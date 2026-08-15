// packages/harness/src/ci-gates.ts — M4's CI wiring layer. Composes the already-built,
// already-tested lanes (suites.ts for two-player; solo-runner/probes-solo/solo-metrics/
// solo-gates for solo; certify.ts for the daily-puzzle certificate check) into ONE dispatcher
// selected by `manifest.solo.format`, never by player count (platform-corrections.md C2).
//
// This module does NOT reimplement any gate logic — every threshold, every property check,
// every probe already lives in suites.ts/solo-gates.ts/probes-solo.ts/certify.ts and is tested
// there. What this module owns is exactly the M4 scope: (a) the per-game DISPATCH, keyed
// correctly and enforced at runtime (`selectGateKind`, `GateKindMismatchError`), and (b) the
// explicit, always->=100 sample-count defaults CI relies on (G-14: "M3's CI gate configs [must]
// pass an explicit runs (>=100) rather than relying on defaults" — extended here to every
// count this module threads through: two-player `games`, solo `seedCount`).
//
// The `data/certificates/<gameId>/<day>.json` re-verification this module performs for a
// daily-puzzle game is the SAME `verifyCertificate` a certified day already passed once at
// `certifyDay` time (certify.ts) — running it again here, off the committed artifact, is what
// makes a stored certificate's CI re-verification (platform §7.7) real rather than assumed.

import { bufferDaysRemaining, readAllCertificates, readCertificate } from "./certify";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import { verifyCertificate } from "@twist-arcade/engine/testkit/checks";
import type { GameManifest } from "@twist-arcade/game-spec";
import { buildSoloRoster, type SafeMoveFn } from "./agents";
import { alwaysSafeVsStrongRatio, grindProbe, runAlwaysSafeProbe, type GrindResult } from "./probes-solo";
import { runSoloAgentOverSeeds, pairedSeeds, type PlaySoloRunOptions } from "./solo-runner";
import { computeSoloDistributionMetrics, type SoloDistributionMetrics, type SoloDistributionMetricsCiTier } from "./solo-metrics";
import { dayOverDayDriftSigma as computeDayOverDayDriftSigma } from "./calibrate";
import {
  allGatesPass,
  evaluateSoloGates,
  type GateResult as SoloGateResult,
  type SoloGateChaseInputsDeferred,
  type SoloGateChaseInputsFull,
  type SoloGatePuzzleInputs,
} from "./solo-gates";
import { runCiSuite, solvedValueAttainment, type CiSuiteReport, type RunCiSuiteOptions } from "./suites";
import { runProbeSuite, type RushDrawAttainment } from "./probes-two-player";

// ---------------------------------------------------------------------------------------
// C2 dispatch — selected by manifest.solo.format, never by player count.
// ---------------------------------------------------------------------------------------

export type GameCiGateKind = "two-player" | "solo-chase" | "solo-puzzle";

/** Thrown by `selectGateKind` for a manifest.solo.format outside the closed union it knows
 *  about today — exhaustiveness guard, matching solo-gates.ts's own posture at the same seam:
 *  a future third format landing here without a corresponding branch fails loudly rather than
 *  silently defaulting to one of the two existing gate tables. */
export class UnrecognizedSoloFormatError extends Error {
  constructor(format: unknown) {
    super(`selectGateKind: unrecognized manifest.solo.format ${JSON.stringify(format)}`);
    this.name = "UnrecognizedSoloFormatError";
  }
}

/**
 * The C2 entry point for THIS module: which of the three gate lanes a manifest's own data
 * selects — read `manifest.solo.format` when `solo` is present, and NEVER consult
 * `manifest.players.max` to decide (a solo game with `players.max === 1` and
 * `solo.format === "score-chase"` must select "solo-chase", not "solo-puzzle", even though
 * both share the same player count — that conflation is exactly the bug C2 exists to prevent).
 */
export function selectGateKind(manifest: Pick<GameManifest, "solo">): GameCiGateKind {
  if (!manifest.solo) return "two-player";
  if (manifest.solo.format === "score-chase") return "solo-chase";
  if (manifest.solo.format === "daily-puzzle") return "solo-puzzle";
  throw new UnrecognizedSoloFormatError((manifest.solo as { format: unknown }).format);
}

/** Thrown by `runGameCiGate` when the caller's requested `kind` disagrees with what
 *  `selectGateKind(manifest)` itself says. This is the runtime enforcement of C2: a caller
 *  that (say) branches on `manifest.players.max === 1 ? "solo-puzzle" : "two-player"` instead
 *  of reading `manifest.solo.format` gets a loud, immediate error here — never a gate table
 *  silently run against the wrong format. */
export class GateKindMismatchError extends Error {
  constructor(gameId: string, requested: GameCiGateKind, actual: GameCiGateKind) {
    super(
      `runGameCiGate: caller requested kind "${requested}" for game "${gameId}", but ` +
        `manifest.solo.format selects "${actual}" (platform-corrections.md C2: the gate table ` +
        "is selected by manifest.solo.format, never by player count or caller assumption)."
    );
    this.name = "GateKindMismatchError";
  }
}

// ---------------------------------------------------------------------------------------
// Two-player lane — thin wrapper over suites.ts's runCiSuite.
// ---------------------------------------------------------------------------------------

/** G-14 (platform-corrections.md M2 entry checklist): "have M3's CI gate configs pass an
 *  explicit runs (>=100) rather than relying on defaults." `runCiSuite` itself defaults
 *  `games` to 200 (already >=100) — this constant exists so THIS module's own default is
 *  explicit and independently >=100, rather than silently inheriting whatever suites.ts
 *  happens to default to today. */
export const DEFAULT_CI_GATE_GAMES = 100;

export interface TwoPlayerCiGateOptions {
  readonly seed: string;
  readonly games?: number;
  readonly suite?: "ci" | "nightly";
  readonly clock?: RunMatchupClock;
  /** C64 (docs/plans/degeneracy-probes.md): the game's own mirrorMove, repo-layout-resolved by
   *  scripts/ci-gates.ts (mirroring the `safeMove` precedent — see that script's own doc) and
   *  threaded through here. Omitted (the default): see `probes-two-player.ts`'s
   *  `MirrorProbeInput` for how that's reported (n/a, never a silent skip, unless
   *  `manifest.mirrorProbe` is declared, in which case it's never consulted at all). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly mirrorMove?: (state: any, lastOppMove: any, legalMoves: readonly any[]) => any;
  /** platform-corrections.md C71 Part 1 / C80: forwarded verbatim to `runCiSuite`'s own
   *  `seedCount` — omitted (the default) keeps this module's exact pre-C80 single-seed
   *  behaviour. `scripts/ci-gates.ts` (the real CI entry point) is the one call site that sets
   *  this for real. NEVER forwarded into `runProbeSuite` below — `probes-two-player.ts`'s own
   *  `RunProbeSuiteOptions` has no `seedCount` field at all (its `games` is deliberately pinned
   *  at 100, independent of the CI suite's own budget), so there is no seam for this option to
   *  leak into probe matchups even by accident; the probe suite always runs single-seed,
   *  n=100, regardless of what `seedCount` the two-player gate table itself used. */
  readonly seedCount?: number;
}

// Re-declared narrowly rather than importing RunMatchupOptions's clock type just to forward
// it — keeps this module's public surface independent of runner.ts's internal shape.
type RunMatchupClock = RunCiSuiteOptions["clock"];

/**
 * Composes `runCiSuite`'s six-plus-mirror-declaration rows with `runProbeSuite`'s three
 * degeneracy-probe rows (C64) onto ONE `CiSuiteReport` — gate rows are concatenated, `matchups`
 * stays exactly what `runCiSuite` produced (probe matchup detail is available from
 * `runProbeSuite` directly for a caller that wants it, e.g. a research script), so this
 * composition can NEVER perturb the pre-existing six rows' own shape (S0's byte-identical
 * guarantee) — it only ever ADDS rows, the same append-only discipline `evaluateMirrorProbeGate`
 * already established at C48/C62.
 *
 * Rush's proven-draw relief (`probes-two-player.ts`'s `RushDrawAttainment`) is computed HERE,
 * once, from `runCiSuite`'s own strong-self-play numbers via `solvedValueAttainment` — the
 * SAME shared computation `evaluateCiGates` itself consults, never re-derived (the plan's own
 * named C55-shape risk). `null` (no self-play ran — an active C27 deferral), no proven
 * `solvedValue`, OR a proven value that is NOT `"draw"` all omit the option, granting no relief
 * by default — `RushDrawAttainment`'s own n/a detail text asserts "a proven, reached draw"
 * verbatim (plan §1.3: "a parity score is evidence of nothing once neither side can win", which
 * is specifically a DRAW property), so a `p0-win`/`p1-win` claim must never reach it (stage-6
 * finding: the prior version checked `attainment.reached` alone, with no `value === "draw"`
 * guard — a reached p0-win/p1-win claim would have gotten unearned relief AND a report sentence
 * asserting a draw that was never proven).
 */
export function runTwoPlayerCiGate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<any, any, any>,
  manifest: GameManifest,
  opts: TwoPlayerCiGateOptions
): CiSuiteReport {
  const suite = opts.suite ?? "ci";
  const ciReport = runCiSuite(engine, manifest, {
    seed: opts.seed,
    games: opts.games ?? DEFAULT_CI_GATE_GAMES,
    suite,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.seedCount !== undefined ? { seedCount: opts.seedCount } : {}),
  });

  // KNOWN GAP, flagged rather than silently patched (platform-corrections.md C71 Part 1 / C80,
  // stage-6 rebase review): `ciReport.matchups` is `null` in TWO cases — an active C27 deferral
  // (pre-existing) AND a multi-seed run (`opts.seedCount > 1`, this correction's own addition,
  // which reports per-seed detail via `seedRuns`/`precision` instead of one `matchups` triple).
  // So rush's draw relief below is silently WITHHELD whenever `seedCount > 1` is used here, even
  // if the multi-seed aggregate itself reached the proven draw (which `evaluateCiGates`'s own
  // `solved-value-reached` row, fed from `ciReport.gates`, correctly recognizes via `precision`-
  // aware `inputs` — this composition layer just doesn't read that same aggregate back out).
  // This is NOT a crash and NOT a false pass/fail: rush simply measures for real instead of
  // getting relief, which is the same safe default as "no proven solvedValue at all." But it is
  // a real, load-bearing interaction between two corrections landing the same day that neither
  // side's own tests exercise (probes' fixtures never set `seedCount`; this correction's own
  // tests never call `runTwoPlayerCiGate` with both `seedCount > 1` AND a proven draw). Recorded
  // as owed rather than fixed here — extending this to read `ciReport.precision.drawRate.mean`/
  // `.firstPlayerWinRate.mean` when `matchups` is null is a real fix, but it is a design choice
  // (does rush's relief want the point estimate the same way the four `evaluateCiGates` rows
  // do, with no precision-awareness of its own?) that the two owning corrections should make
  // together, not one side unilaterally on a rebase.
  const strongSelfPlay = ciReport.matchups?.strongSelfPlay.metrics;
  const attainment = strongSelfPlay
    ? solvedValueAttainment(manifest.solvedValue, {
        drawRate: strongSelfPlay.drawRate,
        firstPlayerWinRate: strongSelfPlay.firstPlayerWinRate,
      })
    : null;
  // `solvedValueAttainment` reports `{achieved, reached}` — no `proof` (it does not need one to
  // do its OWN job, shared with three other evaluateCiGates blocks that already have
  // `manifest.solvedValue!.proof` in scope). `RushDrawAttainment` names the artifact for its own
  // n/a detail string, so it's paired back in here, at the one seam that needs both.
  //
  // `solvedValue.value === "draw"` is REQUIRED, not optional (stage-6 finding) — rush's relief
  // detail text is hardcoded to assert "a proven, reached draw"; granting it off ANY reached
  // value (including p0-win/p1-win) would make that sentence false for a decisive game.
  //
  // `manifest.solvedValue.proof!`: NOT `?? ""` (stage-6 finding — an empty string would let this
  // cite a nonexistent artifact). C23's own invariant already guarantees this is safe: `ciReport`
  // above only exists because `runCiSuite` -> `evaluateCiGates` already ran and did NOT throw
  // `MissingSolvedValueProofError`, which refuses any `solvedValue.value !== "unknown"` with an
  // empty/absent `proof` before any gate evaluates — reaching this line with `value === "draw"`
  // (checked immediately above) therefore already proves `proof` is a real, non-empty string.
  const rushDrawAttainment: RushDrawAttainment | undefined =
    attainment && manifest.solvedValue?.value === "draw"
      ? { reached: attainment.reached, proof: manifest.solvedValue.proof! }
      : undefined;

  // probes-two-player.ts's own doc: `games` is deliberately NEVER forwarded here — the probe
  // suite always defaults to 100, at both suite tiers (plan §3: "deliberately not
  // NIGHTLY_GAMES"), independent of whatever games count the CI suite itself ran with.
  const probeReport = runProbeSuite(engine, manifest, {
    seed: opts.seed,
    suite,
    ...(opts.mirrorMove ? { mirrorMove: opts.mirrorMove } : {}),
    ...(rushDrawAttainment ? { rushDrawAttainment } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
  });

  const gates = [...ciReport.gates, ...probeReport.gates];
  return {
    ...ciReport,
    ok: gates.every((g) => g.status !== "fail"),
    gates,
  };
}

// ---------------------------------------------------------------------------------------
// Solo score-chase lane — real roster + real probes, composed exactly as solo-gates.ts's own
// SoloGateChaseInputs expects.
// ---------------------------------------------------------------------------------------

/** Same G-14 posture, extended to the solo lane's paired-seed count (there is no upstream
 *  default to inherit from — solo-runner.ts's `pairedSeeds` takes `n` as a required argument
 *  precisely so nothing silently supplies too few — but this module's OWN default must still
 *  be explicit and >=100, for the same reason. */
export const DEFAULT_SOLO_SEED_COUNT = 100;

/** Matches solo-runner.ts's own `DEFAULT_BUDGET` ({kind:"rollouts", n:1000}) exactly — this
 *  module always threads an EXPLICIT budget through (rather than relying on solo-runner.ts's
 *  own default) so C19's suite-dependent override below has one number to substitute in
 *  place of, with no silent difference in behavior when no override applies. */
const DEFAULT_SOLO_CHASE_ROLLOUTS = 1000;

/** Empirically grounded floor (platform-corrections.md C19's hidden-info follow-up; see
 *  packages/harness/test/probes-solo.test.ts's own tuning notes on the SAME shipped Strong
 *  agent): at ~1-2 determinization samples per candidate move (K), the shipped
 *  `determinizedFlatMonteCarloPolicy` reproduced a naive majority-vote wrapper's weak
 *  separation; at ~10+ samples/candidate, real separation appeared. 8 sits between those two
 *  observed points — comfortably above the failing case, with headroom under the point that
 *  was shown to work. K = budget.n / legalMoves.length (determinized-flat-mc.ts), so this is
 *  checked as `budget.n / (root branching factor) >= this floor`. */
export const MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE = 8;

/** Thrown by `runSoloChaseCiGate` when, for a `hiddenInformation: true` engine, the resolved
 *  rollout budget (possibly scaled via `manifest.ciGateBudget.soloChaseCiRollouts`) divided by
 *  the root branching factor works out to fewer determinization samples per candidate (K) than
 *  `MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE` — a real, if approximate, generic proxy for "this
 *  budget is too low to trust Strong as a yardstick" (C6: "a gate defined relative to a
 *  reference agent is only as trustworthy as that agent"). Refuses BEFORE running any
 *  self-play, rather than silently reporting an Always-Safe-vs-Strong ratio measured against a
 *  Strong too weak to mean anything. */
export class HiddenInfoBudgetTooLowError extends Error {
  constructor(gameId: string, budgetN: number, branchingFactor: number, samplesPerCandidate: number) {
    super(
      `runSoloChaseCiGate: engine "${gameId}" has hiddenInformation===true and its resolved ` +
        `rollout budget (${budgetN}) divided by the root branching factor (${branchingFactor}) ` +
        `works out to only ~${samplesPerCandidate.toFixed(2)} determinization samples per ` +
        `candidate move — below the floor of ${MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE} known ` +
        "(empirically) to keep the shipped Strong agent a meaningful Always-Safe yardstick " +
        "(platform-corrections.md C19's hidden-info follow-up; C6's 'a gate defined relative to " +
        "a reference agent is only as trustworthy as that agent'). Raise the rollout budget (or " +
        "manifest.ciGateBudget.soloChaseCiRollouts) rather than trust a ratio measured against a " +
        "Strong this weak."
    );
    this.name = "HiddenInfoBudgetTooLowError";
  }
}

/** Root branching factor estimate: legal moves from a freshly-set-up state, under a fixed
 *  probe seed (this is a budget SANITY check, not a measurement the gate itself reports —
 *  determinism here just keeps the check itself reproducible). Good enough for the floor
 *  check above: every shipped hidden-info game's widest branching factor is at or near the
 *  opening position (Mine Run: every cell unrevealed), so this is a conservative (if anything,
 *  slightly pessimistic — later, narrower decisions get proportionally MORE samples per
 *  candidate for the same budget) estimate of K. */
function estimateRootBranchingFactor<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): number {
  const state = engine.setup(1, rngFromSeed("__ci_gate_hidden_info_budget_probe__"));
  return engine.legalMoves(state, 0).length;
}

/** No-op for a perfect-information engine (K/determinization does not apply there at all —
 *  the "Strong" agent for those games is `beamPolicy`, whose cost model is unrelated to this
 *  rollouts-per-candidate coupling). Only ever throws for `hiddenInformation: true`. */
function assertHiddenInfoRolloutBudgetViable<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  budgetN: number
): void {
  if (!engine.meta.hiddenInformation) return;
  const branchingFactor = estimateRootBranchingFactor(engine);
  if (branchingFactor <= 0) return; // nothing to divide by — not this guard's concern
  const samplesPerCandidate = budgetN / branchingFactor;
  if (samplesPerCandidate < MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE) {
    throw new HiddenInfoBudgetTooLowError(engine.meta.id, budgetN, branchingFactor, samplesPerCandidate);
  }
}

export interface SoloChaseCiGateOptions<M extends Json, V> {
  readonly seed: string;
  readonly seedCount?: number;
  readonly moveCap?: number;
  readonly ceilingScore?: number;
  /** The mandatory per-game Always-Safe hook (platform §6/§7.4) — required here at the type
   *  level for the same reason `runAlwaysSafeProbe` hard-errors without one at runtime: a
   *  chase without it cannot pass CI, by design. */
  readonly safeMove: SafeMoveFn<M, V>;
  /** Only meaningful for a misère-tagged chase (solo-gates.ts reports "n/a" with a reason
   *  otherwise) — precomputed by the caller, since what "losing fast" means is per-game
   *  knowledge this module has no business owning. */
  readonly suicide?: { suicideIsOptimalLine: boolean };
  /** C19: selects whether `manifest.ciGateBudget.soloChaseCiRollouts` applies ("ci", the
   *  default) or is ignored in favor of the platform default of 1000 ("nightly" — "keeps the
   *  full-budget table", matching the two-player lane's identical rule in suites.ts). */
  readonly suite?: "ci" | "nightly";
}

export interface SoloChaseGateReport {
  readonly gameId: string;
  readonly format: "score-chase";
  readonly ok: boolean;
  readonly gates: readonly SoloGateResult[];
  readonly metrics: SoloDistributionMetrics | SoloDistributionMetricsCiTier;
  readonly grind: GrindResult;
  /** Undefined iff `manifest.ciGateBudget.deferGatesToNightly` is active at this run (C27) —
   *  Strong never ran, so there is no ratio to report; the gate table's own `"deferred"` rows
   *  explain why. Non-null in every other case, including every run before C27 existed. */
  readonly alwaysSafeVsStrong?: number;
}

export function runSoloChaseCiGate<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: SoloChaseCiGateOptions<M, V>
): SoloChaseGateReport {
  const seedCount = opts.seedCount ?? DEFAULT_SOLO_SEED_COUNT;
  const seeds = pairedSeeds(opts.seed, seedCount);
  const moveCap = opts.moveCap ?? manifest.solo?.moveCap ?? 2000;
  const suite = opts.suite ?? "ci";

  // C27: at suite "ci" only, `manifest.ciGateBudget.deferGatesToNightly` skips Strong (and
  // Always-Safe, which needs Strong's own scores to form a ratio) ENTIRELY — not scaled down
  // (that's `soloChaseCiRollouts` below), skipped, because the manifest has declared this
  // lane's Strong-dependent rows unaffordable to measure at all at this tier (Mine Run:
  // ~4.6h at seedCount=100, measured). Nightly always ignores this field (same rule as
  // `soloChaseCiRollouts`), enforced structurally by this `suite === "ci"` check —
  // `evaluateSoloGates` independently refuses if a caller ever bypasses it and reaches
  // "nightly" with still-deferred chase inputs anyway (C27's abuse guard).
  const deferral = suite === "ci" ? manifest.ciGateBudget?.deferGatesToNightly : undefined;

  const roster = buildSoloRoster(engine);
  // grindProbe needs no roster agent at all — real at every tier, deferred or not.
  const grind = grindProbe(engine, { startSeeds: seeds.slice(0, 3) });

  if (deferral) {
    // Random and Greedy are cheap (no MCTS search) — running them costs nothing close to
    // Strong's, so CI still measures greedyVsRandomRatio for real; only the rows that need
    // Strong's own scores are unaffordable and defer.
    const rolloutsN = manifest.ciGateBudget?.soloChaseCiRollouts ?? DEFAULT_SOLO_CHASE_ROLLOUTS;
    const runOpts: PlaySoloRunOptions = { moveCap, budget: { kind: "rollouts", n: rolloutsN } };
    const randomSummary = runSoloAgentOverSeeds(engine, roster.random, seeds, runOpts);
    const greedySummary = runSoloAgentOverSeeds(engine, roster.greedy, seeds, runOpts);
    const metrics = computeSoloDistributionMetrics({ random: randomSummary, greedy: greedySummary });

    const chaseInputs: SoloGateChaseInputsDeferred = {
      metrics,
      grind,
      deferredToTier: "nightly",
      deferredReason: deferral.reason,
      ...(opts.suicide ? { suicide: opts.suicide } : {}),
    };
    const gates = evaluateSoloGates({ manifest, chase: chaseInputs, suite });

    return {
      gameId: manifest.id,
      format: "score-chase",
      ok: allGatesPass(gates),
      gates,
      metrics,
      grind,
    };
  }

  // C19: at suite "ci" (the default) only, measure Strong/Always-Safe with
  // `ciGateBudget.soloChaseCiRollouts` rollouts instead of the platform default — "nightly"
  // always uses the full default (the plan's "nightly keeps the full-budget table", the same
  // rule suites.ts's two-player lane follows). For a hidden-info engine this SAME number also
  // sets the determinization sample count K (K = n / legalMoves.length) — the coupling is
  // exactly why the floor guard below is checked against this resolved value, not the raw
  // manifest field.
  const ciOverride = manifest.ciGateBudget?.soloChaseCiRollouts;
  const rolloutsN = suite === "ci" && ciOverride !== undefined ? ciOverride : DEFAULT_SOLO_CHASE_ROLLOUTS;

  assertHiddenInfoRolloutBudgetViable(engine, rolloutsN);

  const runOpts: PlaySoloRunOptions = { moveCap, budget: { kind: "rollouts", n: rolloutsN } };

  const randomSummary = runSoloAgentOverSeeds(engine, roster.random, seeds, runOpts);
  const greedySummary = runSoloAgentOverSeeds(engine, roster.greedy, seeds, runOpts);
  const strongSummary = runSoloAgentOverSeeds(engine, roster.strong, seeds, runOpts);
  const metrics = computeSoloDistributionMetrics(
    { random: randomSummary, greedy: greedySummary, strong: strongSummary },
    opts.ceilingScore !== undefined ? { ceilingScore: opts.ceilingScore } : {}
  );

  const alwaysSafeSummary = runAlwaysSafeProbe(engine, opts.safeMove, seeds, runOpts);
  const alwaysSafeVsStrong = alwaysSafeVsStrongRatio(alwaysSafeSummary, strongSummary);

  const chaseInputs: SoloGateChaseInputsFull = {
    metrics,
    grind,
    alwaysSafeVsStrong,
    ...(opts.suicide ? { suicide: opts.suicide } : {}),
  };

  const gates = evaluateSoloGates({ manifest, chase: chaseInputs, suite });

  return {
    gameId: manifest.id,
    format: "score-chase",
    ok: allGatesPass(gates),
    gates,
    metrics,
    grind,
    alwaysSafeVsStrong,
  };
}

// ---------------------------------------------------------------------------------------
// Solo daily-puzzle lane — reads committed certificates off disk and RE-VERIFIES the day
// under review through the same verifyCertificate every certified day already passed once.
// ---------------------------------------------------------------------------------------

export interface SoloPuzzleCiGateOptions {
  /** e.g. `path.join(repoRoot, "data/certificates")` — never a baked-in path (certify.ts's
   *  own convention; see its module doc). */
  readonly baseDir: string;
  /** The day under review (UTC "YYYY-MM-DD") — normally "today" in a real CI run, injected
   *  here so this stays a pure-inputs, testable function of its arguments. */
  readonly today: string;
  /** Day arithmetic, injected for the same reason `bufferDaysRemaining` (calibrate.ts)
   *  requires it: `dayFor(day, offset)` for offset in `[-1, horizonDays)` — a negative
   *  offset (yesterday) is used to look up the prior day for the day-over-day drift gate. */
  readonly dayFor: (isoDay: string, offset: number) => string;
  readonly horizonDays?: number;
}

export interface SoloPuzzleGateReport {
  readonly gameId: string;
  readonly format: "daily-puzzle";
  readonly ok: boolean;
  readonly gates: readonly SoloGateResult[];
}

export async function runSoloPuzzleCiGate<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  manifest: GameManifest,
  opts: SoloPuzzleCiGateOptions
): Promise<SoloPuzzleGateReport> {
  const gameId = manifest.id;
  const horizonDays = opts.horizonDays ?? 90;

  const allCerts = await readAllCertificates(opts.baseDir, gameId);
  const certifiedDays = new Set(allCerts.map((c) => c.day));
  const todayCert = await readCertificate(opts.baseDir, gameId, opts.today);

  let verifiedByReplay = false;
  if (todayCert) {
    try {
      verifyCertificate(engine, {
        gameId: todayCert.gameId,
        gameVersion: todayCert.gameVersion,
        engineVersion: todayCert.engineVersion,
        seed: todayCert.seed,
        moveLog: todayCert.moveLog,
        par: todayCert.par,
        parKind: todayCert.parKind,
        ...(todayCert.guessFree !== undefined ? { guessFree: todayCert.guessFree } : {}),
      });
      verifiedByReplay = true;
    } catch {
      verifiedByReplay = false;
    }
  }

  const certifiedBufferDays = bufferDaysRemaining(certifiedDays, opts.today, opts.dayFor, horizonDays);

  const previousDay = opts.dayFor(opts.today, -1);
  const previousCert = allCerts.find((c) => c.day === previousDay);
  const dayOverDayDriftSigma =
    todayCert && previousCert
      ? computeDayOverDayDriftSigma(previousCert.features.zScore, todayCert.features.zScore)
      : undefined;

  // A stored certificate's own `nonce` IS the count of rejected candidates that preceded it
  // (certifyDay's loop increments nonce once per attempt) — so the generator-rejection-rate
  // gate for THIS specific certified day is recoverable straight from the artifact, with no
  // need to re-run (or separately persist) the generation attempt log.
  const generatorRejectionRate = todayCert ? todayCert.nonce / (todayCert.nonce + 1) : 0;

  const puzzleInputs: SoloGatePuzzleInputs = {
    certificate: {
      present: todayCert !== undefined,
      verifiedByReplay,
      par: todayCert?.par ?? 0,
    },
    // DailyCertificate.features stores `deadEndDensity`, not `randomPlayoutSolveRate` directly
    // (game-spec/src/certificate.ts) — but certify.ts's own `randomPlayoutStats` only ever
    // tallies a random playout as EITHER "won" or "dead-ended" (no third outcome), so the two
    // are always exact complements at generation time; deriving it back here needs no new
    // certificate field.
    randomPlayoutSolveRate: todayCert ? 1 - todayCert.features.deadEndDensity : 0,
    forcedMoveFraction: todayCert?.features.forcedMoveFraction ?? 0,
    generatorRejectionRate,
    ...(dayOverDayDriftSigma !== undefined ? { dayOverDayDriftSigma } : {}),
    certifiedBufferDays,
    ...(engine.meta.hiddenInformation ? { fogDeductionOnly: todayCert?.guessFree ?? false } : {}),
  };

  const gates = evaluateSoloGates({ manifest, puzzle: puzzleInputs });

  return { gameId, format: "daily-puzzle", ok: allGatesPass(gates), gates };
}

// ---------------------------------------------------------------------------------------
// The unified dispatcher — one call site a CI script drives per registered game.
// ---------------------------------------------------------------------------------------

export type GameCiGateOptions<M extends Json = Json, V = unknown> =
  | ({ readonly kind: "two-player" } & TwoPlayerCiGateOptions)
  | ({ readonly kind: "solo-chase" } & SoloChaseCiGateOptions<M, V>)
  | ({ readonly kind: "solo-puzzle" } & SoloPuzzleCiGateOptions);

export type GameCiGateReport =
  | { readonly kind: "two-player"; readonly gameId: string; readonly ok: boolean; readonly report: CiSuiteReport }
  | { readonly kind: "solo-chase"; readonly gameId: string; readonly ok: boolean; readonly report: SoloChaseGateReport }
  | { readonly kind: "solo-puzzle"; readonly gameId: string; readonly ok: boolean; readonly report: SoloPuzzleGateReport };

/**
 * The one call site a CI script needs per registered game: dispatches to the right lane by
 * `manifest.solo.format` (never player count) and REFUSES a caller-supplied `kind` that
 * disagrees with what the manifest itself says (`GateKindMismatchError`) — so a bug in the
 * CALLER's own dispatch logic (e.g. keying off `players.max` after all) cannot silently run
 * the wrong gate table; it throws instead of producing a report that looks legitimate.
 */
export async function runGameCiGate<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: GameCiGateOptions<M, V>
): Promise<GameCiGateReport> {
  const actual = selectGateKind(manifest);
  if (opts.kind !== actual) {
    throw new GateKindMismatchError(manifest.id, opts.kind, actual);
  }

  if (opts.kind === "two-player") {
    const report = runTwoPlayerCiGate(engine, manifest, opts);
    return { kind: "two-player", gameId: manifest.id, ok: report.ok, report };
  }

  if (opts.kind === "solo-chase") {
    const report = runSoloChaseCiGate(engine, manifest, opts);
    return { kind: "solo-chase", gameId: manifest.id, ok: report.ok, report };
  }

  // opts.kind === "solo-puzzle"
  const report = await runSoloPuzzleCiGate(engine, manifest, opts);
  return { kind: "solo-puzzle", gameId: manifest.id, ok: report.ok, report };
}

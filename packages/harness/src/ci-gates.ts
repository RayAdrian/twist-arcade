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
import { verifyCertificate } from "@twist-arcade/engine/testkit/checks";
import type { GameManifest } from "@twist-arcade/game-spec";
import { buildSoloRoster, type SafeMoveFn } from "./agents";
import { alwaysSafeVsStrongRatio, grindProbe, runAlwaysSafeProbe, type GrindResult } from "./probes-solo";
import { runSoloAgentOverSeeds, pairedSeeds, type PlaySoloRunOptions } from "./solo-runner";
import { computeSoloDistributionMetrics, type SoloDistributionMetrics } from "./solo-metrics";
import { dayOverDayDriftSigma as computeDayOverDayDriftSigma } from "./calibrate";
import {
  allGatesPass,
  evaluateSoloGates,
  type GateResult as SoloGateResult,
  type SoloGateChaseInputs,
  type SoloGatePuzzleInputs,
} from "./solo-gates";
import { runCiSuite, type CiSuiteReport, type RunCiSuiteOptions } from "./suites";

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
}

// Re-declared narrowly rather than importing RunMatchupOptions's clock type just to forward
// it — keeps this module's public surface independent of runner.ts's internal shape.
type RunMatchupClock = RunCiSuiteOptions["clock"];

export function runTwoPlayerCiGate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<any, any, any>,
  manifest: GameManifest,
  opts: TwoPlayerCiGateOptions
): CiSuiteReport {
  return runCiSuite(engine, manifest, {
    seed: opts.seed,
    games: opts.games ?? DEFAULT_CI_GATE_GAMES,
    suite: opts.suite ?? "ci",
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
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
}

export interface SoloChaseGateReport {
  readonly gameId: string;
  readonly format: "score-chase";
  readonly ok: boolean;
  readonly gates: readonly SoloGateResult[];
  readonly metrics: SoloDistributionMetrics;
  readonly grind: GrindResult;
  readonly alwaysSafeVsStrong: number;
}

export function runSoloChaseCiGate<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: SoloChaseCiGateOptions<M, V>
): SoloChaseGateReport {
  const seedCount = opts.seedCount ?? DEFAULT_SOLO_SEED_COUNT;
  const seeds = pairedSeeds(opts.seed, seedCount);
  const moveCap = opts.moveCap ?? manifest.solo?.moveCap ?? 2000;
  const runOpts: PlaySoloRunOptions = { moveCap };

  const roster = buildSoloRoster(engine);
  const randomSummary = runSoloAgentOverSeeds(engine, roster.random, seeds, runOpts);
  const greedySummary = runSoloAgentOverSeeds(engine, roster.greedy, seeds, runOpts);
  const strongSummary = runSoloAgentOverSeeds(engine, roster.strong, seeds, runOpts);
  const metrics = computeSoloDistributionMetrics(
    { random: randomSummary, greedy: greedySummary, strong: strongSummary },
    opts.ceilingScore !== undefined ? { ceilingScore: opts.ceilingScore } : {}
  );

  const grind = grindProbe(engine, { startSeeds: seeds.slice(0, 3) });

  const alwaysSafeSummary = runAlwaysSafeProbe(engine, opts.safeMove, seeds, runOpts);
  const alwaysSafeVsStrong = alwaysSafeVsStrongRatio(alwaysSafeSummary, strongSummary);

  const chaseInputs: SoloGateChaseInputs = {
    metrics,
    grind,
    alwaysSafeVsStrong,
    ...(opts.suicide ? { suicide: opts.suicide } : {}),
  };

  const gates = evaluateSoloGates({ manifest, chase: chaseInputs });

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

// packages/harness/src/probes-two-player.ts — the two-player degeneracy probe suite
// (docs/plans/degeneracy-probes.md, wiring platform-corrections.md C64's finding). Mirror,
// stall, and rush (packages/bots/src/probes/*.ts) existed as real, tested bot policies with
// ZERO call sites outside three hand-written Tilt research scripts (scripts/research/
// tilt-t4-gates.ts and friends) — five games shipped through a gate table that silently omitted
// all three, while the SOLO probes (probes-solo.ts) were genuinely enforced the whole time.
//
// SAME TWO-LAYER SPLIT AS suites.ts, FOR THE SAME REASON (see that module's own doc):
//   1. `evaluateProbeGates` — a PURE function over already-computed numbers (`ProbeGateInputs`).
//      Every threshold has a test that plants a violation of EXACTLY that number, cheaply and
//      deterministically (see probes-two-player.test.ts).
//   2. `runProbeSuite` — wires `evaluateProbeGates` to REAL self-play via `runMatchup`, using the
//      SAME roster/tier-resolution machinery `runCiSuite` uses (never a second, independently
//      re-derived clone — see `resolveEffectiveRuthlessTier`'s own doc in suites.ts).
//
// KEPT BESIDE runCiSuite, NEVER FOLDED IN (plan §2's own decision, restated here since it is
// this module's whole reason for existing as a separate file):
//   1. Byte-identical guarantee — leaving runCiSuite's own signature, matchups, and six rows
//      untouched makes C63's fixed-seed diff (S0) trivially provable for THIS change too.
//   2. Inputs differ — the mirror probe needs the game's own `mirrorMove`, which lives in the
//      game package, is not in the manifest, and is resolved by repo-layout knowledge
//      scripts/ci-gates.ts explicitly owns (the `safeMove` precedent) — threading a
//      function-valued hook through runCiSuite itself would leak that layer into a module that
//      deliberately knows nothing about repo file layout.
//   3. The two-layer pattern repeats the structure every existing lane already has.
//
// MIRROR ROW EXCLUSIVITY (plan §4.3): a manifest that declares `manifest.mirrorProbe` gets its
// n/a row from suites.ts's own `evaluateMirrorProbeGate` (runCiSuite's C48/C62 mechanism) — this
// module produces NO "mirror-probe" row for that game (`mirror.kind === "suppressed"`). A
// non-declaring game gets exactly ONE "mirror-probe" row from THIS module instead: measured
// (`"available"`, a real `mirrorMove` was resolved) or a distinct n/a (`"unavailable"` — no
// `mirrorMove` was resolved; whether that is a hard refusal at all is decided one layer up, by
// scripts/ci-gates.ts's `MirrorMoveNotExportedError` for a `"symmetric"`-tagged game — this
// module never sees tags at all, by design, mirroring `evaluateMirrorProbeGate`'s own
// `Pick<GameManifest, "id" | "mirrorProbe">` parameter type).
//
// STALL/RUSH have no declaration-based skip mechanism at all — every two-player game that
// reaches this module gets both rows.

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { GameManifest, HarnessThresholds } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import { agentParityScore, agentWinRate } from "./metrics";
import { mirrorAgent, resolveNamedAgent } from "./roster";
import { runMatchup, type MatchupReport, type RunMatchupOptions } from "./runner";
import {
  applyException,
  deferredGate,
  findTier,
  resolveEffectiveRuthlessTier,
  tierAgent,
  validateExceptions,
  type CiGateDeferral,
  type GateResult,
  type GateStatus,
  type ManifestException,
} from "./suites";

/** The mirror-probe row's three-way shape (plan §4.3's exclusivity rule) — decided by the
 *  CALLER (`runProbeSuite`) from manifest + resolved-export state, BEFORE any self-play runs:
 *    - `"suppressed"`: `manifest.mirrorProbe` is declared — produce NO row at all (the existing
 *      `evaluateMirrorProbeGate` in suites.ts already covers this game's mirror-probe row).
 *    - `"unavailable"`: not declared, and no `mirrorMove` was resolved — a real n/a row, citing
 *      `reason`, unconditionally (never "deferred" — see the module doc above: this is a
 *      structural fact about what was resolvable, independent of self-play cost, the same
 *      posture `ruthless-vs-standard`'s "no standard tier" branch takes ahead of deferral in
 *      suites.ts).
 *    - `"available"`: not declared, a `mirrorMove` WAS resolved — `winRate` is the measured P2
 *      win rate (wins/all games — see the gate's own detail-string comment for why "draws
 *      excluded" is the wrong way to say this), `drawRate` is the SAME matchup's draw rate,
 *      recorded (not gated on) per the stage-6 finding below. Both NaN-poisoned (C4) when
 *      unreachable (deferred).
 *
 *  STAGE-6 FINDING, RECORDED NOT FIXED HERE: `game-theory-lens` §5.4 names the canonical mirror
 *  degeneracy as "P2 copying P1's move through the center can force a draw (or worse)" — but
 *  wins/games scores a mirror that draws 100% of its games as a 0% win rate, i.e. a clean PASS,
 *  so this metric cannot fire on the exact pathology its own source document most emphasizes
 *  (and strong-self-play's draw-rate gate does not catch it either, since that measures a
 *  DIFFERENT matchup). The threshold NUMBERS (`mirrorProbeWinRateWarn`/`Fail`) are RECOVERED
 *  (roadmap.md:258, game-theory-lens §2.7/§3.4); the METRIC BINDING — using wins/games at all,
 *  rather than a parity-style score with the same proven-draw relief rush-probe has — is
 *  PROPOSED, a plan amendment the coordinator is recording, not an in-branch redesign (a
 *  parity-style metric would false-fire on Fadeout, where a drawing mirror is health, without
 *  the SAME relief rush-probe gets). `drawRate` is recorded in the gate detail below so a future
 *  S5 baseline captures this even though today's gate cannot act on it. */
export type MirrorProbeInput =
  | { readonly kind: "suppressed" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "available"; readonly winRate: number; readonly drawRate: number };

/** The already-computed numbers `evaluateProbeGates` gates on — kept separate from real
 *  `MatchupReport`s so the pure evaluator can be tested with hand-built values, no real self-play
 *  required (mirrors suites.ts's own `GateInputs`). */
export interface ProbeGateInputs {
  readonly mirror: MirrorProbeInput;
  /** Stall-probe assertion A (plan §1.2): cap-hit rate ACROSS the stall matchup. */
  readonly stallCapHitRate: number;
  /** Stall-probe assertion B: stall's win rate as P2 — wins/all games (a draw counts as a
   *  non-win, but stays IN the denominator; this is deliberately NOT a win+draw metric, plan
   *  §1.2: "in a proven-draw game like Fadeout, stall drawing against correct play is the
   *  correct outcome, and a win+draw metric would fire on health"). */
  readonly stallWinRate: number;
  /** Rush-probe's parity score, (wins + 0.5*draws)/games (plan §1.3) — see
   *  `metrics.ts`'s `agentParityScore`, the metric this field is built from. */
  readonly rushScore: number;
}

/** Reuses suites.ts's OWN `solvedValueAttainment` computation (plan §1.3 / the plan's own named
 *  C55-shape risk: "re-deriving instead of sharing it lets the probe relief and
 *  solved-value-reached drift") — never re-derived here. The composing caller (`ci-gates.ts`'s
 *  `runTwoPlayerCiGate`) computes this ONCE from `runCiSuite`'s own strong-self-play numbers and
 *  threads the result through `runProbeSuite`'s `rushDrawAttainment` option. */
export interface RushDrawAttainment {
  readonly reached: boolean;
  readonly proof: string;
}

/** The three probe gate names — named once here so the nightly abuse guard below stays in
 *  lockstep with the gate blocks themselves (mirrors `DEFERRABLE_CI_GATES`'s own doc in
 *  suites.ts, the sibling this class is modeled on). */
const PROBE_GATE_NAMES = ["mirror-probe", "stall-probe", "rush-probe"] as const;

/** Thrown by `evaluateProbeGates` when suite `"nightly"` is given an active `CiGateDeferral`
 *  (platform-corrections.md C27's abuse guard, same posture as suites.ts's
 *  `TwoPlayerDeferredGateAtNightlyError` and solo-gates.ts's `SoloDeferredGateAtNightlyError`).
 *
 *  STAGE-6 FINDING (fixed here): this refusal is named explicitly in the plan (§3, §5 S2, and
 *  "done means" #3's own planted violation) but was never built — `runProbeSuite` structurally
 *  never constructs an active deferral at suite "nightly" (it only ever consults
 *  `manifest.ciGateBudget.deferGatesToNightly` when `suite === "ci"`), so the gap was
 *  unreachable through the wrapper and the existing test suite only ever exercised that
 *  wrapper's own construction, never this evaluator's own seam. `evaluateProbeGates` is a public
 *  export precisely so it CAN be called standalone — a caller that does, and hands it
 *  `(suite: "nightly", deferral: {active: true})`, would otherwise get three silent `"deferred"`
 *  rows: a gate deferred at every tier, C27's exact abuse case, and precisely the "a documented
 *  protection that was never built" shape this whole module exists to close (C64) — recurring
 *  one seam over, inside the very change that closes it. */
export class ProbeDeferredGateAtNightlyError extends Error {
  constructor(reason: string) {
    super(
      `evaluateProbeGates: suite "nightly" was given an ACTIVE deferral (reason: "${reason}") ` +
        `for [${PROBE_GATE_NAMES.join(", ")}] (platform-corrections.md C27). A gate deferred at ` +
        "EVERY tier never runs — nightly must measure the full probe suite for real, never " +
        "defer again."
    );
    this.name = "ProbeDeferredGateAtNightlyError";
  }
}

/**
 * Pure gate evaluation (see module doc for why this is split from `runProbeSuite`). Validates
 * its OWN `exceptions` standalone (`validateExceptions`, suites.ts) — a pure evaluator tested in
 * isolation (as this one is meant to be) must never silently accept a dead exception just
 * because no caller happened to run `evaluateCiGates` first with the same list; that would be
 * exactly the quiet-gap shape this codebase's other validators exist to rule out everywhere.
 * Refuses (`ProbeDeferredGateAtNightlyError`) the identical abuse shape immediately after, for
 * the identical reason.
 */
export function evaluateProbeGates(
  inputs: ProbeGateInputs,
  thresholds: HarnessThresholds,
  exceptions: readonly ManifestException[] = [],
  suite: "ci" | "nightly" = "ci",
  deferral?: CiGateDeferral,
  rushDrawAttainment?: RushDrawAttainment
): GateResult[] {
  validateExceptions(exceptions);

  // C27's abuse guard (stage-6 finding — see ProbeDeferredGateAtNightlyError's own doc): nightly
  // is the ONLY tier allowed to report these three rows as anything other than "deferred" — a
  // caller that hands nightly an active deferral gets refused here, loudly, rather than shipping
  // a "nightly: OK" report where the probe suite never actually ran.
  if (suite === "nightly" && deferral?.active) {
    throw new ProbeDeferredGateAtNightlyError(deferral.reason);
  }

  const results: GateResult[] = [];

  /** The severity split every probe gate shares (plan §1.4): "at suite 'ci' a probe fail is
   *  downgraded to warn; at 'nightly' it fails for real — the same severity rule
   *  ruthless-vs-standard already carries." A raw "pass"/"warn" is reported unchanged; a raw
   *  "fail" routes through `applyException` ONLY at nightly (an exception can only ever downgrade
   *  a REAL fail — never the ci-tier's own structural warn-instead-of-fail, which bypasses
   *  applyException entirely, exactly mirroring `ruthless-vs-standard`'s own block in suites.ts). */
  function pushSeverityAdjusted(gate: "mirror-probe" | "stall-probe" | "rush-probe", raw: GateStatus, detail: string): void {
    if (raw === "pass" || raw === "warn") {
      results.push({ gate, status: raw, detail });
    } else if (suite === "nightly") {
      results.push(applyException(gate, "fail", detail, exceptions));
    } else {
      results.push({ gate, status: "warn", detail });
    }
  }

  // -------------------------------------------------------------------------------------
  // mirror-probe
  // -------------------------------------------------------------------------------------
  if (inputs.mirror.kind === "suppressed") {
    // No row at all — evaluateMirrorProbeGate (suites.ts) already covers this game.
  } else if (inputs.mirror.kind === "unavailable") {
    // Structural fact, independent of deferral (see MirrorProbeInput's own doc) — checked
    // BEFORE the deferral branch, same ordering rule ruthless-vs-standard's "no standard tier"
    // uses in suites.ts.
    results.push({ gate: "mirror-probe", status: "n/a", detail: `not applicable: ${inputs.mirror.reason}` });
  } else if (deferral?.active) {
    results.push(deferredGate("mirror-probe", deferral.reason));
  } else {
    const wr = inputs.mirror.winRate;
    const raw: GateStatus = wr >= thresholds.mirrorProbeWinRateFail ? "fail" : wr >= thresholds.mirrorProbeWinRateWarn ? "warn" : "pass";
    // STAGE-6 FINDING: `drawRate` is recorded here — NOT gated on (see MirrorProbeInput's own
    // doc for why this metric cannot fire on the canonical "mirror forces a draw" pathology
    // today) — so a future S5 baseline captures it even though this gate cannot act on it yet.
    const detail =
      `${(wr * 100).toFixed(1)}% win rate as P2 (wins/all games; draws count as non-wins, not excluded from the denominator), ` +
      `mirror draw rate ${(inputs.mirror.drawRate * 100).toFixed(1)}% (recorded only — see the metric-binding note on MirrorProbeInput), ` +
      `(warn >= ${(thresholds.mirrorProbeWinRateWarn * 100).toFixed(0)}%, fail >= ${(thresholds.mirrorProbeWinRateFail * 100).toFixed(0)}%, ${suite})`;
    pushSeverityAdjusted("mirror-probe", raw, detail);
  }

  // -------------------------------------------------------------------------------------
  // stall-probe — two assertions (plan §1.2), one row, the worse of the two wins (matches
  // suites.ts's own "mean-plies" precedent: a band condition AND a cap-hit condition folded
  // into a single gate row).
  // -------------------------------------------------------------------------------------
  if (deferral?.active) {
    results.push(deferredGate("stall-probe", deferral.reason));
  } else {
    const capHitFail = inputs.stallCapHitRate > thresholds.stallProbeCapHitFail;
    const capHitWarn = !capHitFail && inputs.stallCapHitRate > 0;
    const winRateFail = inputs.stallWinRate >= thresholds.stallProbeWinRateFail;
    const winRateWarn = !winRateFail && inputs.stallWinRate >= thresholds.stallProbeWinRateWarn;
    const raw: GateStatus = capHitFail || winRateFail ? "fail" : capHitWarn || winRateWarn ? "warn" : "pass";
    const detail =
      `cap-hit rate ${(inputs.stallCapHitRate * 100).toFixed(2)}% (fail > ${(thresholds.stallProbeCapHitFail * 100).toFixed(0)}%, warn > 0%), ` +
      `win rate ${(inputs.stallWinRate * 100).toFixed(1)}% as P2 (wins/all games; draws count as non-wins, not excluded from the denominator) ` +
      `(warn >= ${(thresholds.stallProbeWinRateWarn * 100).toFixed(0)}%, fail >= ${(thresholds.stallProbeWinRateFail * 100).toFixed(0)}%, ${suite})`;
    pushSeverityAdjusted("stall-probe", raw, detail);
  }

  // -------------------------------------------------------------------------------------
  // rush-probe — plan §1.3's proven-draw relief, reusing solvedValueAttainment (see
  // RushDrawAttainment's own doc). Checked AFTER deferral (same reasoning as draw-rate/FPA's
  // own proven-draw relief in suites.ts: whether the proof was reached is itself computed from
  // self-play data that never ran this tier when deferred — unmeasured, not "known true").
  // -------------------------------------------------------------------------------------
  if (deferral?.active) {
    results.push(deferredGate("rush-probe", deferral.reason));
  } else if (rushDrawAttainment?.reached) {
    results.push({
      gate: "rush-probe",
      status: "n/a",
      detail: `manifest.solvedValue is a proven, reached draw (${rushDrawAttainment.proof}) — a parity score is evidence of nothing once neither side can win`,
    });
  } else {
    const raw: GateStatus =
      inputs.rushScore >= thresholds.rushProbeScoreFail ? "fail" : inputs.rushScore > thresholds.rushProbeScoreWarn ? "warn" : "pass";
    const detail =
      `${(inputs.rushScore * 100).toFixed(1)}% parity score vs mcts1k, (wins + 0.5*draws)/games (warn > ${(thresholds.rushProbeScoreWarn * 100).toFixed(0)}%, ` +
      `fail >= ${(thresholds.rushProbeScoreFail * 100).toFixed(0)}%, ${suite})`;
    pushSeverityAdjusted("rush-probe", raw, detail);
  }

  return results;
}

export interface RunProbeSuiteOptions<S extends WithEffects, M extends Json> {
  /** The platform's pinned three-argument mirror convention (roster.ts's own doc — `M | null`,
   *  the runner falls back to a random legal move when it returns `null`). Omitted (the
   *  default): a game that either declares `manifest.mirrorProbe` OR has no resolvable export —
   *  see `MirrorProbeInput`'s own doc for how that omission is reported. */
  readonly mirrorMove?: (state: S, lastOppMove: M | null, legalMoves: readonly M[]) => M | null;
  readonly seed: string;
  /** Default 100. Deliberately NEVER suite-scaled the way `runCiSuite`'s own `games` is
   *  (plan §3: "nightly: same matchups at shipped budgets, fail severity, and games: 100 —
   *  deliberately not NIGHTLY_GAMES (2000)" — probe thresholds sit >=40pp above the healthy
   *  reading, so n=100 already separates pass from fail by ~4-5 SD; 20x the games buys nothing
   *  the thresholds need). Composition callers (`ci-gates.ts`) must never forward their own
   *  CI_GAMES/NIGHTLY_GAMES split into this option. */
  readonly games?: number;
  readonly suite?: "ci" | "nightly";
  readonly clock?: RunMatchupOptions["clock"];
  /** See `RushDrawAttainment`'s own doc — omitted (the default) when there is no proven
   *  `solvedValue`, or when the composing caller has no self-play numbers yet to compute it
   *  from (e.g. a standalone `runProbeSuite` call): rush then measures for real, never granting
   *  unearned relief by default. */
  readonly rushDrawAttainment?: RushDrawAttainment;
}

export interface ProbeSuiteReport {
  readonly gameId: string;
  readonly suite: "ci" | "nightly";
  /** True iff no gate has status "fail" ("warn"/"n/a"/"deferred" do not fail the suite) — same
   *  convention as `CiSuiteReport.ok`. */
  readonly ok: boolean;
  readonly gates: readonly GateResult[];
  /** `null` iff `manifest.ciGateBudget.deferGatesToNightly` is active at this run (C27, reused
   *  from suites.ts) — no self-play ran at all. Non-null otherwise; `mirror` is independently
   *  `null` within a non-null `matchups` when the mirror row was suppressed or unavailable (no
   *  mirror matchup ever ran for this game, even though stall/rush did). */
  readonly matchups: {
    readonly mirror: MatchupReport | null;
    readonly stall: MatchupReport | null;
    readonly rush: MatchupReport | null;
  } | null;
}

/**
 * Runs the real self-play the probe suite needs (plan §1): mirror (the game's own `mirrorMove`
 * as P2, `mirrorSeats: false`, vs "ruthless" at the suite's effective budget — the SAME
 * in-memory-cloned tier `runCiSuite` measures with, via `resolveEffectiveRuthlessTier`), stall
 * (roster `"stall"` as P2, `mirrorSeats: false`, vs "ruthless"), and rush (roster `"rush"` vs
 * roster `"mcts1k"`, `mirrorSeats: true`) — then evaluates every gate against the manifest's own
 * threshold overrides and exceptions, exactly like `runCiSuite` does for its own six rows.
 */
export function runProbeSuite<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: RunProbeSuiteOptions<S, M>
): ProbeSuiteReport {
  const games = opts.games ?? 100;
  const suite = opts.suite ?? "ci";
  const thresholds: HarnessThresholds = { ...DEFAULT_HARNESS_THRESHOLDS, ...manifest.thresholds };
  const exceptions = manifest.exceptions ?? [];
  validateExceptions(exceptions);

  const mirrorSuppressed = manifest.mirrorProbe !== undefined;
  const mirrorUnavailableInput: MirrorProbeInput = mirrorSuppressed
    ? { kind: "suppressed" }
    : opts.mirrorMove
      ? { kind: "available", winRate: Number.NaN, drawRate: Number.NaN } // placeholder — overwritten once self-play actually runs, below
      : { kind: "unavailable", reason: "no mirrorMove was supplied to runProbeSuite for this game" };

  const shippedRuthlessTier = findTier(manifest, "ruthless");
  if (!shippedRuthlessTier) {
    throw new Error(
      `runProbeSuite: manifest "${manifest.id}" has no "ruthless" difficulty tier — the mirror/` +
        "stall probe matchups have no opponent to run."
    );
  }

  // C27: same rule as runCiSuite — at suite "ci" only, an active deferGatesToNightly skips ALL
  // self-play here too, reused (not duplicated), per plan §3.
  const deferral: CiGateDeferral | undefined =
    suite === "ci" && manifest.ciGateBudget?.deferGatesToNightly
      ? { active: true, reason: manifest.ciGateBudget.deferGatesToNightly.reason }
      : undefined;

  if (deferral?.active) {
    const gates = evaluateProbeGates(
      {
        mirror: mirrorUnavailableInput,
        stallCapHitRate: Number.NaN,
        stallWinRate: Number.NaN,
        rushScore: Number.NaN,
      },
      thresholds,
      exceptions,
      suite,
      deferral,
      opts.rushDrawAttainment
    );
    return {
      gameId: manifest.id,
      suite,
      ok: gates.every((g) => g.status !== "fail"),
      gates,
      matchups: null,
    };
  }

  // Reuses runCiSuite's EXACT budget resolution (C19/C20/C22/C26) — "ruthless at the suite's
  // effective budget" means the SAME in-memory clone, never a second, independently-scaled one.
  const { ruthlessTier } = resolveEffectiveRuthlessTier(manifest, suite, shippedRuthlessTier);
  const ruthless = tierAgent<S, M>("ruthless", ruthlessTier);

  let mirrorMatchup: MatchupReport | null = null;
  let mirrorInput: MirrorProbeInput = mirrorUnavailableInput;
  if (!mirrorSuppressed && opts.mirrorMove) {
    const mirror = mirrorAgent<S, M>(opts.mirrorMove);
    mirrorMatchup = runMatchup(engine, ruthless, mirror, {
      games,
      seed: `${opts.seed}:mirror-probe`,
      mirrorSeats: false,
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
    mirrorInput = {
      kind: "available",
      winRate: agentWinRate(mirrorMatchup.outcomes, "mirror"),
      // Stage-6 finding: recorded so the gate detail (and a future S5 baseline) captures it,
      // even though the gate itself does not act on it yet — see MirrorProbeInput's own doc.
      drawRate: mirrorMatchup.metrics.drawRate,
    };
  }

  const stallAgent = resolveNamedAgent<S, M>("stall");
  const stallMatchup = runMatchup(engine, ruthless, stallAgent, {
    games,
    seed: `${opts.seed}:stall-probe`,
    mirrorSeats: false,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });

  const rushAgent = resolveNamedAgent<S, M>("rush");
  const mcts1kAgent = resolveNamedAgent<S, M>("mcts1k");
  const rushMatchup = runMatchup(engine, rushAgent, mcts1kAgent, {
    games,
    seed: `${opts.seed}:rush-probe`,
    mirrorSeats: true,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });

  const inputs: ProbeGateInputs = {
    mirror: mirrorInput,
    stallCapHitRate: stallMatchup.metrics.capHitRate,
    stallWinRate: agentWinRate(stallMatchup.outcomes, "stall"),
    rushScore: agentParityScore(rushMatchup.outcomes, "rush"),
  };

  const gates = evaluateProbeGates(inputs, thresholds, exceptions, suite, undefined, opts.rushDrawAttainment);

  return {
    gameId: manifest.id,
    suite,
    ok: gates.every((g) => g.status !== "fail"),
    gates,
    matchups: { mirror: mirrorMatchup, stall: stallMatchup, rush: rushMatchup },
  };
}

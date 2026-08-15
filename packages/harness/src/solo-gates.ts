// packages/harness/src/solo-gates.ts — the solo-ci / solo-design gate table, selected by
// `manifest.solo.format` (platform-corrections.md C2), NEVER by player count. Crackstep and
// Mine Run are both `maxPlayers: 1` and share almost no gates: Crackstep is a deterministic
// puzzle (no score(), no safeMove, structural termination) and Mine Run is a score chase.
// Keying the gate table on player count would run score-chase gates against a puzzle and
// hard-error it for lacking a `safeMove` hook it correctly doesn't have.
//
// A gate that does not apply to a format is reported as explicitly `"n/a"` — never silently
// omitted, and never collapsed into `"pass"`. A skipped gate and a passed gate must never look
// the same in a report (C2's own words): callers rendering this report must be able to tell
// "this game doesn't have this concern" apart from "this game passed this concern" apart from
// "this concern was not wired up yet" (the last of those is `"n/a"` too, but with a detail
// string that says so explicitly rather than pretending it's a format exclusion).
//
// Scope: this module covers exactly what M3c/M3d compute (solo-metrics.ts's distribution
// metrics, probes-solo.ts's Grind/Always-Safe results, and the certify/calibrate pipeline's
// per-day features). The three platform-wide rows every game plan lists alongside these
// (engine contract suite, rule-sentence length, bundle/axe budgets) are NOT this module's
// concern — they are M4 CI-workflow wiring, explicitly out of this milestone's scope — and are
// left for a future caller to fold into the same report shape.

import type { GameManifest, SoloThresholds } from "@twist-arcade/game-spec";
import { DEFAULT_SOLO_THRESHOLDS } from "@twist-arcade/game-spec";
import type { GrindResult } from "./probes-solo";
import type { SoloDistributionMetrics, SoloDistributionMetricsCiTier } from "./solo-metrics";

/** `"deferred"` (platform-corrections.md C27) is NOT a fourth flavor of "n/a". `"n/a"` means
 *  "this gate does not apply to this game/format" (C2) — a claim that will NEVER become a
 *  number, at any tier. `"deferred"` means the exact opposite: the gate DOES apply, and WILL be
 *  measured for real, just not at THIS tier (too expensive — see
 *  `GameManifest.ciGateBudget.deferGatesToNightly`). Collapsing the two would silently stop a
 *  gate from ever running again while its report kept reading as "doesn't apply here" forever —
 *  the exact conflation C2/C23 already exist to prevent, in a third place. */
export type GateStatus = "pass" | "warn" | "fail" | "n/a" | "deferred";

export interface GateResult {
  readonly name: string;
  readonly status: GateStatus;
  readonly detail: string;
}

/** Full inputs — Strong ran, so every row below is measured for real. This is the shape every
 *  score-chase gate table used before C27, and the ONLY shape suite "nightly" may ever supply
 *  (`evaluateSoloGates` refuses otherwise — see `SoloDeferredGateAtNightlyError`). */
export interface SoloGateChaseInputsFull {
  metrics: SoloDistributionMetrics;
  grind: GrindResult;
  /** Required whenever a chase's roster ran at all — `runAlwaysSafeProbe` hard-errors
   *  (MissingSafeMoveError) rather than let a caller reach this point without one, so an
   *  undefined value here means the suite never actually ran the roster, not that the gate is
   *  inapplicable. */
  alwaysSafeVsStrong: number;
  /** Suicide probe (solo-games-lens §3.6): applies only to a misère-tagged chase. Omit
   *  entirely for a non-misère game — the gate reports "n/a" with a reason distinguishing
   *  "not misère-tagged" from a format exclusion. */
  suicide?: { suicideIsOptimalLine: boolean };
}

/** C27: Strong did NOT run at this tier — Mine Run's real-board Strong-dependent rows cost
 *  ~4.6h at seedCount=100 (measured, platform-corrections.md C27), unaffordable in CI.
 *  `metrics` is only the subset honestly computable from random+greedy alone
 *  (`computeSoloDistributionMetrics({random, greedy})`'s narrower overload). Every row that
 *  needs Strong reports `"deferred"` — naming `deferredToTier` (where it WILL be measured) and
 *  `deferredReason` (why it isn't measured here) — never `"n/a"` and never silently omitted. */
export interface SoloGateChaseInputsDeferred {
  metrics: SoloDistributionMetricsCiTier;
  grind: GrindResult;
  /** The tier that measures the deferred rows for real — today always `"nightly"` (the only
   *  other suite), spelled out rather than hardcoded so a report's own detail string names it
   *  explicitly instead of a caller having to infer it. */
  deferredToTier: string;
  /** Folded verbatim into every deferred row's detail (see `GameManifest.ciGateBudget.
   *  deferGatesToNightly`'s own doc) — this is what a reader of the CI report actually sees. */
  deferredReason: string;
  suicide?: { suicideIsOptimalLine: boolean };
}

/** Either shape a score-chase gate table can be evaluated against — see the two interfaces'
 *  own docs. Discriminated on the presence of `deferredToTier`. */
export type SoloGateChaseInputs = SoloGateChaseInputsFull | SoloGateChaseInputsDeferred;

/** The exact set of chase gate rows that need `strong` and therefore become `"deferred"`
 *  (never evaluated) under `SoloGateChaseInputsDeferred` — named once here so both
 *  `evaluateChaseGates` and the nightly abuse guard below stay in lockstep with each other.
 *  Exported (platform-corrections.md C70) so deferral-ledger.ts's nightly-discharge wiring
 *  knows exactly which gate identity a real nightly run for THIS lane discharges, without
 *  re-deriving it from a report that (being nightly) never shows any row as `"deferred"` to
 *  read the list back off of. */
export const STRONG_DEPENDENT_CHASE_GATES = [
  "strongVsRandomRatio",
  "distributionOverlap",
  "strongVsGreedyRatio",
  "strongScoreCV",
  "alwaysSafeVsStrong",
  "medianRunLength",
  "capHitRate",
  "ceilingPileUp",
] as const;

/** Thrown by `evaluateSoloGates` when suite `"nightly"` is given `SoloGateChaseInputsDeferred`
 *  (platform-corrections.md C27's abuse guard). Nightly is the ONLY tier that ever measures a
 *  deferred row for real — `runSoloChaseCiGate` structurally never builds deferred inputs at
 *  suite "nightly" (it only ever consults `manifest.ciGateBudget.deferGatesToNightly` when
 *  `suite === "ci"`), but this is independent, defense-in-depth enforcement at the pure
 *  evaluator itself: a row deferred at EVERY tier is a gate that never runs again, and that
 *  must be a loud, immediate failure here, not a quiet status that ships in a "nightly: OK"
 *  report nobody ever double-checks. */
export class SoloDeferredGateAtNightlyError extends Error {
  constructor(tier: string) {
    super(
      `evaluateSoloGates: suite "nightly" was given Strong-dependent chase inputs still marked ` +
        `deferred (to "${tier}") for [${STRONG_DEPENDENT_CHASE_GATES.join(", ")}] ` +
        "(platform-corrections.md C27). A gate deferred at EVERY tier never runs — nightly must " +
        "supply the FULL roster (random, greedy, AND strong), never the CI-tier partial."
    );
    this.name = "SoloDeferredGateAtNightlyError";
  }
}

/** Everything a daily-puzzle's gate table needs — the output of `harness certify` /
 *  `harness calibrate` for the day(s) under review. */
export interface SoloGatePuzzleInputs {
  certificate: { present: boolean; verifiedByReplay: boolean; par: number };
  randomPlayoutSolveRate: number;
  forcedMoveFraction: number;
  generatorRejectionRate: number;
  /** Undefined on a game's very first certified day (no prior day to compare against) — the
   *  gate reports "n/a" with that reason, not a format exclusion either. */
  dayOverDayDriftSigma?: number;
  certifiedBufferDays: number;
  /** platform-corrections.md C11: undefined for a non-fog (perfect-information) puzzle — the
   *  gate reports "n/a" with that reason (not a format exclusion; a fog vs. non-fog puzzle
   *  are both `daily-puzzle` format). For a fog (hidden-information) puzzle this MUST be
   *  supplied: `true` iff the certified day's `DailyCertificate.guessFree` was true (solved
   *  by deduction alone), `false` if the certified day required a guess — which `certifyDay`
   *  now refuses to certify in the first place, so a `false` here means the certify-time
   *  rejection was bypassed or this report is stale. */
  fogDeductionOnly?: boolean;
}

export interface EvaluateSoloGatesInput {
  manifest: Pick<GameManifest, "solo" | "thresholds">;
  chase?: SoloGateChaseInputs;
  puzzle?: SoloGatePuzzleInputs;
  /** Which suite this evaluation is for — only meaningful for a score-chase `chase` input
   *  (C27's abuse guard): `"nightly"` refuses (`SoloDeferredGateAtNightlyError`) if `chase` is
   *  still the CI-tier `SoloGateChaseInputsDeferred` shape, since nightly is the tier that MUST
   *  measure Strong-dependent rows for real. Defaults to `"ci"` — the deferred shape's own home
   *  tier — so every existing caller that never mentions suite (daily-puzzle, or a chase that
   *  always ran the full roster) is unaffected. */
  suite?: "ci" | "nightly";
}

function resolveThresholds(manifest: Pick<GameManifest, "thresholds">): SoloThresholds {
  // manifest.thresholds is `Partial<HarnessThresholds | SoloThresholds>` (game-spec's own
  // union — ambiguous at the type level about which table a given override belongs to, not
  // this module's decision to fix); only fields that are actually SoloThresholds keys apply
  // here, exactly like spreading any other partial override.
  return { ...DEFAULT_SOLO_THRESHOLDS, ...(manifest.thresholds as Partial<SoloThresholds> | undefined) };
}

function na(name: string, reason: string): GateResult {
  return { name, status: "n/a", detail: reason };
}

function passFail(name: string, failed: boolean, detail: string): GateResult {
  return { name, status: failed ? "fail" : "pass", detail };
}

/** Two-tier gate (warn at one threshold, hard-fail at a stricter one) — the roadmap/lens
 *  pattern used by generator-rejection-rate and certified-buffer-days. `direction` controls
 *  whether "past the threshold" means >= (a rate climbing too high) or <= (a buffer draining
 *  too low). */
function twoTier(
  name: string,
  value: number,
  warnAt: number,
  failAt: number,
  direction: "high-is-bad" | "low-is-bad",
  detail: string
): GateResult {
  const failed = direction === "high-is-bad" ? value > failAt : value < failAt;
  const warned = direction === "high-is-bad" ? value > warnAt : value < warnAt;
  const status: GateStatus = failed ? "fail" : warned ? "warn" : "pass";
  return { name, status, detail };
}

/** `"deferred"`, naming the tier that measures the row for real (C27) — distinct at the report
 *  layer from both `"n/a"` (`na()` above: never measured, at any tier) and a real `"pass"`/
 *  `"fail"` (measured, right here, right now). */
function deferredRow(name: string, tier: string, reason: string): GateResult {
  return { name, status: "deferred", detail: `measured at ${tier} (${reason})` };
}

function evaluateChaseGates(inputs: SoloGateChaseInputs, t: SoloThresholds): GateResult[] {
  const [runLo, runHi] = t.runLengthRange;
  const results: GateResult[] = [];

  if ("deferredToTier" in inputs) {
    const { metrics: m, grind, deferredToTier: tier, deferredReason: reason } = inputs;
    results.push(
      deferredRow("strongVsRandomRatio", tier, reason),
      deferredRow("distributionOverlap", tier, reason),
      // greedyVsRandomRatio needs only random+greedy — it is NOT in STRONG_DEPENDENT_CHASE_GATES
      // and is evaluated for real here, exactly as it would be at nightly (proof, per the
      // standing instruction, that the partial path can still fail for real: see
      // solo-gates.test.ts's planted violation on this exact row under deferred inputs).
      passFail(
        "greedyVsRandomRatio",
        m.greedyVsRandomRatio < t.minGreedyVsRandomRatio,
        `${m.greedyVsRandomRatio.toFixed(3)} (fail if < ${t.minGreedyVsRandomRatio})`
      ),
      deferredRow("strongVsGreedyRatio", tier, reason),
      deferredRow("strongScoreCV", tier, reason),
      deferredRow("alwaysSafeVsStrong", tier, reason),
      // grindProbe needs no roster agent at all (probes-solo.ts's grindProbe searches the
      // engine directly) — real here too, same as nightly.
      passFail(
        "grindProbe",
        grind.found,
        grind.found
          ? `zero-risk cycle found (length ${grind.cycle?.length ?? "?"}, scoreDelta ${grind.scoreDelta})`
          : "no zero-risk unbounded cycle found"
      ),
      deferredRow("medianRunLength", tier, reason),
      deferredRow("capHitRate", tier, reason),
      deferredRow("ceilingPileUp", tier, reason)
    );
  } else {
    const m = inputs.metrics;
    results.push(
      passFail(
        "strongVsRandomRatio",
        m.strongVsRandomRatio < t.minStrongVsRandomRatio,
        `${m.strongVsRandomRatio.toFixed(3)} (fail if < ${t.minStrongVsRandomRatio})`
      ),
      passFail(
        "distributionOverlap",
        m.distributionOverlapsBadly,
        `strongMedian=${m.strongMedian}, randomP75=${m.randomP75}, strongP10=${m.strongP10}, randomP90=${m.randomP90}`
      ),
      passFail(
        "greedyVsRandomRatio",
        m.greedyVsRandomRatio < t.minGreedyVsRandomRatio,
        `${m.greedyVsRandomRatio.toFixed(3)} (fail if < ${t.minGreedyVsRandomRatio})`
      ),
      passFail(
        "strongVsGreedyRatio",
        m.strongVsGreedyRatio < t.minStrongVsGreedyRatio,
        `${m.strongVsGreedyRatio.toFixed(3)} (fail if < ${t.minStrongVsGreedyRatio})`
      ),
      passFail(
        "strongScoreCV",
        m.strongScoreCV > t.maxStrongScoreCV,
        `${m.strongScoreCV.toFixed(3)} (fail if > ${t.maxStrongScoreCV})`
      ),
      passFail(
        "alwaysSafeVsStrong",
        inputs.alwaysSafeVsStrong >= t.maxAlwaysSafeVsStrongRatio,
        `${inputs.alwaysSafeVsStrong.toFixed(3)} (fail if >= ${t.maxAlwaysSafeVsStrongRatio})`
      ),
      passFail(
        "grindProbe",
        inputs.grind.found,
        inputs.grind.found
          ? `zero-risk cycle found (length ${inputs.grind.cycle?.length ?? "?"}, scoreDelta ${inputs.grind.scoreDelta})`
          : "no zero-risk unbounded cycle found"
      ),
      passFail(
        "medianRunLength",
        m.medianRunLength < runLo || m.medianRunLength > runHi,
        `${m.medianRunLength} decisions (fail outside [${runLo}, ${runHi}])`
      ),
      passFail(
        "capHitRate",
        m.capHitRate > t.maxCapHitRate,
        `${(m.capHitRate * 100).toFixed(2)}% (fail if > ${(t.maxCapHitRate * 100).toFixed(2)}%)`
      ),
      passFail(
        "ceilingPileUp",
        m.ceilingPileUp > t.maxCeilingPileUp,
        `${(m.ceilingPileUp * 100).toFixed(2)}% (fail if > ${(t.maxCeilingPileUp * 100).toFixed(2)}%)`
      )
    );
  }

  if (inputs.suicide) {
    results.push(
      passFail(
        "suicideProbe",
        inputs.suicide.suicideIsOptimalLine,
        inputs.suicide.suicideIsOptimalLine
          ? "losing fast IS the optimal line — the misère framing is fake"
          : "losing fast is not the optimal line"
      )
    );
  } else {
    results.push(na("suicideProbe", "not misère-tagged"));
  }

  // Puzzle-only rows, explicitly N/A for a score chase (mine-run.md §6: "No certificate —
  // certificates are the *puzzle* pipeline; a score chase ships on the distribution gates
  // instead"). Unaffected by deferral — these never applied to a score chase regardless of tier.
  results.push(
    na("certificatePresent", "score-chase format — no daily certificate pipeline"),
    na("certificatePar", "score-chase format — no par to certify"),
    na("randomPlayoutSolveRate", "score-chase format — no single 'solve' to rate"),
    na("forcedMoveFraction", "score-chase format — no optimal solve path to measure"),
    na("generatorRejectionRate", "score-chase format — no certify-time generator"),
    na("dayOverDayDrift", "score-chase format — no daily difficulty band"),
    na("certifiedBufferDays", "score-chase format — no certificate buffer to deplete"),
    na("fogDeductionOnly", "score-chase format — no daily certificate, no guess-free requirement to check")
  );

  return results;
}

function evaluatePuzzleGates(inputs: SoloGatePuzzleInputs, t: SoloThresholds): GateResult[] {
  const [parLo, parHi] = t.certificateParRange;
  const results: GateResult[] = [
    passFail(
      "certificatePresent",
      !inputs.certificate.present || !inputs.certificate.verifiedByReplay,
      inputs.certificate.present
        ? inputs.certificate.verifiedByReplay
          ? "present and verified by replay"
          : "present but FAILED CI replay verification"
        : "missing — a daily seed shipped without a certificate"
    ),
    passFail(
      "certificatePar",
      inputs.certificate.par < parLo || inputs.certificate.par > parHi,
      `par=${inputs.certificate.par} (fail outside [${parLo}, ${parHi}])`
    ),
    passFail(
      "randomPlayoutSolveRate",
      inputs.randomPlayoutSolveRate > t.maxRandomPlayoutSolveRate,
      `${(inputs.randomPlayoutSolveRate * 100).toFixed(1)}% (fail if > ${(t.maxRandomPlayoutSolveRate * 100).toFixed(1)}%)`
    ),
    passFail(
      "forcedMoveFraction",
      inputs.forcedMoveFraction > t.maxForcedMoveFraction,
      `${(inputs.forcedMoveFraction * 100).toFixed(1)}% (fail if > ${(t.maxForcedMoveFraction * 100).toFixed(1)}%)`
    ),
    twoTier(
      "generatorRejectionRate",
      inputs.generatorRejectionRate,
      0.5,
      t.maxGeneratorRejectionRate,
      "high-is-bad",
      `${(inputs.generatorRejectionRate * 100).toFixed(1)}% (warn > 50%, fail if > ${(t.maxGeneratorRejectionRate * 100).toFixed(0)}%)`
    ),
  ];

  if (inputs.dayOverDayDriftSigma === undefined) {
    results.push(na("dayOverDayDrift", "no prior certified day to compare against"));
  } else {
    results.push(
      passFail(
        "dayOverDayDrift",
        Math.abs(inputs.dayOverDayDriftSigma) > t.maxDayOverDayDriftSigma,
        `${inputs.dayOverDayDriftSigma.toFixed(3)}σ (fail if |Δ| > ${t.maxDayOverDayDriftSigma}σ)`
      )
    );
  }

  results.push(
    twoTier(
      "certifiedBufferDays",
      inputs.certifiedBufferDays,
      30,
      t.minCertifiedBufferDays,
      "low-is-bad",
      `${inputs.certifiedBufferDays} days buffered (alert < 30, fail if < ${t.minCertifiedBufferDays})`
    )
  );

  if (inputs.fogDeductionOnly === undefined) {
    results.push(na("fogDeductionOnly", "non-fog (perfect-information) puzzle — no guess-free requirement to check"));
  } else {
    results.push(
      passFail(
        "fogDeductionOnly",
        !inputs.fogDeductionOnly,
        inputs.fogDeductionOnly
          ? "solved by deduction alone, no guess required"
          : "the certified day requires guessing — fog dailies must be deduction-only (C11)"
      )
    );
  }

  // Score-chase-only rows, explicitly N/A for a daily puzzle (docs/plans/crackstep.md §5's own
  // ruling: these guard skill expression via distributions that a puzzle — which has no
  // score() and no score distribution — does not have).
  results.push(
    na("strongVsRandomRatio", "daily-puzzle format — no score() distribution"),
    na("distributionOverlap", "daily-puzzle format — no score() distribution"),
    na("greedyVsRandomRatio", "daily-puzzle format — no score() distribution"),
    na("strongVsGreedyRatio", "daily-puzzle format — no score() distribution"),
    na("strongScoreCV", "daily-puzzle format — no score() distribution"),
    na("alwaysSafeVsStrong", "daily-puzzle format — no bank/push risk decision, no safeMove hook required"),
    na("grindProbe", "daily-puzzle format — termination is structural, discharged by the contract suite, not a tripwire search"),
    na("medianRunLength", "daily-puzzle format — the puzzle analogue is the certificate par band, which applies"),
    na("capHitRate", "daily-puzzle format — the puzzle analogue is the certificate par band, which applies"),
    na("ceilingPileUp", "daily-puzzle format — no score ceiling to pile up against"),
    na("suicideProbe", "daily-puzzle format — score-chase-only probe (crackstep.md §5)")
  );

  return results;
}

/**
 * The C2 entry point: selects the gate table from `manifest.solo.format`, never from player
 * count, and evaluates every row from that table plus the explicit "n/a" rows for the OTHER
 * format's rows — so a report always has the SAME set of gate names regardless of which format
 * produced it, distinguishing pass/warn/fail/n/a rather than omitting rows a reader might
 * otherwise mistake for "not checked at all".
 */
export function evaluateSoloGates(input: EvaluateSoloGatesInput): GateResult[] {
  const solo = input.manifest.solo;
  if (!solo) {
    throw new Error("evaluateSoloGates: manifest.solo is required — this is not a solo game's manifest.");
  }
  const t = resolveThresholds(input.manifest);

  if (solo.format === "score-chase") {
    if (!input.chase) {
      throw new Error(
        "evaluateSoloGates: manifest.solo.format is 'score-chase' but no `chase` inputs were supplied " +
          "— run the roster/probes suite first (this is a caller error, not an N/A gate)."
      );
    }
    // C27's abuse guard: nightly is the ONLY tier allowed to report a Strong-dependent row as
    // anything other than "deferred" — a caller that hands nightly the CI-tier deferred shape
    // (by accident, or by copy-pasting the ci-tier wiring) gets refused here, loudly, rather
    // than shipping a "nightly: OK" report where the gate never actually ran.
    if ((input.suite ?? "ci") === "nightly" && "deferredToTier" in input.chase) {
      throw new SoloDeferredGateAtNightlyError(input.chase.deferredToTier);
    }
    return evaluateChaseGates(input.chase, t);
  }

  if (solo.format === "daily-puzzle") {
    if (!input.puzzle) {
      throw new Error(
        "evaluateSoloGates: manifest.solo.format is 'daily-puzzle' but no `puzzle` inputs were supplied " +
          "— run the certify/calibrate pipeline first (this is a caller error, not an N/A gate)."
      );
    }
    return evaluatePuzzleGates(input.puzzle, t);
  }

  // Exhaustiveness guard — GameManifest['solo']['format'] is a closed union of exactly these
  // two values today; a future third format landing here without a corresponding branch
  // should fail loudly rather than silently fall through to an empty report.
  throw new Error(`evaluateSoloGates: unrecognized manifest.solo.format ${JSON.stringify((solo as { format: unknown }).format)}`);
}

/** Convenience: true iff no row is `"fail"` — a `"warn"` does not fail CI (roadmap's own
 *  "warn at PR budget, fail nightly" pattern), only `"fail"` is build-breaking. A caller that
 *  wants to surface warnings separately (e.g. a nightly job escalating them) should filter
 *  `results` for `status === "warn"` directly rather than relying on this helper alone. */
export function allGatesPass(results: readonly GateResult[]): boolean {
  return results.every((r) => r.status !== "fail");
}

/** True iff any row is `"deferred"` — the C27 "provisional pass" signal: a report can be
 *  `allGatesPass` (no `"fail"`) while still not being a FULLY measured green, because one or
 *  more Strong-dependent rows haven't run yet at this tier. `report.ts`'s `formatSoloGateTable`
 *  checks this to render that distinction rather than printing a bare "OK" indistinguishable
 *  from a fully-measured nightly pass. */
export function hasDeferredGates(results: readonly GateResult[]): boolean {
  return results.some((r) => r.status === "deferred");
}

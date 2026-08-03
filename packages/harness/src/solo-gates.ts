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
import type { SoloDistributionMetrics } from "./solo-metrics";

export type GateStatus = "pass" | "warn" | "fail" | "n/a";

export interface GateResult {
  readonly name: string;
  readonly status: GateStatus;
  readonly detail: string;
}

/** Everything a score-chase's gate table needs — the output of a solo-ci suite run against a
 *  `score-chase` manifest (buildSoloRoster + runSoloAgentOverSeeds + computeSoloDistributionMetrics
 *  + grindProbe + runAlwaysSafeProbe/alwaysSafeVsStrongRatio). */
export interface SoloGateChaseInputs {
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
}

export interface EvaluateSoloGatesInput {
  manifest: Pick<GameManifest, "solo" | "thresholds">;
  chase?: SoloGateChaseInputs;
  puzzle?: SoloGatePuzzleInputs;
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

function evaluateChaseGates(inputs: SoloGateChaseInputs, t: SoloThresholds): GateResult[] {
  const m = inputs.metrics;
  const [runLo, runHi] = t.runLengthRange;
  const results: GateResult[] = [
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
    ),
  ];

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
  // instead").
  results.push(
    na("certificatePresent", "score-chase format — no daily certificate pipeline"),
    na("certificatePar", "score-chase format — no par to certify"),
    na("randomPlayoutSolveRate", "score-chase format — no single 'solve' to rate"),
    na("forcedMoveFraction", "score-chase format — no optimal solve path to measure"),
    na("generatorRejectionRate", "score-chase format — no certify-time generator"),
    na("dayOverDayDrift", "score-chase format — no daily difficulty band"),
    na("certifiedBufferDays", "score-chase format — no certificate buffer to deplete")
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

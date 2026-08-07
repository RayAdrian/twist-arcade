// scripts/research/tilt-t3-validation-sweep.ts — T3 step 2 (docs/plans/tilt.md §5.2, C22
// resolution): the real validation, at n=100 (never n=15 — C26's Order-vs-Chaos lesson: mean-
// plies at n=15 swung 19.8-28.4 non-monotonically; the cost pilot's own gate flips confirmed the
// same noise for Tilt at n=15, printed above each candidate here for continuity).
//
// ONE fixed seed across every candidate (C24) via compareBudgets. Same 5 candidates as the cost
// pilot (1,500/2,000/3,000/5,000/10,000 — the plan's own list, not imported from another game).
//
// VALIDATION CRITERION (coordinator's ruling, matching how it was applied to Order vs Chaos):
// does the candidate reproduce the 10,000-rollout BASELINE'S VERDICT — same side of the [35,65]
// first-player-win-rate band (i.e. the SAME gate pass/fail outcome), mean-plies in band, AND
// zero cap hits — never "are the raw numbers similar" (unanswerable at this sample size).
//
// Run: pnpm tsx scripts/research/tilt-t3-validation-sweep.ts > .scratch/tilt-t3-validation.out 2>&1

import type { CiSuiteReport } from "@twist-arcade/harness";
import { compareBudgets, worstCapHitRate } from "@twist-arcade/harness";
import { tilt } from "../../games/tilt/engine";
import { manifest } from "../../games/tilt/manifest";

const SEED = "tilt-t3-validation";
const GAMES = 100;
const CANDIDATES = [1500, 2000, 3000, 5000, 10000];
const BASELINE_ROLLOUTS = 10000; // the shipped ruthless budget

function gateStatus(report: CiSuiteReport, gate: string): string {
  return report.gates.find((g) => g.gate === gate)?.status ?? "MISSING";
}

function gateDetail(report: CiSuiteReport, gate: string): string {
  return report.gates.find((g) => g.gate === gate)?.detail ?? "MISSING";
}

function capHitRateOf(report: CiSuiteReport): number {
  if (!report.matchups) return Number.NaN; // deferred — not expected for Tilt
  return worstCapHitRate([report.matchups.strongVsRandom, report.matchups.strongSelfPlay, report.matchups.ruthlessVsStandard]);
}

function main(): void {
  console.log(
    `Tilt T3 validation sweep — seed="${SEED}", ${GAMES} games/candidate, candidates=[${CANDIDATES.join(", ")}]`
  );
  console.log("Criterion: reproduce the 10,000-rollout baseline's VERDICT, not raw-number closeness.");
  console.log();

  const points = compareBudgets(tilt, manifest, CANDIDATES, { seed: SEED, games: GAMES });

  for (const point of points) {
    const r = point.report;
    const fpa = gateDetail(r, "first-player-win-rate");
    const draw = gateDetail(r, "draw-rate");
    const plies = gateDetail(r, "mean-plies");
    const capHit = capHitRateOf(r);
    console.log(`--- rollouts=${point.rollouts} ---`);
    console.log(`  first-player-win-rate: ${gateStatus(r, "first-player-win-rate")} — ${fpa}`);
    console.log(`  draw-rate:             ${gateStatus(r, "draw-rate")} — ${draw}`);
    console.log(`  mean-plies:            ${gateStatus(r, "mean-plies")} — ${plies}`);
    console.log(`  cap-hit rate (all matchups): ${(capHit * 100).toFixed(2)}%`);
    console.log();
  }

  const baselinePoint = points.find((p) => p.rollouts === BASELINE_ROLLOUTS);
  if (!baselinePoint) throw new Error(`baseline candidate ${BASELINE_ROLLOUTS} not found in results`);
  const baseline = baselinePoint.report;
  const baselineFpaStatus = gateStatus(baseline, "first-player-win-rate");
  const baselineMeanPliesStatus = gateStatus(baseline, "mean-plies");
  const baselineCapHit = capHitRateOf(baseline);

  console.log("=== VALIDATION VERDICTS (vs 10,000-rollout baseline) ===");
  console.log(
    `Baseline (${BASELINE_ROLLOUTS}): first-player-win-rate=${baselineFpaStatus}, mean-plies=${baselineMeanPliesStatus}, cap-hit=${(baselineCapHit * 100).toFixed(2)}%`
  );
  console.log();

  const validated: number[] = [];
  for (const point of points) {
    const r = point.report;
    const fpaMatches = gateStatus(r, "first-player-win-rate") === baselineFpaStatus;
    const pliesMatches = gateStatus(r, "mean-plies") === baselineMeanPliesStatus;
    const zeroCapHits = capHitRateOf(r) === 0;
    const reproduces = fpaMatches && pliesMatches && zeroCapHits;
    console.log(
      `rollouts=${point.rollouts.toString().padStart(6)}: FPA-verdict-match=${fpaMatches} mean-plies-verdict-match=${pliesMatches} ` +
        `zero-cap-hits=${zeroCapHits} => ${reproduces ? "REPRODUCES BASELINE" : "DOES NOT REPRODUCE"}`
    );
    if (reproduces) validated.push(point.rollouts);
  }

  console.log();
  if (validated.length > 0) {
    const cheapest = Math.min(...validated);
    console.log(`Cheapest budget reproducing the baseline verdict: ${cheapest}`);
  } else {
    console.log("NO candidate reproduces the baseline verdict — escalate before shipping any override.");
  }
}

main();

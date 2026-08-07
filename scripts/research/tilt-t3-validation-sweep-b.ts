// scripts/research/tilt-t3-validation-sweep-b.ts — T3 replication (docs/plans/tilt.md §5.2):
// the SAME n=100 validation sweep as tilt-t3-validation-sweep.ts, on an INDEPENDENT fixed seed
// ("tilt-t3-validation-b" vs the original "tilt-t3-validation") — everything else identical
// (same 5 candidates, same games count, same criterion). Exists specifically to confirm or kill
// the monotone FPA-vs-rollouts drift the first sweep found (58/52/48/48/38 across
// 1500/2000/3000/5000/10000) before trusting it as a real effect rather than an unlucky
// ordering on one seed. One seed per sweep (C24) — never the swept variable in the seed.
//
// Run: pnpm tsx scripts/research/tilt-t3-validation-sweep-b.ts > .scratch/tilt-t3-validation-b.out 2>&1

import type { CiSuiteReport } from "@twist-arcade/harness";
import { compareBudgets, worstCapHitRate } from "@twist-arcade/harness";
import { tilt } from "../../games/tilt/engine";
import { manifest } from "../../games/tilt/manifest";

const SEED = "tilt-t3-validation-b";
const GAMES = 100;
const CANDIDATES = [1500, 2000, 3000, 5000, 10000];
const BASELINE_ROLLOUTS = 10000;

function gateStatus(report: CiSuiteReport, gate: string): string {
  return report.gates.find((g) => g.gate === gate)?.status ?? "MISSING";
}

function gateDetail(report: CiSuiteReport, gate: string): string {
  return report.gates.find((g) => g.gate === gate)?.detail ?? "MISSING";
}

function capHitRateOf(report: CiSuiteReport): number {
  if (!report.matchups) return Number.NaN;
  return worstCapHitRate([report.matchups.strongVsRandom, report.matchups.strongSelfPlay, report.matchups.ruthlessVsStandard]);
}

function main(): void {
  console.log(
    `Tilt T3 validation sweep (SEED B, independent replication) — seed="${SEED}", ${GAMES} games/candidate, candidates=[${CANDIDATES.join(", ")}]`
  );
  console.log("Purpose: confirm or kill the monotone FPA drift found on the first seed.");
  console.log();

  const points = compareBudgets(tilt, manifest, CANDIDATES, { seed: SEED, games: GAMES });

  for (const point of points) {
    const r = point.report;
    console.log(`--- rollouts=${point.rollouts} ---`);
    console.log(`  first-player-win-rate: ${gateStatus(r, "first-player-win-rate")} — ${gateDetail(r, "first-player-win-rate")}`);
    console.log(`  draw-rate:             ${gateStatus(r, "draw-rate")} — ${gateDetail(r, "draw-rate")}`);
    console.log(`  mean-plies:            ${gateStatus(r, "mean-plies")} — ${gateDetail(r, "mean-plies")}`);
    console.log(`  cap-hit rate (all matchups): ${(capHitRateOf(r) * 100).toFixed(2)}%`);
    console.log();
  }

  const baselinePoint = points.find((p) => p.rollouts === BASELINE_ROLLOUTS);
  if (!baselinePoint) throw new Error(`baseline candidate ${BASELINE_ROLLOUTS} not found`);
  const baseline = baselinePoint.report;
  const baselineFpaStatus = gateStatus(baseline, "first-player-win-rate");
  const baselineMeanPliesStatus = gateStatus(baseline, "mean-plies");
  const baselineCapHit = capHitRateOf(baseline);

  console.log("=== VALIDATION VERDICTS (vs 10,000-rollout baseline, SEED B) ===");
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
    console.log(`Cheapest budget reproducing the baseline verdict (seed B): ${Math.min(...validated)}`);
  } else {
    console.log("NO candidate reproduces the baseline verdict on seed B — escalate before shipping any override.");
  }

  // Explicit monotonicity check, printed for direct comparison against seed A's own reading.
  const fpaByRollouts = CANDIDATES.map((n) => {
    const r = points.find((p) => p.rollouts === n)!.report;
    const detail = gateDetail(r, "first-player-win-rate");
    const match = /^(\d+(?:\.\d+)?)%/.exec(detail);
    return { rollouts: n, fpaPct: match ? Number(match[1]) : Number.NaN };
  });
  console.log();
  console.log("FPA by rollouts (seed B):", fpaByRollouts.map((x) => `${x.rollouts}=${x.fpaPct}%`).join("  "));
  let monotoneDecreasing = true;
  let monotoneIncreasing = true;
  for (let i = 1; i < fpaByRollouts.length; i++) {
    if (fpaByRollouts[i]!.fpaPct > fpaByRollouts[i - 1]!.fpaPct) monotoneDecreasing = false;
    if (fpaByRollouts[i]!.fpaPct < fpaByRollouts[i - 1]!.fpaPct) monotoneIncreasing = false;
  }
  console.log(`monotone decreasing: ${monotoneDecreasing}   monotone increasing: ${monotoneIncreasing}`);
}

main();

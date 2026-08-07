// scripts/research/tilt-t3-cost-pilot.ts — T3 step 1 (docs/plans/tilt.md §5.2): a ~15-game-per-
// candidate TIMING-ONLY pilot, never a verdict (C26: Order vs Chaos's own pilot read mean-plies
// swinging 19.8-28.4 non-monotonically at n=15 — noise, not signal). This script reports
// wall-clock only; the validation sweep (n=100) is a separate script/run.
//
// ONE seed across every candidate (C24) via compareBudgets — never a hand-rolled per-candidate
// seed. Candidates are the plan's own list (1,500/2,000/3,000/5,000/10,000) — NOT imported from
// any other game's numbers (C25: Fadeout's 3,000 and Order vs Chaos's 3,000 are evidence about
// their own boards only).
//
// Run: pnpm tsx scripts/research/tilt-t3-cost-pilot.ts > .scratch/tilt-t3-cost-pilot.out 2>&1

import { compareBudgets } from "@twist-arcade/harness";
import { tilt } from "../../games/tilt/engine";
import { manifest } from "../../games/tilt/manifest";

const SEED = "tilt-t3-cost-pilot";
const GAMES = 15; // timing only — never a verdict at this n (C26)
const CANDIDATES = [1500, 2000, 3000, 5000, 10000];

function main(): void {
  console.log(`Tilt T3 cost pilot — seed="${SEED}", ${GAMES} games/candidate, candidates=[${CANDIDATES.join(", ")}]`);
  console.log("TIMING ONLY. No verdict is drawn from this run (C26).");
  console.log();

  for (const rollouts of CANDIDATES) {
    const start = Date.now();
    const points = compareBudgets(tilt, manifest, [rollouts], { seed: SEED, games: GAMES });
    const elapsedMs = Date.now() - start;
    const point = points[0]!;
    const gateSummary = point.report.gates.map((g) => `${g.gate}=${g.status}`).join(" ");
    console.log(
      `rollouts=${rollouts.toString().padStart(6)}  elapsed=${(elapsedMs / 1000).toFixed(1)}s   gates: ${gateSummary}`
    );
  }

  console.log();
  console.log("Done. Use this to decide which candidates are affordable for the n=100 validation sweep.");
}

main();

// Re-run of the C55 strong-vs-random measurement at 2,000 and 10,000 rollouts, against the
// FIXED packages/bots/src/mcts.ts. Same seed and game count as the original B3 sweep
// (docs/plans/platform-corrections.md C55: "b3-sweep-fixed-seed", 60 games/matchup) — NOT a
// new/tuned budget, just the two the coordinator asked to be re-measured.
import { compareBudgets } from "@twist-arcade/harness";
import { bidTacToe } from "./bid-tac-toe-repro/engine";
import { manifest } from "./bid-tac-toe-repro/manifest";

const CANDIDATES = [2000, 10000]; // the exact two C55 already reported pre-fix numbers for
const GAMES = 60; // same as the original B3 sweep

const points = compareBudgets(bidTacToe, manifest, CANDIDATES, { seed: "b3-sweep-fixed-seed", games: GAMES });

for (const { rollouts, report } of points) {
  const m = report.matchups;
  console.log(`\n==== rollouts=${rollouts} ====`);
  if (!m) {
    console.log("  (deferred — no self-play ran)");
    continue;
  }
  console.log(`  strongVsRandom win rate: see gates below`);
  console.log(`  strongSelfPlay: drawRate=${(m.strongSelfPlay.metrics.drawRate * 100).toFixed(1)}% firstPlayerWinRate=${(m.strongSelfPlay.metrics.firstPlayerWinRate * 100).toFixed(1)}% meanPlies=${m.strongSelfPlay.metrics.meanPlies.toFixed(1)} capHitRate=${(m.strongSelfPlay.metrics.capHitRate * 100).toFixed(2)}%`);
  console.log(`  gates:`);
  for (const g of report.gates) {
    console.log(`    [${g.status.toUpperCase()}] ${g.gate}: ${g.detail}`);
  }
}

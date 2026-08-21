// Throwaway B3 script (not committed as a package deliverable — a Fadeout-run-solve-style
// investigation script). Budget sweep per C22/C24: ONE fixed seed across every candidate,
// never the swept variable in the seed (compareBudgets() enforces this structurally).

import { compareBudgets } from "@twist-arcade/harness";
import { bidTacToe } from "./engine";
import { manifest } from "./manifest";

// Candidates must stay STRICTLY ABOVE standard's shipped 1,500 rollouts (C19/C20 tier-collapse
// guard: runCiSuite refuses a candidate that would make "ruthless" and "standard" the same
// effective strength at CI tier) — B1's placeholder tier values are otherwise unchanged here;
// TIER TUNING is explicitly B5's job (plan §10), not B3's.
const CANDIDATES = [1600, 2000, 3000, 5000, 10000]; // 10000 = shipped ruthless (baseline)
const GAMES = 60; // exploratory pass — the validated candidate gets a bigger confirmatory run

const points = compareBudgets(bidTacToe, manifest, CANDIDATES, { seed: "b3-sweep-fixed-seed", games: GAMES });

for (const { rollouts, report } of points) {
  const m = report.matchups;
  console.log(`\n==== rollouts=${rollouts} ====`);
  if (!m) {
    console.log("  (deferred — no self-play ran)");
    continue;
  }
  console.log(`  strongSelfPlay: drawRate=${(m.strongSelfPlay.metrics.drawRate * 100).toFixed(1)}% firstPlayerWinRate=${(m.strongSelfPlay.metrics.firstPlayerWinRate * 100).toFixed(1)}% meanPlies=${m.strongSelfPlay.metrics.meanPlies.toFixed(1)} capHitRate=${(m.strongSelfPlay.metrics.capHitRate * 100).toFixed(2)}%`);
  console.log(`  gates:`);
  for (const g of report.gates) {
    console.log(`    [${g.status.toUpperCase()}] ${g.gate}: ${g.detail}`);
  }
}

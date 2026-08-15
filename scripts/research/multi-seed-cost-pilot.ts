// scripts/research/multi-seed-cost-pilot.ts — C71 Part 1 / C77's own cost pilot: does splitting
// a FIXED total-game budget across K separate seeds (K separate runCiSuite calls, each with
// games/K) cost meaningfully more wall-clock than running the SAME total games under one seed?
// TIMING ONLY (tilt-t3-cost-pilot.ts's own posture) — no gate verdict is drawn from this run.
//
// Why this matters: C71 measured 5 independent single-seed runCiSuite(games=100) calls on Tilt
// at ~260-284s EACH (docs/research/games/tilt-fpa-replication-2026-08-12.out) — naively running
// K seeds at the SHIPPED games count multiplies cost by K, which the plan calls out as the hard
// constraint. The alternative this pilot tests: hold TOTAL games fixed across every K (so total
// self-play games — and therefore, if cost is dominated by per-game rollout cost rather than
// per-call fixed overhead — total wall time — stays flat), and see whether that holds in
// practice or whether per-call overhead (engine setup, tier resolution, JIT) is large enough to
// matter once you're making K times as many runCiSuite calls.
//
// Run: pnpm tsx scripts/research/multi-seed-cost-pilot.ts > .scratch/multi-seed-cost-pilot.out 2>&1

import { runCiSuite } from "@twist-arcade/harness";
import { tilt } from "../../games/tilt/engine";
import { manifest } from "../../games/tilt/manifest";

const TOTAL_GAMES = 12; // small and cheap (timing only) — divisible by every K below
const SEED_COUNTS = [1, 2, 3, 4, 6, 12];

function main(): void {
  console.log(
    `multi-seed cost pilot — game=tilt, ruthless override=${manifest.ciGateBudget?.twoPlayerCiRollouts}, ` +
      `TOTAL_GAMES=${TOTAL_GAMES} held fixed across every K, seedCounts=[${SEED_COUNTS.join(", ")}]`
  );
  console.log("TIMING ONLY. No gate verdict is drawn from this run (tilt-t3-cost-pilot.ts's own posture).");
  console.log();

  for (const k of SEED_COUNTS) {
    if (TOTAL_GAMES % k !== 0) throw new Error(`TOTAL_GAMES=${TOTAL_GAMES} not divisible by K=${k}`);
    const gamesPerSeed = TOTAL_GAMES / k;
    const start = Date.now();
    for (let i = 0; i < k; i++) {
      runCiSuite(tilt, manifest, { seed: `multi-seed-cost-pilot:k${k}:${i}`, games: gamesPerSeed, suite: "ci" });
    }
    const elapsedMs = Date.now() - start;
    console.log(
      `K=${k.toString().padStart(2)}  gamesPerSeed=${gamesPerSeed.toString().padStart(2)}  ` +
        `calls=${k}  elapsed=${(elapsedMs / 1000).toFixed(2)}s  perGamePlayMs=${(elapsedMs / (TOTAL_GAMES * 2)).toFixed(1)}`
    );
  }

  console.log();
  console.log(
    "Done. perGamePlayMs is elapsed / (TOTAL_GAMES * 2 matchups [strongVsRandom, strongSelfPlay] — " +
      "tilt has no 'standard' tier, so ruthlessVsStandard never runs). If perGamePlayMs stays flat " +
      "across K, per-call overhead is negligible and splitting a fixed budget across more seeds is free."
  );
}

main();

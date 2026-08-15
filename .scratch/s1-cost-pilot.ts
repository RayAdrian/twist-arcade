// .scratch/s1-cost-pilot.ts — S1: 15-game TIMING-ONLY pilot (C26) for the two-player degeneracy
// probe suite (mirror/stall/rush) against the three shipped two-player games, at their real
// ci-tier effective rollout budgets. Reports wall-clock seconds per probe matchup and a linear
// n=15->n=100 extrapolation, compared against docs/plans/degeneracy-probes.md §3's own estimate.
// NEVER draws a pass/fail verdict from these numbers (C26's own lesson, restated in the plan:
// "the n=15 gate reads themselves flipped pass/fail non-monotonically across candidates... n=15
// is noise") — this script prints timings only.

import { runProbeSuite } from "@twist-arcade/harness";
import { fadeoutEngine, fadeoutManifest } from "../games/fadeout/index";
import { mirrorMove as fadeoutMirrorMove } from "../games/fadeout/probes";
import { nineGrids, manifest as nineGridsManifest } from "../games/nine-grids/index";
import { mirrorMove as nineGridsMirrorMove } from "../games/nine-grids/probes";
import { tilt, manifest as tiltManifest } from "../games/tilt/index";
import { mirrorMove as tiltMirrorMove } from "../games/tilt/probes";

const GAMES = 15;

interface Point {
  readonly game: string;
  readonly seconds: number;
}

function timeIt<T>(fn: () => T): { result: T; seconds: number } {
  const start = Date.now();
  const result = fn();
  const seconds = (Date.now() - start) / 1000;
  return { result, seconds };
}

function main(): void {
  const points: Point[] = [];

  console.log(`S1 cost pilot — ${GAMES} games/matchup, TIMING ONLY (C26), never a verdict.\n`);

  // ---------------------------------------------------------------------------------------
  // Tilt — ciGateBudget.twoPlayerCiRollouts: 3000
  // ---------------------------------------------------------------------------------------
  {
    const { seconds } = timeIt(() =>
      runProbeSuite(tilt, tiltManifest, { seed: "s1-cost-pilot:tilt", games: GAMES, mirrorMove: tiltMirrorMove })
    );
    points.push({ game: "tilt", seconds });
    console.log(`tilt:       ${seconds.toFixed(1)}s for ${GAMES} games x 3 probe matchups (mirror+stall+rush)`);
  }

  // ---------------------------------------------------------------------------------------
  // Fadeout — ciGateBudget.twoPlayerCiRollouts: 3000
  // ---------------------------------------------------------------------------------------
  {
    const { seconds } = timeIt(() =>
      runProbeSuite(fadeoutEngine, fadeoutManifest, { seed: "s1-cost-pilot:fadeout", games: GAMES, mirrorMove: fadeoutMirrorMove })
    );
    points.push({ game: "fadeout", seconds });
    console.log(`fadeout:    ${seconds.toFixed(1)}s for ${GAMES} games x 3 probe matchups (mirror+stall+rush)`);
  }

  // ---------------------------------------------------------------------------------------
  // Nine Grids — ciGateBudget.twoPlayerCiRollouts: 1500 (the widest error bars per the plan)
  // ---------------------------------------------------------------------------------------
  {
    const { seconds } = timeIt(() =>
      runProbeSuite(nineGrids, nineGridsManifest, { seed: "s1-cost-pilot:nine-grids", games: GAMES, mirrorMove: nineGridsMirrorMove })
    );
    points.push({ game: "nine-grids", seconds });
    console.log(`nine-grids: ${seconds.toFixed(1)}s for ${GAMES} games x 3 probe matchups (mirror+stall+rush)`);
  }

  console.log("\nLinear n=15 -> n=100 extrapolation (estimate; NOT a measurement at n=100):");
  for (const p of points) {
    const extrapolated100 = (p.seconds / GAMES) * 100;
    console.log(`  ${p.game}: ${extrapolated100.toFixed(0)}s (${(extrapolated100 / 60).toFixed(1)} min) for the full 100-game probe suite`);
  }

  console.log("\nPlan §3's own estimate (the '+mirror +stall' and '+rush' columns combined, at n=100):");
  console.log("  tilt:       +~96s +~25s  = +~121s (~2.0 min)");
  console.log("  fadeout:    +~7-8min +~1.5min = +~8.5-9.5 min");
  console.log("  nine-grids: +~8-10min +~4-6min = +~12-16 min");
}

main();

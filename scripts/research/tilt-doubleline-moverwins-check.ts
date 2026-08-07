// scripts/research/tilt-doubleline-moverwins-check.ts — the §5.1/§1.4 follow-up owed by T2's
// own conditional rule: double-line frequency measured at 9.00% in the mcts1k-vs-mcts1k
// self-play arm of tilt-kill-sweep.ts, above the ~2% threshold, so the "doubleLine: mover-wins"
// variant must be measured too (not a kill — a required second measurement, per plan §1.4/§4).
// SAME seed, SAME game count, SAME pairing as the shipped-config self-play arm — only the
// engine config differs — so this is a clean apples-to-apples comparison, not a fresh sweep.

import { agentWinRate, resolveNamedAgent, runMatchup } from "@twist-arcade/harness";
import { createTiltEngine, type TiltMove, type TiltState } from "../../games/tilt/engine";

const SEED = "tilt-t2-kill-sweep"; // identical to tilt-kill-sweep.ts's self-play arm — C24.
const GAMES = 200;

function main(): void {
  const moverWins = createTiltEngine({ doubleLine: "mover-wins" });
  const mcts1k = resolveNamedAgent<TiltState, TiltMove>("mcts1k");

  const report = runMatchup(moverWins, mcts1k, mcts1k, { games: GAMES, seed: SEED, maxPlies: 60 });
  const m = report.metrics;

  console.log(`Tilt doubleLine:"mover-wins" self-play check — seed="${SEED}", ${GAMES} games`);
  console.log(`  seat0 win rate: ${(m.winRateBySeat[0] * 100).toFixed(1)}%`);
  console.log(`  seat1 win rate: ${(m.winRateBySeat[1] * 100).toFixed(1)}%`);
  console.log(`  draw rate: ${(m.drawRate * 100).toFixed(1)}%  (shipped "draw" config measured 9.0% here)`);
  console.log(`  mean plies: ${m.meanPlies.toFixed(1)}  median: ${m.medianPlies}`);
  console.log(`  cap-hit rate: ${(m.capHitRate * 100).toFixed(2)}%`);
  console.log(`  mcts1k win rate (both seats pooled): ${(agentWinRate(report.outcomes, "mcts1k") * 100).toFixed(1)}%`);
  console.log();
  console.log(
    "Comparison: shipped 'draw' config drew 9.0% of self-play games (all double-lines). Under " +
      "'mover-wins', those same double-line positions instead resolve to a winner — draw rate " +
      `here (${(m.drawRate * 100).toFixed(1)}%) reflects only genuine full-board no-line draws.`
  );
}

main();

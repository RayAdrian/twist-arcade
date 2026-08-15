// .scratch/nine-grids-fallback-before-after.ts — platform-corrections.md C81 / task #26: verifies
// that aligning games/nine-grids/probes.ts's mirrorMove to the null convention (returning `null`
// instead of silently substituting `legalMoves[0]` internally) does not materially change the
// mirror-probe's own measured win/draw rate, BEYOND the substitution source itself (harness's
// uniform-random legal move vs. the old code's deterministic legalMoves[0]).
//
// Runs the SAME mirror matchup (ruthless at nine-grids' own ci-effective budget vs. mirror,
// mirrorSeats:false, n=100, same seed) through the OLD mirrorMove (inlined below, copied verbatim
// from games/nine-grids/probes.ts at commit 97e6114, before the C81 fix) and the NEW one (the real,
// current export) and prints both.
//
// Throwaway script, not a package deliverable — run once before the fix, once after.

import { runProbeSuite } from "@twist-arcade/harness";
import { nineGrids, manifest as nineGridsManifest } from "../games/nine-grids/index";
import { mirrorMove as newMirrorMove } from "../games/nine-grids/probes";
import type { NineGridsMove, NineGridsState } from "../games/nine-grids/engine";

const TOTAL_CELLS = 81;

// Verbatim pre-fix implementation (commit 97e6114) — never returns null, substitutes
// legalMoves[0] internally, invisible to the harness.
function oldMirrorMove(
  _state: NineGridsState,
  lastOppMove: NineGridsMove | null,
  legalMoves: readonly NineGridsMove[]
): NineGridsMove {
  if (lastOppMove) {
    const g = lastOppMove.board * 9 + lastOppMove.cell;
    const mirroredG = TOTAL_CELLS - 1 - g;
    const board = Math.floor(mirroredG / 9);
    const cell = mirroredG % 9;
    const mirrored = legalMoves.find((m) => m.board === board && m.cell === cell);
    if (mirrored) return mirrored;
  }
  const move = legalMoves[0];
  if (!move) {
    throw new Error("nine-grids: mirrorMove() called with no legal moves — the harness should never do this");
  }
  return move;
}

const SEED = "nine-grids-fallback-before-after";
const GAMES = 20;

function main(): void {
  console.log(`nine-grids mirror-probe: OLD (legalMoves[0] fallback) vs NEW (null -> harness fallback), n=${GAMES}, seed="${SEED}"\n`);

  const before = runProbeSuite(nineGrids, nineGridsManifest, {
    seed: SEED,
    games: GAMES,
    mirrorMove: oldMirrorMove as (state: NineGridsState, lastOppMove: NineGridsMove | null, legalMoves: readonly NineGridsMove[]) => NineGridsMove | null,
  });
  const beforeMirror = before.matchups!.mirror!;
  console.log("OLD (legalMoves[0] internal fallback, invisible to harness):");
  console.log(`  win rate (P2, wins/games): ${(beforeMirror.metrics.winRateBySeat[1] * 100).toFixed(1)}%`);
  console.log(`  draw rate: ${(beforeMirror.metrics.drawRate * 100).toFixed(1)}%`);
  console.log(`  mirrorFallbackRate (harness's own count — expect null/0, old code never returns null): ${beforeMirror.metrics.mirrorFallbackRate}`);
  console.log(`  mirror-probe gate: ${before.gates.find((g) => g.gate === "mirror-probe")?.status}`);

  const after = runProbeSuite(nineGrids, nineGridsManifest, {
    seed: SEED,
    games: GAMES,
    mirrorMove: newMirrorMove,
  });
  const afterMirror = after.matchups!.mirror!;
  console.log("\nNEW (null -> harness's own uniform-random fallback):");
  console.log(`  win rate (P2, wins/games): ${(afterMirror.metrics.winRateBySeat[1] * 100).toFixed(1)}%`);
  console.log(`  draw rate: ${(afterMirror.metrics.drawRate * 100).toFixed(1)}%`);
  console.log(`  mirrorFallbackRate (harness's own count): ${((afterMirror.metrics.mirrorFallbackRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`  mirror-probe gate: ${after.gates.find((g) => g.gate === "mirror-probe")?.status}`);

  const winDelta = Math.abs(beforeMirror.metrics.winRateBySeat[1] - afterMirror.metrics.winRateBySeat[1]);
  const drawDelta = Math.abs(beforeMirror.metrics.drawRate - afterMirror.metrics.drawRate);
  console.log(`\nDelta: win rate ${(winDelta * 100).toFixed(1)}pp, draw rate ${(drawDelta * 100).toFixed(1)}pp`);
}

main();

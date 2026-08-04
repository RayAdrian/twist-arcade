// games/nine-grids/heuristic.ts — position evaluation for the minimax/greedy bot option (plan
// §3: "Positive = good for player"). MCTS needs nothing, so this only matters once a `minimax`
// difficulty tier is wired in manifest.ts. Two terms, per the task brief ("small-board control
// plus macro-line potential"), weighted so macro-line facts dominate tactical in-board ones —
// completing (or threatening) a macro line is what actually wins the game; winning one small
// board is only ever a step toward that.
//
// Only SIGN and ORDERING are contractual (packages/engine/src/types.ts's heuristic doc) — the
// magnitude below is not tuned against anything and is not meant to be read as a probability or
// a scaled score.

import type { PlayerId } from "@twist-arcade/engine";
import { allBoardStatuses, LINES, opponentOf, type MicroBoardStatus } from "./engine-internal";
import type { NineGridsState } from "./engine";

const MACRO_LINE_WEIGHT = 3;
const MICRO_LINE_WEIGHT = 0.3;

/** How many of a macro line's 3 boards are already won by `p`, PROVIDED the line is still
 *  "live" for `p` — i.e. no board in it is won by the opponent, and none is full-with-no-
 *  winner. A full-but-drawn board is decisive-neutral (see engine-internal.ts's macroWinnerOf
 *  doc): it blocks the line for BOTH sides just as surely as an opponent win would, so it must
 *  disqualify the line here exactly the same way — treating it as merely "not yet won by
 *  opponent" would wrongly keep crediting a line that can never actually complete. */
function liveLineCredit(slots: readonly [MicroBoardStatus, MicroBoardStatus, MicroBoardStatus], p: PlayerId): number {
  let ownWon = 0;
  for (const s of slots) {
    if (s.kind === "won" && s.winner !== p) return 0; // opponent already owns a slot: dead for p
    if (s.kind === "full") return 0; // decisive-neutral: dead for BOTH sides
    if (s.kind === "won") ownWon++; // won, and (given the checks above) won by p
  }
  return ownWon;
}

export function nineGridsHeuristic(state: NineGridsState, player: PlayerId): number {
  const opponent = opponentOf(player);
  const boardStatuses = allBoardStatuses(state.cells);

  let score = 0;

  // Macro-line potential: for each of the 8 macro lines, credit whichever side it's still live
  // for, weighted by how many of that line's 3 boards they've already won.
  for (const [a, b, c] of LINES) {
    const slots: [MicroBoardStatus, MicroBoardStatus, MicroBoardStatus] = [
      boardStatuses[a]!,
      boardStatuses[b]!,
      boardStatuses[c]!,
    ];
    score += liveLineCredit(slots, player) * MACRO_LINE_WEIGHT;
    score -= liveLineCredit(slots, opponent) * MACRO_LINE_WEIGHT;
  }

  // Small-board control: ordinary open-line tactical threats, but ONLY within boards still
  // open (a closed board's internal marks no longer matter beyond the status already scored
  // above). Same "own present, opponent absent" shape as classic-ttt's reference heuristic.
  for (let board = 0; board < 9; board++) {
    if (boardStatuses[board]!.kind !== "open") continue;
    const base = board * 9;
    for (const [a, b, c] of LINES) {
      const cells = [state.cells[base + a], state.cells[base + b], state.cells[base + c]];
      const hasPlayer = cells.includes(player);
      const hasOpponent = cells.includes(opponent);
      if (hasPlayer && !hasOpponent) score += MICRO_LINE_WEIGHT;
      if (hasOpponent && !hasPlayer) score -= MICRO_LINE_WEIGHT;
    }
  }

  return score;
}

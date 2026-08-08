// games/duel-draft/heuristic.ts — position evaluation for minimax/greedy bots (docs/plans/
// duel-draft.md §3: "own-live-lines minus opponent-live-lines, a line being live if it holds
// no opposing mark and no destroyed cell, weighted by own marks on it").
//
// MCTS (the only shipped search per plan §9 — minimax refuses simultaneous games by design)
// needs nothing from this file; it exists for the probes file's greedy-family policies
// (probes.ts) and any future minimax/greedy tier. "Positive = good for player" (the engine
// contract's own rule) — only SIGN and ORDERING are contractual, never magnitude.

import type { PlayerId } from "@twist-arcade/engine";
import { isLiveFor, progressFor, WINDOWS, type Cell, type DuelDraftState, type Seat } from "./engine";

/** Sum, over every live-for-`player` window, of `player`'s own progress on it (own marks
 *  already placed) — plan §3's "weighted by own marks on it". A window that is live but has
 *  zero of `player`'s marks on it yet contributes 0, exactly as it should: it is a genuine
 *  future opportunity, not a current advantage. */
function liveLineScore(board: readonly Cell[], player: Seat): number {
  let total = 0;
  for (const w of WINDOWS) {
    if (isLiveFor(board, w, player)) total += progressFor(board, w, player);
  }
  return total;
}

export function heuristic(state: DuelDraftState, player: PlayerId): number {
  const seat = player as Seat;
  const opponent: Seat = seat === 0 ? 1 : 0;
  return liveLineScore(state.board, seat) - liveLineScore(state.board, opponent);
}

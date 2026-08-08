// games/duel-draft/probes.ts — the permanent probes file (docs/plans/duel-draft.md §6/§7,
// §9's own instruction: "D0's scripted policies become a permanent probes file, not
// throwaway"). Carries D0's three scripted policies (greedy-threat, defensive-cover, mixed-
// greedy — ported verbatim in decision logic from scripts/research/duel-draft-d0.ts, which
// stays the source of truth D0's report was measured against) plus the collider (plan §7.4,
// this game's own new degeneracy probe, replacing the stock mirror probe — see below).
//
// Every probe shares the SAME "live window" vocabulary the engine's own heuristic.ts uses
// (isLiveFor/progressFor from engine.ts) rather than re-deriving a parallel notion of
// "threat" — a window is live for a player iff it holds no opposing mark and no destroyed
// cell (plan §7.3's own definition, verbatim).
//
// ---------------------------------------------------------------------------------------
// THE MIRROR PROBE: deliberately NOT implemented here (plan header / §7.4).
//
// The stock convention (packages/harness/src/roster.ts's `mirrorAgent`) wraps a per-game
// `mirrorMove(state, lastOppMove, legalMoves)` that copies the OPPONENT'S MOST RECENT move —
// coherent for a SEQUENTIAL game (Tilt: P1 moves, P2 reacts to what P1 just did) or even a
// simultaneous-but-phased one where a later phase can react to an earlier one. Duel Draft has
// neither: every non-terminal state is a single joint pick (plan §1.1) with NO prior move
// WITHIN THE SAME ROUND to react to — both seats choose from the identical pre-resolution
// board, blind to each other, by construction. "Copy the opponent's move from the PREVIOUS
// round" is not incoherent to COMPUTE, but it has no strategic content to measure: it does not
// preserve board symmetry (both seats already acted last round too) and is not a "so late that
// nothing else matters" reaction either. There is nothing here for a mirror probe to test.
//
// This is the C48 ruling shape applied unprompted (docs/plans/platform-corrections.md C48):
// "where mirroring is provably not value-preserving, the probe cannot measure its claim — a
// WARN invites someone to tune away a number that never meant anything." The correct report
// for this game's mirror probe is `n/a`, with this reason — not the roster's default WARN-on-
// absence behavior. That distinction lives in the harness's gate-reporting layer
// (packages/harness/src/suites.ts's `evaluateMirrorProbeGate`, routed at C62) — this file
// supplies only the reason string; `manifest.ts` declares `mirrorProbe: { applicable: false,
// reason: MIRROR_PROBE_NOT_APPLICABLE_REASON }`, which is what makes `runCiSuite`'s real report
// carry a `mirror-probe: n/a` row citing this text, rather than the absence a reader could not
// distinguish from "nobody thought about it". No `mirrorMove` is exported from this file on
// purpose: exporting the scaffold's vacuous "always play the first legal move" placeholder
// would risk it being wired into `mirrorAgent()` later and silently read as a real (and
// meaningless) win-rate number instead of the `n/a` this game's structure actually calls for.
export const MIRROR_PROBE_NOT_APPLICABLE_REASON =
  "no prior move WITHIN a round exists to mirror — every non-terminal state is a single joint " +
  "pick (plan §1.1), so a mirror strategy would need to see the opponent's THIS-round pick " +
  "before responding, which simultaneity rules out by construction. Report as n/a with this " +
  "reason, never a WARN (platform-corrections.md C48's ruling shape).";

import type { PlayerId, Rng } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "@twist-arcade/bots";
import { isLiveFor, progressFor, WINDOWS, type Cell, type DuelDraftMove, type DuelDraftState, type Seat } from "./engine";

function noStats(): SearchStats {
  return { elapsedMs: 0 };
}

function seatOf(player: PlayerId): Seat {
  return player as Seat;
}

function legalCellsOf(state: DuelDraftState): number[] {
  const cells: number[] = [];
  state.board.forEach((c, i) => {
    if (c === "empty") cells.push(i);
  });
  return cells;
}

/** Sum, over every live-for-`player` window containing `cell`, of (progress-so-far + 1).
 *  Rewards cells that advance multiple or more-advanced lines at once — the mechanism that
 *  lets a greedy policy stumble into double threats without being told to look for them
 *  (verbatim from scripts/research/duel-draft-d0.ts's own `scoreCell`, which D0's report
 *  measured this exact scoring function against). */
function scoreCell(board: readonly Cell[], player: Seat, cell: number): number {
  let score = 0;
  for (const w of WINDOWS) {
    if (!w.includes(cell)) continue;
    if (!isLiveFor(board, w, player)) continue;
    score += progressFor(board, w, player) + 1;
  }
  return score;
}

/** A legal cell that completes a live-for-`player` window right now (progress === WIN_LENGTH-1
 *  and this is the window's only empty cell). Null if no such move exists. */
function findImmediateWin(board: readonly Cell[], player: Seat, legal: readonly number[]): number | null {
  const legalSet = new Set(legal);
  for (const w of WINDOWS) {
    if (!isLiveFor(board, w, player)) continue;
    const empties = w.filter((i) => board[i] === "empty");
    if (empties.length === 1 && progressFor(board, w, player) === w.length - 1 && legalSet.has(empties[0]!)) {
      return empties[0]!;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// greedy-threat: take a free win; else extend the most-advanced live line(s), tie-broken
// toward cells that advance the most lines at once (scoreCell), tie-broken by lowest index for
// determinism. Fully deterministic given a board — which is exactly why greedy-threat vs
// itself collides every round on the symmetric opening board (D0's report: real, not a bug,
// and the reason mixed-greedy exists).
// ---------------------------------------------------------------------------------------

export function pickGreedyThreatCell(board: readonly Cell[], player: Seat, legal: readonly number[]): number {
  const win = findImmediateWin(board, player, legal);
  if (win !== null) return win;
  let best = legal[0]!;
  let bestScore = -1;
  for (const cell of legal) {
    const s = scoreCell(board, player, cell);
    if (s > bestScore) {
      bestScore = s;
      best = cell;
    }
  }
  return best;
}

export function greedyThreatPolicy(): Policy<DuelDraftState, DuelDraftMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      const legal = legalCellsOf(state);
      if (legal.length === 0) {
        throw new Error("duel-draft probes: greedyThreatPolicy called with no legal moves");
      }
      return { move: { cell: pickGreedyThreatCell(state.board, seat, legal) }, stats: noStats() };
    },
  };
}

// ---------------------------------------------------------------------------------------
// defensive-cover: take a free win; else block the opponent's immediate win; else cover the
// opponent's most-advanced live line (highest opponent progress among windows touching a legal
// cell, defense-score tie-break); else play greedily (own offense). D0's report: this policy's
// own "else play greedily" fallback is why greedy-threat-vs-defensive-cover reads 0% decisive
// on the empty opening board (both fall through to the identical deterministic scoring
// function and collide every round) — a real, explained degeneracy, not a bug.
// ---------------------------------------------------------------------------------------

export function pickDefensiveCoverCell(board: readonly Cell[], player: Seat, legal: readonly number[]): number {
  const opponent: Seat = player === 0 ? 1 : 0;
  const ownWin = findImmediateWin(board, player, legal);
  if (ownWin !== null) return ownWin;
  const oppWin = findImmediateWin(board, opponent, legal);
  if (oppWin !== null) return oppWin;

  let bestCell: number | null = null;
  let bestProgress = -1;
  let bestDefScore = -1;
  for (const cell of legal) {
    let cellBestProgress = -1;
    for (const w of WINDOWS) {
      if (!w.includes(cell)) continue;
      if (!isLiveFor(board, w, opponent)) continue;
      const p = progressFor(board, w, opponent);
      if (p > cellBestProgress) cellBestProgress = p;
    }
    if (cellBestProgress < 0) continue;
    const defScore = scoreCell(board, opponent, cell);
    if (cellBestProgress > bestProgress || (cellBestProgress === bestProgress && defScore > bestDefScore)) {
      bestProgress = cellBestProgress;
      bestDefScore = defScore;
      bestCell = cell;
    }
  }
  if (bestCell !== null && bestProgress >= 1) return bestCell;
  return pickGreedyThreatCell(board, player, legal);
}

export function defensiveCoverPolicy(): Policy<DuelDraftState, DuelDraftMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      const legal = legalCellsOf(state);
      if (legal.length === 0) {
        throw new Error("duel-draft probes: defensiveCoverPolicy called with no legal moves");
      }
      return { move: { cell: pickDefensiveCoverCell(state.board, seat, legal) }, stats: noStats() };
    },
  };
}

// ---------------------------------------------------------------------------------------
// mixed-greedy: take a free win; else with probability MIXED_EPSILON play a uniformly random
// legal cell; else sample uniformly among the top-MIXED_TOP_K legal cells by greedy score.
// The policy that exists specifically so self-play doesn't collide with certainty (plan §6): a
// deterministic policy facing itself on a symmetric position computes the same pick every
// round, which is real (see greedy-threat above) and is sidestepped here by construction
// rather than worked around.
// ---------------------------------------------------------------------------------------

const MIXED_EPSILON = 0.2;
const MIXED_TOP_K = 3;

export function pickMixedGreedyCell(board: readonly Cell[], player: Seat, legal: readonly number[], rng: Rng): number {
  const win = findImmediateWin(board, player, legal);
  if (win !== null) return win;
  if (rng.next() < MIXED_EPSILON) return legal[rng.int(legal.length)]!;
  const scored = legal.map((cell) => ({ cell, score: scoreCell(board, player, cell) }));
  scored.sort((a, b) => b.score - a.score);
  const k = Math.min(MIXED_TOP_K, scored.length);
  return scored[rng.int(k)]!.cell;
}

export function mixedGreedyPolicy(): Policy<DuelDraftState, DuelDraftMove> {
  return {
    chooseMove({ state, player, rng }) {
      const seat = seatOf(player);
      const legal = legalCellsOf(state);
      if (legal.length === 0) {
        throw new Error("duel-draft probes: mixedGreedyPolicy called with no legal moves");
      }
      return { move: { cell: pickMixedGreedyCell(state.board, seat, legal, rng) }, stats: noStats() };
    },
  };
}

// ---------------------------------------------------------------------------------------
// collider (plan §7.4): "a bot that predicts the opponent's pick and picks the same cell,
// seeking draws by destruction" — this game's own replacement for the mirror probe (see this
// file's module doc above for why the stock mirror probe is n/a here instead).
//
// The predictor has no channel to the opponent's ACTUAL hidden policy — there is none to have:
// a pending pick never enters `S` (plan §4), so nothing legitimate could read it even in
// principle. Instead it predicts using the SAME well-defined, deterministic greedy-threat
// procedure evaluated from THE OPPONENT'S OWN perspective — a reasonable, game-agnostic proxy
// for "what a decent opponent plays" — and then plays that predicted cell itself. If the
// prediction is right, the shared pick destroys the cell (a forced draw-by-destruction,
// exactly the plan's own framing); if it is wrong, the collider still lands on a cell its own
// predictor judged valuable for the OPPONENT to take, which is at minimum a real defensive
// pick, never a wasted one. Gate (D3, plan §7.4): <40% draws forced vs Strong.
// ---------------------------------------------------------------------------------------

export function pickColliderCell(board: readonly Cell[], player: Seat, legal: readonly number[]): number {
  const opponent: Seat = player === 0 ? 1 : 0;
  return pickGreedyThreatCell(board, opponent, legal);
}

export function colliderPolicy(): Policy<DuelDraftState, DuelDraftMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      const legal = legalCellsOf(state);
      if (legal.length === 0) {
        throw new Error("duel-draft probes: colliderPolicy called with no legal moves");
      }
      return { move: { cell: pickColliderCell(state.board, seat, legal) }, stats: noStats() };
    },
  };
}

// packages/bots/src/probes/rush.ts — generic 2-player degeneracy probe (plan §6):
// "1-ply greedy: win now, else block, else best heuristic, else random". Rush answers the
// harness's most basic sanity question about a two-player game: if the simplest possible
// non-random agent (look one ply ahead, take a win if there is one, else stop the opponent's
// immediate threat, else follow the static heuristic) plays about as well as a real search
// budget (mcts1k), the game has no tactical depth — every decision is flat and a human will
// feel that immediately (task framing: "if rush ≈ MCTS-1k in the harness, the game is
// tactically flat").
//
// Deliberately NOT a general N-ply search: rush only ever looks one ply past ITS move ("win
// now") and one ply past the resulting position ("block" — does the now-active opponent have
// an immediate win?). "Block" only has meaning for a SEQUENTIAL single opponent, so it is a
// no-op (never narrows the candidate pool) for simultaneous games — rush degrades gracefully
// to heuristic/random there rather than guessing at a joint-move notion of blocking.

import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "../policy";

interface Candidate<S extends WithEffects, M extends Json> {
  move: M;
  next: S;
  isWin: boolean;
  letsOpponentWinNext: boolean;
}

/** True iff, in `state`, the ACTIVE player can reach an immediate ({kind:"won"}) win with one
 *  of their own legal moves. Used for both "win now" (checked on `state` itself, active player
 *  === the mover choosing rush's move) and "block" (checked on the state AFTER one of rush's
 *  candidate moves, active player === the opponent about to reply). Sequential-only: a
 *  simultaneous `active()` has no single "the mover about to act", so this reports false there
 *  — deliberately conservative rather than guessing. */
function activePlayerCanWinImmediately<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  rng: Rng
): boolean {
  if (engine.status(state).kind !== "ongoing") return false;
  const active = engine.active(state);
  if (active.mode !== "sequential") return false;
  const mover = active.player;
  for (const m of engine.legalMoves(state, mover)) {
    const next = engine.apply(state, new Map([[mover, m]]), rng);
    const status = engine.status(next);
    if (status.kind === "won" && status.winner === mover) return true;
  }
  return false;
}

export function rushPolicy<S extends WithEffects, M extends Json>(): Policy<S, M> {
  return {
    chooseMove({ engine, state, player, rng, clock }) {
      const start = clock.now();
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new Error("rushPolicy: chooseMove called on a terminal state");
      }
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(`rushPolicy: player ${String(player)} has no legal moves`);
      }

      const candidates: Candidate<S, M>[] = legal.map((move) => {
        const next = engine.apply(state, new Map([[player, move]]), rng);
        const nextStatus = engine.status(next);
        const isWin = nextStatus.kind === "won" && nextStatus.winner === player;
        const letsOpponentWinNext =
          nextStatus.kind === "ongoing" && activePlayerCanWinImmediately(engine, next, rng);
        return { move, next, isWin, letsOpponentWinNext };
      });

      // Tier 1: win now — if ANY candidate wins immediately, restrict to those (arbitrary
      // choice among multiple simultaneous wins is fine; there's nothing better to do).
      const winning = candidates.filter((c) => c.isWin);
      let pool = winning.length > 0 ? winning : candidates;

      // Tier 2: block — only narrows the pool when doing so actually excludes something
      // (i.e. a real one-move threat exists). If every candidate is equally (un)safe — no
      // threat, or a forced loss regardless — block has nothing to say and changes nothing.
      if (winning.length === 0) {
        const safe = candidates.filter((c) => !c.letsOpponentWinNext);
        if (safe.length > 0 && safe.length < candidates.length) {
          pool = safe;
        }
      }

      // Tier 3: best heuristic on the resulting position (from `player`'s POV) — else
      // tier 4, uniform random over whatever survived tiers 1-2.
      let bestMove: M = pool[0]!.move;
      if (engine.heuristic) {
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const c of pool) {
          const score = engine.heuristic(c.next, player);
          if (score > bestScore) {
            bestScore = score;
            bestMove = c.move;
          }
        }
      } else {
        bestMove = pool[rng.int(pool.length)]!.move;
      }

      return {
        move: bestMove,
        stats: { elapsedMs: clock.now() - start, rollouts: candidates.length },
      };
    },
  };
}

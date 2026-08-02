// packages/bots/src/minimax.ts — minimax + alpha-beta, iterative deepening (plan §6).
//
// Fits sequential, deterministic, perfect-information, 2-player games ONLY (the classic
// minimax precondition). Refuses — with a typed error, not a silent wrong answer — any game
// that is simultaneous, stochastic, hidden-information, or lacks `engine.heuristic` (needed
// once the search can't reach a terminal within budget/maxDepth).

import type { GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "./policy";

export class MinimaxUnsupportedGameError extends Error {
  constructor(reason: string) {
    super(`minimaxPolicy: ${reason}`);
    this.name = "MinimaxUnsupportedGameError";
  }
}

export interface MinimaxOptions {
  /** Hard depth ceiling for iterative deepening. Default 9 (enough to fully solve
   *  tic-tac-toe-sized games; larger games should pass an explicit, budget-appropriate cap —
   *  minimax is not meant to scale to large state spaces without a real evaluation function
   *  and much more careful iterative deepening than this simple version provides). */
  maxDepth?: number;
}

function terminalValue(status: Status, player: PlayerId): number | undefined {
  switch (status.kind) {
    case "won":
      return status.winner === player ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    case "lost":
      return Number.NEGATIVE_INFINITY;
    case "draw":
      return 0;
    case "scored":
      return status.scores[player] ?? 0;
    case "ongoing":
      return undefined;
  }
}

/**
 * Depth-limited NEGAMAX with alpha-beta pruning — the standard convention: `negamax(...,
 * mover, ...)` returns the position's value from `mover`'s OWN perspective (not a fixed root
 * player's), and every recursive call negates the child's value (since what's good for the
 * next mover is symmetrically bad for the current one — the standard zero-sum assumption,
 * exact for win/lose/draw games like tic-tac-toe; best-effort for `scored` 2P games whose
 * score vectors are not exactly zero-sum, which is why minimax additionally restricts itself
 * to `maxPlayers <= 2` sequential deterministic perfect-info games in `minimaxPolicy` below).
 * Increments `nodeCounter` for every state visited (the "rollouts" budget is spent as a
 * node-expansion cap, since minimax has no rollouts in the MCTS sense).
 */
function negamax<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  depth: number,
  alpha: number,
  beta: number,
  mover: PlayerId,
  rng: Rng,
  nodeCounter: { count: number },
  nodeBudget: number | undefined
): number {
  nodeCounter.count += 1;
  const status = engine.status(state);
  const terminal = terminalValue(status, mover);
  if (terminal !== undefined) return terminal;
  if (depth === 0 || (nodeBudget !== undefined && nodeCounter.count >= nodeBudget)) {
    if (!engine.heuristic) {
      throw new MinimaxUnsupportedGameError(
        `search reached depth/budget limit without a terminal state, and engine ` +
          `"${engine.meta.id}" has no heuristic() to fall back on — minimax requires one for ` +
          "any game whose full tree cannot be searched to completion."
      );
    }
    return engine.heuristic(state, mover);
  }

  const legal = engine.legalMoves(state, mover);
  if (legal.length === 0) {
    throw new MinimaxUnsupportedGameError(
      `active player ${mover} has no legal moves while status is ongoing — this violates the ` +
        "engine contract's no-hidden-pass rule and minimax cannot search past it."
    );
  }

  let value = Number.NEGATIVE_INFINITY;
  let a = alpha;
  const nextMover: PlayerId = mover === 0 ? 1 : 0;
  for (const move of legal) {
    const next = engine.apply(state, new Map([[mover, move]]), rng);
    const childValue = negamax(engine, next, depth - 1, -beta, -a, nextMover, rng, nodeCounter, nodeBudget);
    const candidate = -childValue; // negate: childValue is from nextMover's perspective
    if (candidate > value) value = candidate;
    a = Math.max(a, value);
    if (a >= beta) break; // alpha-beta cutoff
  }
  return value;
}

export function minimaxPolicy<S extends WithEffects, M extends Json>(
  opts: MinimaxOptions = {}
): Policy<S, M> {
  const maxDepth = opts.maxDepth ?? 9;
  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      if (engine.meta.simultaneous) {
        throw new MinimaxUnsupportedGameError(
          `engine "${engine.meta.id}" is simultaneous — minimax fits sequential perfect-info ` +
            "games only."
        );
      }
      if (engine.meta.hiddenInformation) {
        throw new MinimaxUnsupportedGameError(
          `engine "${engine.meta.id}" has hiddenInformation===true — minimax fits perfect-info ` +
            "games only (use determinize() with mcts/flat-mc for hidden-info games)."
        );
      }
      if (engine.meta.stochastic) {
        throw new MinimaxUnsupportedGameError(
          `engine "${engine.meta.id}" is stochastic — minimax fits deterministic games only.`
        );
      }
      if (engine.meta.maxPlayers > 2) {
        throw new MinimaxUnsupportedGameError(
          `engine "${engine.meta.id}" supports more than 2 players — this minimax implements ` +
            "the 2-player negamax convention only."
        );
      }
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new MinimaxUnsupportedGameError("chooseMove called on a terminal state");
      }
      const active = engine.active(state);
      if (active.mode !== "sequential" || active.player !== player) {
        throw new MinimaxUnsupportedGameError(`player ${player} is not the active mover in this state`);
      }

      const nodeBudget = budget.kind === "rollouts" ? budget.n : undefined;
      const nodeCounter = { count: 0 };
      const legal = engine.legalMoves(state, player);
      if (legal.length === 0) {
        throw new MinimaxUnsupportedGameError(`player ${player} has no legal moves`);
      }

      let bestMove: M = legal[0]!;
      let bestValue = Number.NEGATIVE_INFINITY;
      let depthReached = 0;

      const deadline = budget.kind === "deadlineMs" ? start + budget.ms : undefined;
      for (let depth = 1; depth <= maxDepth; depth++) {
        if (deadline !== undefined && clock.now() >= deadline) break;
        let iterationBestMove: M = bestMove;
        let iterationBestValue = Number.NEGATIVE_INFINITY;
        let sawUnsupported: MinimaxUnsupportedGameError | undefined;
        for (const move of legal) {
          if (deadline !== undefined && clock.now() >= deadline) break;
          const next = engine.apply(state, new Map([[player, move]]), rng);
          const nextMover: PlayerId = player === 0 ? 1 : 0;
          let value: number;
          try {
            const childValue = negamax(
              engine,
              next,
              depth - 1,
              Number.NEGATIVE_INFINITY,
              Number.POSITIVE_INFINITY,
              nextMover,
              rng,
              nodeCounter,
              nodeBudget
            );
            value = -childValue; // negate: childValue is from nextMover's perspective
          } catch (err) {
            if (err instanceof MinimaxUnsupportedGameError) {
              // Ran out of depth/budget without a heuristic at THIS depth — remember it, but
              // still let a shallower completed depth stand if we have one.
              sawUnsupported = err;
              continue;
            }
            throw err;
          }
          if (value > iterationBestValue) {
            iterationBestValue = value;
            iterationBestMove = move;
          }
        }
        if (iterationBestValue > Number.NEGATIVE_INFINITY) {
          bestMove = iterationBestMove;
          bestValue = iterationBestValue;
          depthReached = depth;
        } else if (sawUnsupported && depthReached === 0) {
          // Never completed even depth 1 (e.g., depth 1 itself needs a heuristic that isn't
          // there) — this IS a genuine "cannot search this game" situation.
          throw sawUnsupported;
        }
        if (nodeBudget !== undefined && nodeCounter.count >= nodeBudget) break;
        if (bestValue === Number.POSITIVE_INFINITY) break; // found a forced win; no need to go deeper
      }

      return {
        move: bestMove,
        stats: {
          elapsedMs: clock.now() - start,
          depth: depthReached,
          rootValue: bestValue,
        },
      };
    },
  };
}

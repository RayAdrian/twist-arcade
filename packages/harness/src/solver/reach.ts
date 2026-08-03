// packages/harness/src/solver/reach.ts — BFS reachability over the 2-player game graph,
// deduplicated on `encode(S)` (plan §7.6, M3a). See types.ts's module doc for the C3 caveat:
// this hashing is sound only when `encode` is a valid position key (no history-dependent
// legality, e.g. superko) — callers on a history-dependent game must compose over their own
// position key instead (see solve.ts).

import type { GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import { assertSolvablePreconditions, ReachLimitExceededError, UnsupportedGameError } from "./types";

export interface ReachEdge {
  move: Json;
  toHash: string;
}

export interface ReachNode<S> {
  state: S;
  hash: string;
  status: Status;
  /** The active player at this node, or undefined for a terminal (no one to move). */
  mover?: PlayerId;
  /** Outgoing transitions. Empty for terminal nodes. */
  moves: ReachEdge[];
}

export interface ReachGraph<S> {
  nodes: Map<string, ReachNode<S>>;
  initialHash: string;
}

export interface ReachOptions {
  /** Abort past this many discovered states (default 1e7, plan §7.6). */
  maxStates?: number;
}

/** A fixed, deterministic rng — the exact solver only ever runs on deterministic
 *  (`stochastic: false`) games, so `setup`/`apply` are contractually not permitted to make any
 *  outcome-relevant draw from it; it exists purely to satisfy the `Rng` parameter every
 *  `GameEngine` method signature requires. */
function inertRng(): Rng {
  return rngFromSeed("harness:solver:inert");
}

/**
 * Enumerates every state reachable from `engine.setup(2, rng)` under legal play, deduplicating
 * on `encode(state)` — the position key for this solver (see the C3 caveat in types.ts).
 * Requires perfect-info/deterministic/sequential/exactly-2-player (asserted up front via
 * `assertSolvablePreconditions`, thrown as `UnsupportedGameError` rather than silently
 * producing a wrong graph).
 */
export function reach<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ReachOptions = {}
): ReachGraph<S> {
  assertSolvablePreconditions(engine.meta);
  const maxStates = opts.maxStates ?? 1e7;

  const rng = inertRng();
  const initialState = engine.setup(2, rng);
  const initialHash = engine.encode(initialState);

  const nodes = new Map<string, ReachNode<S>>();
  const queue: string[] = [];

  function visit(state: S, hash: string): void {
    if (nodes.has(hash)) return;
    if (nodes.size >= maxStates) {
      throw new ReachLimitExceededError(maxStates);
    }
    const status = engine.status(state);
    const node: ReachNode<S> = { state, hash, status, moves: [] };
    if (status.kind === "ongoing") {
      const active = engine.active(state);
      if (active.mode !== "sequential") {
        throw new UnsupportedGameError(
          `engine "${engine.meta.id}" produced a simultaneous active() spec mid-reach — the ` +
            "exact solver fits sequential games only."
        );
      }
      node.mover = active.player;
    }
    nodes.set(hash, node);
    queue.push(hash);
  }

  visit(initialState, initialHash);

  while (queue.length > 0) {
    const hash = queue.shift()!;
    const node = nodes.get(hash)!;
    if (node.status.kind !== "ongoing" || node.mover === undefined) continue;

    const legal = engine.legalMoves(node.state, node.mover);
    if (legal.length === 0) {
      throw new UnsupportedGameError(
        `engine "${engine.meta.id}": active player ${node.mover} has no legal moves while ` +
          `status is ongoing at ${hash} — violates the engine contract's no-hidden-pass rule.`
      );
    }
    for (const move of legal) {
      const child = engine.apply(node.state, new Map([[node.mover, move]]), inertRng());
      const childHash = engine.encode(child);
      node.moves.push({ move: move as unknown as Json, toHash: childHash });
      visit(child, childHash);
    }
  }

  return { nodes, initialHash };
}

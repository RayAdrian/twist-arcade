// packages/harness/src/solver/reach.ts — BFS reachability over the 2-player game graph,
// deduplicated on `encode(S)` by DEFAULT (plan §7.6, M3a). See types.ts's module doc for the C3
// caveat: `encode` is a valid position key only when two states with the same `encode()` output
// are always legally interchangeable going forward, which is false under superko or any
// history-dependent legality rule. `ReachOptions.keyOf` lets a caller override the position key
// entirely — a history-dependent game composes `reach()` locally over its OWN sound key (see
// solve.ts's doc and index.ts's barrel doc for why reach/retrograde are exported individually
// for exactly this).

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

export interface ReachOptions<S = unknown> {
  /** Abort past this many discovered states (default 1e7, plan §7.6). */
  maxStates?: number;
  /**
   * The position key to dedupe on — defaults to `engine.encode`. Correction C3 (see types.ts's
   * module doc): `encode` is a valid position key only when two states with the same `encode()`
   * output are always legally interchangeable going forward, which is false under superko or
   * any history-dependent legality rule. `index.ts`'s own barrel doc promises `reach`/
   * `retrograde` are exported individually so a history-dependent game can "compose them locally
   * over its own position key" — before this option existed, `reach()` hardwired `encode` with
   * no way to honor that promise, so a caller needing a sound history-aware key had to
   * reimplement this entire BFS from scratch to get it (review's "broken promise at the API
   * level"). `retrograde()` never needed this itself — it operates purely on the graph
   * `reach()` already built, keyed however `reach()` keyed it.
   */
  keyOf?: (state: S) => string;
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
  opts: ReachOptions<S> = {}
): ReachGraph<S> {
  assertSolvablePreconditions(engine.meta);
  const maxStates = opts.maxStates ?? 1e7;
  const keyOf = opts.keyOf ?? ((state: S) => engine.encode(state));

  const rng = inertRng();
  const initialState = engine.setup(2, rng);
  const initialHash = keyOf(initialState);

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

  // Index-cursor traversal, not `queue.shift()`: `shift()` is O(V) per call (it re-indexes every
  // remaining element), making this loop O(V^2) overall — fine at classic-ttt's 5,478 states,
  // unusable at Fadeout's ~142k (and outright wrong to rely on near the advertised 1e7 ceiling).
  // `retrograde.ts` already uses this exact pattern for the identical reason; this brings
  // `reach()` in line with its own sibling in the same solver.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const hash = queue[cursor]!;
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
      const childHash = keyOf(child);
      node.moves.push({ move: move as unknown as Json, toHash: childHash });
      visit(child, childHash);
    }
  }

  return { nodes, initialHash };
}

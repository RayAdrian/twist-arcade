// packages/harness/src/solver/retrograde.ts — value iteration / retrograde analysis on the
// (possibly cyclic) reachability graph produced by reach.ts (plan §7.6, M3a).
//
// WHY NOT PLAIN MINIMAX (see types.ts's module doc and platform-corrections.md's C3 sibling
// concern): decay-style games decay pieces off the board, so positions RECUR — the graph
// reach() builds is cyclic. A naive recursive minimax/negamax over a cyclic graph either loops
// forever chasing a cycle (no depth cap) or returns a wrong value at an arbitrary depth cutoff
// (depth-capped) — not merely imprecise, WRONG, because a position that is a genuine forced win
// through a cycle-adjacent line gets misjudged as "unknown". Retrograde analysis instead works
// backward from KNOWN outcomes (terminal positions) and only ever asserts a WIN or LOSS label
// once it is PROVEN by exhaustive analysis of that label's own children — so it never needs to
// "guess" at a cycle. Anything never proven win or loss by the time the backward propagation
// runs out of frontier is exactly the class of position from which neither player can force an
// outcome — a draw by eternal recurrence — which is why draws are never explicitly labeled
// (module convention, restated below): they are the fixed point's residue, not a computed value.
//
// THE ALGORITHM (a standard retrograde/backward-induction worklist, generalized off the usual
// "turns strictly alternate" assumption — nothing in the GameEngine contract guarantees that):
//
// For an ongoing node `n` with mover `m`, define `value(n)` (once resolved) as WIN or LOSS FOR
// `m` — i.e. mover-relative, never absolute. A node is resolved the moment it is PROVEN:
//
//   - WIN(n): some outgoing move from `n` leads to a child `c` whose outcome, evaluated from
//     `m`'s perspective, is WIN. ("Outcome from m's perspective" — see `outcomeForMover` below —
//     handles both freshly-terminal children (`status.kind === "won"`) and already-resolved
//     ongoing children, flipping the child's own mover-relative value when the child's mover
//     differs from `m`, and passing it through unflipped when it doesn't — e.g. an extra-turn
//     rule where the same player moves again.)
//   - LOSS(n): EVERY outgoing move's child outcome, from `m`'s perspective, is LOSS. This can
//     only be proven once every child has itself been resolved (or is a "won" terminal) — it is
//     therefore discovered by counting down `n`'s remaining unresolved children, not by a single
//     edge the way WIN is.
//
// Implementation: a worklist BFS seeded from terminal children of ongoing nodes, propagating a
// newly-resolved node's value to ITS predecessors exactly once each (via a precomputed reverse-
// edge index), decrementing each predecessor's "remaining children" counter on a proven LOSS
// edge and resolving immediately on a proven WIN edge. Every node is resolved at most once
// (`label` is write-once), so the whole pass is O(V + E) over the reach graph — linear, no
// per-node recursion, and correct on cycles because a node genuinely stuck in a cycle with no
// forcing line simply never gets pushed onto the worklist. That is the fixed point.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { ReachGraph } from "./reach";
import { flipValue, type PositionValue } from "./types";

export interface RetrogradeResult {
  /**
   * Mover-relative value at `hash`: WIN/LOSS for whichever player is `active()` at that node
   * (meaningless — and never asked by any correct caller — at a terminal node, which has no
   * mover). Anything never proven WIN or LOSS by the time the fixed point is reached is
   * reported as "draw" — the residue convention this module's doc describes. `valueAt` never
   * throws on an unknown hash it has simply never resolved; it throws only via the graph-closure
   * assertion inside `retrograde()` itself, at construction time, not per-lookup.
   */
  valueAt(hash: string): PositionValue;
}

/** Internal per-node backward-induction label. Write-once: a node enters this map at most once,
 *  the instant it is PROVEN win or loss — never speculatively, never overwritten. A hash absent
 *  from this map at the end of the worklist is exactly the "draw residue" case; `valueAt` below
 *  is the only place that ever synthesizes the string `"draw"` — this map itself never stores
 *  it (mirrors the flipValue()/PositionValue split documented in types.ts). */
type Label = Map<string, "win" | "loss">;

/**
 * Runs value iteration to a fixed point over `graph` (as produced by `reach()`, or any graph
 * satisfying the same closure invariant: every edge's `toHash` is itself a key of `graph.nodes`).
 * `_engine` is accepted for API symmetry with `reach()` (and so game-local solvers composing
 * `reach`/`retrograde` together, per C3, can call both with the same argument list) — the
 * algorithm itself does not call any engine method; it operates purely on the graph's own
 * status/mover/edge data.
 */
export function retrograde<S extends WithEffects, M extends Json, V extends WithEffects>(
  _engine: GameEngine<S, M, V>,
  graph: ReachGraph<S>
): RetrogradeResult {
  const label: Label = new Map();

  // Reverse-edge index: childHash -> [{ from: predHash, mover: predMover }, ...]. Built once,
  // up front, over every ongoing node's outgoing edges (terminal nodes have none — reach.ts
  // guarantees `moves: []` for any non-ongoing node).
  const preds = new Map<string, { from: string; mover: PlayerId }[]>();
  // remaining[hash] = count of this ongoing node's outgoing edges not yet proven LOSS-for-its-
  // mover. Reaching 0 is exactly "every child is a proven loss for me" = a proven LOSS.
  const remaining = new Map<string, number>();

  for (const node of graph.nodes.values()) {
    if (node.status.kind !== "ongoing" || node.mover === undefined) continue;
    remaining.set(node.hash, node.moves.length);
    for (const edge of node.moves) {
      if (!graph.nodes.has(edge.toHash)) {
        throw new Error(
          `retrograde(): edge from ${node.hash} targets ${edge.toHash}, which is not in the ` +
            "graph — retrograde() requires a closed reachability graph (reach()'s own postcondition)."
        );
      }
      const arr = preds.get(edge.toHash);
      if (arr) {
        arr.push({ from: node.hash, mover: node.mover });
      } else {
        preds.set(edge.toHash, [{ from: node.hash, mover: node.mover }]);
      }
    }
  }

  /** The outcome of reaching `childHash`, evaluated from `mover`'s perspective — "win"/"loss" if
   *  determined, `undefined` if not (yet, or ever). Terminal "won" is read straight off status;
   *  any other terminal kind (draw, or a 2P engine's disallowed lost/scored, defensively) is
   *  treated as undetermined, matching the "residue = draw" convention — a permanently-drawn
   *  terminal must never force a WIN or LOSS anywhere above it. An ongoing child's outcome is its
   *  own mover-relative label, passed through unchanged if the same player moves again (an
   *  extra-turn rule) or flipped via `flipValue` when a different player is now to move — the
   *  general case that subsumes strict alternation without assuming it. */
  function outcomeForMover(mover: PlayerId, childHash: string): "win" | "loss" | undefined {
    const child = graph.nodes.get(childHash)!;
    if (child.status.kind === "won") {
      return child.status.winner === mover ? "win" : "loss";
    }
    if (child.status.kind !== "ongoing") {
      return undefined;
    }
    const childValue = label.get(childHash);
    if (childValue === undefined) return undefined;
    return child.mover === mover ? childValue : flipValue(childValue);
  }

  const queue: string[] = [];

  function resolve(hash: string, value: "win" | "loss"): void {
    if (label.has(hash)) return; // already proven — first proof wins, never re-derived.
    label.set(hash, value);
    queue.push(hash);
  }

  /** Evaluate one (predHash --mover--> childHash) edge now that `childHash`'s outcome may have
   *  just become determinable, and resolve `predHash` if this edge is enough to prove it. */
  function processEdge(predHash: string, predMover: PlayerId, childHash: string): void {
    if (label.has(predHash)) return; // predHash already resolved by an earlier edge.
    const outcome = outcomeForMover(predMover, childHash);
    if (outcome === "win") {
      resolve(predHash, "win");
    } else if (outcome === "loss") {
      const left = (remaining.get(predHash) ?? 0) - 1;
      remaining.set(predHash, left);
      if (left <= 0) resolve(predHash, "loss");
    }
    // outcome === undefined: nothing provable yet from this edge.
  }

  // Seed pass: every ongoing node's edges that already point at a non-ongoing (terminal) child
  // are evaluable immediately, with no prerequisite propagation — this is what resolves 1-ply
  // forced wins (and any node all of whose children are immediate terminal losses) up front.
  for (const node of graph.nodes.values()) {
    if (node.status.kind !== "ongoing" || node.mover === undefined) continue;
    for (const edge of node.moves) {
      const child = graph.nodes.get(edge.toHash)!;
      if (child.status.kind !== "ongoing") {
        processEdge(node.hash, node.mover, edge.toHash);
      }
    }
  }

  // Propagation: each time a node is resolved (pushed onto the queue), every predecessor edge
  // into it becomes newly evaluable. Index-based traversal (not `shift()`) keeps this O(V + E)
  // instead of O(V^2) on graphs the size of classic-ttt's 5,478 states.
  for (let i = 0; i < queue.length; i++) {
    const hash = queue[i]!;
    for (const { from, mover } of preds.get(hash) ?? []) {
      processEdge(from, mover, hash);
    }
  }

  return {
    valueAt(hash: string): PositionValue {
      return label.get(hash) ?? "draw";
    },
  };
}

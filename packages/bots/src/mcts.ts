// packages/bots/src/mcts.ts — MCTS (UCT), the workhorse (plan §6).
//
// Needs only legalMoves/apply/status/active from the engine contract (plus, optionally,
// score()/heuristic() as a value estimate when a rollout hits the ply cap before a terminal).
// Handles, WITHOUT a code fork for any of these (plan §6's explicit requirement):
//   - 1-player games natively: a single active player at every node just means there are no
//     "opponent" nodes to model — the same tree-growth loop applies unchanged.
//   - stochastic games: every rollout keeps drawing from the SAME injected `rng` stream
//     (never reseeded/forked) — since Rng is a stateful generator, sequential draws across
//     many rollouts are naturally decorrelated ("fresh rng per playout") while the overall
//     decision stays fully deterministic given the caller's seed.
//   - simultaneous games: branches on the JOINT move space (the cartesian product of each
//     active player's legalMoves, expressed directly as the `ReadonlyMap<PlayerId, M>` apply()
//     already expects) rather than a decoupled per-player statistic — "start simple", per the
//     plan; decoupled UCT is explicitly deferred.
//   - hidden-info games: NOT handled here at all — see determinize() in policy.ts. This file
//     only ever operates on a real `S` (perfect information, or a determinized sample of one).
//
// VALUE CONVENTION (worth stating precisely, since it is the one subtle design decision this
// file makes): every node's `totalValue` is accumulated with respect to a single FIXED
// "edge owner" — the player who is deemed to have "chosen" the edge leading to that node.
// For a sequential node, the edge owner of node N's CHILDREN is N's own active player (N is
// where that player chose their move) — so children of the same parent are always compared
// apples-to-apples during UCB selection. The root's own edge owner is the requesting
// `player` by definition (root has no parent). For a simultaneous node, there is no single
// natural "chooser" (multiple players commit at once); the requesting `player` is used as
// the edge owner there too — a deliberate simplification matching the plan's explicit
// "decoupled UCT deferred... fine at our branching factors" scoping. This generalizes both
// sequential alternating (2P zero-sum or general-sum) and solo trees without special-casing,
// and reduces exactly to standard single-player MCTS when there is only one seat.

import type { GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "./policy";

export class MctsTerminalStateError extends Error {
  constructor() {
    super("mctsPolicy: chooseMove called on a terminal state — there is nothing to search for.");
    this.name = "MctsTerminalStateError";
  }
}

export interface MctsOptions {
  /** UCB1 exploration constant. Default 1.4 (~sqrt(2)), per plan §6. */
  explorationC?: number;
  /** Hard ply cap on the random-rollout phase beyond the tree (never the tree itself, which
   *  stops growing once budget runs out) — mirrors the engine contract's own termination
   *  cap. Default 200. */
  rolloutCapPlies?: number;
}

type JointMove<M> = ReadonlyMap<PlayerId, M>;

function jointMoveKey<M extends Json>(jm: JointMove<M>): string {
  const sorted = Array.from(jm.entries()).sort((a, b) => a[0] - b[0]);
  return stableStringify(sorted as unknown as Json);
}

/** Enumerates the joint move space at `state`: a singleton-map list for a sequential node, or
 *  the cartesian product across all active players' own legal moves for a simultaneous node. */
function jointMoveOptions<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S
): JointMove<M>[] {
  const active = engine.active(state);
  if (active.mode === "sequential") {
    return engine.legalMoves(state, active.player).map((m) => new Map([[active.player, m]]) as JointMove<M>);
  }
  let combos: JointMove<M>[] = [new Map()];
  for (const p of active.players) {
    const moves = engine.legalMoves(state, p);
    const next: JointMove<M>[] = [];
    for (const combo of combos) {
      for (const m of moves) {
        const merged = new Map(combo);
        merged.set(p, m);
        next.push(merged);
      }
    }
    combos = next;
  }
  return combos;
}

/** The edge owner for children of `state` — see the module doc's VALUE CONVENTION note. */
function edgeOwnerAt<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  rootPlayer: PlayerId
): PlayerId {
  const active = engine.active(state);
  return active.mode === "sequential" ? active.player : rootPlayer;
}

interface Node<S extends WithEffects, M extends Json> {
  state: S;
  status: Status;
  visits: number;
  totalValue: number; // w.r.t. this node's OWN edge owner (see module doc)
  untried: JointMove<M>[];
  children: Map<string, { jointMove: JointMove<M>; child: Node<S, M> }>;
}

function makeNode<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S
): Node<S, M> {
  const status = engine.status(state);
  return {
    state,
    status,
    visits: 0,
    totalValue: 0,
    untried: status.kind === "ongoing" ? jointMoveOptions(engine, state) : [],
    children: new Map(),
  };
}

/** Value of a (possibly non-terminal, ply-cap-hit) outcome, from `player`'s perspective. */
function leafValue<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  status: Status,
  state: S,
  player: PlayerId
): number {
  switch (status.kind) {
    case "won":
      return status.winner === player ? 1 : -1;
    case "lost":
      return -1;
    case "draw":
      return 0;
    case "scored":
      return status.scores[player] ?? 0;
    case "ongoing":
      if (engine.score) return engine.score(state, player);
      if (engine.heuristic) return engine.heuristic(state, player) / 9;
      return 0;
  }
}

function rollout<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  start: S,
  rng: Rng,
  maxPlies: number
): { status: Status; state: S } {
  let state = start;
  let status = engine.status(state);
  let plies = 0;
  while (status.kind === "ongoing" && plies < maxPlies) {
    const active = engine.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const jm = new Map<PlayerId, M>();
    for (const p of actors) {
      const legal = engine.legalMoves(state, p);
      if (legal.length === 0) {
        throw new Error(
          `mctsPolicy rollout: active player ${p} has no legal moves while status is ongoing ` +
            "— this violates the engine contract's no-hidden-pass rule."
        );
      }
      jm.set(p, legal[rng.int(legal.length)]!);
    }
    state = engine.apply(state, jm, rng);
    status = engine.status(state);
    plies += 1;
  }
  return { status, state };
}

export function mctsPolicy<S extends WithEffects, M extends Json>(opts: MctsOptions = {}): Policy<S, M> {
  const explorationC = opts.explorationC ?? 1.4;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      const rootStatus = engine.status(state);
      if (rootStatus.kind !== "ongoing") {
        throw new MctsTerminalStateError();
      }
      const root = makeNode(engine, state);

      const runOnce = (): void => {
        // --- SELECT + EXPAND ---
        const path: Node<S, M>[] = [root];
        const owners: PlayerId[] = [];
        let node = root;
        let expanded = false;
        while (!expanded) {
          if (node.status.kind !== "ongoing") break;
          const owner = edgeOwnerAt(engine, node.state, player);
          if (node.untried.length > 0) {
            const idx = rng.int(node.untried.length);
            const jm = node.untried[idx]!;
            node.untried = node.untried.slice(0, idx).concat(node.untried.slice(idx + 1));
            const childState = engine.apply(node.state, jm, rng);
            const child = makeNode(engine, childState);
            node.children.set(jointMoveKey(jm), { jointMove: jm, child });
            path.push(child);
            owners.push(owner);
            node = child;
            expanded = true;
            break;
          }
          if (node.children.size === 0) break; // no legal moves at all (shouldn't happen if ongoing)
          let best: { jointMove: JointMove<M>; child: Node<S, M> } | undefined;
          let bestScore = Number.NEGATIVE_INFINITY;
          for (const entry of node.children.values()) {
            const score =
              entry.child.visits === 0
                ? Number.POSITIVE_INFINITY
                : entry.child.totalValue / entry.child.visits +
                  explorationC * Math.sqrt(Math.log(node.visits) / entry.child.visits);
            if (score > bestScore) {
              bestScore = score;
              best = entry;
            }
          }
          path.push(best!.child);
          owners.push(owner);
          node = best!.child;
        }

        // --- ROLLOUT (simulate randomly from the new leaf to a terminal/horizon) ---
        const { status: leafStatus, state: leafState } = rollout(engine, node.state, rng, rolloutCapPlies);

        // --- BACKPROPAGATE ---
        for (let i = path.length - 1; i >= 0; i--) {
          const owner = i === 0 ? player : owners[i - 1]!;
          const value = leafValue(engine, leafStatus, leafState, owner);
          path[i]!.visits += 1;
          path[i]!.totalValue += value;
        }
      };

      let rollouts = 0;
      if (budget.kind === "rollouts") {
        for (let i = 0; i < budget.n; i++) {
          runOnce();
          rollouts += 1;
        }
      } else {
        const deadline = start + budget.ms;
        do {
          runOnce();
          rollouts += 1;
        } while (clock.now() < deadline);
      }

      let bestEntry: { jointMove: JointMove<M>; child: Node<S, M> } | undefined;
      let bestVisits = -1;
      const rootVisits: { move: Json; visits: number }[] = [];
      for (const entry of root.children.values()) {
        const myMove = entry.jointMove.get(player);
        if (myMove !== undefined) {
          rootVisits.push({ move: myMove as unknown as Json, visits: entry.child.visits });
        }
        if (entry.child.visits > bestVisits) {
          bestVisits = entry.child.visits;
          bestEntry = entry;
        }
      }
      if (!bestEntry) {
        throw new Error("mctsPolicy: no legal moves were available to search from the given state");
      }
      const move = bestEntry.jointMove.get(player);
      if (move === undefined) {
        throw new Error(`mctsPolicy: player ${player} has no move component in the selected joint action`);
      }

      const stats: SearchStats = { elapsedMs: clock.now() - start, rollouts, rootVisits };
      if (root.visits > 0) stats.rootValue = root.totalValue / root.visits;
      return { move, stats };
    },
  };
}

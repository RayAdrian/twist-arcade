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
//   - simultaneous games: the TREE branches on the JOINT move space (the cartesian product of
//     each active player's legalMoves, expressed directly as the `ReadonlyMap<PlayerId, M>`
//     apply() already expects) rather than a decoupled per-player statistic — "start simple",
//     per the plan; decoupled UCT (separate UCB1 statistics kept and grown per player during
//     SELECTION) is explicitly still deferred. What changed (platform-corrections.md C56): FINAL
//     MOVE SELECTION at a simultaneous root no longer reads off "the single most-visited joint
//     cell" — that picks one lucky cell out of the cartesian product, not a judgment about your
//     own action. It now marginalizes — see `aggregateByOwnMove` below — summing visits (and
//     value) across every joint arm that shares your own move component, and choosing from
//     THAT. This is strictly a selection-time fix; the tree itself still grows on the joint
//     space exactly as before.
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

import type { GameEngine, Json, PlayerId, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "./policy";
import { rolloutToHorizon, valueOfStatus } from "./search-utils";

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

/** A joint arm collapsed down to a single actor's own move component — the unit
 *  `aggregateByOwnMove` groups by and sums. */
interface OwnMoveAggregate<M extends Json> {
  move: M;
  visits: number;
  totalValue: number;
}

/**
 * Marginalizes a simultaneous root's joint-move children down to ONE actor's own action
 * (platform-corrections.md C56): groups `entries` by `stableStringify(move)` and sums `visits`
 * / `totalValue` within each group, regardless of what any other simultaneous actor did on that
 * arm. Order is insertion order of first occurrence.
 *
 * Exported and kept as a pure function — independent of `Node`, `root.children`, rng, or any
 * real search — so it can be unit-tested against a synthetic joint-visit distribution
 * (mirrors search-utils.ts's pattern for `valueOfStatus`/`rankingValueOf`: the AGGREGATION
 * RULE is worth testing on its own, separate from whether a particular real search run happens
 * to produce a distribution that exercises it).
 *
 * For a SEQUENTIAL root this is a structural no-op: `jointMoveOptions` never produces two
 * children sharing the same own-move value there (each legal move of the single active player
 * gets exactly one child), so every group has exactly one member and the result is
 * order-and-value-identical to `entries`. `mctsPolicy`'s sequential branch does not call this
 * function anyway (see its own comment) — this fact is what justifies that it wouldn't need to.
 */
export function aggregateByOwnMove<M extends Json>(
  entries: readonly { move: M; visits: number; totalValue: number }[]
): OwnMoveAggregate<M>[] {
  const byKey = new Map<string, OwnMoveAggregate<M>>();
  for (const entry of entries) {
    const key = stableStringify(entry.move as unknown as Json);
    const existing = byKey.get(key);
    if (existing) {
      existing.visits += entry.visits;
      existing.totalValue += entry.totalValue;
    } else {
      byKey.set(key, { move: entry.move, visits: entry.visits, totalValue: entry.totalValue });
    }
  }
  return Array.from(byKey.values());
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
        const { status: leafStatus, state: leafState } = rolloutToHorizon(engine, node.state, rng, rolloutCapPlies);

        // --- BACKPROPAGATE ---
        for (let i = path.length - 1; i >= 0; i--) {
          const owner = i === 0 ? player : owners[i - 1]!;
          const value = valueOfStatus(engine, leafStatus, leafState, owner);
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

      // --- FINAL SELECTION (platform-corrections.md C56) ---
      const rootActive = engine.active(state);
      let move: M;
      let rootVisits: { move: Json; visits: number }[];

      if (rootActive.mode === "simultaneous") {
        // Marginalize: sum visits/value across every joint arm sharing `player`'s own move,
        // then choose the own-move with the most AGGREGATED visits — the decoupled analog of
        // "most robust child" (favor the action UCB spent the most cumulative attention
        // confirming, across however the other actor(s) responded), not "the single luckiest
        // joint cell" (the pre-fix defect: one cell out of the cartesian product, which a
        // handful of visits can put on top by chance — see mcts.test.ts's lucky-cell-rps case
        // and docs/plans/platform-corrections.md C56 for a real measured instance).
        const ownEntries = Array.from(root.children.values())
          .map((entry) => ({
            move: entry.jointMove.get(player),
            visits: entry.child.visits,
            totalValue: entry.child.totalValue,
          }))
          .filter((e): e is { move: M; visits: number; totalValue: number } => e.move !== undefined);
        const aggregates = aggregateByOwnMove(ownEntries);

        let best: OwnMoveAggregate<M> | undefined;
        let bestVisits = -1;
        for (const agg of aggregates) {
          if (agg.visits > bestVisits) {
            bestVisits = agg.visits;
            best = agg;
          }
        }
        if (!best) {
          throw new Error("mctsPolicy: no legal moves were available to search from the given state");
        }
        move = best.move;
        rootVisits = aggregates.map((agg) => ({ move: agg.move as unknown as Json, visits: agg.visits }));
      } else {
        // Sequential (or solo) root — UNCHANGED from before C56, deliberately not routed
        // through aggregateByOwnMove: every shipped sequential game's tiers (Fadeout, Nine
        // Grids, Tilt) depend on byte-identical output here, and this branch is the ORIGINAL
        // code, untouched, not merely "equivalent" code. (It would in fact behave identically
        // to the aggregation path, per aggregateByOwnMove's structural-no-op doc — but keeping
        // it as its own literal branch means that claim never has to be trusted, only the
        // literal unchanged code path does.)
        let bestEntry: { jointMove: JointMove<M>; child: Node<S, M> } | undefined;
        let bestVisits = -1;
        const seqRootVisits: { move: Json; visits: number }[] = [];
        for (const entry of root.children.values()) {
          const myMove = entry.jointMove.get(player);
          if (myMove !== undefined) {
            seqRootVisits.push({ move: myMove as unknown as Json, visits: entry.child.visits });
          }
          if (entry.child.visits > bestVisits) {
            bestVisits = entry.child.visits;
            bestEntry = entry;
          }
        }
        if (!bestEntry) {
          throw new Error("mctsPolicy: no legal moves were available to search from the given state");
        }
        const seqMove = bestEntry.jointMove.get(player);
        if (seqMove === undefined) {
          throw new Error(`mctsPolicy: player ${player} has no move component in the selected joint action`);
        }
        move = seqMove;
        rootVisits = seqRootVisits;
      }

      const stats: SearchStats = { elapsedMs: clock.now() - start, rollouts, rootVisits };
      if (root.visits > 0) stats.rootValue = root.totalValue / root.visits;
      return { move, stats };
    },
  };
}

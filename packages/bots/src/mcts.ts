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
//     apply() already expects — this part is UNCHANGED: transitions genuinely depend on the
//     joint outcome, so the tree still stores/returns joint children). SELECTION at a
//     simultaneous node, however, is DECOUPLED UCT / DUCT (docs/plans/sim-search-remedy.md,
//     C57/C58/C71): each active player independently runs UCB1 over a per-seat statistics
//     table of THEIR OWN move component (visits, totalValue from THAT SEAT'S OWN perspective —
//     `Node.seatMoveStats`, populated only at simultaneous nodes), and the joint move actually
//     descended into is the composition of each seat's own pick, looked up in the existing
//     joint-children Map. This replaces the OLD "single fixed edge owner (the requester) for
//     the whole node" convention at simultaneous nodes (see `edgeOwnerAt`'s doc below, and
//     platform-corrections.md C71 Part 2 for the measured defect this replaces: root value
//     drifting toward +1 on a position an exact solver proves is a draw, because the opponent
//     was modeled as a co-operator rather than an adversary). What changed at C56 (FINAL move
//     selection at a simultaneous ROOT no longer reading off "the single most-visited joint
//     cell") is now SUBSUMED, not layered on top: final selection at a simultaneous root reads
//     the requester's own `seatMoveStats` table directly — already exactly the marginal
//     `aggregateByOwnMove` computed, by construction, since every joint arm sharing an own-move
//     component contributes to that move's single table entry. `aggregateByOwnMove` itself is
//     kept (exported, still unit-tested) but is no longer called on this live path.
//
//     HONEST SCOPE (replacing the falsified "fine at our branching factors" claim this file
//     carried through C55–C58): DUCT is EXACT-TARGET at a PURE-SADDLE simultaneous node —
//     decoupled per-seat best-response dynamics have their fixed point exactly at a pure
//     saddle point, by definition (mcts.test.ts's matrix-saddle fixture verifies this by hand
//     at a scale a human can check without trusting a solver). At a MIXED-equilibrium node,
//     DUCT has NO mechanism to converge to a mixed distribution — it always reports one
//     deterministic "best" pure move per search call, and per-seat visit tables can cycle
//     rather than settle (mcts.test.ts documents this on best-of-5 RPS without asserting
//     equilibrium convergence, which DUCT does not promise). This claim NAMES ITS OWN CHECK
//     (C31/C64: the doc must not outrun the code) — see docs/plans/sim-search-remedy.md §1's
//     refutation conditions for what would make this the wrong call for a given game: check
//     that game's own saddle census (a per-game measured fact, not a platform theorem) before
//     assuming DUCT alone is sufficient.
//   - hidden-info games: NOT handled here at all — see determinize() in policy.ts. This file
//     only ever operates on a real `S` (perfect information, or a determinized sample of one).
//
// VALUE CONVENTION (worth stating precisely, since it is the one subtle design decision this
// file makes): every node's `totalValue` is accumulated with respect to a single FIXED
// "edge owner" — the player who is deemed to have "chosen" the edge leading to that node.
// For a sequential node, the edge owner of node N's CHILDREN is N's own active player (N is
// where that player chose their move) — so children of the same parent are always compared
// apples-to-apples during UCB selection, and this value directly drives sequential SELECTION
// (unchanged by DUCT — see above). The root's own edge owner is the requesting `player` by
// definition (root has no parent) — this is ALSO unchanged by DUCT: `stats.rootValue` is still
// `root.totalValue / root.visits`, the requester's own running average across every rollout
// that passed through the root, regardless of node mode. For a simultaneous node there is no
// single natural "chooser" (multiple players commit at once); the requesting `player` is
// still used as this node-level `totalValue`'s edge owner — but, since DUCT, this quantity is
// ONLY a reporting/backprop-bookkeeping value at simultaneous nodes, never a selection input:
// simultaneous SELECTION reads `Node.seatMoveStats` instead (see above), a separate per-seat
// table that DOES give each active player their own value convention. `stats.rootValue`
// improving post-fix (platform-corrections.md C71 Part 2's own prediction) falls entirely out
// of DUCT reallocating WHERE the tree spends its rollouts, not out of any change to how this
// particular accumulator itself is computed. This generalizes both sequential alternating (2P
// zero-sum or general-sum) and solo trees without special-casing, and reduces exactly to
// standard single-player MCTS when there is only one seat.

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

/** DUCT (plan §1): one active seat's own-move statistic at a simultaneous node — visits and
 *  totalValue accumulated from THAT SEAT'S OWN `valueOfStatus` perspective, summed across
 *  every joint arm sharing this own-move component (the decoupled analog of a UCB1 child). */
interface SeatMoveStat<M extends Json> {
  move: M;
  visits: number;
  totalValue: number;
}

interface Node<S extends WithEffects, M extends Json> {
  state: S;
  status: Status;
  visits: number;
  totalValue: number; // w.r.t. this node's OWN edge owner (see module doc)
  untried: JointMove<M>[];
  children: Map<string, { jointMove: JointMove<M>; child: Node<S, M> }>;
  // DUCT: per-active-seat own-move statistics, populated and read ONLY at simultaneous nodes
  // (module doc). Absent for sequential/solo nodes — the sequential path never touches this.
  seatMoveStats?: Map<PlayerId, Map<string, SeatMoveStat<M>>>;
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

/**
 * DUCT selection (plan §1) at a simultaneous node whose joint move space has already been
 * fully expanded (the caller guarantees `node.untried` is empty before calling this — every
 * joint arm has therefore been drawn+backpropagated at least once, so every active seat's own
 * legal move already has a `seatMoveStats` entry with `visits >= 1`; see this function's use
 * site for why that invariant holds). Each active player independently picks the own move
 * maximizing UCB1 over `node.seatMoveStats` (same formula, same `visits === 0` fallback shape,
 * as the sequential branch's UCB1 — just evaluated once per active seat over that seat's own
 * table instead of once over joint children). The joint move is their composition, looked up
 * in the EXISTING joint-children Map — this function never creates a node and never draws from
 * `rng`; it is a pure, deterministic function of already-recorded statistics, so it introduces
 * no new source of randomness at all (stricter than the plan's "any new rng draw must occur
 * only inside a simultaneous-mode branch" requirement).
 */
function selectDuctChild<S extends WithEffects, M extends Json>(
  node: Node<S, M>,
  activePlayers: readonly PlayerId[],
  explorationC: number
): { jointMove: JointMove<M>; child: Node<S, M> } {
  const chosen = new Map<PlayerId, M>();
  for (const p of activePlayers) {
    const table = node.seatMoveStats?.get(p);
    if (!table || table.size === 0) {
      throw new Error(
        "mctsPolicy: DUCT selection reached a simultaneous node with no recorded own-move " +
          `statistics for player ${p} — unreachable once every joint arm has been expanded.`
      );
    }
    let bestMove: M | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const stat of table.values()) {
      const score =
        stat.visits === 0
          ? Number.POSITIVE_INFINITY
          : stat.totalValue / stat.visits + explorationC * Math.sqrt(Math.log(node.visits) / stat.visits);
      if (score > bestScore) {
        bestScore = score;
        bestMove = stat.move;
      }
    }
    chosen.set(p, bestMove!);
  }
  const key = jointMoveKey(chosen);
  const entry = node.children.get(key);
  if (!entry) {
    throw new Error(
      "mctsPolicy: DUCT selection composed a joint move with no matching child — every joint " +
        "arm should already be expanded once `untried` is empty."
    );
  }
  return entry;
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
        // DUCT bookkeeping: the actual joint move taken FROM path[i] TO path[i+1], recorded
        // for every step regardless of how it was chosen (untried-draw, sequential UCB1, or
        // DUCT selection) — the per-seat backprop pass below reads this, but only ever USES an
        // entry for a step whose `path[i]` was itself a simultaneous node (module doc).
        const jointMoves: JointMove<M>[] = [];
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
            jointMoves.push(jm);
            node = child;
            expanded = true;
            break;
          }
          if (node.children.size === 0) break; // no legal moves at all (shouldn't happen if ongoing)
          const active = engine.active(node.state);
          let selected: { jointMove: JointMove<M>; child: Node<S, M> };
          if (active.mode === "sequential") {
            // UNCHANGED from before DUCT — byte-identical UCB1 over joint (here: singleton)
            // children, same formula, same child-Map iteration order, same tie-break (plan §2's
            // byte-identity requirement for every shipped sequential game).
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
            selected = best!;
          } else {
            // DUCT (plan §1) — gated strictly on simultaneous mode, per the module doc.
            selected = selectDuctChild(node, active.players, explorationC);
          }
          path.push(selected.child);
          owners.push(owner);
          jointMoves.push(selected.jointMove);
          node = selected.child;
        }

        // --- ROLLOUT (simulate randomly from the new leaf to a terminal/horizon) ---
        const { status: leafStatus, state: leafState } = rolloutToHorizon(engine, node.state, rng, rolloutCapPlies);

        // --- BACKPROPAGATE ---
        // UNCHANGED: still the single fixed-edge-owner accumulation (module doc's VALUE
        // CONVENTION) — drives sequential UCB1 selection and `stats.rootValue` reporting,
        // for every node regardless of mode.
        for (let i = path.length - 1; i >= 0; i--) {
          const owner = i === 0 ? player : owners[i - 1]!;
          const value = valueOfStatus(engine, leafStatus, leafState, owner);
          path[i]!.visits += 1;
          path[i]!.totalValue += value;
        }
        // DUCT per-seat backprop (plan §1, ADDITIVE — touches only the new `seatMoveStats`
        // field): at every SIMULTANEOUS node on the path, credit each active seat's OWN
        // move component of the joint move actually taken from it with THAT SEAT'S OWN
        // `valueOfStatus`. Gated on `active.mode === "simultaneous"` — sequential nodes are
        // never touched by this loop, matching the plan's "any new rng draw/behavior only
        // inside a simultaneous-mode branch" requirement (this loop draws no rng at all).
        for (let i = 0; i < path.length - 1; i++) {
          const from = path[i]!;
          const activeAtFrom = engine.active(from.state);
          if (activeAtFrom.mode !== "simultaneous") continue;
          const jm = jointMoves[i]!;
          if (!from.seatMoveStats) from.seatMoveStats = new Map();
          for (const p of activeAtFrom.players) {
            const ownMove = jm.get(p);
            if (ownMove === undefined) continue; // engine contract: every active seat has a component
            let table = from.seatMoveStats.get(p);
            if (!table) {
              table = new Map();
              from.seatMoveStats.set(p, table);
            }
            const seatKey = stableStringify(ownMove as unknown as Json);
            const seatValue = valueOfStatus(engine, leafStatus, leafState, p);
            const existing = table.get(seatKey);
            if (existing) {
              existing.visits += 1;
              existing.totalValue += seatValue;
            } else {
              table.set(seatKey, { move: ownMove, visits: 1, totalValue: seatValue });
            }
          }
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

      // --- FINAL SELECTION (platform-corrections.md C56, subsumed by DUCT per C57/C58) ---
      const rootActive = engine.active(state);
      let move: M;
      let rootVisits: { move: Json; visits: number }[];

      if (rootActive.mode === "simultaneous") {
        // DUCT (plan §1): the requester's own `seatMoveStats` table at the root ALREADY IS the
        // marginal — every joint arm sharing an own-move component contributes to that move's
        // single table entry as it is visited (backprop above), so reading it directly
        // subsumes C56's `aggregateByOwnMove`-over-`root.children` by construction, without
        // needing to re-derive the aggregation here. Choose the own-move with the most visits
        // — same "most robust child" reasoning C56 established (favor the action UCB spent the
        // most cumulative attention confirming, across however the other actor(s) responded),
        // now grounded in each seat's own value rather than the root requester's alone.
        // `aggregateByOwnMove` itself is kept (exported, still unit-tested below) but is no
        // longer on this live path — plan §6.3's explicit "smaller diff, flag deletion as a
        // follow-up decision".
        const ownTable = root.seatMoveStats?.get(player);
        if (!ownTable || ownTable.size === 0) {
          throw new Error("mctsPolicy: no legal moves were available to search from the given state");
        }
        let best: SeatMoveStat<M> | undefined;
        let bestVisits = -1;
        for (const stat of ownTable.values()) {
          if (stat.visits > bestVisits) {
            bestVisits = stat.visits;
            best = stat;
          }
        }
        move = best!.move;
        rootVisits = Array.from(ownTable.values()).map((stat) => ({
          move: stat.move as unknown as Json,
          visits: stat.visits,
        }));
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

// packages/bots/test/support/mcts-legacy.ts — TEST-ONLY, EXPERIMENT-ONLY. NOT a package
// deliverable. NOT reachable from `@twist-arcade/bots`'s public surface: `packages/bots/
// package.json`'s `exports` map only opens `.`, `./worker/protocol`, `./worker/host` — none of
// them resolve to this file, and `src/index.ts` (the `.` barrel) does not import it either. It
// lives under `test/` specifically so nothing under `src/**` (what actually ships) can reach it
// even by accident.
//
// WHAT THIS IS: a byte-for-byte copy of `packages/bots/src/mcts.ts` as it stood at `dabc6a2`
// (docs/plans/platform-corrections.md's own C57/C58 pre-fix baseline commit) — the algorithm
// BEFORE the DUCT remedy (docs/plans/sim-search-remedy.md) replaced max-max joint-child
// selection at simultaneous nodes with decoupled per-seat UCB1. Obtained via
// `git show dabc6a2:packages/bots/src/mcts.ts`, not reconstructed from memory or from reading
// the current `mcts.ts` and "undoing" the diff by hand — the whole point of this file is to be
// a faithful legacy oracle, and a hand-reconstruction cannot self-certify that.
//
// WHY IT EXISTS: platform-corrections.md C75 — DUCT's record is mixed (H1 killed, Bid-Tac-Toe's
// strong-vs-random decline reversed; but it picks optimal moves LESS often than max-max on the
// exact bid-auction oracle, and it introduced a budget decline on Duel Draft, the previously
// healthy control). Every prior comparison measured DUCT and max-max SEPARATELY against random
// or an oracle. This file exists so a script can run the two searches AGAINST EACH OTHER,
// head-to-head, in the same process — the discriminating experiment sim-search-remedy.md never
// ran.
//
// THE ONLY EDITS FROM THE `dabc6a2` SOURCE ARE RENAMES, NO LOGIC CHANGES:
//   mctsPolicy            -> mctsPolicyLegacy
//   MctsOptions            -> MctsOptionsLegacy
//   MctsTerminalStateError -> MctsTerminalStateErrorLegacy
//   aggregateByOwnMove     -> aggregateByOwnMoveLegacy
// renamed only so this file can be imported into the same process as the current `mcts.ts`
// (which exports the same four names) without a collision — every private helper, every
// branch, every formula, every comment describing THAT commit's design is left as it was typed
// at `dabc6a2`. In particular this file does NOT have `seatMoveStats`/DUCT selection at all —
// simultaneous-node selection here is the OLD single-fixed-edge-owner UCB1 over JOINT children
// (the max-max defect C57/C58/C71 diagnosed), and FINAL selection at a simultaneous root goes
// through `aggregateByOwnMoveLegacy` over `root.children` (the C56 marginalization, still
// present at `dabc6a2` — C56 landed before C57/C58 did).
//
// FAITHFULNESS IS VERIFIED, NOT ASSERTED: `.scratch/c57-byte-identity-dump.mts` run with its
// `legacy` mode argument reproduces `docs/research/games/c57-byte-identity-pre-fix-{fadeout,
// nine-grids,tilt}.json` byte-for-byte (those three JSON files were captured from the REAL
// `dabc6a2` checkout, before `mcts.ts` was ever edited for C57/C58 — see that plan's §6 step 1).
// If this file ever diverges from that check, it is not the old algorithm and nothing measured
// against it is trustworthy — see the dump script's own comment for how to re-run the check.
//
// NEVER import this from anything under `src/**`, from any shipped game, or from the package
// barrel. It exists to be imported by throwaway `.scratch/` and `games/*/_*.mts` diagnostic
// scripts and by this package's own `test/**` suite only.

import type { GameEngine, Json, PlayerId, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "../../src/policy";
import { rolloutToHorizon, valueOfStatus } from "../../src/search-utils";

export class MctsTerminalStateErrorLegacy extends Error {
  constructor() {
    super("mctsPolicyLegacy: chooseMove called on a terminal state — there is nothing to search for.");
    this.name = "MctsTerminalStateErrorLegacy";
  }
}

export interface MctsOptionsLegacy {
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
 *  `aggregateByOwnMoveLegacy` groups by and sums. */
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
 * order-and-value-identical to `entries`. `mctsPolicyLegacy`'s sequential branch does not call this
 * function anyway (see its own comment) — this fact is what justifies that it wouldn't need to.
 */
export function aggregateByOwnMoveLegacy<M extends Json>(
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

export function mctsPolicyLegacy<S extends WithEffects, M extends Json>(opts: MctsOptionsLegacy = {}): Policy<S, M> {
  const explorationC = opts.explorationC ?? 1.4;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      const rootStatus = engine.status(state);
      if (rootStatus.kind !== "ongoing") {
        throw new MctsTerminalStateErrorLegacy();
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
        const aggregates = aggregateByOwnMoveLegacy(ownEntries);

        let best: OwnMoveAggregate<M> | undefined;
        let bestVisits = -1;
        for (const agg of aggregates) {
          if (agg.visits > bestVisits) {
            bestVisits = agg.visits;
            best = agg;
          }
        }
        if (!best) {
          throw new Error("mctsPolicyLegacy: no legal moves were available to search from the given state");
        }
        move = best.move;
        rootVisits = aggregates.map((agg) => ({ move: agg.move as unknown as Json, visits: agg.visits }));
      } else {
        // Sequential (or solo) root — UNCHANGED from before C56, deliberately not routed
        // through aggregateByOwnMoveLegacy: every shipped sequential game's tiers (Fadeout, Nine
        // Grids, Tilt) depend on byte-identical output here, and this branch is the ORIGINAL
        // code, untouched, not merely "equivalent" code. (It would in fact behave identically
        // to the aggregation path, per aggregateByOwnMoveLegacy's structural-no-op doc — but keeping
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
          throw new Error("mctsPolicyLegacy: no legal moves were available to search from the given state");
        }
        const seqMove = bestEntry.jointMove.get(player);
        if (seqMove === undefined) {
          throw new Error(`mctsPolicyLegacy: player ${player} has no move component in the selected joint action`);
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

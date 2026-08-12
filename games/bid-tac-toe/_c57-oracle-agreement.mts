// games/bid-tac-toe/_c57-oracle-agreement.mts — E-A, docs/plans/sim-search-residue.md §2.
// Throwaway diagnostic script (the C36 discipline / _c36-diagnostic.mts's own precedent — NOT
// a package deliverable). Builds the real initial state directly and calls `mctsPolicy`
// directly with `rngFromSeed`/a null clock, following `_c36-diagnostic.mts`'s pattern.
//
// WHAT THIS MEASURES, PER RUN, AT THE REAL INITIAL STATE (B=8, star=1):
//   - the chosen (amount, star)
//   - rootValue, in the requesting seat's OWN perspective (mcts.ts's module doc: the root's
//     edge owner is always the requesting `player`) — run once per seat, so "both seats'
//     rootValue" falls out of the {seat 0, seat 1} loop naturally
//   - the full own-move marginal table `mctsPolicy` actually returns (star-SEPARATE — this
//     IS what `aggregateByOwnMove`'s `stableStringify` grouping produces today, module doc of
//     mcts.ts / H3), PLUS an amount-COMBINED regrouping computed at ~zero marginal cost
//     (H3's "checked as one extra column" ask), and whether the argmax differs between them
//   - the root joint-visit heat-map: visits by (own bid, opponent bid), so "marginal visit
//     mass over opponent-bid columns conditional on own bid" can be read directly off it
//
// THE JOINT HEAT-MAP PROBLEM: `mctsPolicy`'s public `SearchStats.rootVisits` is already
// marginalized over the OPPONENT's move component before it is ever returned — mcts.ts's
// simultaneous-root branch keeps only `entry.jointMove.get(player)` (the caller's OWN move)
// when building the entries it hands to `aggregateByOwnMove`, so the opponent's move is
// discarded before aggregation, not merely summed visibly. There is no public seam that
// returns the raw per-JOINT-arm visit counts a heat-map needs (confirmed: neither
// mcts.test.ts nor `_c36-diagnostic.mts` ever reads anything beyond `stats.rootVisits`
// either). Rules for E-A explicitly forbid touching `packages/bots/src/mcts.ts` at all
// ("no fix before E-A" — the plan's §4 ruling), so no new field can be added there either,
// however additive.
//
// THE FIX: `runInstrumentedMcts` below is a byte-for-byte structural mirror of mcts.ts's
// SELECT+EXPAND+ROLLOUT+BACKPROP loop and final-selection logic (same UCB1 formula, same
// exploration constant, same edge-owner convention, same rollout — `uniformRandomMoveSelector`
// equivalent, same cap), reimplemented locally ONLY to keep each joint child node's own
// (own-move, opponent-move) pair before summing it away. `packages/bots/src/mcts.ts` itself is
// never imported, called, or modified for this purpose — its only role in this script is as
// the ORACLE this clone is checked against. `aggregateByOwnMove` (the actual C56-fix logic
// under investigation) is NOT re-exported from `@twist-arcade/bots`'s package barrel
// (`packages/bots/package.json`'s `exports` field only opens `.`, `./worker/protocol`,
// `./worker/host` — a deep import of `mcts.ts` would not even resolve), so it is mirrored
// locally too (`aggregateByOwnMoveLocal`), verbatim from mcts.ts's own source.
//
// SELF-VALIDATION, EVERY SINGLE RUN, NOT JUST IN A TEST SUITE: since `rngFromSeed(seed)` is a
// pure function of the seed string (packages/engine/src/rng.ts), calling it twice with the
// SAME seed string hands two independently-constructed `Rng` streams that draw an IDENTICAL
// sequence. Every run below calls the REAL `mctsPolicy` and this clone with two freshly
// re-seeded (never reused/continued) `Rng`s built from the identical seed string, then asserts
// the real policy's chosen move, `rootValue`, and full `rootVisits` are IDENTICAL to the
// clone's own derivation of the same three things. A silent structural drift between this
// clone and the real algorithm would corrupt E-A's evidence at the source — `assertCloneAgrees`
// throws immediately, aborting the whole run, rather than ever reporting an unvalidated number.
//
// SEEDING RULE (C22/C24, non-negotiable — `_b3-sweep.mts`'s own precedent, "ONE fixed seed
// across every candidate so every budget played identical games"): the seed string is built
// from the seat and the seed INDEX only. The budget never enters it — a per-budget seed would
// confound the very curve E-A measures.

import type { Json, PlayerId, Rng, Status } from "@twist-arcade/engine";
import { rngFromSeed, stableStringify } from "@twist-arcade/engine";
import { mctsPolicy } from "@twist-arcade/bots";
import { bidTacToe, STARTING_BUDGET, type BidTacToeMove, type BidTacToeState, type Seat } from "./engine";
import { bidMoveKey, createExactOracle } from "./solver/backward-induction";

const NULL_CLOCK = { now: (() => { let t = 0; return () => (t += 1); })() };

// Pinned to mcts.ts's own defaults (packages/bots/src/mcts.ts's MctsOptions defaults) — NEVER
// tuned here (plan §4: "No tuning of explorationC, any budget, or any gate threshold").
const EXPLORATION_C = 1.4;
const ROLLOUT_CAP_PLIES = 200;

function rootState(): BidTacToeState {
  return {
    board: Array.from({ length: 9 }, () => null),
    budgets: [STARTING_BUDGET, STARTING_BUDGET],
    star: 1, // real setup(): seat 1 holds the star.
    phase: { kind: "bid" },
    lastEffects: [],
  };
}

// ---------------------------------------------------------------------------------------
// Byte-for-byte mirror of mcts.ts's private tree-growth algorithm, monomorphic to
// BidTacToeState/BidTacToeMove (no generics needed — this game is the only caller). See the
// module doc above for why this exists and how it is kept honest.
// ---------------------------------------------------------------------------------------

type JointMove = ReadonlyMap<PlayerId, BidTacToeMove>;

function jointMoveKeyLocal(jm: JointMove): string {
  const sorted = Array.from(jm.entries()).sort((a, b) => a[0] - b[0]);
  return stableStringify(sorted as unknown as Json);
}

function jointMoveOptionsLocal(state: BidTacToeState): JointMove[] {
  const active = bidTacToe.active(state);
  if (active.mode === "sequential") {
    return bidTacToe.legalMoves(state, active.player).map((m) => new Map([[active.player, m]]) as JointMove);
  }
  let combos: JointMove[] = [new Map()];
  for (const p of active.players) {
    const moves = bidTacToe.legalMoves(state, p);
    const next: JointMove[] = [];
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

interface CloneNode {
  state: BidTacToeState;
  status: Status;
  visits: number;
  totalValue: number;
  untried: JointMove[];
  children: Map<string, { jointMove: JointMove; child: CloneNode }>;
}

function makeCloneNode(state: BidTacToeState): CloneNode {
  const status = bidTacToe.status(state);
  return {
    state,
    status,
    visits: 0,
    totalValue: 0,
    untried: status.kind === "ongoing" ? jointMoveOptionsLocal(state) : [],
    children: new Map(),
  };
}

function edgeOwnerAtLocal(state: BidTacToeState, rootPlayer: PlayerId): PlayerId {
  const active = bidTacToe.active(state);
  return active.mode === "sequential" ? active.player : rootPlayer;
}

/** Mirrors search-utils.ts's `valueOfStatus` for exactly the cases bid-tac-toe ever produces
 *  (won/draw — never lost/scored, and V3's own finding is that every rollout reaches a real
 *  terminal well under the 200-ply cap, so the "ongoing"/horizon-estimate branch is never
 *  exercised in this regime). Throws rather than guessing if that assumption is ever violated —
 *  see the module doc: an unvalidated code path here must not silently produce a number. */
function valueOfStatusLocal(status: Status, player: PlayerId): number {
  switch (status.kind) {
    case "won":
      return status.winner === player ? 1 : -1;
    case "draw":
      return 0;
    default:
      throw new Error(
        `valueOfStatusLocal: unexpected status.kind="${status.kind}" — bid-tac-toe is assumed ` +
          "(V3) to always reach a real won/draw terminal well under the rollout cap; this " +
          "clone's handling of any other case is unvalidated against the real search-utils.ts " +
          "and must not be trusted."
      );
  }
}

function rolloutToHorizonLocal(
  start: BidTacToeState,
  rng: Rng,
  maxPlies: number
): { status: Status; state: BidTacToeState } {
  let state = start;
  let status = bidTacToe.status(state);
  let plies = 0;
  while (status.kind === "ongoing" && plies < maxPlies) {
    const active = bidTacToe.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const jm = new Map<PlayerId, BidTacToeMove>();
    for (const p of actors) {
      const legal = bidTacToe.legalMoves(state, p);
      jm.set(p, legal[rng.int(legal.length)]!);
    }
    state = bidTacToe.apply(state, jm, rng) as BidTacToeState;
    status = bidTacToe.status(state);
    plies += 1;
  }
  return { status, state };
}

interface OwnMoveAggregateLocal {
  move: BidTacToeMove;
  visits: number;
  totalValue: number;
}

/** Verbatim mirror of mcts.ts's exported `aggregateByOwnMove` — NOT re-exported from
 *  `@twist-arcade/bots`'s package barrel (see module doc), so it is reproduced here rather than
 *  deep-imported across the package boundary. */
function aggregateByOwnMoveLocal(
  entries: readonly { move: BidTacToeMove; visits: number; totalValue: number }[]
): OwnMoveAggregateLocal[] {
  const byKey = new Map<string, OwnMoveAggregateLocal>();
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

interface InstrumentedResult {
  move: BidTacToeMove;
  rootValue: number;
  rootVisits: { move: Json; visits: number }[]; // star-SEPARATE, native aggregateByOwnMove output
  jointRootVisits: { own: BidTacToeMove; opp: BidTacToeMove; visits: number }[];
}

function runInstrumentedMcts(state: BidTacToeState, player: PlayerId, rollouts: number, rng: Rng): InstrumentedResult {
  const rootStatus = bidTacToe.status(state);
  if (rootStatus.kind !== "ongoing") throw new Error("runInstrumentedMcts: chooseMove called on a terminal state");
  const root = makeCloneNode(state);

  const runOnce = (): void => {
    const path: CloneNode[] = [root];
    const owners: PlayerId[] = [];
    let node = root;
    let expanded = false;
    while (!expanded) {
      if (node.status.kind !== "ongoing") break;
      const owner = edgeOwnerAtLocal(node.state, player);
      if (node.untried.length > 0) {
        const idx = rng.int(node.untried.length);
        const jm = node.untried[idx]!;
        node.untried = node.untried.slice(0, idx).concat(node.untried.slice(idx + 1));
        const childState = bidTacToe.apply(node.state, jm, rng) as BidTacToeState;
        const child = makeCloneNode(childState);
        node.children.set(jointMoveKeyLocal(jm), { jointMove: jm, child });
        path.push(child);
        owners.push(owner);
        node = child;
        expanded = true;
        break;
      }
      if (node.children.size === 0) break;
      let best: { jointMove: JointMove; child: CloneNode } | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const entry of node.children.values()) {
        const score =
          entry.child.visits === 0
            ? Number.POSITIVE_INFINITY
            : entry.child.totalValue / entry.child.visits +
              EXPLORATION_C * Math.sqrt(Math.log(node.visits) / entry.child.visits);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
      path.push(best!.child);
      owners.push(owner);
      node = best!.child;
    }

    const { status: leafStatus } = rolloutToHorizonLocal(node.state, rng, ROLLOUT_CAP_PLIES);

    for (let i = path.length - 1; i >= 0; i--) {
      const owner = i === 0 ? player : owners[i - 1]!;
      const value = valueOfStatusLocal(leafStatus, owner);
      path[i]!.visits += 1;
      path[i]!.totalValue += value;
    }
  };

  for (let i = 0; i < rollouts; i++) runOnce();

  const rootActive = bidTacToe.active(state);
  if (rootActive.mode !== "simultaneous") {
    throw new Error("runInstrumentedMcts: E-A only ever targets the real (simultaneous, bid-phase) initial state");
  }
  const otherSeat: PlayerId = player === 0 ? 1 : 0;

  const jointRootVisits = Array.from(root.children.values()).map((entry) => ({
    own: entry.jointMove.get(player)!,
    opp: entry.jointMove.get(otherSeat)!,
    visits: entry.child.visits,
  }));

  const ownEntries = Array.from(root.children.values()).map((entry) => ({
    move: entry.jointMove.get(player)!,
    visits: entry.child.visits,
    totalValue: entry.child.totalValue,
  }));
  const aggregates = aggregateByOwnMoveLocal(ownEntries);
  let bestAgg = aggregates[0];
  for (const agg of aggregates) if (bestAgg === undefined || agg.visits > bestAgg.visits) bestAgg = agg;
  if (!bestAgg) throw new Error("runInstrumentedMcts: no legal moves were available to search from the given state");

  return {
    move: bestAgg.move,
    rootValue: root.visits > 0 ? root.totalValue / root.visits : 0,
    rootVisits: aggregates.map((agg) => ({ move: agg.move as unknown as Json, visits: agg.visits })),
    jointRootVisits,
  };
}

// ---------------------------------------------------------------------------------------
// Self-validation against the REAL, unmodified mctsPolicy — see module doc.
// ---------------------------------------------------------------------------------------

function sortedVisits(rv: readonly { move: Json; visits: number }[]): string {
  return rv
    .map((r) => `${stableStringify(r.move)}:${r.visits}`)
    .sort()
    .join(",");
}

function assertCloneAgrees(
  seedLabel: string,
  player: PlayerId,
  rollouts: number,
  clone: InstrumentedResult
): void {
  const real = mctsPolicy().chooseMove({
    engine: bidTacToe,
    state: rootState(),
    player,
    rng: rngFromSeed(seedLabel), // freshly re-seeded, NOT the same Rng instance the clone consumed
    budget: { kind: "rollouts", n: rollouts },
    clock: NULL_CLOCK,
  });

  const realMoveKey = bidMoveKey(real.move as unknown as { amount: number; star?: boolean });
  const cloneMoveKey = bidMoveKey(clone.move as unknown as { amount: number; star?: boolean });
  if (realMoveKey !== cloneMoveKey) {
    throw new Error(
      `assertCloneAgrees: chosen move DIVERGED — real mctsPolicy chose ${realMoveKey}, clone ` +
        `chose ${cloneMoveKey} (seed=${seedLabel}, player=${player}, rollouts=${rollouts}). ` +
        "The instrumented clone has drifted from mcts.ts — its joint-visit numbers cannot be trusted."
    );
  }
  const realRootValue = real.stats.rootValue ?? 0;
  if (Math.abs(realRootValue - clone.rootValue) > 1e-9) {
    throw new Error(
      `assertCloneAgrees: rootValue DIVERGED — real=${realRootValue}, clone=${clone.rootValue} ` +
        `(seed=${seedLabel}, player=${player}, rollouts=${rollouts}).`
    );
  }
  const realVisitsKey = sortedVisits(real.stats.rootVisits ?? []);
  const cloneVisitsKey = sortedVisits(clone.rootVisits);
  if (realVisitsKey !== cloneVisitsKey) {
    throw new Error(
      `assertCloneAgrees: rootVisits DIVERGED (seed=${seedLabel}, player=${player}, rollouts=${rollouts}).\n` +
        `  real:  ${realVisitsKey}\n  clone: ${cloneVisitsKey}`
    );
  }
}

// ---------------------------------------------------------------------------------------
// H3 column: star-separate (native) vs amount-combined regrouping of the SAME rootVisits,
// at ~zero marginal cost — plan §2's "checked as one extra column in E-A".
// ---------------------------------------------------------------------------------------

function amountCombined(rootVisits: readonly { move: Json; visits: number }[]): Map<number, number> {
  const byAmount = new Map<number, number>();
  for (const { move, visits } of rootVisits) {
    const m = move as unknown as BidTacToeMove & { amount: number };
    byAmount.set(m.amount, (byAmount.get(m.amount) ?? 0) + visits);
  }
  return byAmount;
}

function argmaxStarSeparate(rootVisits: readonly { move: Json; visits: number }[]): string {
  let best = rootVisits[0]!;
  for (const r of rootVisits) if (r.visits > best.visits) best = r;
  return bidMoveKey(best.move as unknown as { amount: number; star?: boolean });
}

function argmaxAmountCombined(byAmount: Map<number, number>): number {
  let bestAmount = -1;
  let bestVisits = -1;
  for (const [amount, visits] of byAmount) {
    if (visits > bestVisits) {
      bestVisits = visits;
      bestAmount = amount;
    }
  }
  return bestAmount;
}

// ---------------------------------------------------------------------------------------
// CLI parsing — budgets, seed count, and seats are all parameters (this smoke run uses
// small values now; the full sweep later reuses this same script unedited).
// ---------------------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): { budgets: number[]; seedCount: number; seats: Seat[] } {
  let budgets = [1000, 2000, 5000, 10000, 20000]; // plan §2's full sweep
  let seedCount = 20; // plan §2's full sweep
  let seats: Seat[] = [0, 1];
  for (const arg of argv) {
    const budgetsMatch = /^--budgets=(.+)$/.exec(arg);
    if (budgetsMatch) budgets = budgetsMatch[1]!.split(",").map((s) => Number(s.trim()));
    const seedsMatch = /^--seeds=(\d+)$/.exec(arg);
    if (seedsMatch) seedCount = Number(seedsMatch[1]);
    const seatsMatch = /^--seats=(.+)$/.exec(arg);
    if (seatsMatch) seats = seatsMatch[1]!.split(",").map((s) => Number(s.trim()) as Seat);
  }
  return { budgets, seedCount, seats };
}

// ---------------------------------------------------------------------------------------
// Main sweep.
// ---------------------------------------------------------------------------------------

function main(): void {
  const { budgets, seedCount, seats } = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `E-A: budgets=[${budgets.join(",")}] seeds=${seedCount} seats=[${seats.join(",")}] ` +
      `at the real initial state (B=${STARTING_BUDGET}, star=1)\n`
  );

  process.stderr.write("solving the exact oracle (B=8, one-time cost)...\n");
  const oracleStart = Date.now();
  const oracle = createExactOracle(STARTING_BUDGET);
  const root = rootState();
  const exactRootValue = oracle.exactValue(root);
  process.stderr.write(
    `  done in ${Date.now() - oracleStart}ms — exact root value (seat-0 perspective) = ${exactRootValue}\n`
  );
  const optimalBids0 = oracle.optimalBids(root, 0);
  const optimalBids1 = oracle.optimalBids(root, 1);
  process.stderr.write(`  seat 0 optimal bids: {${Array.from(optimalBids0).join(", ")}}\n`);
  process.stderr.write(`  seat 1 optimal bids: {${Array.from(optimalBids1).join(", ")}}\n\n`);

  for (const budget of budgets) {
    for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
      console.log(`==== budget=${budget} seedIndex=${seedIndex} ====`);
      for (const seat of seats) {
        // C22/C24: the seed varies by seat and seed index, NEVER by budget.
        const seedLabel = `c57-ea-seat${seat}-seed${seedIndex}`;
        const rng = rngFromSeed(seedLabel);
        const result = runInstrumentedMcts(root, seat, budget, rng);
        assertCloneAgrees(seedLabel, seat, budget, result);

        const chosenKey = bidMoveKey(result.move as unknown as { amount: number; star?: boolean });
        const optimalSet = seat === 0 ? optimalBids0 : optimalBids1;
        const byAmount = amountCombined(result.rootVisits);
        const starArgmax = argmaxStarSeparate(result.rootVisits);
        const amountArgmax = argmaxAmountCombined(byAmount);
        const starArgmaxAmount = Number(starArgmax.endsWith("*") ? starArgmax.slice(0, -1) : starArgmax);
        const argmaxDiffers = starArgmaxAmount !== amountArgmax;

        console.log(`  seat ${seat} (seed "${seedLabel}"):`);
        console.log(`    chosen: ${chosenKey}  (in exact optimalBids? ${optimalSet.has(chosenKey)})`);
        console.log(`    rootValue (seat ${seat} own perspective): ${result.rootValue.toFixed(4)}`);
        console.log(
          `    marginals star-separate: ` +
            result.rootVisits
              .slice()
              .sort((a, b) => b.visits - a.visits)
              .map((r) => `${bidMoveKey(r.move as unknown as { amount: number; star?: boolean })}:${r.visits}`)
              .join(", ")
        );
        console.log(
          `    marginals amount-combined: ` +
            Array.from(byAmount.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([amount, visits]) => `${amount}:${visits}`)
              .join(", ")
        );
        console.log(`    argmax differs (star-separate=${starArgmax} vs amount-combined=${amountArgmax}): ${argmaxDiffers}`);

        // Joint-visit heat-map: own-move rows, opponent-bid columns, conditional on own bid.
        const byOwn = new Map<string, { total: number; byOpp: Map<string, number> }>();
        for (const { own, opp, visits } of result.jointRootVisits) {
          const ownKey = bidMoveKey(own as unknown as { amount: number; star?: boolean });
          const oppKey = bidMoveKey(opp as unknown as { amount: number; star?: boolean });
          const bucket = byOwn.get(ownKey) ?? { total: 0, byOpp: new Map() };
          bucket.total += visits;
          bucket.byOpp.set(oppKey, (bucket.byOpp.get(oppKey) ?? 0) + visits);
          byOwn.set(ownKey, bucket);
        }
        console.log(`    joint heat-map (own -> [opponent-bid:visits, ...], row totals sum to own-move's visits):`);
        for (const [ownKey, bucket] of Array.from(byOwn.entries()).sort((a, b) => b[1].total - a[1].total)) {
          const cells = Array.from(bucket.byOpp.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([oppKey, v]) => `${oppKey}:${v}`)
            .join(", ");
          console.log(`      own=${ownKey} (total=${bucket.total}): ${cells}`);
        }
      }
      console.log("");
    }
  }

  process.stderr.write("E-A complete. This run is instrument validation / a shape check ONLY " +
    "when budgets/seeds are small (e.g. a smoke pass) — see docs/plans/sim-search-residue.md §2's " +
    "pre-registered interpretation table before drawing any H1/H2 conclusion from it.\n");
}

main();

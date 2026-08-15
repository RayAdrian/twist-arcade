// .scratch/exp1-mechanism-check.mts — Experiment 1, docs/plans/rollout-evaluation.md §5 step 1.
// Throwaway diagnostic script (C36 discipline), NOT a package deliverable. Cited by
// platform-corrections.md C73 (the evaluation-defect finding this remedy answers) and C77 (the
// standing rule this script exists to satisfy: "when a fix ships with a root-cause narrative,
// the narrative is a claim requiring its own test — separate from the test that the fix works").
//
// WHAT THIS TESTS: the plan's mechanism claim (§0) is "tanh(heuristic) at the leaf creates a
// monotone gradient over payment that points at the oracle's optimal set." This script verifies
// that claim BEFORE any implementation exists, per the pre-registered refutation condition R1
// (plan §1): R1 fires if the tanh(heuristic)-induced own-bid ordering disagrees with
// `optimalBids(state, seat)` at the root, or at more than 20% of sampled reachable bid-phase
// states. NO SEARCH — this never calls mctsPolicy or any bot, and never touches packages/bots or
// any game engine source. `createExactOracle(8)` is the only expensive call (~5.1s, per the
// solve report).
//
// -2p VERIFIED AGAINST THE CODE (not just quoted from the plan): heuristic.ts's first term is
// `budgets[seat] - budgets[opponent]`; engine.ts's apply() bid branch (lines 291-293) does
// `budgets[winner] -= payment; budgets[loser] += payment` — so winning at price p changes the
// winner's own budget term by -p and the opponent's by +p, a -2p swing in the DIFFERENCE term.
// Confirmed by direct read, not assumed.
//
// "OWN-BID INDUCED VALUE", DEFINED PRECISELY — the one place this script has to make a modeling
// choice the plan's prose leaves implicit. `optimalBids(state, seat)` is defined (backward-
// induction.ts's `optimalBidsAt`) as a MAXIMIN/MINIMAX over the full (own-bid x opponent-bid)
// payoff matrix, using the exact recursive game value as the cell payoff — NOT as "the value if
// my bid wins" in isolation. An own-bid that only ever gets scored against "assume it wins" is
// not the same question `optimalBids` answers (it ignores the case where a cheap own-bid loses
// to a slightly higher opponent bid, which the exact table shows matters: e.g. overpaying when
// you WIN is bad, but so is a rival cheaply outbidding you when you bid too low — a real
// tension `optimalBids`'s maximin already prices in). So this script builds the SAME matrix
// structure `optimalBidsAt`/`buildBidMatrix` build — own-bid x opponent-bid, resolved via the
// real `resolveBid()` (engine.ts, exported, reused verbatim, not reimplemented) — but with each
// cell's payoff being `tanh(heuristic(...))` at the IMMEDIATE resolved place-phase successor (no
// placement, no recursion — the literal MCTS leaf a rollout-cap-0 expand step would reach,
// exactly what `valueOfStatus`'s "ongoing" branch computes, search-utils.ts:107) instead of the
// exact recursive value. Seat 0's induced value per own-bid is then `min` over the opponent's
// bids (maximin, seat 0 maximizes this); seat 1's is `max` over the opponent's bids (minimax,
// seat 1 minimizes this) — the identical reduction `optimalBidsAt` performs, just fed a
// different (cheap, 1-ply, imperfect) cell evaluator. Own-bid candidates are read directly from
// `bidTacToe.legalMoves(state, seat)` (the real engine, not a hand-rolled move enumerator), so
// the star sub-variant ("8" vs "8*") is a distinct candidate exactly as it is a distinct member
// of `optimalBids`'s own returned set, and comparison is by EXACT `bidMoveKey`, no leniency.
//
// SAMPLING METHOD: `createExactOracle`'s `ExactOracle` interface (backward-induction.ts:479-494)
// exposes only `exactValue(state)` and `optimalBids(state, seat)` — the solver's internal memo
// (`SolverState.memo`, a `Map<string, number>` of hashed keys, not full states) is NOT exported,
// so "a sample of reachable bid-phase states drawn from the oracle's memo" cannot literally mean
// iterating that Map. Instead: since `createExactOracle(budget)` solves by visiting EVERY state
// reachable from the real initial position via `bidTacToe.legalMoves()`/`apply()` (module doc),
// any state reached by a legal random playout from that same root is, by construction, a member
// of that same reachable set (and therefore present in the oracle's memo, queryable via
// `exactValue`/`optimalBids`). This script runs many independent random-move playouts from the
// real root (seeded via `rngFromSeed`, one fresh seed string per trajectory, deterministic),
// recording every distinct bid-phase state visited along the way (deduped by a local key over
// board+budgets+star), until a target sample size is reached or the trajectory budget is spent.
// This is a BIASED sample toward states reachable under uniform-random play, not a uniform
// sample over the ~1.37M states the B=8 solve report gives — stated plainly per the task's
// instruction to disclose sampling method. It skews toward "typical" mid-entropy play and under-
// represents deep endgame low-budget corners the oracle would eventually visit — which is
// exactly why the pre-registered gate is a 20% threshold over a large sample, not a single-state
// check.

import { rngFromSeed } from "@twist-arcade/engine";
import type { Rng } from "@twist-arcade/engine";
import {
  bidTacToe,
  resolveBid,
  STARTING_BUDGET,
  type BidTacToeBidMove,
  type BidTacToeState,
  type Seat,
} from "../games/bid-tac-toe/engine";
import { heuristic } from "../games/bid-tac-toe/heuristic";
import {
  bidMoveKey,
  createExactOracle,
  type BidMoveKey,
  type ExactOracle,
} from "../games/bid-tac-toe/solver/backward-induction";

const EPS = 1e-9;
const TARGET_SAMPLE_SIZE = 4000;
const MAX_TRAJECTORIES = 20000;

function rootState(): BidTacToeState {
  return {
    board: Array.from({ length: 9 }, () => null),
    budgets: [STARTING_BUDGET, STARTING_BUDGET],
    star: 1, // real setup(): seat 1 holds the star.
    phase: { kind: "bid" },
    lastEffects: [],
  };
}

function stateKey(state: BidTacToeState): string {
  let board = "";
  for (const c of state.board) board += c === null ? "." : String(c);
  return `${board}|${state.budgets[0]},${state.budgets[1]}|star${state.star}`;
}

function marksOnBoard(state: BidTacToeState): number {
  let n = 0;
  for (const c of state.board) if (c !== null) n += 1;
  return n;
}

/** One random-move playout from the real root, collecting every distinct bid-phase state
 *  visited (including the root itself, always the first). Uses the REAL engine's
 *  legalMoves()/apply()/status() exclusively — no shortcuts, so every collected state is
 *  genuinely reachable under the real rules. */
function playoutCollectBidStates(rng: Rng, sink: Map<string, BidTacToeState>): void {
  let state = rootState();
  let guard = 0;
  while (bidTacToe.status(state).kind === "ongoing" && guard < 40) {
    guard += 1;
    if (state.phase.kind === "bid") {
      const key = stateKey(state);
      if (!sink.has(key)) sink.set(key, state);
      const m0 = bidTacToe.legalMoves(state, 0);
      const m1 = bidTacToe.legalMoves(state, 1);
      const chosen0 = m0[rng.int(m0.length)]!;
      const chosen1 = m1[rng.int(m1.length)]!;
      state = bidTacToe.apply(state, new Map([[0, chosen0], [1, chosen1]]), rng);
    } else {
      const winner = state.phase.winner;
      const moves = bidTacToe.legalMoves(state, winner);
      const chosen = moves[rng.int(moves.length)]!;
      state = bidTacToe.apply(state, new Map([[winner, chosen]]), rng);
    }
  }
}

/** The immediate place-phase successor of a resolved bid — hand-built to the identical shape
 *  `valueOfResolvedWin` builds in backward-induction.ts (budgets transferred, board untouched,
 *  star transferred only if the resolution says so, phase -> place/winner). That helper is
 *  private to the solver module, so this is a deliberate, narrow re-derivation of the same
 *  arithmetic engine.ts's own apply() bid branch performs (lines 290-313), not a fresh guess. */
function resolvedSuccessor(
  state: BidTacToeState,
  winner: Seat,
  payment: number,
  starDecisive: boolean
): BidTacToeState {
  const loser: Seat = winner === 0 ? 1 : 0;
  const budgets: [number, number] = [state.budgets[0], state.budgets[1]];
  budgets[winner] -= payment;
  budgets[loser] += payment;
  const star: Seat = starDecisive ? loser : state.star;
  return {
    board: state.board,
    budgets,
    star,
    phase: { kind: "place", winner },
    lastEffects: [],
  };
}

interface StateVerdict {
  readonly agree: boolean;
  readonly spread: number;
  readonly topKeys: readonly BidMoveKey[];
  readonly optimalKeys: readonly BidMoveKey[];
}

/** Builds the shared (seat 0 moves x seat 1 moves) matrix of tanh(heuristic) at the immediate
 *  resolved leaf, in seat-0 perspective (v0) — mirroring `buildBidMatrix`'s structure exactly,
 *  with the exact recursive cell value replaced by the 1-ply heuristic evaluation this
 *  experiment is testing. Own-bid candidates come from the REAL `legalMoves()`, not a
 *  hand-rolled enumerator, so star-variant keys line up with `optimalBids`'s own key space. */
function evaluateState(
  oracle: ExactOracle,
  state: BidTacToeState,
  seat: Seat
): StateVerdict {
  const rows = bidTacToe.legalMoves(state, 0) as BidTacToeBidMove[];
  const cols = bidTacToe.legalMoves(state, 1) as BidTacToeBidMove[];

  const cellValue = (row: BidTacToeBidMove, col: BidTacToeBidMove): number => {
    const resolved = resolveBid(state.star, row, col);
    const successor = resolvedSuccessor(state, resolved.winner, resolved.payment, resolved.starDecisive);
    return Math.tanh(heuristic(successor, 0)); // seat-0 perspective, shared across both reductions
  };

  const inducedBySeat0Move = rows.map((row) => {
    let rowMin = Number.POSITIVE_INFINITY;
    for (const col of cols) rowMin = Math.min(rowMin, cellValue(row, col));
    return { move: row, value: rowMin };
  });
  const inducedBySeat1Move = cols.map((col) => {
    let colMax = Number.NEGATIVE_INFINITY;
    for (const row of rows) colMax = Math.max(colMax, cellValue(row, col));
    return { move: col, value: colMax };
  });

  const induced = seat === 0 ? inducedBySeat0Move : inducedBySeat1Move;
  const values = induced.map((i) => i.value);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);

  // seat 0 wants the HIGHEST induced value (maximin); seat 1 wants the LOWEST (minimax) — the
  // same asymmetry `optimalBidsAt` encodes.
  const target = seat === 0 ? maxValue : minValue;
  const topKeys = induced.filter((i) => Math.abs(i.value - target) < EPS).map((i) => bidMoveKey(i.move));

  const optimalKeys = Array.from(oracle.optimalBids(state, seat));
  const agree = topKeys.some((k) => optimalKeys.includes(k));

  return { agree, spread: maxValue - minValue, topKeys, optimalKeys };
}

function main(): void {
  const t0 = Date.now();
  process.stderr.write("Solving createExactOracle(8)...\n");
  const oracle = createExactOracle(STARTING_BUDGET);
  process.stderr.write(`  solved in ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`);

  // --- Root check, both seats -----------------------------------------------------------
  const root = rootState();
  const rootVerdicts: Record<Seat, StateVerdict> = {
    0: evaluateState(oracle, root, 0),
    1: evaluateState(oracle, root, 1),
  };

  console.log("=== ROOT (B=8, star held by seat 1) ===");
  for (const seat of [0, 1] as const) {
    const v = rootVerdicts[seat];
    console.log(
      `seat ${seat}: top induced-value bid(s) = {${v.topKeys.join(", ")}}, ` +
        `optimalBids = {${v.optimalKeys.join(", ")}}, agree = ${v.agree}, ` +
        `spread = ${v.spread.toFixed(6)}`
    );
  }
  console.log("");

  // --- Sample reachable bid-phase states via random playouts -----------------------------
  process.stderr.write(
    `Sampling reachable bid-phase states (target ${TARGET_SAMPLE_SIZE}, cap ${MAX_TRAJECTORIES} trajectories)...\n`
  );
  const sink = new Map<string, BidTacToeState>();
  let trajectories = 0;
  for (; trajectories < MAX_TRAJECTORIES && sink.size < TARGET_SAMPLE_SIZE; trajectories++) {
    const rng = rngFromSeed(`exp1-mechanism-check-traj-${trajectories}`);
    playoutCollectBidStates(rng, sink);
  }
  const sampled = Array.from(sink.values());
  process.stderr.write(`  ${trajectories} trajectories -> ${sampled.length} distinct bid-phase states\n\n`);

  // Depth distribution (marks already on board when the auction happens) for disclosure.
  const depthCounts = new Map<number, number>();
  for (const s of sampled) depthCounts.set(marksOnBoard(s), (depthCounts.get(marksOnBoard(s)) ?? 0) + 1);
  const depthLine = Array.from(depthCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => `${d}:${n}`)
    .join(", ");
  console.log(`Sample depth distribution (marks-on-board : count): ${depthLine}`);
  console.log("");

  // --- Evaluate every sampled state, both seats -------------------------------------------
  const results: Record<Seat, { disagreements: number; total: number; spreads: number[] }> = {
    0: { disagreements: 0, total: 0, spreads: [] },
    1: { disagreements: 0, total: 0, spreads: [] },
  };

  for (const state of sampled) {
    for (const seat of [0, 1] as const) {
      const v = evaluateState(oracle, state, seat);
      results[seat].total += 1;
      if (!v.agree) results[seat].disagreements += 1;
      results[seat].spreads.push(v.spread);
    }
  }

  console.log("=== SAMPLED STATES (excludes root, reported separately above) ===");
  for (const seat of [0, 1] as const) {
    const r = results[seat];
    const frac = r.total === 0 ? 0 : r.disagreements / r.total;
    const spreads = r.spreads.slice().sort((a, b) => a - b);
    const mean = spreads.reduce((a, b) => a + b, 0) / (spreads.length || 1);
    const min = spreads[0] ?? 0;
    const max = spreads[spreads.length - 1] ?? 0;
    const median = spreads.length ? spreads[Math.floor(spreads.length / 2)]! : 0;
    console.log(
      `seat ${seat}: n=${r.total}, disagreements=${r.disagreements} (${(frac * 100).toFixed(2)}%), ` +
        `spread min=${min.toFixed(6)} median=${median.toFixed(6)} mean=${mean.toFixed(6)} max=${max.toFixed(6)}`
    );
  }
  console.log("");

  // --- R1 verdict, applied exactly as pre-registered (plan §1) ---------------------------
  const rootFires = !rootVerdicts[0].agree || !rootVerdicts[1].agree;
  const sampleFires =
    (results[0].total > 0 && results[0].disagreements / results[0].total > 0.2) ||
    (results[1].total > 0 && results[1].disagreements / results[1].total > 0.2);
  const r1Fires = rootFires || sampleFires;

  console.log("=== R1 VERDICT ===");
  console.log(`root disagreement (either seat): ${rootFires}`);
  console.log(`sample disagreement > 20% (either seat): ${sampleFires}`);
  console.log(`R1 FIRES: ${r1Fires}`);
}

main();

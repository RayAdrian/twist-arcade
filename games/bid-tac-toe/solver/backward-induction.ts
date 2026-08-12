// games/bid-tac-toe/solver/backward-induction.ts — B2's exact solve (docs/plans/bid-tac-toe.md
// §5), a GAME-LOCAL script per correction C3: the generic solver refuses this game twice
// (`packages/harness/src/solver/types.ts:67` rejects `simultaneous: true` engines outright;
// `reach.ts:93` throws on a simultaneous `active()` spec mid-reach), so this composes nothing
// from `@twist-arcade/harness`'s solver lane — it is a standalone backward induction over the
// real public engine, following the Fadeout precedent's SHAPE (a game-local solve script) while
// being a genuinely different ALGORITHM underneath: Fadeout's graph has cycles (superko) and
// needs retrograde analysis; Bid-Tac-Toe's graph is ACYCLIC (plan §3.2 / B1's own acyclicity
// property test — every auction strictly fills a cell, no history in state), so this is
// straight memoized backward induction, no value iteration, no GHI.
//
// THE ONE GENUINELY NOVEL PIECE (plan §5): a bid-phase node is a MATRIX-GAME node, not a plain
// minimax node. Player 0's legal bids are the ROWS, player 1's the COLUMNS, and each cell's
// payoff is the (already-solved, memoized) value of the place-phase state that bid pair
// resolves to. Develin & Payne's discrete-bidding-game theory predicts PURE optimal bids exist
// for this class of game — that is a HYPOTHESIS about our exact tie/transfer variant until
// checked, which is exactly what computing BOTH the maximin (max_i min_j A[i][j]) and the
// minimax (min_j max_i A[i][j]) bound at every bid node checks: by the standard saddle-point
// argument, maximin <= true game value <= minimax always, with EQUALITY iff a pure Nash
// equilibrium exists at that node. This script never invents a value for an unequal (impure)
// node via linear programming — per the coordinator's ruling, an LP-solved mixed-strategy value
// is exactly the kind of "probabilistic value" the `SolvedValue` vocabulary has no arm for, and
// building one locally here would be inventing an answer the platform has nowhere to put. When
// impurity is found, this module: (a) records it in a census (see SaddleCensus below), (b)
// propagates the AVERAGE of the two bounds upward, purely so a full tree walk can still
// terminate and report SOME numbers — every value computed once impurity has been seen anywhere
// in its subtree is a documented BOUND-BASED APPROXIMATION, never claimed exact, and
// `SolveResult.pure` is false the moment this ever fires even once, which is what solve.ts uses
// to decide whether `solvedValue` may claim anything beyond `"unknown"`.
//
// WHY resolveBid() (engine.ts) IS ALREADY THE FAST PATH: bid resolution is pure integer
// arithmetic (compare two amounts, maybe read one boolean) — there is no allocation-heavy state
// construction to avoid in the classification step itself, so this solver calls engine.ts's own
// exported resolveBid() DIRECTLY, up to rows*cols times per bid node, rather than maintaining an
// independently reimplemented copy that could drift from the one apply() actually uses (the
// same DRY reasoning B1's own refactor introduced it for). What IS avoided is constructing a
// full successor STATE OBJECT (and recursing into it) once per (row, col) cell: since the
// resolved (winner, payment, starDecisive) triple ranges over only O(budget) DISTINCT values
// (every row/col pair with the same winner+payment+starDecisive collapses to the identical
// successor state), this solver precomputes each distinct successor's value ONCE per bid node
// (O(budget) recursive calls) and then scans the full rows*cols grid doing only cheap
// arithmetic + a table lookup per cell — matching the plan's own cost model ("~1,156 successor
// LOOKUPS", not 1,156 recursive descents).
//
// BUDGET IS A SOLVER PARAMETER, NOT engine.ts's STARTING_BUDGET CONSTANT: only `setup()` and
// `decode()` reference that module constant (setup() to seed initial budgets; decode() to
// validate Richman conservation against it) — `apply()`/`legalMoves()`/`isLegal()`/`status()`/
// `active()` are all budget-parametric purely via `state.budgets`. This solver never calls
// `setup()` or `decode()`; it constructs its own initial state directly for whatever `budget`
// it is asked to solve, so the {8, 12, 16, 20} sweep (plan §5) needs no engine change at all.

import type { PlayerId, Rng } from "@twist-arcade/engine";
import {
  bidTacToe,
  resolveBid,
  type BidTacToeBidMove,
  type BidTacToeState,
  type Seat,
} from "../engine";

// The solver never generates chance events (stochastic: false, and every rng-taking engine call
// here is either setup()-shaped [never invoked — see module doc] or apply(), whose bid/place
// transitions are both fully deterministic and never touch rng). A single shared no-op Rng
// avoids allocating a fresh one per apply() call across tens of millions of invocations.
const NULL_RNG: Rng = {
  next: () => 0,
  int: () => 0,
  shuffle: <T>(xs: readonly T[]): T[] => [...xs],
};

/** A compact, fast memo key — deliberately NOT `bidTacToe.encode()` (stableStringify's
 *  key-sorting/JSON-escaping overhead matters at tens of millions of calls). Cross-checked
 *  against `encode()` for injectivity in backward-induction.test.ts (same states must produce
 *  the same key; the two functions need not agree byte-for-byte, only agree on which states are
 *  equal — a property this module's own tests assert directly). */
function fastKey(state: BidTacToeState): string {
  let board = "";
  for (const cell of state.board) board += cell === null ? "." : String(cell);
  const phase = state.phase.kind === "bid" ? "b" : `p${state.phase.winner}`;
  return `${board}|${state.budgets[0]}|${state.star}|${phase}`;
}

export interface DepthCensusRow {
  readonly depth: number; // marks already on the board when this bid node was evaluated (0..8)
  readonly total: number;
  readonly impure: number; // maximin !== minimax
}

export interface SaddleCensus {
  readonly totalBidNodes: number;
  readonly impureBidNodes: number;
  readonly impureFraction: number; // 0 when totalBidNodes === 0 (vacuously pure)
  readonly byDepth: readonly DepthCensusRow[];
}

export interface FirstAuctionRow {
  readonly payment: number;
  /** Value (seat-0 perspective) of the position immediately after seat 0 wins the FIRST
   *  auction, paying `payment`, and then places optimally. */
  readonly valueIfSeat0Wins: number;
  /** Value if seat 1 wins instead, paying `payment`. */
  readonly valueIfSeat1Wins: number;
}

export type CanonicalStep =
  | { readonly kind: "bid"; readonly detail: string; readonly moves: readonly [BidTacToeBidMove, BidTacToeBidMove] }
  | { readonly kind: "place"; readonly detail: string; readonly winner: Seat; readonly cell: number };

export interface SolveResult {
  readonly budget: number;
  /** Seat-0-perspective value in [-1, 1]. Exactly one of {-1, 0, 1} whenever `pure` is true
   *  (asserted as a property in backward-induction.test.ts) — a fractional root value can only
   *  occur when `pure` is false. */
  readonly rootValue: number;
  /** True iff EVERY bid node visited anywhere in the reachable tree had maximin === minimax.
   *  False the moment even one node needed the bound-average fallback — see module doc. */
  readonly pure: boolean;
  /** rootValue if seat 0 held the star at setup instead of seat 1 (a hypothetical, never-
   *  reachable-in-real-play state, constructed purely to isolate the star's own worth) MINUS
   *  the real rootValue (seat 1 holds the star, matching engine.ts's actual setup()). Positive
   *  means holding the star is worth exactly this much to seat 0 in this position. */
  readonly starHolderAdvantage: number;
  readonly firstAuctionTable: readonly FirstAuctionRow[];
  readonly saddleCensus: SaddleCensus;
  /** Total distinct (board, budgets, star, phase) positions memoized while solving — the
   *  reachable-state count, reported alongside the plan §1 estimate for comparison. */
  readonly reachableStates: number;
  readonly canonicalLine: readonly CanonicalStep[];
}

function initialState(budget: number, star: Seat): BidTacToeState {
  return {
    board: Array.from({ length: 9 }, () => null),
    budgets: [budget, budget],
    star,
    phase: { kind: "bid" },
    lastEffects: [],
  };
}

interface SolverState {
  readonly memo: Map<string, number>;
  totalBidNodes: number;
  impureBidNodes: number;
  readonly byDepth: Map<number, { total: number; impure: number }>;
}

function newSolverState(): SolverState {
  return { memo: new Map(), totalBidNodes: 0, impureBidNodes: 0, byDepth: new Map() };
}

function marksOnBoard(state: BidTacToeState): number {
  let n = 0;
  for (const c of state.board) if (c !== null) n += 1;
  return n;
}

function recordCensus(solver: SolverState, depth: number, pure: boolean): void {
  solver.totalBidNodes += 1;
  if (!pure) solver.impureBidNodes += 1;
  const row = solver.byDepth.get(depth) ?? { total: 0, impure: 0 };
  row.total += 1;
  if (!pure) row.impure += 1;
  solver.byDepth.set(depth, row);
}

function movesFor(budget: number, isHolder: boolean): { amount: number; star: boolean }[] {
  const moves: { amount: number; star: boolean }[] = [];
  for (let amount = 0; amount <= budget; amount++) {
    moves.push({ amount, star: false });
    if (isHolder) moves.push({ amount, star: true });
  }
  return moves;
}

function valueOf(solver: SolverState, state: BidTacToeState): number {
  const key = fastKey(state);
  const cached = solver.memo.get(key);
  if (cached !== undefined) return cached;

  const status = bidTacToe.status(state);
  let value: number;
  if (status.kind === "won") {
    value = status.winner === 0 ? 1 : -1;
  } else if (status.kind === "draw") {
    value = 0;
  } else if (state.phase.kind === "place") {
    value = valueOfPlaceNode(solver, state);
  } else {
    value = valueOfBidNode(solver, state);
  }

  solver.memo.set(key, value);
  return value;
}

function valueOfPlaceNode(solver: SolverState, state: BidTacToeState): number {
  // `state.phase.kind === "place"` is already established by valueOf()'s own caller-side
  // narrowing (its only call site), but that narrowing does not cross a function boundary —
  // TS sees `state: BidTacToeState`'s full phase union again here, so it must be re-asserted
  // locally (never previously caught: this file was outside the package's typecheck `include`
  // glob until the games/bid-tac-toe/tsconfig.json fix alongside this — see C57/C58).
  if (state.phase.kind !== "place") {
    throw new Error(`valueOfPlaceNode: state.phase.kind must be "place", got "${state.phase.kind}"`);
  }
  const winner = state.phase.winner;
  const legal = bidTacToe.legalMoves(state, winner);
  let best = winner === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const move of legal) {
    const successor = bidTacToe.apply(state, new Map<PlayerId, typeof move>([[winner, move]]), NULL_RNG);
    const v = valueOf(solver, successor);
    if (winner === 0 ? v > best : v < best) best = v;
  }
  return best;
}

/** The value of the place-phase state reached when `winner` wins the auction paying `payment`,
 *  with `starDecisive` telling whether the star transferred. Builds the successor state
 *  directly (no apply() call needed — this IS what apply()'s own bid branch does, minus the
 *  legality re-checks apply() performs on caller-supplied moves, which are unnecessary here
 *  since every (winner, payment, starDecisive) triple this function is ever called with is
 *  derived from resolveBid() over already-enumerated legal moves). `board` is shared by
 *  reference across every successor of one bid node — safe: BidTacToeState.board is readonly
 *  and this solver never mutates it. */
function valueOfResolvedWin(
  solver: SolverState,
  state: BidTacToeState,
  winner: Seat,
  payment: number,
  starDecisive: boolean
): number {
  const loser: Seat = winner === 0 ? 1 : 0;
  const budgets: [number, number] = [state.budgets[0], state.budgets[1]];
  budgets[winner] -= payment;
  budgets[loser] += payment;
  const star: Seat = starDecisive ? loser : state.star;
  const successor: BidTacToeState = {
    board: state.board,
    budgets,
    star,
    phase: { kind: "place", winner },
    lastEffects: [],
  };
  return valueOf(solver, successor);
}

interface BidMatrix {
  readonly rows: readonly { amount: number; star: boolean }[];
  readonly cols: readonly { amount: number; star: boolean }[];
  readonly cellValue: (
    row: { amount: number; star: boolean },
    col: { amount: number; star: boolean }
  ) => number;
}

/** Builds the (rows x cols) matrix-game payoff structure at a bid node (module doc's "THE ONE
 *  GENUINELY NOVEL PIECE") — the O(budget) distinct-successor precompute plus a `cellValue`
 *  lookup closure over it. Factored out of `valueOfBidNode`/`bestBidPair` (both need the exact
 *  same matrix) and reused by `optimalBidsAt` below, so the maximin/minimax computation that
 *  underpins `createExactOracle().optimalBids()` shares this construction rather than
 *  reimplementing it a third time. */
function buildBidMatrix(solver: SolverState, state: BidTacToeState): BidMatrix {
  const [b0, b1] = state.budgets;
  const holder = state.star;
  const minBudget = Math.min(b0, b1);

  const nonDecisive0: number[] = [];
  for (let k = 0; k <= b0; k++) nonDecisive0.push(valueOfResolvedWin(solver, state, 0, k, false));
  const nonDecisive1: number[] = [];
  for (let k = 0; k <= b1; k++) nonDecisive1.push(valueOfResolvedWin(solver, state, 1, k, false));
  const decisive: number[] = [];
  for (let k = 0; k <= minBudget; k++) decisive.push(valueOfResolvedWin(solver, state, holder, k, true));

  const rows = movesFor(b0, holder === 0);
  const cols = movesFor(b1, holder === 1);

  const cellValue = (row: { amount: number; star: boolean }, col: { amount: number; star: boolean }): number => {
    const rowMove: BidTacToeBidMove = { kind: "bid", amount: row.amount, ...(row.star ? { star: true } : {}) };
    const colMove: BidTacToeBidMove = { kind: "bid", amount: col.amount, ...(col.star ? { star: true } : {}) };
    const resolved = resolveBid(holder, rowMove, colMove);
    if (resolved.starDecisive) return decisive[resolved.payment]!;
    return resolved.winner === 0 ? nonDecisive0[resolved.payment]! : nonDecisive1[resolved.payment]!;
  };

  return { rows, cols, cellValue };
}

function valueOfBidNode(solver: SolverState, state: BidTacToeState): number {
  const { rows, cols, cellValue } = buildBidMatrix(solver, state);

  let maximin = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (const col of cols) {
      const v = cellValue(row, col);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maximin) maximin = rowMin;
  }

  let minimax = Number.POSITIVE_INFINITY;
  for (const col of cols) {
    let colMax = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const v = cellValue(row, col);
      if (v > colMax) colMax = v;
    }
    if (colMax < minimax) minimax = colMax;
  }

  const EPS = 1e-9;
  const pure = Math.abs(maximin - minimax) < EPS;
  recordCensus(solver, marksOnBoard(state), pure);

  return pure ? maximin : (maximin + minimax) / 2;
}

// ---------------------------------------------------------------------------------------
// Strategy extraction: a single canonical line from the root, re-deriving each step's optimal
// move(s) from the already-memoized values (cheap — path length is at most 18 plies).
// ---------------------------------------------------------------------------------------

function bestPlaceCell(solver: SolverState, state: BidTacToeState): { cell: number; value: number } {
  // Same cross-function narrowing note as valueOfPlaceNode above.
  if (state.phase.kind !== "place") {
    throw new Error(`bestPlaceCell: state.phase.kind must be "place", got "${state.phase.kind}"`);
  }
  const winner = state.phase.winner;
  const legal = bidTacToe.legalMoves(state, winner);
  let best: { cell: number; value: number } | undefined;
  for (const move of legal) {
    // legalMoves() at a place-phase state only ever returns place moves (engine.ts), but its
    // return type is the full BidTacToeMove union, so `move.cell` resolves through the shared
    // `[key: string]: Json` index signature (Json, which includes null) rather than the
    // place-specific `cell: number` field — narrow explicitly rather than widen the field type.
    if (move.kind !== "place") {
      throw new Error(`bestPlaceCell: legalMoves() at a place-phase state returned a non-place move: kind=${move.kind}`);
    }
    const successor = bidTacToe.apply(state, new Map<PlayerId, typeof move>([[winner, move]]), NULL_RNG);
    const v = valueOf(solver, successor);
    if (!best || (winner === 0 ? v > best.value : v < best.value)) best = { cell: move.cell, value: v };
  }
  if (!best) throw new Error("bestPlaceCell: no legal placement — should be unreachable while ongoing");
  return best;
}

/** Canonical (smallest-amount) bids achieving each side's own bound, plus the resulting
 *  (winner, payment, starDecisive) when those two canonical choices meet — sound because, at a
 *  PURE node, any best-row/best-col pair reproduces the saddle value exactly (module doc). At
 *  an IMPURE node this is a best-effort illustrative line only, not a claim of optimality. */
function bestBidPair(
  solver: SolverState,
  state: BidTacToeState
): { row: { amount: number; star: boolean }; col: { amount: number; star: boolean } } {
  const { rows, cols, cellValue } = buildBidMatrix(solver, state);

  let maximin = Number.NEGATIVE_INFINITY;
  let bestRow = rows[0]!;
  for (const row of rows) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (const col of cols) rowMin = Math.min(rowMin, cellValue(row, col));
    if (rowMin > maximin) {
      maximin = rowMin;
      bestRow = row;
    }
  }

  let minimax = Number.POSITIVE_INFINITY;
  let bestCol = cols[0]!;
  for (const col of cols) {
    let colMax = Number.NEGATIVE_INFINITY;
    for (const row of rows) colMax = Math.max(colMax, cellValue(row, col));
    if (colMax < minimax) {
      minimax = colMax;
      bestCol = col;
    }
  }

  return { row: bestRow, col: bestCol };
}

function extractCanonicalLine(solver: SolverState, root: BidTacToeState): CanonicalStep[] {
  const steps: CanonicalStep[] = [];
  let state = root;
  let guard = 0;
  while (bidTacToe.status(state).kind === "ongoing" && guard < 32) {
    guard += 1;
    if (state.phase.kind === "bid") {
      const { row, col } = bestBidPair(solver, state);
      const rowMove: BidTacToeBidMove = { kind: "bid", amount: row.amount, ...(row.star ? { star: true } : {}) };
      const colMove: BidTacToeBidMove = { kind: "bid", amount: col.amount, ...(col.star ? { star: true } : {}) };
      const resolved = resolveBid(state.star, rowMove, colMove);
      steps.push({
        kind: "bid",
        detail:
          `seat 0 bids ${row.amount}${row.star ? "*" : ""}, seat 1 bids ${col.amount}${col.star ? "*" : ""} ` +
          `-> seat ${resolved.winner} wins, pays ${resolved.payment}` +
          (resolved.starDecisive ? " (star decisive, transfers)" : ""),
        moves: [rowMove, colMove],
      });
      state = bidTacToe.apply(state, new Map<PlayerId, BidTacToeBidMove>([[0, rowMove], [1, colMove]]), NULL_RNG);
    } else {
      const { cell, value } = bestPlaceCell(solver, state);
      const winner = state.phase.winner;
      steps.push({ kind: "place", detail: `seat ${winner} places cell ${cell} (value ${value})`, winner, cell });
      const move = { kind: "place" as const, cell };
      state = bidTacToe.apply(state, new Map<PlayerId, typeof move>([[winner, move]]), NULL_RNG);
    }
  }
  return steps;
}

export function solveBudget(budget: number): SolveResult {
  if (!Number.isInteger(budget) || budget < 0) {
    throw new RangeError(`solveBudget: budget must be a non-negative integer, got ${budget}`);
  }
  const solver = newSolverState();
  const root = initialState(budget, 1); // real setup(): seat 1 holds the star.
  const rootValue = valueOf(solver, root);

  const mirrored = initialState(budget, 0); // hypothetical: seat 0 holds the star instead.
  const mirroredValue = valueOf(solver, mirrored);

  const firstAuctionTable: FirstAuctionRow[] = [];
  for (let payment = 0; payment <= budget; payment++) {
    firstAuctionTable.push({
      payment,
      valueIfSeat0Wins: valueOfResolvedWin(solver, root, 0, payment, false),
      valueIfSeat1Wins: valueOfResolvedWin(solver, root, 1, payment, false),
    });
  }

  const byDepth: DepthCensusRow[] = Array.from(solver.byDepth.entries())
    .map(([depth, row]) => ({ depth, total: row.total, impure: row.impure }))
    .sort((a, b) => a.depth - b.depth);

  const saddleCensus: SaddleCensus = {
    totalBidNodes: solver.totalBidNodes,
    impureBidNodes: solver.impureBidNodes,
    impureFraction: solver.totalBidNodes === 0 ? 0 : solver.impureBidNodes / solver.totalBidNodes,
    byDepth,
  };

  return {
    budget,
    rootValue,
    pure: solver.impureBidNodes === 0,
    starHolderAdvantage: mirroredValue - rootValue,
    firstAuctionTable,
    saddleCensus,
    reachableStates: solver.memo.size,
    canonicalLine: extractCanonicalLine(solver, root),
  };
}

// ---------------------------------------------------------------------------------------
// createExactOracle() — docs/plans/sim-search-residue.md §2's prerequisite for E-A (the
// root-agreement experiment that discriminates H1 from H2). An EXPORT, not a behavior change:
// nothing shipped calls this solver, and `valueOf`/`buildBidMatrix`/the memo are the exact same
// private machinery `solveBudget` already uses — this only exposes two read-only views over it:
// the memoized value of an ARBITRARY reachable state (not just the root), and, at a bid node,
// the FULL SET of bids achieving the maximin (seat 0) / minimax (seat 1) bound — `bestBidPair`
// above only ever returns ONE canonical (first-found) tie-break per side, which is enough for
// `extractCanonicalLine` but not for E-B's planned "is the search's chosen bid a member of the
// optimal set" membership test, which needs every tied optimum, not one arbitrary
// representative.
// ---------------------------------------------------------------------------------------

/** A bid's canonical string key — `"3"` or `"3*"` — matching the label format already used by
 *  `extractCanonicalLine`'s `detail` strings and by the C36/C57 diagnostic scripts
 *  (`_c36-diagnostic.mts`'s `${row.amount}${row.star ? "*" : ""}`), so a caller comparing an
 *  MCTS-chosen move against `optimalBids()`'s set doesn't need a second ad hoc formatter. */
export type BidMoveKey = string;

export function bidMoveKey(move: { amount: number; star?: boolean }): BidMoveKey {
  return `${move.amount}${move.star ? "*" : ""}`;
}

export interface ExactOracle {
  /** The memoized, seat-0-perspective exact value of ANY reachable state under this oracle's
   *  budget (not only the root) — a plain memo lookup, computing on first access. `state` must
   *  be reachable from the real initial position (budget conservation
   *  `budgets[0] + budgets[1] === 2 * budget` holds for every state this solver ever
   *  constructs); passing a state built from a DIFFERENT total budget silently mixes two
   *  disjoint memo spaces under one key scheme and is a caller error, not something this
   *  function can detect (the same trust `solveBudget` already places in its own callers). */
  exactValue(state: BidTacToeState): number;
  /** The full SET of `seat`'s bids achieving its own bound at a bid-phase `state` — maximin
   *  rows for seat 0 (`max_i min_j`), minimax cols for seat 1 (`min_j max_i`), exactly per the
   *  module doc's saddle-point definition. Ties are the common case (module doc / solve report
   *  §1.2), so this is deliberately a `Set`, not a single canonical pick like `bestBidPair`'s.
   *  Throws if `state.phase.kind !== "bid"` — there is no bid to be optimal about elsewhere. */
  optimalBids(state: BidTacToeState, seat: Seat): ReadonlySet<BidMoveKey>;
}

function optimalBidsAt(solver: SolverState, state: BidTacToeState, seat: Seat): Set<BidMoveKey> {
  if (state.phase.kind !== "bid") {
    throw new Error(
      `createExactOracle().optimalBids: state.phase.kind must be "bid", got "${state.phase.kind}"`
    );
  }
  const { rows, cols, cellValue } = buildBidMatrix(solver, state);
  const EPS = 1e-9;
  const result = new Set<BidMoveKey>();

  if (seat === 0) {
    const rowMins = rows.map((row) => {
      let rowMin = Number.POSITIVE_INFINITY;
      for (const col of cols) rowMin = Math.min(rowMin, cellValue(row, col));
      return rowMin;
    });
    const maximin = Math.max(...rowMins);
    rows.forEach((row, i) => {
      if (Math.abs(rowMins[i]! - maximin) < EPS) result.add(bidMoveKey(row));
    });
  } else {
    const colMaxes = cols.map((col) => {
      let colMax = Number.NEGATIVE_INFINITY;
      for (const row of rows) colMax = Math.max(colMax, cellValue(row, col));
      return colMax;
    });
    const minimax = Math.min(...colMaxes);
    cols.forEach((col, i) => {
      if (Math.abs(colMaxes[i]! - minimax) < EPS) result.add(bidMoveKey(col));
    });
  }
  return result;
}

/** Builds an exact oracle for `budget`, pre-solved from the real initial position
 *  (`initialState(budget, 1)` — seat 1 holds the star, matching `engine.ts`'s actual `setup()`)
 *  so `reachableStates`-worth of memo entries are warm before the first `exactValue`/
 *  `optimalBids` call. Cross-checked (backward-induction.test.ts) against `oracle.ts`'s
 *  independent `solveBudgetBruteForce` at B<=3 and against
 *  `docs/research/games/bid-tac-toe-solve-report.md`'s published canonical numbers — the same
 *  two-source trust structure the original solve used. */
export function createExactOracle(budget: number): ExactOracle {
  if (!Number.isInteger(budget) || budget < 0) {
    throw new RangeError(`createExactOracle: budget must be a non-negative integer, got ${budget}`);
  }
  const solver = newSolverState();
  valueOf(solver, initialState(budget, 1));

  return {
    exactValue(state: BidTacToeState): number {
      return valueOf(solver, state);
    },
    optimalBids(state: BidTacToeState, seat: Seat): ReadonlySet<BidMoveKey> {
      return optimalBidsAt(solver, state, seat);
    },
  };
}

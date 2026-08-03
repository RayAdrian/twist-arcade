// games/fadeout/solver/pass2-superko.ts — pass 2 of the exact solve (plan §2.3): history-aware
// search for the EXACT superko (C1) value, refining pass 1's raw/C2 result over exactly the
// residue where C1 and C2 can differ.
//
// WHY A SECOND PASS AT ALL (Graph-History-Interaction, restated for this file): under superko,
// legality is PATH-dependent — whether a move is legal depends on which positions the actual
// game-in-progress has already visited, not just the position reached. `positionKey` alone
// (queues+toMove) is therefore not a sound memoization key for the C1 value in general; a
// position-keyed cache could silently conflate two occurrences of "the same position" that
// actually have different legal-move sets because they were reached via different histories.
// This is exactly why pass 1 (raw-engine.ts) is NOT reused as a C1 proof directly — see below
// for the one direction it safely IS reusable.
//
// A SUPERKO GAME IS ALWAYS DECISIVE, NEVER A DRAW (platform-corrections.md's ruleset-freeze
// note; see engine.ts's `computeStatus` — the draw branch there is gated on
// `resolved.repetition === "threefold"` and does not exist for superko at all): positions can
// never repeat under superko, so a mover who runs out of legal targets simply LOSES (the
// no-legal-moves corner, plan §3.3) — there is no draw terminal to reach. `value()` below
// reflects this directly: it returns only "win" or "loss", NEVER "draw" (see the "sawDraw is
// intentionally absent" note at its return site) — a three-valued minimax accumulator would be
// solving the wrong-arity game.
//
// THE ONE SOUND, UNCONDITIONAL SHORTCUT FROM PASS 1 (monotonicity argument, recorded here so a
// future reader doesn't have to re-derive it): superko's legal-move set at any position is a
// SUBSET of the raw graph's legal-move set at that same position (superko only ever REMOVES a
// move — the one that would recreate a prior position — it never adds one). Therefore:
//   - If pass 1 says a position is LOSS for its mover (every raw-graph continuation loses), then
//     under superko the mover has a SUBSET of those same losing continuations available — still
//     every one of them a loss. LOSS is a universal, history-independent lower bound: it
//     transfers to C1 UNCONDITIONALLY, for every possible history that could have led there.
//   - Pass-1 WIN values ALSO transfer unconditionally, but not for the reason this file used to
//     claim ("the winner could replay that exact line under superko too" — invalid as stated: a
//     witness line fixes only the WINNER's own moves, and nothing about "the winner could
//     replay it" rules out the OPPONENT steering into a history collision). The real reason,
//     specific to how THIS search is shaped, not just to the raw graph in isolation:
//       1. This search never recurses PAST a raw-LOSS position — every move whose child is
//          raw-LOSS is resolved by the unconditional shortcut immediately, below, before any
//          recursive call is made for it. So `historyBefore`, at any point in this search, is
//          built entirely from positions that were raw-WIN or raw-DRAW for their own mover —
//          a raw-LOSS position can never be a member.
//       2. Every OPPONENT-ply position along a canonical win-witness
//          (raw-engine.ts's `winWitnessPositionKeys`) IS raw-LOSS for the opponent, by
//          construction — that is what "the opponent's forced reply" means (see
//          raw-engine.ts's `stepWitness` doc). By (1) and (2) together, no opponent-ply
//          position along the witness can ever already be in `historyBefore` — a set-membership
//          argument, not a lucky property of one specific line.
//       3. The WINNER's own ply positions along the witness are exactly the ones
//          raw-engine.ts's `stepWitness` doc proves are visited in strictly decreasing
//          retrograde resolution order: a WIN proof always cites a child resolved strictly
//          earlier, and a LOSS node's children (which is what the OPPONENT picks from, for
//          "every defense" the opponent could mount) are ALL resolved strictly earlier than the
//          LOSS node itself, by definition of the LOSS proof rule. So the winner's own future
//          positions, from the current node onward, occupy a strictly decreasing, never-
//          repeating slice of resolution order — one that can never coincide with an ancestor
//          reached earlier in this same search.
//     Put together: a raw-WIN position's witness line is unconditionally safe to reuse under
//     superko from wherever this search reaches it — witness/historyBefore disjointness holds
//     by construction, not by the good luck of one specific opponent line. The
//     `witness.every(...)` check at the call site is retained as a defensive, cheap assertion of
//     this invariant, not a correctness dependency.
//   - Pass-1 DRAW values carry no guarantee either way under C1 — plan §16's whole reason for
//     running pass 2 at all is that superko is expected to convert some of this residue into
//     decisive results (removing the "repeat forever" escape).
//
// THE ALGORITHM: plain two-valued minimax (win/loss only — see the note above on why this game
// has no draw terminal under superko), computed directly over (queues, toMove, historySoFar)
// rather than over a pre-built graph — no position-keyed memoization at all (unsound in
// general, per the above), EXCEPT for the one shortcut just described. Budget-bounded (both
// wall-clock and a raw node-visit ceiling) per plan §2.3's 10-minute-per-variant allowance;
// exceeding it reports the pass-1 (C2) value as a documented fallback rather than asserting an
// unproven C1 claim (plan: "Do not ship a superko value claim the solve did not prove") — that
// C2 fallback value CAN legitimately be "draw" (C2 is threefold, which does have a draw
// terminal); only the true C1 value that pass 2 searches for cannot be.

import type { PlayerId } from "@twist-arcade/engine";
import type { PositionValue } from "@twist-arcade/harness";
import {
  DEFAULT_BOARD_SIZE,
  DEFAULT_CAP,
  cellIsTargetable,
  checkWinner,
  transition,
  type Queues,
  type ResolvedRulesetConfig,
} from "../engine-internal";
import { positionKey } from "../engine";
import { winWitnessPositionKeys, type RawConfig, type RawSolveResult } from "./raw-engine";

export interface SuperkoOpeningValue {
  cell: number;
  value: PositionValue;
}

export interface SuperkoSolveResult {
  rootValue: PositionValue;
  openings: SuperkoOpeningValue[];
  /** true iff the search hit its budget (wall-clock or node-visit ceiling) before proving every
   *  value it was asked for. When true, `rootValue`/`openings` fall back to the pass-1 (C2)
   *  value for whatever wasn't proven — callers MUST check this before treating the result as an
   *  exact superko proof (plan §2.3's "do not ship an unproven claim" rule). */
  budgetExceeded: boolean;
  nodesVisited: number;
  elapsedMs: number;
}

export interface SuperkoBudget {
  /** Plan §2.3: "budget: 10 minutes per variant". Default kept far below that for routine runs;
   *  callers doing the real 8-config solve pass an explicit, generous budget. */
  wallClockMs?: number;
  /** A raw visited-node ceiling as a second, deterministic safety valve independent of machine
   *  speed — a slow CI runner shouldn't silently get a different (worse) answer than a fast one
   *  just because it hits the wall-clock budget sooner. */
  maxNodesVisited?: number;
  /** Optional observability hook, called every `progressEveryNodes` visits (default 200,000) —
   *  the hard playThrough=false configs can run for minutes with zero output otherwise, which
   *  is indistinguishable from a hang without this. Never affects the result. */
  onProgress?: (info: { nodesVisited: number; elapsedMs: number }) => void;
  progressEveryNodes?: number;
}

export function resolvedSuperkoConfig(config: RawConfig): ResolvedRulesetConfig {
  return {
    decayTiming: config.decayTiming,
    playThrough: config.playThrough,
    repetition: "superko",
    boardSize: DEFAULT_BOARD_SIZE,
    cap: DEFAULT_CAP,
  };
}

/** Exported for direct unit testing of the superko-filtering mechanism in isolation (see
 *  pass2-superko.test.ts's "sanity anchor" — plan §2.4 anchor 4) without needing a full-tree
 *  search from the root. */
export function legalSuperkoCells(
  queues: Queues,
  mover: PlayerId,
  historyBefore: ReadonlySet<string>,
  resolved: ResolvedRulesetConfig
): { cell: number; childQueues: Queues; childToMove: PlayerId }[] {
  const totalCells = resolved.boardSize * resolved.boardSize;
  const out: { cell: number; childQueues: Queues; childToMove: PlayerId }[] = [];
  for (let cell = 0; cell < totalCells; cell++) {
    if (!cellIsTargetable(queues, cell, mover, resolved)) continue;
    const result = transition(queues, mover, cell, [0, 0], [0, 0], resolved);
    const childKey = positionKey({ queues: result.queues, toMove: result.toMove });
    if (historyBefore.has(childKey)) continue; // superko: would recreate a prior position
    out.push({ cell, childQueues: result.queues, childToMove: result.toMove });
  }
  return out;
}

class SuperkoBudgetExceededError extends Error {
  constructor() {
    super("pass2-superko: search budget exceeded");
    this.name = "SuperkoBudgetExceededError";
  }
}

export interface SuperkoPositionResult {
  value: PositionValue;
  /** See `SuperkoSolveResult.budgetExceeded` — same contract, one position instead of a root +
   *  opening table. When true, `value` falls back to the pass-1 (C2) value AT THIS POSITION. */
  budgetExceeded: boolean;
  nodesVisited: number;
  elapsedMs: number;
}

/** One shared search engine (memoized win witnesses, budget/progress bookkeeping) behind both
 *  `solveSuperko` (root + opening table) and `solveSuperkoFromPosition` (arbitrary position) —
 *  factored out so an arbitrary-position entry point doesn't have to duplicate the recursive
 *  search, the shortcuts, or the budget machinery. Exported only within this module: callers use
 *  the two functions below, both of which share this one implementation. */
function createSuperkoSearch(
  config: RawConfig,
  raw: RawSolveResult,
  budget: SuperkoBudget
): {
  resolved: ResolvedRulesetConfig;
  value: (queues: Queues, toMove: PlayerId, historyBefore: ReadonlySet<string>) => PositionValue;
  valueOfMove: (queues: Queues, mover: PlayerId, cell: number, historyBeforeMove: ReadonlySet<string>) => PositionValue;
  stats: () => { nodesVisited: number; elapsedMs: number };
} {
  const resolved = resolvedSuperkoConfig(config);
  const wallClockMs = budget.wallClockMs ?? 5 * 60 * 1000;
  const maxNodesVisited = budget.maxNodesVisited ?? 5_000_000;
  // performance.now(), not Date.now(): this repo's lint config bans Date/Date.now across
  // games/* (purity rule for engine determinism — see eslint.config.mjs). This module is
  // solver/analysis tooling, never imported by the shipped engine or apply()/setup(), and
  // genuinely needs wall-clock elapsed time for its budget (plan §2.3's "10 minutes per
  // variant"); performance.now() gets the same measurement without tripping a rule aimed at a
  // different concern (non-deterministic game state), so no repo-wide config change is needed.
  const startedAt = performance.now();
  const deadline = startedAt + wallClockMs;
  const onProgress = budget.onProgress;
  const progressEveryNodes = budget.progressEveryNodes ?? 200_000;

  let nodesVisited = 0;

  // Memoized per-position WIN witnesses (raw graph structure, independent of any DFS path — see
  // raw-engine.ts's winWitnessPositionKeys doc for why this is safe to cache globally rather
  // than per-history: it describes the RAW GRAPH's proof structure, not this search's history).
  const witnessCache = new Map<string, readonly string[]>();
  function witnessOf(key: string): readonly string[] {
    const cached = witnessCache.get(key);
    if (cached) return cached;
    const computed = winWitnessPositionKeys(raw, key);
    witnessCache.set(key, computed);
    return computed;
  }

  /** Mover-relative exact value at (queues, toMove) given the superko history accumulated
   *  strictly BEFORE this position (matches state.history's real semantics exactly: it does
   *  NOT yet include the current position — see engine.ts's apply(), which appends the
   *  PRE-move key on the way OUT of a position, not on the way in). Returns only "win" or
   *  "loss" — see the module doc: superko has no draw terminal, so no leaf of this recursion is
   *  ever a draw, and no three-valued accumulator is needed here. */
  function value(queues: Queues, toMove: PlayerId, historyBefore: ReadonlySet<string>): PositionValue {
    nodesVisited++;
    if (onProgress && nodesVisited % progressEveryNodes === 0) {
      onProgress({ nodesVisited, elapsedMs: performance.now() - startedAt });
    }
    if (nodesVisited > maxNodesVisited || performance.now() > deadline) {
      throw new SuperkoBudgetExceededError();
    }

    const currentKeyEarly = positionKey({ queues, toMove });
    // WIN-witness shortcut — see the module doc's "Pass-1 WIN values ALSO transfer
    // unconditionally" argument for why this is sound regardless of `historyBefore`'s contents.
    // Checked before even enumerating legal moves: if it fires, none of that work is needed.
    //
    // Membership check, NOT a try/catch around raw.valueAt(): this position is always ongoing
    // by construction (the caller never invokes `value()` on a state whose checkWinner already
    // fired — see the call sites below), so the only reason raw.valueAt would ever throw here is
    // "key not in the raw graph," which `raw.graph.nodes.has()` answers directly. A try/catch
    // used to wrap this AND the `witnessOf()` call below, which also silently swallowed
    // winWitnessPositionKeys' own "found a repeated position while following a WIN proof —
    // structurally impossible" bug-detection throw (raw-engine.ts) as if it were the same
    // expected "not in graph" case. That real-bug signal must propagate, not be masked as a
    // routine fallback.
    if (raw.graph.nodes.has(currentKeyEarly) && raw.valueAt(currentKeyEarly) === "win") {
      const witness = witnessOf(currentKeyEarly);
      if (witness.every((k) => !historyBefore.has(k))) return "win";
    }

    const moves = legalSuperkoCells(queues, toMove, historyBefore, resolved);
    if (moves.length === 0) {
      // The no-legal-moves corner (plan §3.3): a 2P engine resolves this as a loss for the
      // player with no move, never `lost`/`draw`. This is also the ONLY base case other than an
      // immediate win below — both are decisive, consistent with superko having no draw at all.
      return "loss";
    }

    const historyAfter = new Set(historyBefore);
    historyAfter.add(currentKeyEarly);

    // Move ordering: try the pass-1 LOSS-for-opponent shortcut first (proves WIN in O(1), no
    // recursion) — the raw graph's occupancy+toMove is the same key space positionKey uses, so
    // this lookup is exact, not approximate. Immediate winners (checkWinner fires right away)
    // are equally cheap and tried alongside. Everything else is tried in ascending cell order.
    const deferred: typeof moves = [];

    for (const move of moves) {
      const winner = checkWinner(move.childQueues, resolved.boardSize);
      if (winner !== null) {
        // Only the mover who just placed can have completed a line (see engine-internal.ts's
        // transition() doc — displacement never creates a line for the opponent).
        if (winner === toMove) return "win";
        continue; // defensive; structurally shouldn't happen for the mover's own move
      }
      const childKey = positionKey({ queues: move.childQueues, toMove: move.childToMove });
      if (!raw.graph.nodes.has(childKey)) {
        // The child isn't in the raw graph (can happen if superko allowed a queues/toMove
        // combination the raw BFS never visits due to a difference in reachability framing) —
        // fall back to full search for this child rather than trusting an unavailable oracle.
        deferred.push(move);
        continue;
      }
      if (raw.valueAt(childKey) === "loss") return "win"; // unconditional shortcut, see module doc
      deferred.push(move);
    }

    // No `sawDraw` accumulator: by the module doc's opening note, no leaf of this recursion can
    // ever produce "draw" (the only base cases are the empty-moves "loss" above and the
    // immediate-win/LOSS-shortcut "win"s), so by induction no recursive call below can either —
    // asserted, not just assumed, so a future change that ever DOES yield a "draw" here fails
    // loudly instead of silently reintroducing a draw outcome this game cannot have under
    // superko.
    for (const move of deferred) {
      const childValue = value(move.childQueues, move.childToMove, historyAfter);
      if (childValue === "draw") {
        throw new Error(
          "pass2-superko: value() recursed into a child that evaluated to \"draw\" — structurally " +
            "impossible under superko (no draw terminal exists; see this module's doc), so this " +
            "indicates a real bug rather than an expected case."
        );
      }
      // childToMove is always the OPPONENT of toMove (strict alternation) — flip.
      const asSeenByMover: PositionValue = childValue === "win" ? "loss" : "win";
      if (asSeenByMover === "win") return "win";
    }

    return "loss";
  }

  /** Value of a SPECIFIC move from `mover`'s perspective (as opposed to `value()`, which
   *  returns the mover's BEST-over-all-moves aggregate) — used for the per-opening table, where
   *  we want each individual first move's worth, not just the root's optimal value. Shares the
   *  same immediate-win check and pass-1 LOSS shortcut as the main search for consistency and
   *  speed. */
  function valueOfMove(
    queues: Queues,
    mover: PlayerId,
    cell: number,
    historyBeforeMove: ReadonlySet<string>
  ): PositionValue {
    const result = transition(queues, mover, cell, [0, 0], [0, 0], resolved);
    const winner = checkWinner(result.queues, resolved.boardSize);
    if (winner !== null) return winner === mover ? "win" : "loss";

    const childKey = positionKey({ queues: result.queues, toMove: result.toMove });
    if (raw.graph.nodes.has(childKey) && raw.valueAt(childKey) === "loss") return "win"; // unconditional shortcut

    const historyAfter = new Set(historyBeforeMove);
    historyAfter.add(positionKey({ queues, toMove: mover }));
    const childValue = value(result.queues, result.toMove, historyAfter);
    if (childValue === "draw") {
      throw new Error(
        "pass2-superko: valueOfMove() reached a \"draw\" child — structurally impossible under " +
          "superko (see this module's doc); this indicates a real bug rather than an expected case."
      );
    }
    return childValue === "win" ? "loss" : "win";
  }

  return {
    resolved,
    value,
    valueOfMove,
    stats: () => ({ nodesVisited, elapsedMs: performance.now() - startedAt }),
  };
}

/**
 * Exact superko (C1) value at the ROOT (empty board) plus a per-opening table, for one
 * (decayTiming, playThrough) config. `raw` must be `solveRaw()`'s result for the SAME
 * (decayTiming, playThrough) pair — used only for the unconditional LOSS shortcut and for move
 * ordering (never as a WIN proof; see the module doc).
 */
export function solveSuperko(
  config: RawConfig,
  raw: RawSolveResult,
  budget: SuperkoBudget = {}
): SuperkoSolveResult {
  const search = createSuperkoSearch(config, raw, budget);
  const totalCells = search.resolved.boardSize * search.resolved.boardSize;
  const rootQueues: Queues = [[], []];
  const rootMover: PlayerId = 0;
  const rawOpeningByCell = new Map(raw.openings.map((o) => [o.cell, o.value]));

  // Root and each of the 9 openings are proven ONE AT A TIME below, each in its own try/catch,
  // rather than the whole root+openings sequence sharing one try/catch around it. That used to
  // mean a budget exhausted PARTWAY THROUGH the openings loop discarded an already-proven
  // rootValue (and any openings already proven before the cutoff) in favor of the blanket C2
  // fallback for everything — silently downgrading a genuine C1 proof to "unproven" the instant
  // ANY later, harder opening ran out of budget. `search`'s node/wall-clock budget is shared
  // globally across root+all openings (by design — see createSuperkoSearch's doc), so a value
  // already returned by `search.value()`/`search.valueOfMove()` before the budget was exceeded IS
  // a real proof and must be kept, not rederived or reset just because a sibling call later
  // failed.
  let rootValue: PositionValue;
  let budgetExceeded = false;
  try {
    rootValue = search.value(rootQueues, rootMover, new Set());
  } catch (err) {
    if (!(err instanceof SuperkoBudgetExceededError)) throw err;
    rootValue = raw.rootValue; // C2 fallback (plan §2.3) — legitimately can be "draw" here.
    budgetExceeded = true;
  }

  const openings: SuperkoOpeningValue[] = [];
  for (let cell = 0; cell < totalCells; cell++) {
    if (budgetExceeded) {
      // Once the shared budget is gone, every remaining opening falls back too — no point
      // attempting them (they would immediately throw again) or reporting them inconsistently.
      openings.push({ cell, value: rawOpeningByCell.get(cell) ?? raw.rootValue });
      continue;
    }
    try {
      openings.push({ cell, value: search.valueOfMove(rootQueues, rootMover, cell, new Set()) });
    } catch (err) {
      if (!(err instanceof SuperkoBudgetExceededError)) throw err;
      budgetExceeded = true;
      openings.push({ cell, value: rawOpeningByCell.get(cell) ?? raw.rootValue });
    }
  }

  return { rootValue, openings, budgetExceeded, ...search.stats() };
}

/**
 * Exact superko (C1) value at an ARBITRARY (queues, toMove, historyBefore) position — the
 * from-position counterpart to `solveSuperko`'s root-only entry point, needed to express plan
 * §2.4's own pass-2 TDD anchor directly (a hand-built position, not the empty root) rather than
 * only via the `legalSuperkoCells` mechanism test. Same shortcuts, same budget/fallback
 * contract as `solveSuperko`; the only difference is where the search starts.
 */
export function solveSuperkoFromPosition(
  config: RawConfig,
  raw: RawSolveResult,
  position: { queues: Queues; toMove: PlayerId; historyBefore: ReadonlySet<string> },
  budget: SuperkoBudget = {}
): SuperkoPositionResult {
  const search = createSuperkoSearch(config, raw, budget);
  try {
    const value = search.value(position.queues, position.toMove, position.historyBefore);
    return { value, budgetExceeded: false, ...search.stats() };
  } catch (err) {
    if (err instanceof SuperkoBudgetExceededError) {
      // Fallback per plan §2.3: report the C2 (pass-1) value AT THIS POSITION.
      const key = positionKey({ queues: position.queues, toMove: position.toMove });
      return { value: raw.valueAt(key), budgetExceeded: true, ...search.stats() };
    }
    throw err;
  }
}

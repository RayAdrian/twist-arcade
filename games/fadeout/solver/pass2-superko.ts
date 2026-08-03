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
// THE ONE SOUND, UNCONDITIONAL SHORTCUT FROM PASS 1 (monotonicity argument, recorded here so a
// future reader doesn't have to re-derive it): superko's legal-move set at any position is a
// SUBSET of the raw graph's legal-move set at that same position (superko only ever REMOVES a
// move — the one that would recreate a prior position — it never adds one). Therefore:
//   - If pass 1 says a position is LOSS for its mover (every raw-graph continuation loses), then
//     under superko the mover has a SUBSET of those same losing continuations available — still
//     every one of them a loss. LOSS is a universal, history-independent lower bound: it
//     transfers to C1 UNCONDITIONALLY, for every possible history that could have led there.
//   - Pass-1 WIN values do NOT transfer unconditionally: retrograde's canonical win-witness for
//     a WIN-labeled raw position is itself repeat-free (a corollary of write-once resolution
//     order — a proof can only cite already-resolved, hence strictly earlier-proven, children,
//     so following "the move that's proven win" can never revisit a position), so the winner
//     COULD replay that exact line under superko too UNLESS it collides with a position from
//     BEFORE this node in the actual game-in-progress (a possibility pass 1, which has no
//     concept of "before this node", cannot rule out). That is the Graph-History-Interaction
//     residue this file exists to resolve by real search.
//   - Pass-1 DRAW values carry no guarantee either way under C1 — plan §16's whole reason for
//     running pass 2 at all is that superko is expected to convert some of this residue into
//     decisive results (removing the "repeat forever" escape).
//
// THE ALGORITHM: plain three-valued minimax, but computed directly over (queues, toMove,
// historySoFar) rather than over a pre-built graph — no position-keyed memoization at all
// (unsound in general, per the above), EXCEPT for the one shortcut just described. Budget-
// bounded (both wall-clock and a raw node-visit ceiling) per plan §2.3's 10-minute-per-variant
// allowance; exceeding it reports the pass-1 (C2) value as a documented fallback rather than
// asserting an unproven C1 claim (plan: "Do not ship a superko value claim the solve did not
// prove").

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
   *  PRE-move key on the way OUT of a position, not on the way in). */
  function value(queues: Queues, toMove: PlayerId, historyBefore: ReadonlySet<string>): PositionValue {
    nodesVisited++;
    if (nodesVisited > maxNodesVisited || performance.now() > deadline) {
      throw new SuperkoBudgetExceededError();
    }

    const currentKeyEarly = positionKey({ queues, toMove });
    // WIN-witness shortcut (plan §2.3: "verifies a cached win's line is disjoint from the
    // current path" — see raw-engine.ts's winWitnessPositionKeys doc and this module's doc for
    // why disjointness against historyBefore is sufficient). Checked before even enumerating
    // legal moves: if it fires, none of that work is needed.
    try {
      if (raw.valueAt(currentKeyEarly) === "win") {
        const witness = witnessOf(currentKeyEarly);
        if (witness.every((k) => !historyBefore.has(k))) return "win";
      }
    } catch {
      // currentKeyEarly not in the raw graph — fall through to full search.
    }

    const moves = legalSuperkoCells(queues, toMove, historyBefore, resolved);
    if (moves.length === 0) {
      // The no-legal-moves corner (plan §3.3): a 2P engine resolves this as a loss for the
      // player with no move, never `lost`/`draw`.
      return "loss";
    }

    const historyAfter = new Set(historyBefore);
    historyAfter.add(currentKeyEarly);

    // Move ordering: try the pass-1 LOSS-for-opponent shortcut first (proves WIN in O(1), no
    // recursion) — the raw graph's occupancy+toMove is the same key space positionKey uses, so
    // this lookup is exact, not approximate. Immediate winners (checkWinner fires right away)
    // are equally cheap and tried alongside. Everything else is tried in ascending cell order.
    let sawDraw = false;
    const deferred: typeof moves = [];

    for (const move of moves) {
      const winner = checkWinner(move.childQueues, resolved.boardSize);
      if (winner !== null) {
        // Only the mover who just placed can have completed a line (see engine-internal.ts's
        // transition() doc — displacement never creates a line for the opponent).
        if (winner === toMove) return "win";
        continue; // defensive; structurally shouldn't happen for the mover's own move
      }
      let rawValue: PositionValue;
      try {
        rawValue = raw.valueAt(positionKey({ queues: move.childQueues, toMove: move.childToMove }));
      } catch {
        // The child isn't in the raw graph (can happen if superko allowed a queues/toMove
        // combination the raw BFS never visits due to a difference in reachability framing) —
        // fall back to full search for this child rather than trusting an unavailable oracle.
        deferred.push(move);
        continue;
      }
      if (rawValue === "loss") return "win"; // unconditional shortcut, see module doc
      deferred.push(move);
    }

    for (const move of deferred) {
      const childValue = value(move.childQueues, move.childToMove, historyAfter);
      // childToMove is always the OPPONENT of toMove (strict alternation) — flip.
      const asSeenByMover: PositionValue = childValue === "draw" ? "draw" : childValue === "win" ? "loss" : "win";
      if (asSeenByMover === "win") return "win";
      if (asSeenByMover === "draw") sawDraw = true;
    }

    return sawDraw ? "draw" : "loss";
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
    try {
      if (raw.valueAt(childKey) === "loss") return "win"; // unconditional shortcut
    } catch {
      // not in the raw graph — fall through to full search
    }

    const historyAfter = new Set(historyBeforeMove);
    historyAfter.add(positionKey({ queues, toMove: mover }));
    const childValue = value(result.queues, result.toMove, historyAfter);
    return childValue === "draw" ? "draw" : childValue === "win" ? "loss" : "win";
  }

  const totalCells = resolved.boardSize * resolved.boardSize;
  const rootQueues: Queues = [[], []];
  const rootMover: PlayerId = 0;

  try {
    const rootValue = value(rootQueues, rootMover, new Set());
    const openings: SuperkoOpeningValue[] = [];
    for (let cell = 0; cell < totalCells; cell++) {
      openings.push({ cell, value: valueOfMove(rootQueues, rootMover, cell, new Set()) });
    }
    return { rootValue, openings, budgetExceeded: false, nodesVisited, elapsedMs: performance.now() - startedAt };
  } catch (err) {
    if (err instanceof SuperkoBudgetExceededError) {
      // Fallback per plan §2.3: report the C2 (pass-1) value rather than an unproven C1 claim.
      const openings: SuperkoOpeningValue[] = raw.openings.map((o) => ({ cell: o.cell, value: o.value }));
      return {
        rootValue: raw.rootValue,
        openings,
        budgetExceeded: true,
        nodesVisited,
        elapsedMs: performance.now() - startedAt,
      };
    }
    throw err;
  }
}

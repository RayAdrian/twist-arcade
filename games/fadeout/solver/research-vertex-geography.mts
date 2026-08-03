// games/fadeout/solver/research-vertex-geography.mts — ONE bounded (10-minute) research probe,
// per the F2 amendments' instruction, into whether a qualitatively different attack converges on
// `remove-first/solid`'s superko (C1) value where the plain pass2-superko.ts search did not
// (§1.5 of the solve report: 62.2M nodes / 8 minutes, unconverged).
//
// NOT a change to the shipped solver — pass2-superko.ts is untouched. This is a throwaway,
// heavily-commented probe script exploring one idea and reporting what it finds, bounded to 10
// minutes of wall clock. If it converges, its result is evidence to report, not a value to ship
// (that would require the same scrutiny pass2-superko.ts already got — mutation-verified shortcut
// proofs, an independent cross-check, etc. — none of which this script attempts).
//
// THE IDEA (two optimizations, both argued sound in this module's history — see
// pass2-superko.ts's module doc item 3 and solve.ts's module doc for the underlying theorems):
//
// 1. UNCONDITIONAL WIN TRANSFER, dropping the witness-disjointness check entirely. The shipped
//    pass2-superko.ts checks `raw.valueAt(key) === "win"` and THEN additionally verifies the
//    witness doesn't collide with `historyBefore` before trusting it — described in that file's
//    own doc as "a defensive, cheap assertion of this invariant, not a correctness dependency"
//    (the invariant being: this search never recurses into a raw-LOSS position, so no witness
//    entry can ever already be in historyBefore). If that's really true, the check can be
//    skipped, and skipping it should matter a great deal here specifically: remove-first/solid's
//    raw graph has ZERO ongoing LOSS positions (solve report §1.5, finding #6 — reconfirmed by
//    this repo's own independent sweep-to-fixpoint solver, raw-engine.test.ts), so the OTHER
//    shortcut (`rawValue === "loss"` on a child, an O(1) resolution) can never fire at all in
//    this config — literally every one of the 38,736 raw-WIN ongoing positions can ONLY be
//    reached (and therefore only ever resolved) via this witness-gated path. Removing the gate
//    turns every one of those 38,736 positions into an instant, zero-recursion leaf the moment
//    the search reaches them, whether directly or as a recursive child. What's left to actually
//    search is exactly the 77,338-node draw residue (0 LOSS + 38,736 WIN + 77,338 residue =
//    116,074 ongoing positions, per the report) — a graph where the only two things that can
//    happen from a residue node are "stay in the residue" or "step onto a WIN leaf" — which is
//    exactly Generalized/Vertex Geography: alternately move a token along edges of a graph,
//    never revisiting a vertex, loser is whoever can't move. That reframing is the "vertex
//    geography on the residue" this probe is named for; it does NOT by itself make the problem
//    easier in general (vertex geography is PSPACE-complete on directed graphs, and Fadeout's
//    transitions are not symmetric), but it does mean this probe's search only ever recurses
//    within a graph roughly 1/3 the size of the residue-plus-frontier the shipped search
//    re-explores every time a witness collision forces a fallback.
//
// 2. ROOT-LEVEL SYMMETRY (sound ONLY at the root, never mid-search): the empty board is
//    symmetric under the 3x3 grid's dihedral group (order 8) — corners {0,2,6,8} are one orbit,
//    edges {1,3,5,7} another, center {4} its own. Superko's history starts EMPTY at the root, and
//    the engine's transitions/win-lines are themselves symmetric under the same group, so P0's
//    opening at any two cells in the same orbit lead to ISOMORPHIC subtrees — solving one
//    representative per orbit (cells 0, 1, 4) and copying its value to the other 6 openings is
//    sound. This is explicitly NOT extended to mid-search position folding: once play has
//    happened, `historyBefore` is orbit-specific (a corner-opening history is not interchangeable
//    with an edge-opening one), so folding symmetric positions together mid-recursion would be
//    unsound (two distinct histories could wrongly be treated as the same superko state).
//
// BUDGET: one hard 10-minute wall-clock cap for the WHOLE probe (all 3 representative openings
// combined), enforced below. If the budget is hit, this script reports "no convergence" and
// stops — no grinding past it.

import type { PlayerId } from "@twist-arcade/engine";
import { positionKey } from "../engine";
import { transition, checkWinner, cellIsTargetable, type Queues, type ResolvedRulesetConfig } from "../engine-internal";
import { solveRaw, type RawSolveResult } from "./raw-engine";

// Overridable via env var ONLY for smoke-testing this script itself during development; the
// actual research run described in the F2 amendments always uses the real 10-minute default.
const TOTAL_BUDGET_MS = Number(process.env.FADEOUT_RESEARCH_BUDGET_MS ?? 10 * 60 * 1000);
const startedAt = performance.now();
function remainingMs(): number {
  return TOTAL_BUDGET_MS - (performance.now() - startedAt);
}

class BudgetExceededError extends Error {}

const config = { decayTiming: "remove-first" as const, playThrough: false };
const resolved: ResolvedRulesetConfig = {
  decayTiming: config.decayTiming,
  playThrough: config.playThrough,
  repetition: "superko",
  boardSize: 3,
  cap: 3,
};

process.stderr.write("Building pass-1 raw graph for remove-first/solid...\n");
const raw: RawSolveResult = solveRaw(config);
process.stderr.write(
  `Raw graph built: ${raw.reachableStates} reachable states, root value ${raw.rootValue} ` +
    `(remaining budget: ${(remainingMs() / 1000).toFixed(0)}s)\n`
);

let nodesVisited = 0;
const deadline = startedAt + TOTAL_BUDGET_MS;

function legalSuperkoCells(
  queues: Queues,
  mover: PlayerId,
  historyBefore: ReadonlySet<string>
): { cell: number; childQueues: Queues; childToMove: PlayerId }[] {
  const out: { cell: number; childQueues: Queues; childToMove: PlayerId }[] = [];
  for (let cell = 0; cell < 9; cell++) {
    if (!cellIsTargetable(queues, cell, mover, resolved)) continue;
    const result = transition(queues, mover, cell, [0, 0], [0, 0], resolved);
    const childKey = positionKey({ queues: result.queues, toMove: result.toMove });
    if (historyBefore.has(childKey)) continue;
    out.push({ cell, childQueues: result.queues, childToMove: result.toMove });
  }
  return out;
}

/** Item 1: same shape as pass2-superko.ts's value(), EXCEPT the WIN-transfer check has no
 *  witness/history-disjointness gate at all — trusted unconditionally, per the theorem this
 *  module's doc restates. Two-valued (win/loss) only, same as the shipped search: superko has no
 *  draw terminal (see pass2-superko.ts's module doc). */
function value(queues: Queues, toMove: PlayerId, historyBefore: ReadonlySet<string>): "win" | "loss" {
  nodesVisited++;
  if (nodesVisited % 500_000 === 0) {
    const elapsedS = ((performance.now() - startedAt) / 1000).toFixed(0);
    process.stderr.write(`  ${nodesVisited} nodes, ${elapsedS}s elapsed\n`);
  }
  if (performance.now() > deadline) throw new BudgetExceededError();

  const currentKey = positionKey({ queues, toMove });
  if (raw.graph.nodes.has(currentKey) && raw.valueAt(currentKey) === "win") {
    return "win"; // UNCONDITIONAL — item 1's whole point; no witness check at all.
  }

  const moves = legalSuperkoCells(queues, toMove, historyBefore);
  if (moves.length === 0) return "loss";

  const historyAfter = new Set(historyBefore);
  historyAfter.add(currentKey);

  for (const move of moves) {
    const winner = checkWinner(move.childQueues, resolved.boardSize);
    if (winner !== null) {
      if (winner === toMove) return "win";
      continue;
    }
    const childValue = value(move.childQueues, move.childToMove, historyAfter);
    if (childValue === "loss") return "win"; // opponent loses there -> we win by moving there
  }
  return "loss";
}

// Item 2: root-level symmetry — solve one representative per orbit only.
const ORBIT_REPRESENTATIVE: Record<number, number> = {
  0: 0, 2: 0, 6: 0, 8: 0, // corners
  1: 1, 3: 1, 5: 1, 7: 1, // edges
  4: 4, // center
};

const rootQueues: Queues = [[], []];
const openingValues = new Map<number, "win" | "loss">();
let converged = true;
let winningCellWithLongLine: number | null = null;

outer: for (const repCell of [0, 1, 4]) {
  const t0 = performance.now();
  process.stderr.write(`\nSolving representative opening cell=${repCell} (remaining budget: ${(remainingMs() / 1000).toFixed(0)}s)...\n`);
  const result = transition(rootQueues, 0, repCell, [0, 0], [0, 0], resolved);
  const winner = checkWinner(result.queues, resolved.boardSize);
  let cellValue: "win" | "loss";
  try {
    if (winner !== null) {
      cellValue = winner === 0 ? "win" : "loss";
    } else {
      const historyAfter = new Set([positionKey({ queues: rootQueues, toMove: 0 })]);
      const childValue = value(result.queues, result.toMove, historyAfter);
      cellValue = childValue === "loss" ? "win" : "loss";
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      process.stderr.write(`  BUDGET EXCEEDED while solving cell=${repCell} — stopping, no convergence.\n`);
      converged = false;
      break outer;
    }
    throw err;
  }
  const elapsedS = ((performance.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`  cell=${repCell} -> ${cellValue} (${elapsedS}s, ${nodesVisited} total nodes so far)\n`);
  for (const [cell, rep] of Object.entries(ORBIT_REPRESENTATIVE)) {
    if (rep === repCell) openingValues.set(Number(cell), cellValue);
  }
  if (cellValue === "win" && repCell === 0) winningCellWithLongLine = repCell; // corners: see report below
}

process.stderr.write(`\nTotal nodes visited across the whole probe: ${nodesVisited}\n`);
process.stderr.write(`Total elapsed: ${((performance.now() - startedAt) / 1000).toFixed(1)}s\n`);

if (!converged) {
  process.stdout.write(JSON.stringify({ converged: false, nodesVisited }, null, 2) + "\n");
} else {
  const rootValue = [...openingValues.values()].some((v) => v === "win") ? "win" : "loss";
  process.stdout.write(
    JSON.stringify(
      {
        converged: true,
        rootValue,
        openings: [...openingValues.entries()].sort((a, b) => a[0] - b[0]),
        nodesVisited,
        winningCellWithLongLine,
      },
      null,
      2
    ) + "\n"
  );
}

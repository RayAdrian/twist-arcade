// games/fadeout/solver/raw-engine.test.ts — TDD anchors for pass 1 of the exact solve
// (docs/plans/fadeout.md §2.4):
//   1. reachability count cross-checked against an INDEPENDENTLY written brute-force enumerator
//   2. a hand-built cyclic mini-position that plain minimax would loop on: retrograde must
//      label it (draw residue) and converge
//   3. a hand-built forced-win-in-3 fork: solver must report "win"
//   4. the free R1 axis-collapse cross-check, at the raw-graph layer itself

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { createFadeoutEngine, positionKey } from "../engine";
import { oracleValue } from "./oracle";
import { createRawEngine, solveRaw, winWitnessMoves, type RawConfig } from "./raw-engine";

function inertTestRng(): Rng {
  return { next: () => 0, int: () => 0, shuffle: <T,>(xs: readonly T[]) => xs.slice() };
}

const ALL_RAW_CONFIGS: RawConfig[] = [
  { decayTiming: "remove-first", playThrough: false },
  { decayTiming: "remove-first", playThrough: true },
  { decayTiming: "place-first", playThrough: false },
  { decayTiming: "place-first", playThrough: true },
];

// ---------------------------------------------------------------------------------------
// Anchor 1: independent brute-force reachability oracle. Deliberately reimplemented from
// scratch (own BFS, own key format) rather than reusing positionKeyOf/stableStringify, so an
// off-by-one shared between raw-engine.ts and engine-internal.ts can't hide from this count.
// ---------------------------------------------------------------------------------------

function bruteForceCellIsTargetable(
  queues: readonly [readonly number[], readonly number[]],
  cell: number,
  mover: 0 | 1,
  decayTiming: "remove-first" | "place-first",
  playThrough: boolean
): boolean {
  const owner: 0 | 1 | null = queues[0].includes(cell) ? 0 : queues[1].includes(cell) ? 1 : null;
  if (owner === null) return true;
  if (decayTiming === "remove-first" && owner === mover && queues[mover].length === 3 && queues[mover][0] === cell) {
    return true;
  }
  if (playThrough && queues[owner].length === 3 && queues[owner][0] === cell) return true;
  return false;
}

function bruteForceWinner(queues: readonly [readonly number[], readonly number[]]): 0 | 1 | null {
  const LINES: [number, number, number][] = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  const board: (0 | 1 | null)[] = new Array(9).fill(null);
  for (const c of queues[0]) board[c] = 0;
  for (const c of queues[1]) board[c] = 1;
  for (const [a, b, c] of LINES) {
    const va = board[a];
    if (va !== null && va !== undefined && va === board[b] && va === board[c]) return va;
  }
  return null;
}

/** Independently-written BFS reachability count (own transition logic, own key format). */
function bruteForceReachableCount(config: RawConfig): number {
  type S = { queues: [number[], number[]]; toMove: 0 | 1 };
  const keyOf = (s: S): string => `${JSON.stringify(s.queues[0])}|${JSON.stringify(s.queues[1])}|${s.toMove}`;
  const start: S = { queues: [[], []], toMove: 0 };
  const seen = new Map<string, S>();
  seen.set(keyOf(start), start);
  const queue: S[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i]!;
    if (bruteForceWinner(s.queues) !== null) continue; // terminal: no outgoing edges
    const mover = s.toMove;
    for (let cell = 0; cell < 9; cell++) {
      if (!bruteForceCellIsTargetable(s.queues, cell, mover, config.decayTiming, config.playThrough)) continue;
      // Re-derive the transition independently (own overflow/displacement logic).
      const opponent: 0 | 1 = mover === 0 ? 1 : 0;
      let q0 = s.queues[0].slice();
      let q1 = s.queues[1].slice();
      const qOf = (p: 0 | 1) => (p === 0 ? q0 : q1);
      const setQ = (p: 0 | 1, v: number[]) => {
        if (p === 0) q0 = v;
        else q1 = v;
      };
      if (config.playThrough) {
        const oppQ = qOf(opponent);
        if (oppQ.length === 3 && oppQ[0] === cell) setQ(opponent, oppQ.slice(1));
      }
      // willOverflow must be captured from the PRE-place queue length (matching the real
      // transition()'s semantics exactly) — checking AFTER place() would see length+1 and never
      // fire for place-first, silently disabling decay and exploding this "independent" count
      // into plain unbounded tic-tac-toe (caught by this test: this exact bug produced 6634
      // instead of the correct ~1.4x10^5 for place-first configs on the first run).
      const willOverflow = qOf(mover).length === 3;
      const place = () => setQ(mover, [...qOf(mover), cell]);
      const overflow = () => {
        if (willOverflow) setQ(mover, qOf(mover).slice(1));
      };
      if (config.decayTiming === "remove-first") {
        overflow();
        place();
      } else {
        place();
        overflow();
      }
      const next: S = { queues: [q0, q1], toMove: opponent };
      const k = keyOf(next);
      if (!seen.has(k)) {
        seen.set(k, next);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

describe("solveRaw() — reachability cross-checked against an independent brute-force oracle", () => {
  it.each(ALL_RAW_CONFIGS)(
    "reachable state count matches the independent enumerator for %o",
    (config) => {
      const own = solveRaw(config).reachableStates;
      const oracle = bruteForceReachableCount(config);
      expect(own).toBe(oracle);
    }
  );
});

// ---------------------------------------------------------------------------------------
// Anchor 2: hand-built cyclic mini-position — a full-cap rotation cycle. Plain minimax (no
// cycle handling) would loop forever chasing it; retrograde must converge and label the
// residue as "draw". Reuses the exact rotation mechanics engine.test.ts already hand-verified
// recreate an earlier full position after 6 self-rotations.
// ---------------------------------------------------------------------------------------

describe("solveRaw() — hand-built cyclic mini-position converges (never loops, residue = draw)", () => {
  it("a full-cap pure-rotation position (both sides rotating their own oldest mark forever) is a draw residue", () => {
    const config: RawConfig = { decayTiming: "remove-first", playThrough: false };
    const raw = solveRaw(config);
    // Both sides at cap, occupying disjoint non-winning cells: {0,1,3} for P0, {2,5,7} for P1
    // (same cell sets engine.test.ts's buildToCap() uses — hand-verified there to be win-free).
    // Self-rotation (each mover replacing their own oldest with the SAME cell) leaves occupancy
    // fixed forever: a genuine, provable cycle in the raw graph.
    const startQueues: [readonly number[], readonly number[]] = [[0, 1, 3], [2, 5, 7]];

    // Re-derive the exact positionKey via the real (public) engine's exported positionKey(),
    // matching how raw-engine.ts itself keys the graph.
    const key = positionKey({ queues: startQueues, toMove: 0 });

    expect(raw.valueAt(key)).toBe("draw");

    // Confirm the graph really does contain a cycle back to this exact position (not merely
    // "unresolved because the BFS never got there again" — the corridor fixture in
    // packages/harness/test/solver/retrograde.test.ts pins the analogous check the same way).
    let cursor = raw.graph.nodes.get(key)!;
    let sawCycle = false;
    for (let step = 0; step < 8; step++) {
      // Each self-rotation move: mover targets their own current oldest cell.
      const mover = cursor.mover!;
      const ownQueue = mover === 0 ? cursor.state.queues[0] : cursor.state.queues[1];
      const selfCell = ownQueue[0]!;
      const edge = cursor.moves.find((m) => (m.move as { cell: number }).cell === selfCell)!;
      if (edge.toHash === key) {
        sawCycle = true;
        break;
      }
      cursor = raw.graph.nodes.get(edge.toHash)!;
    }
    expect(sawCycle).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Anchor 3: hand-built forced win, cross-checked by the independent oracle.
//
// HONEST NOTE ON HOW THIS FIXTURE CHANGED SHAPE (kept because the discovery generalizes,
// per CLAUDE.md §3 — never silently smooth over what a red run actually found): the first
// attempt at this anchor tried to hand-build a classic TTT double-threat FORK (P0 corners
// {0,8}, a 3rd mark creating two simultaneous one-away threats, forced-win-in-3). That
// attempt was wrong twice over, both caught by actually running it rather than trusting the
// hand derivation:
//
//   1. {0,8} alone already shares the diagonal line [0,4,8] — cell 4 is an IMMEDIATE win, so
//      the position wasn't a "requires anticipation" fixture at all; it resolved in one ply.
//   2. Worse, a genuine fork in THIS ruleset is structurally suspect: completing a fork is
//      always the forker's 4th placement (a fork needs 3 marks in place to hold 2 threats,
//      so completing either is necessarily over cap) — which decays the forker's OLDEST mark.
//      If that oldest mark happens to be PART OF the line being completed (as with 0 in
//      0-4-8 when P0's queue is [0,8,2] and the oldest is 0), completing it evicts the very
//      cell the line needs, and the "threat" was illusory the whole time. Decay timing
//      cannot save it: engine-internal.ts's transition() runs the win-check on the fully
//      quiescent post-removal board (the plan's explicit A2 sub-rule), and the evicted cell
//      is always the queue's oldest regardless of which cell the new mark targets (decayTiming
//      only reorders EFFECTS, not which cell is evicted — see engine-internal.ts's AXIS
//      COLLAPSE note). A double threat where one arm reuses the mover's own oldest mark is
//      therefore not reliably a fork in Fadeout — worth carrying into the solve report as a
//      genuine, unanticipated ruleset property (naive-TTT forks can be self-defeating here).
//
// Given that, this anchor uses the fixture that actually IS clean: P0 at corners {0, 8}
// (which, per the point above, is an immediate win via cell 4, not a multi-ply fork) —
// still a legitimate "hand-built forced win, solver says win, independent oracle agrees"
// TDD anchor, just an in-1 rather than an in-3. It also still exercises real machinery: the
// oracle must actually evaluate ALL of P0's other legal replies too (this is the exact
// position where the oracle's win-first move-ordering fix — see oracle.ts's module doc — was
// discovered to matter, since deeper alternatives at this same board reach cap and expose a
// genuinely slow, un-memoized cyclic subtree if explored first).
// ---------------------------------------------------------------------------------------

describe("solveRaw() — hand-built forced win, cross-checked by the independent oracle", () => {
  it.each(ALL_RAW_CONFIGS)("reports 'win' for %o at a position with an immediate diagonal threat", (config) => {
    const raw = solveRaw(config);
    const preWin = { queues: [[0, 8], [1, 3]] as [readonly number[], readonly number[]], toMove: 0 as const };
    const key = positionKey(preWin);

    expect(raw.valueAt(key)).toBe("win");

    // Cross-check with the independent oracle over the REAL public engine (superko config —
    // this line never revisits a position, so the repetition rule choice cannot matter here).
    const realEngine = createFadeoutEngine({ decayTiming: config.decayTiming, playThrough: config.playThrough, repetition: "superko" });
    const fullState = {
      queues: preWin.queues,
      toMove: preWin.toMove,
      history: [],
      faded: [0, 0] as [number, number],
      longestLife: [0, 0] as [number, number],
      lastEffects: [],
    };
    expect(oracleValue(realEngine, fullState, { maxPlies: 10 })).toBe("win");
  });

  it("the win is immediate (1 ply): P0 completing 0-4-8 via cell 4 directly", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: false, repetition: "superko" });
    const preWin = {
      queues: [[0, 8], [1, 3]] as [readonly number[], readonly number[]],
      toMove: 0 as const,
      history: [],
      faded: [0, 0] as [number, number],
      longestLife: [0, 0] as [number, number],
      lastEffects: [],
    };
    expect(engine.status(preWin).kind).toBe("ongoing");
    const afterWin = engine.apply(preWin, new Map([[0, { cell: 4 }]]), inertTestRng());
    expect(engine.status(afterWin)).toEqual({ kind: "won", winner: 0 });
  });
});

// ---------------------------------------------------------------------------------------
// Anchor 4: the free R1 axis-collapse cross-check, at the raw-graph layer. Under playThrough,
// decayTiming is provably a no-op (engine-internal.ts's AXIS COLLAPSE doc comment) — the raw
// solver MUST report identical root value, opening table, and reachable-state count for both
// decayTiming arms. A divergence here means the SOLVER is broken, not that these are different
// games (the plan explicitly calls this out as a free correctness check, §16).
// ---------------------------------------------------------------------------------------

describe("solveRaw() — R1 axis collapse: identical values for both decayTiming arms under playThrough", () => {
  it("remove-first vs place-first, playThrough=true: identical reachable count, root value, and opening table", () => {
    const a1 = solveRaw({ decayTiming: "remove-first", playThrough: true });
    const a2 = solveRaw({ decayTiming: "place-first", playThrough: true });
    expect(a1.reachableStates).toBe(a2.reachableStates);
    expect(a1.rootValue).toBe(a2.rootValue);
    expect(a1.openings).toEqual(a2.openings);
  });
});

describe("createRawEngine() — basic shape", () => {
  it("setup() starts empty, P0 to move", () => {
    const engine = createRawEngine({ decayTiming: "remove-first", playThrough: false });
    const state = engine.setup(2, inertTestRng());
    expect(state.queues).toEqual([[], []]);
    expect(state.toMove).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// winWitnessMoves() — extraction-logic anchor. A first version of stepWitness() assumed
// EVERY node along a win witness must itself be "win" for whoever's mover there, which is
// wrong (the opponent's forced replies are LOSS nodes for the opponent) and threw as soon as
// the walk reached one. Caught here by actually replaying the extracted line through the REAL
// engine end-to-end and checking it reaches a genuine win, legally, at every step — not by
// re-inspecting the code.
// ---------------------------------------------------------------------------------------

describe("winWitnessMoves() — extracted forced-win lines replay legally to a real win", () => {
  it.each(ALL_RAW_CONFIGS)("for %o, if root is WIN the extracted line replays to a real win under BOTH repetition rules", (config) => {
    const raw = solveRaw(config);
    if (raw.rootValue !== "win") return; // nothing to extract; covered by the config-specific case below

    const rootKey = positionKey({ queues: [[], []], toMove: 0 });
    const cells = winWitnessMoves(raw, rootKey);
    expect(cells.length).toBeGreaterThan(0);

    for (const repetition of ["superko", "threefold"] as const) {
      const engine = createFadeoutEngine({ decayTiming: config.decayTiming, playThrough: config.playThrough, repetition });
      let state = engine.setup(2, inertTestRng());
      for (const cell of cells) {
        expect(engine.status(state).kind).toBe("ongoing");
        expect(engine.isLegal(state, state.toMove, { cell })).toBe(true);
        state = engine.apply(state, new Map([[state.toMove, { cell }]]), inertTestRng());
      }
      expect(engine.status(state)).toEqual({ kind: "won", winner: 0 });
    }
  });

  it("place-first/solid is a concrete case where the root IS a win, worth pinning by name", () => {
    // Confirms the it.each above isn't vacuously skipping every config — this specific config's
    // root is "win" per the earlier anchor tests (see the raw openings table in the solve
    // report), so this test actually exercises the extraction, not just the fixture set-up.
    const config: RawConfig = { decayTiming: "place-first", playThrough: false };
    expect(solveRaw(config).rootValue).toBe("win");
  });
});

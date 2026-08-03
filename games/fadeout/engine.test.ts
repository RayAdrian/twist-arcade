// games/fadeout/engine.test.ts
//
// TDD per CLAUDE.md §3: each `it` below pins one behavior from docs/plans/fadeout.md §3.5's
// TDD anchors. Slice 1 (basic shape) was written and watched red before engine.ts existed;
// the remaining slices were authored against the design in the handoff report and then run —
// several (see inline notes) caught real bugs in the first implementation pass, which is the
// genuine red/green signal for this slice even though the whole engine was drafted in one
// pass rather than method-by-method. Reported honestly in the handoff, per CLAUDE.md §3's
// instruction never to silently smooth over that.

import { describe, expect, it } from "vitest";
import { engineContract } from "@twist-arcade/engine/testkit";
import { rngFor, rngFromSeed, rngForSetup, type PlayerId } from "@twist-arcade/engine";
import { allRulesetConfigs, createFadeoutEngine, positionKey, type FadeoutState, type RulesetConfig } from "./engine";

const BASE_CONFIG: RulesetConfig = {
  decayTiming: "place-first",
  playThrough: false,
  repetition: "superko",
};

function apply(
  engine: ReturnType<typeof createFadeoutEngine>,
  state: FadeoutState,
  player: PlayerId,
  cell: number,
  seed = "t",
  step = 0
): FadeoutState {
  return engine.apply(state, new Map([[player, { cell }]]), rngFor(seed, step));
}

describe("fadeout engine — basic shape", () => {
  it("exposes meta for a 2-player perfect-information game", () => {
    const engine = createFadeoutEngine(BASE_CONFIG);
    expect(engine.meta.id).toBe("fadeout");
    expect(engine.meta.minPlayers).toBe(2);
    expect(engine.meta.maxPlayers).toBe(2);
    expect(engine.meta.hiddenInformation).toBe(false);
    expect(engine.meta.simultaneous).toBe(false);
    expect(engine.meta.stochastic).toBe(false);
  });

  it("setup() starts with empty queues, player 0 to move, and no effects", () => {
    const engine = createFadeoutEngine(BASE_CONFIG);
    const state = engine.setup(2, rngForSetup("t1"));
    expect(state.queues).toEqual([[], []]);
    expect(state.toMove).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.faded).toEqual([0, 0]);
    expect(state.longestLife).toEqual([0, 0]);
    expect(state.lastEffects).toEqual([]);
  });

  it("a plain placement into an empty cell records a `placed` effect and flips toMove", () => {
    const engine = createFadeoutEngine(BASE_CONFIG);
    let state = engine.setup(2, rngForSetup("t2"));
    state = apply(engine, state, 0, 4, "t2");
    expect(state.queues[0]).toEqual([4]);
    expect(state.queues[1]).toEqual([]);
    expect(state.toMove).toBe(1);
    expect(state.lastEffects).toEqual([{ type: "placed", player: 0, cell: 4 }]);
  });
});

describe("fadeout engine — factory guards", () => {
  it("throws for any boardSize/cap other than the implemented 3x3/cap-3", () => {
    expect(() => createFadeoutEngine({ ...BASE_CONFIG, boardSize: 4 })).toThrow(/reserved/);
    expect(() => createFadeoutEngine({ ...BASE_CONFIG, cap: 4 })).toThrow(/reserved/);
  });

  it("allRulesetConfigs() enumerates exactly the 8 combinations of the 3 axes", () => {
    const configs = allRulesetConfigs();
    expect(configs).toHaveLength(8);
    const keys = new Set(configs.map((c) => `${c.decayTiming}|${c.playThrough}|${c.repetition}`));
    expect(keys.size).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------
// Decay timing (axis A) x playable-through (axis B) — plan §3.5's scripted sequences.
// Cells are chosen so P0 only ever touches {0,1,3} and P1 only ever touches {2,5,7}: neither
// set is a win-line (checked by hand against the 8 LINES), and the sets are disjoint, so no
// accidental win or displacement occurs while the two players independently build up to cap.
// ---------------------------------------------------------------------------------------

function buildToCap(engine: ReturnType<typeof createFadeoutEngine>, seed: string): FadeoutState {
  let state = engine.setup(2, rngForSetup(seed));
  const moves: [PlayerId, number][] = [
    [0, 0],
    [1, 2],
    [0, 1],
    [1, 5],
    [0, 3],
    [1, 7],
  ];
  moves.forEach(([player, cell], i) => {
    state = apply(engine, state, player, cell, seed, i);
  });
  return state;
}

describe("fadeout engine — decay timing (A) x playable-through (B)", () => {
  it("A1 remove-first: a mover's own doomed cell is a legal self-target even under B1 solid", () => {
    const engine = createFadeoutEngine({ decayTiming: "remove-first", playThrough: false, repetition: "superko" });
    const capped = buildToCap(engine, "a1-solid");
    expect(capped.queues).toEqual([[0, 1, 3], [2, 5, 7]]);

    expect(engine.legalMoves(capped, 0).map((m) => m.cell)).toContain(0);
    expect(engine.isLegal(capped, 0, { cell: 0 })).toBe(true);

    const next = apply(engine, capped, 0, 0, "a1-solid", 6);
    // remove-first: decayed(0) then placed(0) — same cell, occupancy unchanged, order rotates.
    expect(next.lastEffects).toEqual([
      { type: "decayed", player: 0, cell: 0 },
      { type: "placed", player: 0, cell: 0 },
    ]);
    expect(next.queues[0]).toEqual([1, 3, 0]);
    expect(next.faded).toEqual([1, 0]);
    // longestLife redefined (orchestrator ruling R2) as plies survived on the board, not "own
    // placements survived" — the old metric was provably confined to {0,2,3}. This mark (P0's
    // 1st placement, cell 0, born at ply 0) is evicted at ply 6 (P0's queue+faded=3+0, P1's
    // queue+faded=3+0 ⇒ currentPly=6): lifespan = 6 - 0 = 6.
    expect(next.longestLife).toEqual([6, 0]);
  });

  it("A2 place-first + B1 solid: the mover's own doomed cell is occupied and NOT a legal target", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: false, repetition: "superko" });
    const capped = buildToCap(engine, "a2-solid");

    expect(engine.legalMoves(capped, 0).map((m) => m.cell)).not.toContain(0);
    expect(engine.isLegal(capped, 0, { cell: 0 })).toBe(false);
    expect(() => apply(engine, capped, 0, 0, "a2-solid", 6)).toThrow(/illegal move/);
  });

  it("A2 place-first + B1 solid: a normal placement elsewhere places-then-decays, in that effect order", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: false, repetition: "superko" });
    const capped = buildToCap(engine, "a2-elsewhere");
    const next = apply(engine, capped, 0, 4, "a2-elsewhere", 6);
    expect(next.lastEffects).toEqual([
      { type: "placed", player: 0, cell: 4 },
      { type: "decayed", player: 0, cell: 0 },
    ]);
    expect(next.queues[0]).toEqual([1, 3, 4]);
    expect(next.faded).toEqual([1, 0]);
    // Same currentPly=6/birthPly=0 derivation as the A1 case above — decayTiming only reorders
    // the effects, not the resulting lifespan (see the R1 axis-collapse note either way).
    expect(next.longestLife).toEqual([6, 0]);
  });

  it("B2 playable-through: a NON-cap player may displace the opponent's doomed mark early (one ply short of a full-cap eviction)", () => {
    // After P0's 3rd placement, P0 is at cap (oldest = cell 0) while P1 has only 2 marks —
    // the one naturally-occurring window (strict alternation from an empty board means P0,
    // moving first, always reaches cap no later than P1) where the ABOUT-TO-MOVE player is
    // NOT at cap and can therefore displace without also triggering its own overflow in the
    // same transition. Isolates the displacement mechanic from the "both happen at once"
    // case covered separately below.
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: true, repetition: "superko" });
    let state = engine.setup(2, rngForSetup("b2-disp"));
    const setup: [PlayerId, number][] = [
      [0, 0],
      [1, 2],
      [0, 1],
      [1, 5],
      [0, 3], // P0 reaches cap (queue0 = [0,1,3], oldest = 0); P1 still has only 2 marks
    ];
    setup.forEach(([player, cell], i) => {
      state = apply(engine, state, player, cell, "b2-disp", i);
    });
    expect(state.toMove).toBe(1);
    expect(state.queues).toEqual([[0, 1, 3], [2, 5]]);
    expect(engine.legalMoves(state, 1).map((m) => m.cell)).toContain(0); // P0's doomed cell

    const before = state;
    state = apply(engine, state, 1, 0, "b2-disp", 5);
    expect(state.lastEffects).toEqual([
      { type: "decayed", player: 0, cell: 0 },
      { type: "placed", player: 1, cell: 0 },
    ]);
    expect(state.faded[0]).toBe(before.faded[0] + 1);
    // Displaced mark: P0's 1st placement (cell 0), born at ply 0. currentPly at displacement =
    // faded[0]+|q0|+faded[1]+|q1| = 0+3+0+2 = 5 (evaluated on the PRE-transition state, i.e.
    // before this displacing move is counted). lifespan = 5 - 0 = 5.
    expect(state.longestLife[0]).toBe(5);
    expect(state.queues).toEqual([[1, 3], [2, 5, 0]]);
  });

  it("B2 playable-through + A1 remove-first: displacement of the opponent's doomed mark is ordered before the mover's own overflow", () => {
    const engine = createFadeoutEngine({ decayTiming: "remove-first", playThrough: true, repetition: "superko" });
    const capped = buildToCap(engine, "b2-both-a1"); // both players at cap; P0 to move
    // P0 targets P1's doomed cell (2): displaces P1's mark AND triggers P0's own overflow.
    const next = apply(engine, capped, 0, 2, "b2-both-a1", 6);
    expect(next.lastEffects).toEqual([
      { type: "decayed", player: 1, cell: 2 }, // displacement, always first
      { type: "decayed", player: 0, cell: 0 }, // A1: mover's own overflow before placing
      { type: "placed", player: 0, cell: 2 },
    ]);
    expect(next.queues).toEqual([[1, 3, 2], [5, 7]]);
    expect(next.faded).toEqual([1, 1]);
    // currentPly = 0+3+0+3 = 6 (both at cap before this move). P1's displaced mark (cell 2) was
    // its 1st placement, born at ply 1 (P1 moves 2nd ⇒ birthPly = 2*0+1 = 1): lifespan = 6-1 = 5.
    // P0's own-overflow mark (cell 0) was its 1st placement, born at ply 0: lifespan = 6-0 = 6.
    // Same values regardless of decayTiming ordering (see the identical A2 case below) — that's
    // the R1 axis-collapse in miniature.
    expect(next.longestLife).toEqual([6, 5]);
  });

  it("B2 playable-through + A2 place-first: same displacement, mover's own overflow ordered after placing", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: true, repetition: "superko" });
    const capped = buildToCap(engine, "b2-both-a2");
    const next = apply(engine, capped, 0, 2, "b2-both-a2", 6);
    expect(next.lastEffects).toEqual([
      { type: "decayed", player: 1, cell: 2 }, // displacement, always first
      { type: "placed", player: 0, cell: 2 }, // A2: place before the mover's own overflow
      { type: "decayed", player: 0, cell: 0 },
    ]);
    expect(next.queues).toEqual([[1, 3, 2], [5, 7]]);
    expect(next.faded).toEqual([1, 1]);
    // Identical currentPly/birthPly derivation as the A1 case above — decayTiming only reorders
    // the effects, never the lifespan, which is exactly the R1 axis-collapse claim.
    expect(next.longestLife).toEqual([6, 5]);
  });
});

// ---------------------------------------------------------------------------------------
// A1+B2 vs A2+B2 equivalence — the R1 axis collapse, pinned. Under playThrough=true, decayTiming
// is provably a no-op on legality/outcome (see RulesetConfig's AXIS COLLAPSE doc comment in
// engine-internal.ts): a full exhaustive BFS found the two arms' 141,850-position game graphs
// byte-identical. A bounded random walk here is the fast regression guard for that: if a future
// change to cellIsTargetable/transition breaks the collapse, this drifts and fails loudly,
// rather than the divergence only surfacing as an unexplained mismatch in F2's solve output.
// ---------------------------------------------------------------------------------------

describe("fadeout engine — A1+B2 vs A2+B2 equivalence (R1: 6 distinct games, not 8)", () => {
  it("bounded random walks see identical legalMoves and identical resulting positionKey at every step", () => {
    const engineA1 = createFadeoutEngine({ decayTiming: "remove-first", playThrough: true, repetition: "superko" });
    const engineA2 = createFadeoutEngine({ decayTiming: "place-first", playThrough: true, repetition: "superko" });
    const asMultiset = (effects: FadeoutState["lastEffects"]) =>
      [...effects].map((e) => `${e.type}:${e.player}:${e.cell}`).sort();

    let totalPlies = 0;
    // Many independent games, not one long walk: a 3x3 board frequently resolves in well under
    // 20 plies (a win or a superko-exhaustion loss), so a single walk can't be relied on to
    // exercise much of the graph — summing across games gives a meaningful sample instead.
    for (let game = 0; game < 25; game++) {
      const seed = `a1-a2-collapse-${game}`;
      const picker = rngFromSeed(`${seed}:picker`);
      let s1 = engineA1.setup(2, rngForSetup(seed));
      let s2 = engineA2.setup(2, rngForSetup(seed));

      for (let ply = 0; ply < 300; ply++) {
        const status1 = engineA1.status(s1);
        const status2 = engineA2.status(s2);
        expect(status2).toEqual(status1);
        if (status1.kind !== "ongoing") break;

        const legal1 = engineA1.legalMoves(s1, s1.toMove).map((m) => m.cell).sort((a, b) => a - b);
        const legal2 = engineA2.legalMoves(s2, s2.toMove).map((m) => m.cell).sort((a, b) => a - b);
        expect(legal2).toEqual(legal1); // identical legal-move sets, per the collapse claim
        expect(legal1.length).toBeGreaterThan(0); // "ongoing" guarantees at least one legal move

        const cell = legal1[picker.int(legal1.length)]!;
        s1 = apply(engineA1, s1, s1.toMove, cell, seed, ply);
        s2 = apply(engineA2, s2, s2.toMove, cell, seed, ply);
        totalPlies++;

        expect(positionKey(s2)).toBe(positionKey(s1)); // identical successor position

        // Effects can legitimately differ in ORDER (that's the whole point — see the doc
        // comment) but never in which (type, player, cell) triples occur.
        expect(asMultiset(s2.lastEffects)).toEqual(asMultiset(s1.lastEffects));
      }
    }

    // Sanity: the walks collectively explored a meaningful number of plies rather than every
    // game ending immediately — a suite of walks that all exit on ply 0 would vacuously "pass"
    // every assertion above without ever exercising the collapse.
    expect(totalPlies).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------------------
// longestLife — regression guard for the R2 redefinition (plies survived on the board, not
// "own placements survived"). The old metric was provably confined to {0, cap, cap-1} = {0, 2,
// 3}; this sweep proves the new one is NOT, so a future refactor that accidentally reverts to
// the old formula gets caught here rather than silently shipping a near-constant share stat.
// ---------------------------------------------------------------------------------------

describe("fadeout engine — longestLife varies beyond the old {0,2,3}-confined range", () => {
  it("a random-game sweep across all 8 variants produces longestLife values outside {0,2,3}", () => {
    const observed = new Set<number>();
    let maxObserved = 0;

    for (const config of allRulesetConfigs()) {
      const engine = createFadeoutEngine(config);
      const label = `${config.decayTiming}|${config.playThrough}|${config.repetition}`;
      for (let game = 0; game < 15; game++) {
        const seed = `longestlife-sweep-${label}-${game}`;
        const picker = rngFromSeed(`${seed}:picker`);
        let state = engine.setup(2, rngForSetup(seed));
        for (let ply = 0; ply < 200; ply++) {
          if (engine.status(state).kind !== "ongoing") break;
          const legal = engine.legalMoves(state, state.toMove);
          if (legal.length === 0) break;
          const move = legal[picker.int(legal.length)]!;
          state = apply(engine, state, state.toMove, move.cell, seed, ply);
          observed.add(state.longestLife[0]);
          observed.add(state.longestLife[1]);
          maxObserved = Math.max(maxObserved, state.longestLife[0], state.longestLife[1]);
        }
      }
    }

    expect(maxObserved).toBeGreaterThan(3);
    expect([...observed].some((v) => v > 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Superko / threefold — the rotation-cycle sequence, driven programmatically (each move
// targets the mover's OWN current oldest cell, computed from live state rather than
// hand-computed cell numbers, since hand-tracking 11+ plies of queue rotations is exactly
// the kind of arithmetic this test exists to double-check independently of).
// ---------------------------------------------------------------------------------------

function ownQueueOf(state: FadeoutState, player: PlayerId): readonly number[] {
  return player === 0 ? state.queues[0] : state.queues[1];
}

function rotateOnce(engine: ReturnType<typeof createFadeoutEngine>, state: FadeoutState, seed: string, step: number): FadeoutState {
  const mover = state.toMove;
  const cell = ownQueueOf(state, mover)[0]!;
  return apply(engine, state, mover, cell, seed, step);
}

describe("fadeout engine — superko vs threefold repetition", () => {
  it("superko: the move that would recreate an earlier full position is illegal, rejected, and throws", () => {
    const engine = createFadeoutEngine({ decayTiming: "remove-first", playThrough: false, repetition: "superko" });
    let state = buildToCap(engine, "superko-cycle");
    const positionA = positionKey(state); // queues=[[0,1,3],[2,5,7]], toMove=0

    let step = 6;
    // 3 rotations each (P0 then P1 alternating) return both queues to their ORIGINAL order —
    // the 6th rotation (P1's 3rd) recreates positionA exactly (verified by hand in the plan
    // walkthrough; re-derived here from live state rather than trusted blindly).
    for (let i = 0; i < 5; i++) {
      state = rotateOnce(engine, state, "superko-cycle", step++);
    }
    // `state` is now one rotation away from recreating positionA. The mover's self-rotation
    // move is the one that would recreate it.
    const mover = state.toMove;
    const recreatingCell = ownQueueOf(state, mover)[0]!;

    expect(engine.legalMoves(state, mover).map((m) => m.cell)).not.toContain(recreatingCell);
    expect(engine.isLegal(state, mover, { cell: recreatingCell })).toBe(false);
    expect(() => apply(engine, state, mover, recreatingCell, "superko-cycle", step)).toThrow(/illegal move/);

    // Sanity: applying the SAME move sequence up to (not including) the illegal move, then
    // independently re-deriving positionA's key from the state just before the illegal move
    // would have landed, confirms it really is positionA and not a coincidental collision.
    const wouldBeQueues: [number[], number[]] = [state.queues[0].slice(), state.queues[1].slice()];
    const movedQueue = mover === 0 ? wouldBeQueues[0] : wouldBeQueues[1];
    movedQueue.shift();
    movedQueue.push(recreatingCell);
    const wouldBeKey = positionKey({ queues: wouldBeQueues, toMove: mover === 0 ? 1 : 0 });
    expect(wouldBeKey).toBe(positionA);
  });

  it("threefold: the identical move sequence stays legal, and the position's 3rd occurrence draws", () => {
    const engine = createFadeoutEngine({ decayTiming: "remove-first", playThrough: false, repetition: "threefold" });
    let state = buildToCap(engine, "threefold-cycle");
    const positionA = positionKey(state);
    expect(engine.status(state).kind).toBe("ongoing");

    let step = 6;
    // First full double-cycle (6 rotations) recreates positionA for its 2nd occurrence —
    // legal under threefold, and the game must still be ongoing (only occurrence 2 of 3).
    for (let i = 0; i < 6; i++) {
      state = rotateOnce(engine, state, "threefold-cycle", step++);
    }
    expect(positionKey(state)).toBe(positionA);
    expect(engine.status(state).kind).toBe("ongoing");

    // Second full double-cycle recreates positionA for its 3rd occurrence: draw.
    for (let i = 0; i < 6; i++) {
      state = rotateOnce(engine, state, "threefold-cycle", step++);
    }
    expect(positionKey(state)).toBe(positionA);
    expect(engine.status(state).kind).toBe("draw");
  });
});

// ---------------------------------------------------------------------------------------
// The no-legal-moves corner (plan §3.3): constructed directly (not derived from a real random
// playout — reaching this naturally requires exhausting a large fraction of the ~10^5-state
// reachable graph, impractical to script by hand) by hand-building a history that already
// contains every remaining empty cell's resulting position.
// ---------------------------------------------------------------------------------------

describe("fadeout engine — no legal moves ⇒ mover loses (never `lost`, never a draw)", () => {
  it("status() resolves an exhausted superko position as a win for the opponent", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: false, repetition: "superko" });
    const queues: [readonly number[], readonly number[]] = [[0, 1, 3], [2, 5, 7]];
    // Every empty cell (4, 6, 8) would put P0's oldest (0) in place of the new mark under
    // place-first + solid — precompute each resulting position and seed it into history.
    const blockedKeys = [4, 6, 8].map((cell) => positionKey({ queues: [[1, 3, cell], [2, 5, 7]], toMove: 1 }));
    const state: FadeoutState = {
      queues,
      toMove: 0,
      history: blockedKeys,
      faded: [0, 0],
      longestLife: [0, 0],
      lastEffects: [],
    };

    expect(engine.status(state)).toEqual({ kind: "won", winner: 1 });
    expect(engine.legalMoves(state, 0)).toEqual([]);
    for (const cell of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(engine.isLegal(state, 0, { cell })).toBe(false);
    }
    expect(() => engine.apply(state, new Map([[0, { cell: 4 }]]), rngFor("stuck", 0))).toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// positionKey vs encode — the C3 distinction (platform-corrections.md), asserted directly.
// ---------------------------------------------------------------------------------------

describe("fadeout engine — positionKey canonicality and its split from encode", () => {
  it("positionKey is independent of object key insertion order", () => {
    const a = positionKey({ queues: [[0, 1], [2]], toMove: 1 });
    const b = positionKey({ toMove: 1, queues: [[0, 1], [2]] } as unknown as Pick<FadeoutState, "queues" | "toMove">);
    expect(a).toBe(b);
  });

  it("positionKey matches for the same logical position reached via different move orders", () => {
    const engine = createFadeoutEngine(BASE_CONFIG);
    let s1 = engine.setup(2, rngForSetup("order1"));
    s1 = apply(engine, s1, 0, 0, "order1", 0);
    s1 = apply(engine, s1, 1, 8, "order1", 1);

    let s2 = engine.setup(2, rngForSetup("order2"));
    // Different seed, same resulting position content — positionKey must not depend on how
    // the position was reached, only on what it currently is.
    s2 = apply(engine, s2, 0, 0, "order2", 0);
    s2 = apply(engine, s2, 1, 8, "order2", 1);

    expect(positionKey(s1)).toBe(positionKey(s2));
  });

  it("encode() differs from positionKey() once history/faded/longestLife diverge, even at identical queues+toMove", () => {
    const base: FadeoutState = {
      queues: [[0], []],
      toMove: 1,
      history: [],
      faded: [0, 0],
      longestLife: [0, 0],
      lastEffects: [],
    };
    const withHistory: FadeoutState = { ...base, history: ["some-prior-key"] };
    const engine = createFadeoutEngine(BASE_CONFIG);

    expect(positionKey(base)).toBe(positionKey(withHistory)); // same game-theoretic position
    expect(engine.encode(base)).not.toBe(engine.encode(withHistory)); // different persisted state
  });
});

// ---------------------------------------------------------------------------------------
// encode/decode — canonical form and C4 (decode must throw, never silently default).
// ---------------------------------------------------------------------------------------

describe("fadeout engine — encode/decode", () => {
  const engine = createFadeoutEngine(BASE_CONFIG);

  it("round-trips through encode/decode with lastEffects reset to []", () => {
    let state = engine.setup(2, rngForSetup("roundtrip"));
    state = apply(engine, state, 0, 4, "roundtrip", 0);
    const decoded = engine.decode(engine.encode(state));
    expect(decoded).toEqual({ ...state, lastEffects: [] });
  });

  it("throws on non-JSON input", () => {
    expect(() => engine.decode("not json")).toThrow(/malformed encoding/);
  });

  it.each([
    ["queues wrong length", JSON.stringify({ queues: [[0]], toMove: 0, history: [], faded: [0, 0], longestLife: [0, 0] })],
    [
      "cell out of range",
      JSON.stringify({ queues: [[9], []], toMove: 0, history: [], faded: [0, 0], longestLife: [0, 0] }),
    ],
    [
      "same cell in both queues",
      JSON.stringify({ queues: [[0], [0]], toMove: 0, history: [], faded: [0, 0], longestLife: [0, 0] }),
    ],
    [
      "queue longer than cap",
      JSON.stringify({ queues: [[0, 1, 2, 3], []], toMove: 0, history: [], faded: [0, 0], longestLife: [0, 0] }),
    ],
    ["bad toMove", JSON.stringify({ queues: [[], []], toMove: 2, history: [], faded: [0, 0], longestLife: [0, 0] })],
    ["missing faded", JSON.stringify({ queues: [[], []], toMove: 0, history: [] })],
    [
      "negative faded",
      JSON.stringify({ queues: [[], []], toMove: 0, history: [], faded: [-1, 0], longestLife: [0, 0] }),
    ],
  ])("throws on malformed input: %s", (_label, encoded) => {
    expect(() => engine.decode(encoded)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// The full engineContract() suite, per variant (plan §13's DoD item).
// ---------------------------------------------------------------------------------------

describe("fadeout engine — engineContract, all 8 ruleset variants", () => {
  for (const config of allRulesetConfigs()) {
    const label = `${config.decayTiming}/${config.playThrough ? "playThrough" : "solid"}/${config.repetition}`;
    describe(label, () => {
      engineContract(createFadeoutEngine(config), { runs: 25, maxPlies: 200 });
    });
  }
});

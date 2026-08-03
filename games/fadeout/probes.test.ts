// games/fadeout/probes.test.ts

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { createFadeoutEngine, type RulesetConfig } from "./engine";
import { mirrorMove } from "./probes";

const CONFIG: RulesetConfig = { decayTiming: "place-first", playThrough: false, repetition: "superko" };

describe("mirrorMove", () => {
  it("returns null when there is no opponent move to mirror", () => {
    const engine = createFadeoutEngine(CONFIG);
    const state = engine.setup(2, rngForSetup("m1"));
    expect(mirrorMove(state, null, engine.legalMoves(state, state.toMove))).toBeNull();
  });

  it("point-reflects a corner move through the centre (0 <-> 8)", () => {
    const engine = createFadeoutEngine(CONFIG);
    let state = engine.setup(2, rngForSetup("m2"));
    state = engine.apply(state, new Map([[0, { cell: 0 }]]), rngFor("m2", 0));
    const legal = engine.legalMoves(state, state.toMove);
    expect(mirrorMove(state, { cell: 0 }, legal)).toEqual({ cell: 8 });
  });

  it("point-reflects an edge move through the centre (1 <-> 7)", () => {
    const engine = createFadeoutEngine(CONFIG);
    let state = engine.setup(2, rngForSetup("m3"));
    state = engine.apply(state, new Map([[0, { cell: 1 }]]), rngFor("m3", 0));
    const legal = engine.legalMoves(state, state.toMove);
    expect(mirrorMove(state, { cell: 1 }, legal)).toEqual({ cell: 7 });
  });

  it("returns null when the reflected cell is not in the mover's current legal set", () => {
    const engine = createFadeoutEngine(CONFIG);
    let state = engine.setup(2, rngForSetup("m4"));
    state = engine.apply(state, new Map([[0, { cell: 4 }]]), rngFor("m4", 0));
    // Centre reflects to itself (8 - 4 = 4), which is now occupied by P0 and (under B1
    // solid) not a legal target for P1 — the degenerate self-reflection case.
    const legal = engine.legalMoves(state, state.toMove);
    expect(mirrorMove(state, { cell: 4 }, legal)).toBeNull();
  });

  it("returns null for an out-of-range reflection (defensive; cell is validated shape by isLegal elsewhere)", () => {
    const engine = createFadeoutEngine(CONFIG);
    const state = engine.setup(2, rngForSetup("m5"));
    expect(mirrorMove(state, { cell: 100 }, engine.legalMoves(state, state.toMove))).toBeNull();
  });
});

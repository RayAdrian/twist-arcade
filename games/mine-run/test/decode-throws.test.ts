// games/mine-run/test/decode-throws.test.ts
//
// platform-corrections.md C4: "decode(x) either returns a state satisfying the engine's own
// invariants, or it throws a typed error. It must never return a partially-constructed,
// type-unsound, or silently-defaulted state." Every case below is a distinct way a forged or
// corrupted replay record could try to sneak a bad state past decode(); each must throw
// MineRunDecodeError, never quietly succeed.

import { describe, expect, it } from "vitest";
import { createMineRun, MineRunDecodeError } from "../engine";

describe("Mine Run decode() — C4 (throw on malformed input, never partial-accept)", () => {
  const engine = createMineRun({ width: 5, height: 5, mines: 3, budget: 8 });

  it("round-trips a real encoded state", () => {
    // Must itself satisfy the reachability invariants decode() now enforces (must-fix 6 below):
    // revealsLeft: 7 out of an 8-budget means exactly 1 reveal move has happened, so revealed
    // must carry the opening region (>=1 cell) PLUS that one move's own contribution (>=1
    // cell) -- 2 cells at minimum, hence `revealed: [1, 2]` rather than a single cell.
    const state = {
      mines: [0, 12, 24],
      revealed: [1, 2],
      exploded: [],
      streakLen: 1,
      streakValue: 1,
      banked: 0,
      revealsLeft: 7,
      lastEffects: [],
    };
    const encoded = engine.encode(state);
    const decoded = engine.decode(encoded);
    expect(engine.encode(decoded)).toBe(encoded);
    expect(decoded.lastEffects).toEqual([]);
  });

  it("throws on non-JSON garbage", () => {
    expect(() => engine.decode("not json at all {{{")).toThrow(MineRunDecodeError);
  });

  it("throws when the encoded value is a JSON array or primitive, not an object", () => {
    expect(() => engine.decode("[1,2,3]")).toThrow(MineRunDecodeError);
    expect(() => engine.decode("42")).toThrow(MineRunDecodeError);
    expect(() => engine.decode("null")).toThrow(MineRunDecodeError);
  });

  it("throws when mines.length does not match this board's configured mine count", () => {
    const bad = JSON.stringify({
      mines: [0, 1], // configured for 3
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws on an out-of-range cell index", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 999], // 999 is out of range for a 5x5=25-cell board
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws on a duplicate cell index within the same array", () => {
    const bad = JSON.stringify({
      mines: [0, 0, 1],
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when exploded contains a cell not present in revealed", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [5],
      exploded: [0], // 0 is a mine but was never put in `revealed`
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when exploded contains a cell that is not a mine", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [5],
      exploded: [5], // 5 is revealed but is not a mine
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when revealed contains a mine that is NOT in exploded (C4: a mine can only enter " +
    "`revealed` by exploding, R7 -- the converse of the exploded-subset checks above)", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [1], // 1 is a mine, revealed, but never marked exploded
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws on a terminal-budget forgery (revealsLeft: 0) that still carries a live streak " +
    "(impossible under R8's auto-bank-at-terminal rule)", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [5],
      exploded: [],
      streakLen: 2,
      streakValue: 3,
      banked: 0,
      revealsLeft: 0,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when revealed.length is too small for the claimed revealsLeft (every reveal move " +
    "adds >=1 revealed cell, and setup's opening region is itself >=1 cell)", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [], // budget is 8; revealsLeft:5 implies 3 reveal moves happened, plus >=1 opening cell
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 5,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when streakLen exceeds the total number of safe revealed cells (a streak cannot " +
    "be longer than the count of safe reveals it was built from)", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [5], // only 1 safe revealed cell
      exploded: [],
      streakLen: 3, // claims a streak longer than any possible safe-reveal history
      streakValue: 6,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when streakValue is arithmetically inconsistent with streakLen (forged score integrity)", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [5],
      exploded: [],
      streakLen: 3,
      streakValue: 999, // should be 3*4/2 = 6
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws on a negative banked value", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: -5,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws on a full-clear terminal forgery (safeRevealed >= safeTotal) that still carries a " +
    "live streak (R8's auto-bank rule fires on EITHER terminal arm -- revealsLeft:0 OR full " +
    "clear -- but a prior fix only transcribed the revealsLeft:0 arm, leaving this the surviving " +
    "half of the disjunction)", () => {
    // 2x2/2-mine/budget-5 board: all 2 safe cells revealed, 0 mines exploded => full-clear
    // terminal by the OTHER arm of `revealsLeft <= 0 || safeRevealed >= safeTotal`, while
    // revealsLeft is still nonzero (4). apply() would auto-bank this streak identically to the
    // revealsLeft:0 case, so a live streak here is exactly as unreachable.
    const smallEngine = createMineRun({ width: 2, height: 2, mines: 2, budget: 5 });
    const bad = JSON.stringify({
      mines: [0, 1],
      revealed: [2, 3],
      exploded: [],
      streakLen: 1,
      streakValue: 1,
      banked: 0,
      revealsLeft: 4,
    });
    expect(() => smallEngine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when exploded.length exceeds the number of reveal moves actually spent (every " +
    "mine hit consumes exactly 1 unit of revealsLeft, and the opening region never contains a " +
    "mine, so exploded.length <= budget - revealsLeft must hold)", () => {
    // budget 8, revealsLeft 8 => zero reveal moves have been spent, so zero mines could
    // possibly have exploded -- but this forgery claims one exploded mine anyway.
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [0],
      exploded: [0],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when revealsLeft exceeds this board's configured budget", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 999,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when a required field is missing entirely", () => {
    const bad = JSON.stringify({ mines: [0, 1, 2], revealed: [], exploded: [] });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });

  it("throws when a numeric field is actually a string", () => {
    const bad = JSON.stringify({
      mines: [0, 1, 2],
      revealed: [],
      exploded: [],
      streakLen: "0",
      streakValue: 0,
      banked: 0,
      revealsLeft: 8,
    });
    expect(() => engine.decode(bad)).toThrow(MineRunDecodeError);
  });
});

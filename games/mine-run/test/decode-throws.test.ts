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
    const state = {
      mines: [0, 12, 24],
      revealed: [1],
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

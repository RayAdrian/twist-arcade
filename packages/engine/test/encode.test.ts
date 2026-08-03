import { describe, expect, it } from "vitest";
import { stableStringify } from "../src/encode";

describe("stableStringify", () => {
  it("produces identical output for objects with keys in different orders", () => {
    const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
    const b = { a: 2, z: 1, m: { x: 2, y: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("is a valid JSON string that round-trips through JSON.parse to a deep-equal value", () => {
    const value = { b: [3, 1, { d: 2, c: 1 }], a: "x" };
    const s = stableStringify(value);
    expect(JSON.parse(s)).toEqual(value);
  });

  it("preserves array order (arrays are not key-sorted)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("distinguishes objects that differ in value even with same keys", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("handles nested arrays of objects with unordered keys", () => {
    const a = { list: [{ y: 1, x: 2 }, { b: 1, a: 2 }] };
    const b = { list: [{ x: 2, y: 1 }, { a: 2, b: 1 }] };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("handles primitives and null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(true)).toBe("true");
  });

  // Gap G-4 (M2 entry checklist, platform-corrections.md): NaN/Infinity are outside
  // JSON-plain semantics but `JSON.stringify` silently maps them to the string "null" —
  // colliding with a real `null` value and breaking canonical-form uniqueness (two states
  // differing only by "field is NaN" vs "field is null" would hash identically). Must throw,
  // not silently null-ify. Tightening this early (before any game generates real states)
  // cannot orphan a valid replay: anything containing NaN/Infinity was never JSON-plain to
  // begin with, so no legitimate stored state could have relied on the old silent behavior.
  it("throws on NaN instead of silently encoding it as null (Gap G-4)", () => {
    expect(() => stableStringify(NaN)).toThrow(/NaN|finite/i);
  });

  it("throws on Infinity instead of silently encoding it as null (Gap G-4)", () => {
    expect(() => stableStringify(Infinity)).toThrow(/Infinity|finite/i);
  });

  it("throws on -Infinity instead of silently encoding it as null (Gap G-4)", () => {
    expect(() => stableStringify(-Infinity)).toThrow(/Infinity|finite/i);
  });

  it("throws when a non-finite number is nested inside an object or array", () => {
    expect(() => stableStringify({ a: NaN })).toThrow(/finite/i);
    expect(() => stableStringify([1, Infinity, 3])).toThrow(/finite/i);
  });

  it("still accepts -0 (finite) and stringifies it via normal JSON semantics", () => {
    expect(() => stableStringify(-0)).not.toThrow();
    expect(stableStringify(-0)).toBe("0");
  });
});

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
});

// games/crackstep/decode-throws.test.ts — platform-corrections.md C4: `decode()` must throw on
// any malformed OR structurally-impossible input, never return a partial/silently-defaulted
// state. Each case here is a PLANTED violation against an otherwise-valid encoding — the
// standing project warning ("verify by planting violations") applied directly to the trust
// boundary `replay()`/`verifyCertificate` depend on.

import { describe, expect, it } from "vitest";
import { crackstep } from "./engine";

function validEncoding(): Record<string, unknown> {
  // A genuine, decodable 1x3 corridor: 0(crumble, crumbled+visited)-1(stone, visited,
  // current)-2(crumble, unvisited).
  return {
    width: 3,
    height: 1,
    tiles: ["crumble", "stone", "crumble"],
    crumbled: [true, false, false],
    visited: [true, true, false],
    pos: 1,
  };
}

function encode(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe("decode() — the valid baseline actually round-trips", () => {
  it("decodes the valid fixture without throwing", () => {
    const state = crackstep.decode(encode(validEncoding()));
    expect(state.pos).toBe(1);
    expect(state.lastEffects).toEqual([]);
  });
});

describe("decode() — planted violations, each must throw", () => {
  it("not valid JSON", () => {
    expect(() => crackstep.decode("{not json")).toThrow();
  });

  it("top-level value is not an object", () => {
    expect(() => crackstep.decode("42")).toThrow();
    expect(() => crackstep.decode("null")).toThrow();
  });

  it("width/height missing or non-positive", () => {
    const bad = { ...validEncoding(), width: 0 };
    expect(() => crackstep.decode(encode(bad))).toThrow();
    const bad2 = { ...validEncoding() };
    delete bad2.height;
    expect(() => crackstep.decode(encode(bad2))).toThrow();
  });

  it("tiles wrong length", () => {
    const bad = { ...validEncoding(), tiles: ["crumble", "stone"] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("tiles contains an invalid tile kind", () => {
    const bad = { ...validEncoding(), tiles: ["crumble", "lava", "crumble"] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("crumbled wrong length or non-boolean entries", () => {
    const bad = { ...validEncoding(), crumbled: [true, false] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
    const bad2 = { ...validEncoding(), crumbled: [true, "false", false] };
    expect(() => crackstep.decode(encode(bad2))).toThrow();
  });

  it("visited wrong length", () => {
    const bad = { ...validEncoding(), visited: [true, true] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("pos out of range", () => {
    const bad = { ...validEncoding(), pos: 3 };
    expect(() => crackstep.decode(encode(bad))).toThrow();
    const bad2 = { ...validEncoding(), pos: -1 };
    expect(() => crackstep.decode(encode(bad2))).toThrow();
  });

  it("a hole marked visited or crumbled is rejected", () => {
    const bad = { ...validEncoding(), tiles: ["hole", "stone", "crumble"], visited: [true, true, false] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("a stone tile marked crumbled is rejected (only crumble tiles ever crumble)", () => {
    const bad = { ...validEncoding(), crumbled: [true, true, false] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("a crumbled cell that was never marked visited is rejected", () => {
    const bad = { ...validEncoding(), crumbled: [true, false, true], visited: [true, true, false] };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("`pos` on a hole is rejected", () => {
    const bad = {
      width: 3,
      height: 1,
      tiles: ["hole", "stone", "crumble"],
      crumbled: [false, false, false],
      visited: [false, true, false],
      pos: 0,
    };
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("`pos` marked crumbled is rejected — cannot be standing on a fallen tile", () => {
    const bad = { ...validEncoding(), pos: 0 }; // cell 0 IS crumbled in the base fixture
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });

  it("`pos` not marked visited is rejected — the player is standing there", () => {
    const bad = { ...validEncoding(), pos: 2, visited: [true, true, false] }; // cell 2 unvisited
    expect(() => crackstep.decode(encode(bad))).toThrow();
  });
});

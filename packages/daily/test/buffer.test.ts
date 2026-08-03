import { describe, expect, it } from "vitest";
import { classifyBuffer } from "../src/buffer";

// Plan §1.2's buffer policy (mirrors the certificate buffer, platform §7.7): ">=90 days of
// manifests committed at all times; CI alerts below 30, hard-fails below 7."

describe("buffer.ts — classifyBuffer()", () => {
  it("ok at and above 90", () => {
    expect(classifyBuffer(90)).toBe("ok");
    expect(classifyBuffer(120)).toBe("ok");
  });
  it("still ok between 30 and 89 (alert threshold is BELOW 30, not below 90)", () => {
    expect(classifyBuffer(30)).toBe("ok");
    expect(classifyBuffer(89)).toBe("ok");
  });
  it("alert below 30, down to and including 7", () => {
    expect(classifyBuffer(29)).toBe("alert");
    expect(classifyBuffer(7)).toBe("alert");
  });
  it("fail below 7", () => {
    expect(classifyBuffer(6)).toBe("fail");
    expect(classifyBuffer(0)).toBe("fail");
  });
});

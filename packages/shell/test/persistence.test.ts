import { beforeEach, describe, expect, it, vi } from "vitest";
import { dailyKey, firstsKey, gameKey, readVersioned, SETTINGS_KEY, writeVersioned } from "../src/persistence";

describe("persistence key helpers (plan §5.6)", () => {
  it("gameKey namespaces by gameId and mode", () => {
    expect(gameKey("fadeout", "solo-bot")).toBe("ta:game:fadeout:solo-bot");
  });
  it("firstsKey namespaces by gameId only (shared record for callouts + softening)", () => {
    expect(firstsKey("fadeout")).toBe("ta:firsts:fadeout");
  });
  it("dailyKey namespaces by day", () => {
    expect(dailyKey("2026-08-02")).toBe("ta:daily:2026-08-02");
  });
  it("SETTINGS_KEY is the fixed site-level key (STREAK_KEY was dropped here — C8, streak.ts owns its own key)", () => {
    expect(SETTINGS_KEY).toBe("ta:settings");
  });
});

describe("readVersioned / writeVersioned round-trip (plan §5.6)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written value", () => {
    writeVersioned("ta:test", { v: 1, foo: "bar" });
    expect(readVersioned<{ v: 1; foo: string }>("ta:test", 1)).toEqual({ v: 1, foo: "bar" });
  });

  it("returns undefined for a missing key", () => {
    expect(readVersioned("ta:missing", 1)).toBeUndefined();
  });

  it("returns undefined (fresh start) on corrupt JSON, never throws", () => {
    window.localStorage.setItem("ta:corrupt", "{not json");
    expect(() => readVersioned("ta:corrupt", 1)).not.toThrow();
    expect(readVersioned("ta:corrupt", 1)).toBeUndefined();
  });

  it("returns undefined on a version mismatch (never crashes on an old schema)", () => {
    window.localStorage.setItem("ta:old", JSON.stringify({ v: 0, foo: "stale" }));
    expect(readVersioned("ta:old", 1)).toBeUndefined();
  });

  it("degrades silently (no throw) when localStorage.setItem throws (private-mode quota)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => writeVersioned("ta:private", { v: 1, x: 1 })).not.toThrow();
    spy.mockRestore();
  });

  it("degrades silently (returns undefined) when localStorage.getItem throws", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => readVersioned("ta:private", 1)).not.toThrow();
    expect(readVersioned("ta:private", 1)).toBeUndefined();
    spy.mockRestore();
  });
});

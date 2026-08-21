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

// A stand-in "full shape" used to exercise readVersioned's validator parameter — mirrors the
// real callers' pattern of a record with a required nested field (PersistedGame.record.steps,
// FirstsRecord's own fields) that an unchecked `as T` cast would happily paper over.
interface Point {
  v: 1;
  x: number;
  y: number;
}
function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === "number" && typeof v.y === "number";
}

describe("readVersioned / writeVersioned round-trip (plan §5.6)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written value that passes its validator", () => {
    writeVersioned("ta:test", { v: 1, x: 1, y: 2 });
    expect(readVersioned<Point>("ta:test", 1, isPoint)).toEqual({ v: 1, x: 1, y: 2 });
  });

  it("returns undefined for a missing key", () => {
    expect(readVersioned("ta:missing", 1, isPoint)).toBeUndefined();
  });

  it("returns undefined (fresh start) on corrupt JSON, never throws", () => {
    window.localStorage.setItem("ta:corrupt", "{not json");
    expect(() => readVersioned("ta:corrupt", 1, isPoint)).not.toThrow();
    expect(readVersioned("ta:corrupt", 1, isPoint)).toBeUndefined();
  });

  it("returns undefined on a version mismatch (never crashes on an old schema)", () => {
    window.localStorage.setItem("ta:old", JSON.stringify({ v: 0, x: 1, y: 2 }));
    expect(readVersioned("ta:old", 1, isPoint)).toBeUndefined();
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
    expect(() => readVersioned("ta:private", 1, isPoint)).not.toThrow();
    expect(readVersioned("ta:private", 1, isPoint)).toBeUndefined();
    spy.mockRestore();
  });

  // PERS-001 (stage-4 finding): well-formed JSON, right version, WRONG SHAPE. Before this fix,
  // `readVersioned` validated only `{v}` and cast the rest away unchecked — so `{"v":1}` came
  // back as if it were a full `Point`/`PersistedGame`, and callers that dereferenced further
  // (`stored.record.seed`) threw. The contract (persistence.ts's own header comment) is
  // "corrupt data — fresh start, never crash"; this must hold for well-formed-but-wrong-shape
  // JSON exactly as it already holds for malformed JSON.
  describe("PERS-001 — well-formed JSON, right version, wrong shape", () => {
    it("returns undefined for the reported case `{\"v\":1}` (no other fields at all)", () => {
      window.localStorage.setItem("ta:shape", JSON.stringify({ v: 1 }));
      expect(() => readVersioned<Point>("ta:shape", 1, isPoint)).not.toThrow();
      expect(readVersioned<Point>("ta:shape", 1, isPoint)).toBeUndefined();
    });

    it("returns undefined when a required field is missing (partial record)", () => {
      // Mirrors PersistedGame with `record.steps` missing — the exact shape a truncated /
      // interrupted write would produce.
      window.localStorage.setItem("ta:shape2", JSON.stringify({ v: 1, x: 1 })); // y missing
      expect(readVersioned<Point>("ta:shape2", 1, isPoint)).toBeUndefined();
    });

    it("returns undefined when a field has the wrong type", () => {
      window.localStorage.setItem("ta:shape3", JSON.stringify({ v: 1, x: "1", y: 2 }));
      expect(readVersioned<Point>("ta:shape3", 1, isPoint)).toBeUndefined();
    });

    it("is NOT sticky: the bad key is removed, so every subsequent read is fresh-start too", () => {
      window.localStorage.setItem("ta:sticky", JSON.stringify({ v: 1 }));
      expect(readVersioned<Point>("ta:sticky", 1, isPoint)).toBeUndefined();
      // The invalid entry must not survive the failed read — otherwise every future load of
      // this route/key re-hits the same invalid value forever (the actual PERS-001 symptom:
      // "bricked until someone manually clears storage").
      expect(window.localStorage.getItem("ta:sticky")).toBeNull();
      // A second read behaves identically (missing key, not "still-invalid key") — confirms
      // there's no special-cased first-read-vs-later-read behavior hiding a re-throw.
      expect(readVersioned<Point>("ta:sticky", 1, isPoint)).toBeUndefined();
    });

    it("leaves a VALID key untouched (only invalid shapes are deleted)", () => {
      writeVersioned("ta:valid", { v: 1, x: 1, y: 2 });
      expect(readVersioned<Point>("ta:valid", 1, isPoint)).toEqual({ v: 1, x: 1, y: 2 });
      expect(window.localStorage.getItem("ta:valid")).not.toBeNull();
    });
  });
});

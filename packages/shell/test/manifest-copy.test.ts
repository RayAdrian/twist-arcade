import { describe, expect, it } from "vitest";
import { classicAttributionLine } from "../src/manifest-copy";

// Regression test for the reported defect (orchestrator review of design 1b): the Crackstep
// hero AND its GameCard both rendered "a twist on N/A — an original twist on a floor-coverage
// path puzzle" — games/crackstep/manifest.ts's `classic` field was an explanatory string
// placeholder for "no classic-game ancestor", not a name meant to sit behind an "a twist on "
// prefix. platform-corrections.md C77 item 4 / task #23 replaced that string-sentinel
// convention with a real `classic: string | null` type — `null` is now the ONLY "no classic"
// signal, so these tests exercise `null` directly instead of an "N/A"-shaped string. The old
// case-insensitive "N/A" sentinel tests are deleted along with the regex they pinned: keeping
// them next to a real `null` check would read as though the string convention still mattered.
describe("classicAttributionLine", () => {
  it("prefixes a normal classic name", () => {
    expect(classicAttributionLine("Tic-Tac-Toe")).toBe("a twist on Tic-Tac-Toe");
  });

  it("returns null for classic: null (no classic-game ancestor, e.g. Crackstep) — never 'a twist on null'", () => {
    expect(classicAttributionLine(null)).toBeNull();
  });

  it("returns null for a blank or whitespace-only classic, never the dangling 'a twist on '", () => {
    // Unrelated to the retired sentinel: a manifest author accidentally setting classic: ""
    // instead of null is still a data bug worth guarding, independent of the null convention.
    expect(classicAttributionLine("")).toBeNull();
    expect(classicAttributionLine("   ")).toBeNull();
    expect(classicAttributionLine("\t\n")).toBeNull();
  });

  it("a classic name that happens to start with 'N/A' is prefixed normally — 'N/A' carries no meaning anymore", () => {
    // Regression guard for the retired convention: "N/Athletics" (or any real classic starting
    // with those letters) must never be silently suppressed now that classic is string | null.
    expect(classicAttributionLine("N/Athletics")).toBe("a twist on N/Athletics");
    expect(classicAttributionLine("N/A")).toBe("a twist on N/A");
  });

  it("trims surrounding whitespace in the rendered attribution", () => {
    expect(classicAttributionLine("  Tic-Tac-Toe  ")).toBe("a twist on Tic-Tac-Toe");
  });
});

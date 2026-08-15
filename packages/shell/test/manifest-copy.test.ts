import { describe, expect, it } from "vitest";
import { classicAttributionLine } from "../src/manifest-copy";

// Regression test for the reported defect (orchestrator review of design 1b): the Crackstep
// hero AND its GameCard both rendered "a twist on N/A — an original twist on a floor-coverage
// path puzzle" — games/crackstep/manifest.ts's `classic` field is an explanatory placeholder
// ("no classic-game ancestor"), not a name meant to sit behind an "a twist on " prefix.
describe("classicAttributionLine", () => {
  it("prefixes a normal classic name", () => {
    expect(classicAttributionLine("Tic-Tac-Toe")).toBe("a twist on Tic-Tac-Toe");
  });

  it("returns null for Crackstep's real classic string (starts with 'N/A') — never prefixed", () => {
    expect(
      classicAttributionLine("N/A — an original twist on a floor-coverage path puzzle")
    ).toBeNull();
  });

  it("returns null for any classic starting with 'N/A', not just Crackstep's exact string", () => {
    expect(classicAttributionLine("N/A")).toBeNull();
    expect(classicAttributionLine("N/A - something else")).toBeNull();
  });

  // C77 item 4: case-insensitivity + a blank-string guard.
  it("is case-insensitive for the N/A sentinel", () => {
    expect(classicAttributionLine("n/a")).toBeNull();
    expect(classicAttributionLine("n/a — lowercase variant")).toBeNull();
    expect(classicAttributionLine("N/a — mixed case")).toBeNull();
  });

  it("returns null for a blank or whitespace-only classic, never the dangling 'a twist on '", () => {
    expect(classicAttributionLine("")).toBeNull();
    expect(classicAttributionLine("   ")).toBeNull();
    expect(classicAttributionLine("\t\n")).toBeNull();
  });

  it("does not false-positive on a classic that merely STARTS WITH the letters n/a with no boundary", () => {
    // "N/Athletics" is not the N/A sentinel — it's a (hypothetical) classic name that happens to
    // start with the same three characters with no separator after them.
    expect(classicAttributionLine("N/Athletics")).toBe("a twist on N/Athletics");
  });

  it("trims surrounding whitespace in the rendered attribution", () => {
    expect(classicAttributionLine("  Tic-Tac-Toe  ")).toBe("a twist on Tic-Tac-Toe");
  });
});

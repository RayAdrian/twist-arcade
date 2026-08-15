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
});

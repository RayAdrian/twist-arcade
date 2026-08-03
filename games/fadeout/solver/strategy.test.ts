// games/fadeout/solver/strategy.test.ts — TDD anchors for greedy strategy extraction and the
// quotability judgment (plan §2.2/§2.3 pass 3).

import { describe, expect, it } from "vitest";
import { extractStrategy } from "./strategy";
import { solveRaw } from "./raw-engine";

describe("extractStrategy() — draw/loss roots have no forced win to quote", () => {
  it("remove-first/solid is a draw root: hasForcedWin=false, quotable=false, empty cells", () => {
    const raw = solveRaw({ decayTiming: "remove-first", playThrough: false });
    expect(raw.rootValue).toBe("draw");
    const strategy = extractStrategy(raw);
    expect(strategy.hasForcedWin).toBe(false);
    expect(strategy.cells).toEqual([]);
    expect(strategy.quotable).toBe(false);
  });
});

describe("extractStrategy() — WIN roots extract a real, replayable forced line", () => {
  it.each([
    { decayTiming: "remove-first" as const, playThrough: true },
    { decayTiming: "place-first" as const, playThrough: true },
    { decayTiming: "place-first" as const, playThrough: false },
  ])("hasForcedWin=true with a non-empty cell sequence for %o", (config) => {
    const raw = solveRaw(config);
    expect(raw.rootValue).toBe("win");
    const strategy = extractStrategy(raw);
    expect(strategy.hasForcedWin).toBe(true);
    expect(strategy.cells.length).toBeGreaterThan(0);
    expect(strategy.description).toContain("P0: ");
    // quotable is a pure function of ply count (documented threshold) — pin it exactly rather
    // than just checking it's a boolean, so a threshold change is a visible diff here too.
    expect(strategy.quotable).toBe(strategy.cells.length <= 5);
  });
});

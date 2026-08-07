// games/mine-run/ui/announce.test.ts — the real announce() fragments (mine-run.md §8.4), built
// from REAL `engine.apply()` effects (never hand-mocked), so a change to the engine's effect
// vocabulary breaks these tests too — mirrors games/tilt/index.test.ts's own documented reason
// for driving fixtures through the real engine. States are hand-constructed directly (bypassing
// setup()/rng), matching test/engine-fixtures.test.ts's own convention, so mine positions are
// known exactly and every expected string is hand-computed, not re-derived blind.

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { createMineRun, DEFAULT_BUDGET, DEFAULT_HEIGHT, DEFAULT_MINES, DEFAULT_WIDTH } from "../engine";
import type { MineRunMove, MineRunState } from "../engine";
import { boardSummaryText, imminentTrailer, movedText, statusText } from "./announce";

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => xs.slice() };

function baseState(mines: number[], revealsLeft: number): MineRunState {
  return {
    mines: [...mines].sort((a, b) => a - b),
    revealed: [],
    exploded: [],
    streakLen: 0,
    streakValue: 0,
    banked: 0,
    revealsLeft,
    lastEffects: [],
  };
}

const engine = createMineRun({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, mines: DEFAULT_MINES, budget: DEFAULT_BUDGET });

function apply(state: MineRunState, move: MineRunMove): MineRunState {
  return engine.apply(state, new Map([[0, move]]), NO_OP_RNG);
}

describe("movedText — a single safe reveal (plan §8.4's exact reveal example, position naming aside)", () => {
  it("names the cell and its count", () => {
    // Cell 45 (row 4, col 5); mines at 34 and 46, both neighbors of 45 -> count 2, no flood.
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    expect(next.streakLen).toBe(1);
    const str = movedText(next.lastEffects);
    expect(str).toBe("Row 5, column 6: 2. Two neighbouring mines.");
  });

  it("a flood (multiple revealed cells in one move) reports a count, not every cell", () => {
    // A full row of mines (50-59) fragments the flood: rows 0-3 (40 cells, count 0) keep
    // flooding into each other; row 4's cells border a row-5 mine (count > 0) and are included
    // as flood BOUNDARY cells without propagating further -- 50 revealed, well short of the 90
    // safe cells total, so this does NOT also trigger R8's full-clear auto-bank (kept separate
    // from that case below).
    const rowOfMines = Array.from({ length: 10 }, (_, i) => 50 + i);
    const state = baseState(rowOfMines, DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 0 });
    const revealedCount = next.lastEffects.filter((e) => e.type === "revealed").length;
    expect(revealedCount).toBeGreaterThan(1);
    expect(next.lastEffects.some((e) => e.type === "banked")).toBe(false);
    expect(movedText(next.lastEffects)).toBe(`Opened ${revealedCount} squares.`);
  });

  it("R8 EDGE CASE: a flood that also exhausts the safe board auto-banks in the SAME move -- both fragments are spoken, documented in movedText's own doc comment", () => {
    // Only 1 mine on the whole 10x10 board -> revealing the corner floods every other safe
    // cell in one move (full-clear terminal), which auto-banks whatever streak that flood built.
    const state = baseState([99], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 0 });
    const revealedCount = next.lastEffects.filter((e) => e.type === "revealed").length;
    const bankedEffect = next.lastEffects.find((e) => e.type === "banked");
    expect(bankedEffect).toBeDefined();
    expect(movedText(next.lastEffects)).toBe(`Opened ${revealedCount} squares. Banked ${bankedEffect!.points}.`);
  });
});

describe("movedText — a mine hit (plan §8.4's exact mine example, position naming aside)", () => {
  it("names the cell and what the streak lost", () => {
    // Build a live streak first (single-neighbor reveals, each scoring +1, +2, ...), then hit
    // a mine placed at the target cell.
    let state = baseState([45, 99], DEFAULT_BUDGET); // 99 unused filler mine, kept off the path
    state = apply(state, { t: "reveal", cell: 34 }); // neighbor of 45 only, not of 99: count 1
    expect(state.streakLen).toBe(1);
    expect(state.streakValue).toBe(1);

    const next = apply(state, { t: "reveal", cell: 45 }); // the mine
    expect(next.exploded).toContain(45);
    const str = movedText(next.lastEffects);
    expect(str).toBe("Mine at Row 5, column 6. Streak of 1 lost.");
  });
});

describe("movedText — banking (plan §8.4's exact bank example)", () => {
  it("names the banked amount", () => {
    // Same single-cell-reveal setup as the first describe block (mines adjacent to, not under,
    // the target) -- a deliberately small, non-flooding streak so the bank that follows is
    // unambiguous.
    let state = baseState([34, 46], DEFAULT_BUDGET);
    state = apply(state, { t: "reveal", cell: 45 });
    expect(state.streakLen).toBe(1);
    const next = apply(state, { t: "bank" });
    expect(movedText(next.lastEffects)).toBe(`Banked ${state.streakValue}.`);
  });
});

describe("movedText — defensive: no effects at all -> empty string", () => {
  it("returns ''", () => {
    expect(movedText([])).toBe("");
  });
});

describe("imminentTrailer — the trailing streak/vault/reveals-left clause (plan §8.4, only available from `view`)", () => {
  it("after a safe reveal: streak + reveals left", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    const view = engine.playerView(next, 0);
    expect(imminentTrailer(next.lastEffects, view)).toBe(`Streak 1, worth 1. ${DEFAULT_BUDGET - 1} reveals left.`);
  });

  it("after a mine hit: vault safe + reveals left", () => {
    let state = baseState([45, 99], DEFAULT_BUDGET);
    state = apply(state, { t: "reveal", cell: 34 });
    const next = apply(state, { t: "reveal", cell: 45 });
    const view = engine.playerView(next, 0);
    expect(imminentTrailer(next.lastEffects, view)).toBe(`Vault 0 safe. ${DEFAULT_BUDGET - 2} reveals left.`);
  });

  it("after an explicit bank: vault total only, no reveals-left clause (R6: bank costs no budget)", () => {
    let state = baseState([34, 46], DEFAULT_BUDGET);
    state = apply(state, { t: "reveal", cell: 45 });
    const bankedPoints = state.streakValue;
    const next = apply(state, { t: "bank" });
    const view = engine.playerView(next, 0);
    expect(imminentTrailer(next.lastEffects, view)).toBe(`Vault ${bankedPoints}.`);
  });

  it("no relevant effect -> empty string", () => {
    const state = baseState([99], DEFAULT_BUDGET);
    const view = engine.playerView(state, 0);
    expect(imminentTrailer([], view)).toBe("");
  });
});

describe("boardSummaryText — full on-demand readback, including the C52 safe-move telegraph", () => {
  it("reports dimensions, reveals left, mine counts, banked, streak, and safety existence", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const view = engine.playerView(state, 0);
    const str = boardSummaryText(view);
    expect(str).toContain(`${DEFAULT_WIDTH} by ${DEFAULT_HEIGHT} board.`);
    expect(str).toContain(`${DEFAULT_BUDGET} reveals left.`);
    expect(str).toContain("Banked 0.");
    expect(str).toContain("Streak 0, worth 0.");
    expect(str).toMatch(/(A safe move is available\.|No proven-safe move right now\.)$/);
  });
});

describe("statusText — the terminal, on the assertive channel (R9: Mine Run only ever emits 'scored')", () => {
  it("names the final score", () => {
    expect(statusText({ kind: "scored", scores: [233] })).toBe("Run over. Final score 233.");
  });

  it("returns '' for any other status kind (defensive — R9 guarantees this never fires in practice)", () => {
    expect(statusText({ kind: "ongoing" })).toBe("");
  });
});

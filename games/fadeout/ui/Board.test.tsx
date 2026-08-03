// @vitest-environment jsdom
//
// games/fadeout/ui/Board.test.tsx — TDD (CLAUDE.md §3) for the Board component itself. Every
// pure computation (ageStep, countdown, ghost, accessible name) is already covered by
// board-view.test.ts without any DOM; this file only proves Board wires that data onto real
// shell `Cell`s correctly — occupant glyph, disabled state from `legal`, ids matching the
// moveToCellId convention CalloutLayer/GameShell rely on, and the grayscale-screenshot
// requirement (ux-lens §2: a grayscale render must be fully readable — proven here by asserting
// the badge, a HUE-INDEPENDENT channel, is present whenever opacity alone would be ambiguous).
//
// Rendered inside a real <BoardShell> (not standalone) — Cell's own useBoardContext() throws
// without one, exactly like packages/shell/test/board-shell.test.tsx's own fixture pattern.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardShell } from "@twist-arcade/shell";
import { createFadeoutEngine } from "../engine";
import type { FadeoutState } from "../engine";
import { FADEOUT_RULESET_CONFIG } from "../manifest";
import { Board } from "./Board";

afterEach(() => cleanup());

const engine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);
const rng = { next: () => 0, int: () => 0, shuffle: <T,>(xs: readonly T[]) => [...xs] };

function play(cells: number[]): FadeoutState {
  let state = engine.setup(2, rng);
  for (const cell of cells) {
    const mover = state.toMove;
    state = engine.apply(state, new Map([[mover, { cell }]]), rng);
  }
  return state;
}

function renderBoard(view: FadeoutState, opts?: { reducedMotion?: boolean }) {
  const legal = engine.legalMoves(view, view.toMove);
  return render(
    <BoardShell rows={3} cols={3} disabled={false} onCellAction={() => {}} boardLabel="Fadeout board">
      <Board
        view={view}
        legal={legal}
        onMove={() => {}}
        seat={view.toMove}
        prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }}
      />
    </BoardShell>
  );
}

describe("Board — renders exactly 9 cells wired to the shell's Cell", () => {
  it("9 gridcells, ids matching moveToCellId({cell}) for every one of them", () => {
    const state = play([]);
    renderBoard(state);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(document.getElementById(`cell-${JSON.stringify({ cell: i })}`)).not.toBeNull();
    }
  });

  it("an empty cell reads 'Empty.' and is enabled (legal) at the start of the game", () => {
    const state = play([]);
    renderBoard(state);
    const cell = screen.getByRole("gridcell", { name: "Row 1, column 1. Empty." });
    expect(cell).not.toHaveAttribute("aria-disabled");
  });

  it("an occupied cell shows its glyph and is disabled (solid ruleset — never a legal target)", () => {
    const state = play([4]); // P0/X at center
    renderBoard(state);
    const cell = screen.getByRole("gridcell", { name: "Row 2, column 2. X." });
    expect(cell).toHaveTextContent("X");
    expect(cell).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Board — the telegraph is legible in GRAYSCALE (ux-lens §2's review gate)", () => {
  // "Grayscale-screenshot test": every board state must be fully readable with hue removed.
  // Proven here without a real screenshot by asserting the two HUE-INDEPENDENT channels ux-lens
  // pins as authoritative (the numeral badge) and structural (shape/glyph) are both present and
  // correctly threaded through — opacity is real but explicitly an ENHANCEMENT (ux-lens §2), so
  // it alone is deliberately not what this gate checks.
  it("a mark at countdown <= 2 shows the numeral badge (aria-hidden, but visually present)", () => {
    // P0: 0,2 (q=2) then P1:1,3 -> cell 0 is index0/q2/cap3 -> remaining=0+1+1=2
    const state = play([0, 1, 2, 3]);
    renderBoard(state);
    const cell = screen.getByRole("gridcell", { name: /Row 1, column 1\. X, fades in 2 turns\./ });
    expect(cell).toHaveTextContent("2"); // the badge numeral
  });

  it("a fresh mark (remaining > 2) shows NO badge at all", () => {
    const state = play([4]);
    renderBoard(state);
    const cell = screen.getByRole("gridcell", { name: "Row 2, column 2. X." });
    expect(cell.textContent).toBe("X"); // no stray numeral
  });

  it("shape/glyph identity (X vs O) never depends on color: both render as literal text content", () => {
    const state = play([4, 0]); // P0 at center, P1 at top-left
    renderBoard(state);
    expect(screen.getByRole("gridcell", { name: "Row 2, column 2. X." })).toHaveTextContent("X");
    expect(screen.getByRole("gridcell", { name: "Row 1, column 1. O." })).toHaveTextContent("O");
  });
});

describe("Board — the ghost outline", () => {
  it("renders a dashed ghost of the departed glyph at the vacated cell for exactly one ply", () => {
    const decayed = play([0, 1, 2, 3, 4, 5, 7]); // P0's 4th placement pops cell 0
    renderBoard(decayed);
    const vacated = screen.getByRole("gridcell", { name: "Row 1, column 1. Empty." });
    expect(vacated).toHaveTextContent("X"); // the ghost glyph, even though the cell is empty
  });

  it("the ghost is gone once another ply passes (Board reflects whatever ghostCellOf(view) says — see board-view.test.ts for the state-level proof)", () => {
    const later = play([0, 1, 2, 3, 4, 5, 7, 8]); // P1's 4th placement pops cell 1 instead
    renderBoard(later);
    const cell0 = screen.getByRole("gridcell", { name: "Row 1, column 1. Empty." });
    expect(cell0).not.toHaveTextContent("X");
  });
});

describe("Board — reduced motion drops the pulse but not the badge/opacity information", () => {
  it("still shows the countdown badge under prefers-reduced-motion (ux-lens §9: motion never carries unique information)", () => {
    // Board [0,1,2,3] is symmetric (both X's cell 0 and O's cell 1 read "fades in 2 turns") —
    // the exact accessible name (already pinned in board-view.test.ts) disambiguates.
    const state = play([0, 1, 2, 3]);
    renderBoard(state, { reducedMotion: true });
    const cell = screen.getByRole("gridcell", { name: "Row 1, column 1. X, fades in 2 turns." });
    expect(cell).toHaveTextContent("2");
  });

  it("a final-turn mark (countdown 1) still renders its glyph under reduced motion (no pulse element required)", () => {
    const state = play([0, 1, 2, 3, 4, 5, 7]);
    renderBoard(state, { reducedMotion: true });
    const cell = screen.getByRole("gridcell", { name: /Row 1, column 3\. X, fades in 1 turn\./ });
    expect(cell).toHaveTextContent("X");
    expect(cell).toHaveTextContent("1"); // badge
  });

  // MUST FIX 2 Part A (stage-6 F3 review): a planted mutant deleting `prefs.reducedMotion ||`
  // from Board.tsx's occupant ternary — so the pulse plays for reduced-motion users too, C5's
  // headline failure — passed all 10 pre-existing Board unit tests AND the reduced-motion e2e,
  // because every prior assertion only checked the badge/glyph were PRESENT, never that the
  // animation itself was absent. These two tests assert directly on the rendered
  // `style.animation`, the actual mechanism the mutant breaks.
  it("does NOT apply the final-turn pulse animation under reduced motion, even though the mark IS at countdown 1", () => {
    const state = play([0, 1, 2, 3, 4, 5, 7]); // P0's 4th placement; cell 2 (X) is now countdown 1
    renderBoard(state, { reducedMotion: true });
    const cell = screen.getByRole("gridcell", { name: /Row 1, column 3\. X, fades in 1 turn\./ });
    const pulseSpan = cell.querySelector("span.inline-block");
    // Under reduced motion, Board renders a bare GlyphMark (no PulsingGlyph wrapper at all) —
    // no span.inline-block, and definitely no inline animation style.
    expect(pulseSpan).toBeNull();
    expect(cell.querySelector('[style*="animation"]')).toBeNull();
  });

  it("DOES apply the final-turn pulse animation WITHOUT reduced motion — the same mark, motion allowed", () => {
    const state = play([0, 1, 2, 3, 4, 5, 7]);
    renderBoard(state, { reducedMotion: false });
    const cell = screen.getByRole("gridcell", { name: /Row 1, column 3\. X, fades in 1 turn\./ });
    const pulseSpan = cell.querySelector("span.inline-block") as HTMLElement | null;
    expect(pulseSpan).not.toBeNull();
    expect(pulseSpan!.style.animation).toContain("fadeout-final-pulse");
  });
});

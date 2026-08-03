// @vitest-environment jsdom
//
// games/mine-run/ui/Board.test.tsx — TDD (CLAUDE.md §3) for the Board component: wiring
// board-view's pure data onto real shell `Cell`s, the mandatory two-tap confirm flow (O2's
// binding condition on the 32px cell-size exception — mine-run.md §8.4/platform-corrections.md
// C5), and the grayscale-screenshot requirement (ux-lens §2). Mirrors games/fadeout/ui/
// Board.test.tsx's structure.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardShell } from "@twist-arcade/shell";
import { rngForSetup, rngFor } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import type { MineRunMove, MineRunState } from "../engine";
import { Board } from "./Board";
import { boardPositionName } from "./board-view";

afterEach(() => cleanup());

const WIDTH = 4;
const HEIGHT = 4;
const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: 3, budget: 10 });

function setupState(seed: string): MineRunState {
  return engine.setup(1, rngForSetup(seed));
}

function apply(state: MineRunState, move: MineRunMove, step: number, seed: string): MineRunState {
  return engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
}

function renderBoard(state: MineRunState, opts?: { reducedMotion?: boolean; onMove?(m: MineRunMove): void }) {
  const view = engine.playerView(state, 0);
  const legal = engine.legalMoves(state, 0);
  const onMove = opts?.onMove ?? (() => {});
  return render(
    <BoardShell
      rows={HEIGHT}
      cols={WIDTH}
      disabled={false}
      onCellAction={(cellId) => onMove(JSON.parse(cellId) as MineRunMove)}
      boardLabel="Mine Run board"
    >
      <Board view={view} legal={legal} onMove={onMove} seat={0} prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }} />
    </BoardShell>
  );
}

function findFreshUnrevealedFixture(): { state: MineRunState; seed: string } {
  // A hand-searched seed whose opening region leaves at least one unrevealed, non-mine cell
  // reachable via a legal reveal — bounded search rather than hardcoding a magic seed string.
  for (let i = 0; i < 50; i++) {
    const seed = `board-fixture-${i}`;
    const state = setupState(seed);
    if (engine.legalMoves(state, 0).some((m) => m.t === "reveal")) return { state, seed };
  }
  throw new Error("no fixture found");
}

describe("Board — renders every cell wired to the shell's Cell", () => {
  it(`${WIDTH * HEIGHT} gridcells, ids matching the reveal-move convention`, () => {
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(WIDTH * HEIGHT);
  });

  it("a revealed (opening-region) cell shows its numeral and is disabled (never a re-reveal target)", () => {
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const revealedCells = screen.getAllByRole("gridcell", { name: /Revealed/ });
    expect(revealedCells.length).toBeGreaterThan(0);
    for (const cell of revealedCells) {
      expect(cell).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("an unrevealed, legal cell reads 'Hidden.' and is enabled", () => {
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const hiddenCells = screen.getAllByRole("gridcell", { name: /Hidden\./ });
    expect(hiddenCells.length).toBeGreaterThan(0);
    expect(hiddenCells[0]).not.toHaveAttribute("aria-disabled");
  });

  it("every cell uses the sanctioned 32px minCellPx floor (O2's exception), not the shell's 48px default", () => {
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    expect(hidden.style.minWidth).toBe("32px");
    expect(hidden.style.minHeight).toBe("32px");
  });
});

describe("Board — the mandatory two-tap confirm flow (O2: every platform, not just touch)", () => {
  it("a FIRST tap on a hidden cell does NOT submit a reveal move — it only arms the cell", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    const moves: MineRunMove[] = [];
    renderBoard(state, { onMove: (m) => moves.push(m) });
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    await user.click(hidden);
    expect(moves).toHaveLength(0);
  });

  it("a SECOND tap on the SAME now-armed cell submits the reveal move", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    const moves: MineRunMove[] = [];
    renderBoard(state, { onMove: (m) => moves.push(m) });
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    await user.click(hidden);
    await user.click(hidden);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ t: "reveal" });
  });

  it("a mis-tap that lands on a DIFFERENT cell after arming re-stages instead of revealing either cell", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    const moves: MineRunMove[] = [];
    renderBoard(state, { onMove: (m) => moves.push(m) });
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ });
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    await user.click(hidden[0]!); // arms cell A
    await user.click(hidden[1]!); // mis-tap on cell B — must NOT reveal A
    expect(moves).toHaveLength(0); // neither A nor B committed yet
    await user.click(hidden[1]!); // second tap on B, now armed — commits B
    expect(moves).toHaveLength(1);
  });

  it("the armed cell is visually distinguished via data-armed (not merely the same as any other hidden cell)", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    expect(hidden).not.toHaveAttribute("data-armed");
    await user.click(hidden);
    expect(hidden).toHaveAttribute("data-armed", "true");
  });

  it("a PLANTED VIOLATION — armed defaulting true would make a single tap commit immediately; confirms the real component does NOT do this by construction (armed starts at null/false for every cell on mount)", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    const moves: MineRunMove[] = [];
    renderBoard(state, { onMove: (m) => moves.push(m) });
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    // Exactly one tap, fresh mount — if the guard were broken (e.g. armed defaulted true), this
    // single tap would already have committed. It must not.
    await user.click(hidden);
    expect(moves).toHaveLength(0);
  });

  it("keyboard: Enter arms, a second Enter on the same focused cell commits", async () => {
    const user = userEvent.setup();
    const { state } = findFreshUnrevealedFixture();
    const moves: MineRunMove[] = [];
    renderBoard(state, { onMove: (m) => moves.push(m) });
    const hidden = screen.getAllByRole("gridcell", { name: /Hidden\./ })[0]!;
    hidden.focus();
    await user.keyboard("{Enter}");
    expect(moves).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(moves).toHaveLength(1);
  });

  it("revealing a cell (an actual state transition) is reflected on the NEXT render — the just-revealed cell leaves the hidden/armable set entirely", () => {
    const { state, seed } = findFreshUnrevealedFixture();
    const legal = engine.legalMoves(state, 0);
    const reveal = legal.find((m) => m.t === "reveal")! as Extract<MineRunMove, { t: "reveal" }>;
    const next = apply(state, reveal, 0, seed);
    const revealedView = engine.playerView(next, 0);
    expect(Object.keys(revealedView.cells)).toContain(String(reveal.cell));

    renderBoard(next);
    const { row, col } = { row: Math.floor(reveal.cell / WIDTH), col: reveal.cell % WIDTH };
    const cell = screen.getByRole("gridcell", { name: new RegExp(`Row ${row + 1}, column ${col + 1}\\. (Revealed|Exploded)`) });
    expect(cell).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Board — the telegraph is legible in GRAYSCALE (ux-lens §2's review gate)", () => {
  it("a revealed safe cell's count is carried as literal text (hue-independent)", () => {
    const { state } = findFreshUnrevealedFixture();
    renderBoard(state);
    const view = engine.playerView(state, 0);
    const [cellStr, cellView] = Object.entries(view.cells).find(([, v]) => "n" in v)!;
    const n = (cellView as { n: number }).n;
    const exactName = `${boardPositionName(Number(cellStr), view.width)}. Revealed, ${n}.`;
    const cell = screen.getByRole("gridcell", { name: exactName });
    expect(cell).toHaveTextContent(String(n));
  });

  it("an exploded cell shows a glyph, not a color-only cue", () => {
    let hit: { state: MineRunState; seed: string; cell: number } | undefined;
    for (let i = 0; i < 40 && !hit; i++) {
      const seed = `grayscale-${i}`;
      let state = setupState(seed);
      for (let step = 0; step < 20 && engine.status(state).kind === "ongoing"; step++) {
        const legal = engine.legalMoves(state, 0);
        const reveal = legal.find((m) => m.t === "reveal") as Extract<MineRunMove, { t: "reveal" }> | undefined;
        if (!reveal) break;
        const wasMine = state.mines.includes(reveal.cell);
        state = apply(state, reveal, step, seed);
        if (wasMine) {
          hit = { state, seed, cell: reveal.cell };
          break;
        }
      }
    }
    expect(hit).toBeDefined();
    renderBoard(hit!.state);
    const cell = screen.getByRole("gridcell", { name: /Exploded mine\./ });
    expect(cell.textContent!.length).toBeGreaterThan(0);
  });
});

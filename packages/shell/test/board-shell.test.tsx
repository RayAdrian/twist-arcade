import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { BoardShell } from "../src/components/BoardShell";
import { Cell } from "../src/components/Cell";

// plan §4.4/§4.5, §7 (mobile), §8 (a11y), §11.2 — Cell + BoardShell's machinery against a
// dummy 3x3 harness. None of this needs a real engine (per plan §10 S0).

function DummyBoard({
  onCellAction,
  disabled = false,
  lockedUntil = 0,
  cellDisabled,
  stagedCell,
  ageStep,
  minCellPx,
  armedCell,
  onArm,
}: {
  onCellAction(cellId: string): void;
  disabled?: boolean;
  lockedUntil?: number;
  cellDisabled?: string;
  stagedCell?: string;
  ageStep?: 0 | 1 | 2;
  minCellPx?: number;
  armedCell?: string;
  onArm?(id: string): void;
}) {
  return (
    <BoardShell rows={3} cols={3} disabled={disabled} onCellAction={onCellAction} boardLabel="Dummy board" lockedUntil={lockedUntil}>
      {Array.from({ length: 3 }, (_, row) =>
        Array.from({ length: 3 }, (_, col) => {
          const id = `${row}-${col}`;
          return (
            <Cell
              key={id}
              id={id}
              row={row}
              col={col}
              accessibleName={`Row ${row + 1}, column ${col + 1}. Empty.`}
              disabled={cellDisabled === id}
              staged={stagedCell === id}
              {...(ageStep !== undefined ? { ageStep } : {})}
              {...(minCellPx !== undefined ? { minCellPx } : {})}
              {...(onArm !== undefined ? { armed: armedCell === id, onArm: () => onArm(id) } : {})}
            />
          );
        })
      )}
    </BoardShell>
  );
}

describe("BoardShell — grid semantics (APG grid pattern, plan §8)", () => {
  it("renders role=grid with aria-rowcount/colcount", () => {
    render(<DummyBoard onCellAction={() => {}} />);
    const grid = screen.getByRole("grid", { name: "Dummy board" });
    expect(grid).toHaveAttribute("aria-rowcount", "3");
    expect(grid).toHaveAttribute("aria-colcount", "3");
  });

  it("every cell has role=gridcell", () => {
    render(<DummyBoard onCellAction={() => {}} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(9);
  });

  it("has no axe violations", async () => {
    const { container } = render(<DummyBoard onCellAction={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("BoardShell — roving tabindex (ONE tab stop for the whole board)", () => {
  it("exactly one cell starts with tabIndex 0 (top-left), the rest are -1", () => {
    render(<DummyBoard onCellAction={() => {}} />);
    const cells = screen.getAllByRole("gridcell");
    const tabbable = cells.filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-label", expect.stringContaining("Row 1, column 1"));
  });

  it("ArrowRight moves the cursor AND the actual DOM focus to the next cell", async () => {
    const user = userEvent.setup();
    render(<DummyBoard onCellAction={() => {}} />);
    const cells = screen.getAllByRole("gridcell");
    cells[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(cells[1]).toHaveFocus();
    expect(cells[1]).toHaveAttribute("tabindex", "0");
    expect(cells[0]).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowDown moves focus a full row down", async () => {
    const user = userEvent.setup();
    render(<DummyBoard onCellAction={() => {}} />);
    const cells = screen.getAllByRole("gridcell");
    cells[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(cells[3]).toHaveFocus(); // row 1, col 0
  });

  it("clamps at the edge (ArrowUp from row 0 stays put, does not wrap or throw)", async () => {
    const user = userEvent.setup();
    render(<DummyBoard onCellAction={() => {}} />);
    const cells = screen.getAllByRole("gridcell");
    cells[0]!.focus();
    await user.keyboard("{ArrowUp}");
    expect(cells[0]).toHaveFocus();
  });

  it("Enter commits the cursor's cell via onCellAction", async () => {
    const user = userEvent.setup();
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard("{Enter}");
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("Space also commits", async () => {
    const user = userEvent.setup();
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard(" ");
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });
});

describe("BoardShell — pointer commit semantics (plan §7: commit on pointerup, drag-away cancels)", () => {
  function firePointer(el: Element, type: string, coords: { clientX: number; clientY: number }) {
    el.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...coords })
    );
  }

  beforeEach(() => {
    // jsdom returns all-zero rects by default; give each cell a real 60x60 box at a distinct
    // offset so "inside vs outside the cell" geometry is meaningful.
    let i = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = i++;
      const x = (index % 3) * 60;
      const y = Math.floor(index / 3) * 60;
      return { x, y, top: y, left: x, right: x + 60, bottom: y + 60, width: 60, height: 60, toJSON() {} };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits when pointerdown and pointerup both land inside the same cell", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    firePointer(cell, "pointerdown", { clientX: 10, clientY: 10 });
    firePointer(cell, "pointerup", { clientX: 20, clientY: 20 });
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("does NOT commit when pointerup lands outside the cell (drag-away cancels)", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    firePointer(cell, "pointerdown", { clientX: 10, clientY: 10 });
    // Cell 0's box is [0,60)x[0,60) per the mock above — 500,500 is far outside it.
    firePointer(cell, "pointerup", { clientX: 500, clientY: 500 });
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("does NOT commit on pointerdown alone", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    firePointer(cell, "pointerdown", { clientX: 10, clientY: 10 });
    expect(onCellAction).not.toHaveBeenCalled();
  });

  // C5: a script/AT-synthesized click carries `detail === 0`, which is how it's told apart from
  // a real mouse/touch click (browsers always give those `detail >= 1`). Without an onClick
  // handler at all, Cell had no path for a bare synthesized click to ever reach `commit()`.
  //
  // UNVERIFIED PREMISE, stated honestly (mirrors Cell.tsx's own onClick comment): we have NOT
  // confirmed on a real device that Android TalkBack's double-tap activation specifically
  // dispatches this shape rather than a pointer pair — see Cell.tsx for the full reasoning on
  // why the fix is safe either way. This test only pins the `detail === 0` contract itself, not
  // the TalkBack premise.
  it("commits on a synthesized click (detail === 0) — the shape a script/AT activation may use (TalkBack premise unverified)", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("does NOT double-commit a real pointer tap's own browser-synthesized click (detail >= 1)", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    firePointer(cell, "pointerdown", { clientX: 10, clientY: 10 });
    firePointer(cell, "pointerup", { clientX: 20, clientY: 20 });
    // A real tap already committed via pointerup above; the browser's own follow-up `click`
    // (detail >= 1, since it came from an actual pointer gesture) must not commit again.
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(onCellAction).toHaveBeenCalledTimes(1);
  });
});

describe("BoardShell — disabled / lockout gating", () => {
  it("disabled=true blocks keyboard commits", async () => {
    const user = userEvent.setup();
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} disabled />);
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard("{Enter}");
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("an individual cell's own disabled prop blocks its commit without disabling the whole board", async () => {
    const user = userEvent.setup();
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} cellDisabled="0-0" />);
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard("{Enter}");
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("drops a commit whose action began before lockedUntil, even though the check runs later", () => {
    const onCellAction = vi.fn();
    const now = 1_000;
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(now);
    render(<DummyBoard onCellAction={onCellAction} lockedUntil={now + 250} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCellAction).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("allows a commit once lockedUntil has passed", () => {
    const onCellAction = vi.fn();
    const now = 1_000;
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(now);
    render(<DummyBoard onCellAction={onCellAction} lockedUntil={now - 1} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCellAction).toHaveBeenCalledWith("0-0");
    nowSpy.mockRestore();
  });
});

describe("BoardShell — 320px viewport cell-size floor (dev-mode assertion)", () => {
  it("console.errors when a registered cell reports a size below 48px", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let observedCallback: ResizeObserverCallback | undefined;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observedCallback = cb;
      }
      observe() {
        // Synchronously report an under-floor size, simulating a too-small cell.
        observedCallback?.(
          [{ contentRect: { width: 32, height: 32 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    render(<DummyBoard onCellAction={() => {}} />);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/48/));
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("Cell — staged visual (I8)", () => {
  it("actually renders at reduced opacity when staged=true — the inline style must reflect it, not just the CSS class", () => {
    // Cell's inline `style={{ opacity }}` always wins over the `opacity-50` utility CLASS at
    // the same element (inline style beats any class, full stop) — so `staged` had a class that
    // could never actually apply. The computed `opacity` value itself must account for `staged`.
    render(<DummyBoard onCellAction={() => {}} stagedCell="0-0" />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell.style.opacity).toBe("0.5");
  });

  it("staged overrides the ageStep-derived opacity (staged takes priority)", () => {
    render(<DummyBoard onCellAction={() => {}} stagedCell="0-0" ageStep={2} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell.style.opacity).toBe("0.5");
  });

  it("an unstaged cell still uses the ageStep-derived opacity, unaffected", () => {
    render(<DummyBoard onCellAction={() => {}} ageStep={2} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell.style.opacity).toBe("0.6"); // AGE_OPACITY[2]
  });
});

describe("Cell — two-tap confirm seam (armed/onArm — Mine Run's O2 mitigation for the 32px exception)", () => {
  it("a first tap on an unarmed cell calls onArm and does NOT commit", () => {
    const onCellAction = vi.fn();
    const onArm = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} onArm={onArm} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onArm).toHaveBeenCalledWith("0-0");
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("a second tap on the SAME cell, once armed=true, commits normally", () => {
    const onCellAction = vi.fn();
    const onArm = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} onArm={onArm} armedCell="0-0" />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("tapping a DIFFERENT cell while another is armed calls the new cell's onArm, not a commit (tap-elsewhere re-stages)", () => {
    const onCellAction = vi.fn();
    const onArm = vi.fn();
    // "0-0" is the currently-armed cell; the tap under test lands on "0-1".
    render(<DummyBoard onCellAction={onCellAction} onArm={onArm} armedCell="0-0" />);
    const other = screen.getAllByRole("gridcell")[1]!;
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onArm).toHaveBeenCalledWith("0-1");
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("keyboard: Enter arms, a second Enter on the same (still-focused) cell commits", async () => {
    const user = userEvent.setup();
    const onCellAction = vi.fn();
    let armed: string | undefined;
    const onArm = vi.fn((id: string) => {
      armed = id;
    });
    const { rerender } = render(
      <DummyBoard onCellAction={onCellAction} onArm={onArm} {...(armed !== undefined ? { armedCell: armed } : {})} />
    );
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard("{Enter}");
    expect(onArm).toHaveBeenCalledWith("0-0");
    expect(onCellAction).not.toHaveBeenCalled();

    rerender(<DummyBoard onCellAction={onCellAction} onArm={onArm} {...(armed !== undefined ? { armedCell: armed } : {})} />);
    expect(screen.getAllByRole("gridcell")[0]).toHaveFocus(); // same element, never remounted
    await user.keyboard("{Enter}");
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("without onArm at all (e.g. Fadeout's Board), a single tap still commits immediately — no regression", () => {
    const onCellAction = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onCellAction).toHaveBeenCalledWith("0-0");
  });

  it("a disabled cell neither arms nor commits — a mis-tap on an illegal cell must never advance any state (planted-violation check)", () => {
    const onCellAction = vi.fn();
    const onArm = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} onArm={onArm} cellDisabled="0-0" />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onArm).not.toHaveBeenCalled();
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("the board's own global `disabled` (not just the cell's) also blocks arming — a guard that must guard even when the whole board is inert", () => {
    const onCellAction = vi.fn();
    const onArm = vi.fn();
    render(<DummyBoard onCellAction={onCellAction} onArm={onArm} disabled />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(onArm).not.toHaveBeenCalled();
    expect(onCellAction).not.toHaveBeenCalled();
  });

  it("renders a visibly distinct outline+scale treatment when armed, via data-armed (never opacity alone, never conflated with `staged`)", () => {
    render(<DummyBoard onCellAction={() => {}} onArm={() => {}} armedCell="0-0" />);
    const armedCellEl = screen.getAllByRole("gridcell")[0]!;
    const unarmedCellEl = screen.getAllByRole("gridcell")[1]!;
    expect(armedCellEl).toHaveAttribute("data-armed", "true");
    expect(unarmedCellEl).not.toHaveAttribute("data-armed");
    // Outline + scale (plan §8.4/O2's "enlarged confirm affordance"), NOT the dimmed 0.5 opacity
    // `staged` already owns (I8) — armed must stay full-opacity so it reads as EMPHASIZED, not
    // de-emphasized.
    expect(armedCellEl.style.opacity).not.toBe("0.5");
    expect(armedCellEl.style.transform).toContain("scale(");
    expect(armedCellEl.style.outlineWidth).not.toBe("");
  });
});

describe("BoardShell — cursor clamps against current bounds on render (orchestrator ruling: dynamic boardDimensions)", () => {
  function ResizableBoard({ rows, cols, onCellAction }: { rows: number; cols: number; onCellAction(cellId: string): void }) {
    return (
      <BoardShell rows={rows} cols={cols} disabled={false} onCellAction={onCellAction} boardLabel="Resizable board">
        {Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const id = `${row}-${col}`;
            return <Cell key={id} id={id} row={row} col={col} accessibleName={`Row ${row + 1}, column ${col + 1}. Empty.`} />;
          })
        )}
      </BoardShell>
    );
  }

  it("re-clamps the roving-tabindex cursor when a shrinking board leaves it stranded outside the new bounds", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ResizableBoard rows={3} cols={3} onCellAction={() => {}} />);

    // Move the cursor to the bottom-right corner (row 2, col 2) of the 3x3 board.
    screen.getAllByRole("gridcell")[0]!.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{ArrowDown}");
    let tabbable = screen.getAllByRole("gridcell").filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-label", expect.stringContaining("Row 3, column 3"));

    // Shrink to a 1x1 board (a real scenario per the presentation.boardDimensions contract:
    // a seed-varied or shrinking-board twist can legitimately return smaller dimensions than
    // the previous render) — (2,2) no longer exists at all.
    rerender(<ResizableBoard rows={1} cols={1} onCellAction={() => {}} />);

    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(1);
    // Without the clamp, the stored cursor (2,2) would match no rendered cell at all, leaving
    // the whole board with ZERO tabIndex=0 cells — an unreachable-by-keyboard grid.
    tabbable = cells.filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(cells[0]);
  });
});

describe("Cell — minCellPx seam (minor: Mine Run's sanctioned 32px exception had no legal API)", () => {
  it("defaults to the 48px floor when minCellPx is omitted", () => {
    render(<DummyBoard onCellAction={() => {}} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell.style.minWidth).toBe("48px");
    expect(cell.style.minHeight).toBe("48px");
  });

  it("honors a smaller minCellPx (e.g. Mine Run's sanctioned 32px + two-tap exception)", () => {
    render(<DummyBoard onCellAction={() => {}} minCellPx={32} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell.style.minWidth).toBe("32px");
    expect(cell.style.minHeight).toBe("32px");
  });

  it("the dev-mode size-floor warning uses minCellPx as the floor, not a hardcoded 48px", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let observedCallback: ResizeObserverCallback | undefined;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observedCallback = cb;
      }
      observe() {
        // 32px wide/tall — below the DEFAULT 48px floor, but exactly at a 32px minCellPx floor.
        observedCallback?.([{ contentRect: { width: 32, height: 32 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    render(<DummyBoard onCellAction={() => {}} minCellPx={32} />);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

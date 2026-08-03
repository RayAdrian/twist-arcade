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
}: {
  onCellAction(cellId: string): void;
  disabled?: boolean;
  lockedUntil?: number;
  cellDisabled?: string;
  stagedCell?: string;
  ageStep?: 0 | 1 | 2;
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

  // C5: TalkBack's double-tap activation gesture dispatches a synthesized `click` (no pointer
  // down/up pair at all — `event.detail === 0` is how a script/AT-synthesized click is told
  // apart from a real mouse/touch click, which browsers always give `detail >= 1`). Without an
  // onClick handler at all, Cell had no path for that activation to ever reach `commit()`.
  it("commits on a synthesized click (detail === 0) — the TalkBack/AT activation shape", () => {
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

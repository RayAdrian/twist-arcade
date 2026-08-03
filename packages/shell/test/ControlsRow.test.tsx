import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ControlsRow } from "../src/components/ControlsRow";

// plan §4.9: Undo is HIDDEN (not greyed) where unavailable. Ctrl/Cmd+Z bonus binding when
// visible. Restart mid-game asks an inline confirm ONLY when the caller says so
// (confirmRestart — solo, >=3 moves; never at a terminal state); extras is the
// game-specific slot. States: full / no-undo / disabled-during-lockout.

describe("ControlsRow", () => {
  it("renders Undo, Restart, and How when canUndo is true", () => {
    render(<ControlsRow canUndo onUndo={() => {}} onRestart={() => {}} onHow={() => {}} />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /how/i })).toBeInTheDocument();
  });

  it("HIDES (does not render, not disables) Undo when canUndo is false", () => {
    render(<ControlsRow canUndo={false} onRestart={() => {}} onHow={() => {}} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("clicking Undo calls onUndo", async () => {
    const onUndo = vi.fn();
    render(<ControlsRow canUndo onUndo={onUndo} onRestart={() => {}} onHow={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl/Cmd+Z triggers onUndo when Undo is visible", async () => {
    const onUndo = vi.fn();
    render(<ControlsRow canUndo onUndo={onUndo} onRestart={() => {}} onHow={() => {}} />);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl/Cmd+Z does nothing when Undo is hidden", async () => {
    const onUndo = vi.fn();
    render(<ControlsRow canUndo={false} onUndo={onUndo} onRestart={() => {}} onHow={() => {}} />);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("restart fires immediately (no confirm) when confirmRestart is false/omitted", async () => {
    const onRestart = vi.fn();
    render(<ControlsRow canUndo={false} onRestart={onRestart} onHow={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("restart opens an inline AlertDialog confirm when confirmRestart is true, and only fires onRestart after confirming", async () => {
    const onRestart = vi.fn();
    render(<ControlsRow canUndo={false} onRestart={onRestart} onHow={() => {}} confirmRestart />);
    await userEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(onRestart).not.toHaveBeenCalled(); // not yet — confirm first
    expect(screen.getByText(/restart\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^restart$/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("disables Undo and Restart (but not How) during the input lockout window", () => {
    render(<ControlsRow canUndo onUndo={() => {}} onRestart={() => {}} onHow={() => {}} disabled />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /restart/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /how/i })).toBeEnabled();
  });

  it("renders the game-specific extras slot", () => {
    render(
      <ControlsRow canUndo={false} onRestart={() => {}} onHow={() => {}} extras={<button>Hint</button>} />
    );
    expect(screen.getByRole("button", { name: /hint/i })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ControlsRow canUndo onUndo={() => {}} onRestart={() => {}} onHow={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

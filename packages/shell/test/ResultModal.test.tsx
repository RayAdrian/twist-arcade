import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { GameManifest } from "@twist-arcade/game-spec";
import { ResultModal } from "../src/components/ResultModal";

// plan §4.10: the most important screen. shadcn Dialog, full-screen takeover, strict priority
// order top-to-bottom: result+texture -> artifact/timeline preview -> Rematch (primary, initial
// focus) -> Next twist (secondary, with its rule sentence) -> Share (tertiary) -> streak line ->
// (reserved account-offer slot, not built). Focus trapped; Escape closes to the finished board.

const nextTwist: GameManifest = {
  id: "gravity-ttt",
  title: "Gravity Tic-Tac-Toe",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Pieces fall to the bottom row.",
  tags: ["gravity"],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [],
};

function baseProps(overrides: Partial<React.ComponentProps<typeof ResultModal>> = {}) {
  return {
    open: true,
    resultText: "You won",
    artifactBody: "❌⭕❌⭕❌💨⭕❌🎯",
    nextTwist,
    onRematch: vi.fn(),
    onNextTwist: vi.fn(),
    onShare: vi.fn().mockResolvedValue("copied"),
    onOpenChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ResultModal", () => {
  it("renders nothing when closed", () => {
    render(<ResultModal {...baseProps({ open: false })} />);
    expect(screen.queryByText("You won")).toBeNull();
  });

  it("renders result text, texture line, and the artifact body when open", () => {
    render(<ResultModal {...baseProps({ textureLine: "Bot's center O faded at the worst moment" })} />);
    expect(screen.getByText("You won")).toBeInTheDocument();
    expect(screen.getByText("Bot's center O faded at the worst moment")).toBeInTheDocument();
    expect(screen.getByText("❌⭕❌⭕❌💨⭕❌🎯")).toBeInTheDocument();
  });

  it("puts initial focus on Rematch (the primary action)", async () => {
    render(<ResultModal {...baseProps()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus());
  });

  it("shows Next twist with its rule sentence when provided, and calls onNextTwist", async () => {
    const user = userEvent.setup();
    const onNextTwist = vi.fn();
    render(<ResultModal {...baseProps({ onNextTwist })} />);
    expect(screen.getByText(/Next:.*Gravity Tic-Tac-Toe/)).toBeInTheDocument();
    expect(screen.getByText("Pieces fall to the bottom row.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next:.*Gravity Tic-Tac-Toe/ }));
    expect(onNextTwist).toHaveBeenCalled();
  });

  it("hides the Next-twist slot entirely when nextTwist is null (registry-size-1, §8.4)", () => {
    render(<ResultModal {...baseProps({ nextTwist: null })} />);
    expect(screen.queryByText(/Next:/)).toBeNull();
  });

  it("calls onRematch when Rematch is clicked", async () => {
    const user = userEvent.setup();
    const onRematch = vi.fn();
    render(<ResultModal {...baseProps({ onRematch })} />);
    await user.click(screen.getByRole("button", { name: "Rematch" }));
    expect(onRematch).toHaveBeenCalled();
  });

  it("renders the streak line when provided", () => {
    render(<ResultModal {...baseProps({ streakLine: "3 games today" })} />);
    expect(screen.getByText("3 games today")).toBeInTheDocument();
  });

  it("shows a 'Copied' confirmation for 2s after a successful share, then reverts", async () => {
    vi.useFakeTimers();
    const onShare = vi.fn().mockResolvedValue("copied");
    render(<ResultModal {...baseProps({ onShare })} />);

    fireEvent.click(screen.getByRole("button", { name: /Share/ }));
    await act(async () => {
      await Promise.resolve(); // flush the onShare() promise microtask
    });
    expect(screen.getByText("Copied")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("shows the long-press-to-copy error text with a selectable artifact on share failure", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn().mockResolvedValue("failed");
    render(<ResultModal {...baseProps({ onShare })} />);
    await user.click(screen.getByRole("button", { name: /Share/ }));
    await waitFor(() => expect(screen.getByText(/Couldn't share.*long-press to copy/)).toBeInTheDocument());
    expect(screen.getByDisplayValue(/❌⭕❌⭕❌💨⭕❌🎯/)).toBeInTheDocument();
  });

  it("calls onOpenChange(false) on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<ResultModal {...baseProps({ onOpenChange })} />);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no axe violations when open", async () => {
    const { container } = render(<ResultModal {...baseProps({ textureLine: "texture", streakLine: "3 games today" })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

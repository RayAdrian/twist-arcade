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

const fullShareText = "Fixture Tic-Tac-Toe — You won\n❌⭕❌⭕❌💨⭕❌🎯\nhttps://example.com/play/fixture-ttt";

function baseProps(overrides: Partial<React.ComponentProps<typeof ResultModal>> = {}) {
  return {
    open: true,
    resultText: "You won",
    artifactBody: "❌⭕❌⭕❌💨⭕❌🎯",
    nextTwist,
    nextTwistHref: "/play/gravity-ttt",
    onRematch: vi.fn(),
    onNextTwistClick: vi.fn(),
    onShare: vi.fn().mockResolvedValue("copied"),
    onOpenChange: vi.fn(),
    shareFallbackText: fullShareText,
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

  it("shows Next twist as a REAL link to nextTwistHref (C4: no external navigation seam otherwise) and fires the click bookkeeping hook", async () => {
    const user = userEvent.setup();
    const onNextTwistClick = vi.fn();
    render(<ResultModal {...baseProps({ nextTwistHref: "/play/gravity-ttt", onNextTwistClick })} />);
    expect(screen.getByText(/Next:.*Gravity Tic-Tac-Toe/)).toBeInTheDocument();
    expect(screen.getByText("Pieces fall to the bottom row.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Next:.*Gravity Tic-Tac-Toe/ });
    expect(link).toHaveAttribute("href", "/play/gravity-ttt");
    await user.click(link);
    expect(onNextTwistClick).toHaveBeenCalled();
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

  it("shows the long-press-to-copy error text with the FULL composed share text (not just artifactBody) in a multi-line, readonly textarea on share failure (I4)", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn().mockResolvedValue("failed");
    render(<ResultModal {...baseProps({ onShare })} />);
    await user.click(screen.getByRole("button", { name: /Share/ }));
    await waitFor(() => expect(screen.getByText(/Couldn't share.*long-press to copy/)).toBeInTheDocument());

    const fallback = screen.getByRole("textbox", { name: "Share text" });
    expect(fallback.tagName).toBe("TEXTAREA");
    expect(fallback).toHaveAttribute("readonly");
    // The FULL composed text (title, result, url) must be present, not merely the game's own
    // move-timeline artifact body in isolation — the player should be able to copy/share the
    // exact same thing a successful share would have sent.
    expect(fallback).toHaveValue(fullShareText);
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

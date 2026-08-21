import { useRef, useState } from "react";
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

  it("renders a 'day N' stamp when dayNumber is provided (design 2a's certified-daily badge)", () => {
    render(<ResultModal {...baseProps({ dayNumber: 41 })} />);
    expect(screen.getByText("day 41")).toBeInTheDocument();
  });

  it("renders no day stamp at all when dayNumber is omitted (a casual, non-daily result)", () => {
    render(<ResultModal {...baseProps()} />);
    expect(screen.queryByText(/^day \d+$/)).toBeNull();
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

  it("TC-2A-RES-005: does not re-invoke onShare while a share is already in flight, and disables the button for the duration", async () => {
    const user = userEvent.setup();
    let resolveShare!: (outcome: "copied") => void;
    const onShare = vi.fn(
      () =>
        new Promise<"copied">((resolve) => {
          resolveShare = resolve;
        })
    );
    render(<ResultModal {...baseProps({ onShare })} />);

    const shareButton = screen.getByRole("button", { name: /Share/ });
    await user.click(shareButton);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(shareButton).toBeDisabled();

    // Second tap while the first share is still in flight — must be a no-op, not a second
    // invocation (RES-005: "one share sheet / one clipboard write. Two invocations = FAIL.").
    await user.click(shareButton);
    expect(onShare).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveShare("copied");
      await Promise.resolve();
    });

    expect(shareButton).not.toBeDisabled();
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("TC-2A-RES-005 (guard is real, not decorative): two synchronous clicks still invoke onShare only once even by a dispatch path userEvent can't exercise", async () => {
    // Deliberately `fireEvent` (raw, synchronous DOM dispatch), not `userEvent` — `userEvent`
    // itself refuses to click an already-`disabled` element, so a `userEvent`-only test proves
    // nothing beyond "the `disabled` attribute is present"; it can never show that `handleShare`'s
    // own `shareBusyRef` early-return is doing real work, only that the DOM's native
    // disabled-button semantics are. Confirmed by hand while building this fix (see
    // ResultModal.tsx's `shareBusyRef` comment): with the `disabled` attribute removed but the
    // ref left in place, this exact test still passes — `onShare` is still called only once — so
    // the ref is independently load-bearing, not redundant belt-and-braces that could never
    // actually catch anything (the failure mode this repo has shipped before per
    // platform-corrections.md C95/C101/C103).
    let resolveShare!: (outcome: "copied") => void;
    const onShare = vi.fn(
      () =>
        new Promise<"copied">((resolve) => {
          resolveShare = resolve;
        })
    );
    render(<ResultModal {...baseProps({ onShare })} />);
    const shareButton = screen.getByRole("button", { name: /Share/ });

    fireEvent.click(shareButton);
    fireEvent.click(shareButton);
    expect(onShare).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveShare("copied");
      await Promise.resolve();
    });
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("releases the in-flight guard after AbortError (dismissed) so the player can share again", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn().mockResolvedValueOnce("dismissed").mockResolvedValueOnce("copied");
    render(<ResultModal {...baseProps({ onShare })} />);

    const shareButton = screen.getByRole("button", { name: /Share/ });

    await user.click(shareButton);
    await waitFor(() => expect(shareButton).not.toBeDisabled());
    expect(onShare).toHaveBeenCalledTimes(1);

    // A dismissed share sheet must never leave Share dead for the rest of the session.
    await user.click(shareButton);
    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("releases the in-flight guard even when onShare throws, rather than leaving Share dead", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("copied");
    render(<ResultModal {...baseProps({ onShare })} />);

    const shareButton = screen.getByRole("button", { name: /Share/ });

    await user.click(shareButton);
    await waitFor(() => expect(shareButton).not.toBeDisabled());

    await user.click(shareButton);
    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
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

// RES-002 / A11Y-007 (stage-4 finding): Escape (and any other dismissal) left
// `document.activeElement === document.body` instead of returning focus into the page.
// ResultModal has NO click-based opener at all — GameShell opens it automatically ~300ms
// after the game reaches a terminal status (see this file's own header comment) — so there is
// no "invoking control" for Radix's default trigger-based restore to return to. The fix is a
// caller-supplied `restoreFocusRef` (normally the finished board's own container), wired to
// the Dialog primitive's own `onCloseAutoFocus` extension point — Radix's documented escape
// hatch for "restore focus somewhere specific on close", not a hand-rolled replacement for its
// focus trap/scope machinery.
//
// This harness mirrors GameShell's real wiring: a real, uncontrolled-from-the-test open/close
// lifecycle (via useState), not a static `open` prop — Radix's FocusScope only runs its
// unmount-focus-restoration logic when the dialog ACTUALLY closes (Presence unmounts), which
// requires `open` to really flip to `false`, not just `onOpenChange` being called.
function ResultModalRestoreHarness(overrides: Partial<React.ComponentProps<typeof ResultModal>> = {}) {
  const [open, setOpen] = useState(true);
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={boardRef} tabIndex={-1} data-testid="board">
        finished board
      </div>
      <ResultModal {...baseProps({ onOpenChange: setOpen, ...overrides })} open={open} restoreFocusRef={boardRef} />
    </>
  );
}

describe("ResultModal — focus return on dismiss (RES-002 / A11Y-007)", () => {
  it("returns focus to restoreFocusRef's element (the board) on Escape — not document.body", async () => {
    render(<ResultModalRestoreHarness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    // Disambiguates *why* focus ended up wherever it did: confirms the dialog actually closed
    // (rather than "board never got focus because Escape didn't dismiss anything").
    await waitFor(() => expect(screen.queryByRole("button", { name: "Rematch" })).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId("board")).toHaveFocus();
  });

  it("returns focus to restoreFocusRef's element (the board) on outside/overlay click — not document.body", async () => {
    render(<ResultModalRestoreHarness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus());

    // The scrim/overlay is the dialog-content's immediate previous sibling in the DOM (Radix's
    // Portal renders Overlay then Content, in that order, as direct children of body — verified
    // by inspection, not assumed) — a structural lookup, not a Tailwind-class string match,
    // so a future restyle can't silently break this the way a className-based selector would.
    // A real modal disables pointer events on everything BEHIND the overlay (`document.body`
    // itself gets `pointer-events: none` while open — confirmed by inspection), so clicking the
    // overlay itself, not `document.body`, is what a real user's scrim-tap does.
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.previousElementSibling as HTMLElement;
    await userEvent.click(overlay);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Rematch" })).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId("board")).toHaveFocus();
  });

  it("does not disturb initial focus-on-open (still lands on Rematch) now that restoreFocusRef is wired", async () => {
    render(<ResultModalRestoreHarness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus());
  });
});

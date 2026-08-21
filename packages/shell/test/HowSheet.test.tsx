import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { Frame } from "@twist-arcade/game-spec";
import { HowSheet } from "../src/components/HowSheet";

// plan §4.3: bottom sheet. Sentence + the game's 3-frame illustrated strip, nothing else.
// Focus-trapped; Esc and scrim-tap close; focus returns to the "How?" trigger. States:
// closed / open / frame-asset missing (renders sentence only — never blocks).

const frames: [Frame, Frame, Frame] = [
  { title: "1. Place", body: "Tap an empty cell." },
  { title: "2. Age", body: "Your pieces fade over time." },
  { title: "3. Vanish", body: "After 3 turns, they're gone." },
];

describe("HowSheet", () => {
  it("renders nothing (closed) when open is false", () => {
    render(<HowSheet open={false} onOpenChange={() => {}} sentence="x" frames={frames} />);
    expect(screen.queryByText("x")).toBeNull();
  });

  it("renders the sentence and all three frames when open", () => {
    render(<HowSheet open onOpenChange={() => {}} sentence="Classic tic-tac-toe, but pieces vanish." frames={frames} />);
    expect(screen.getByText("Classic tic-tac-toe, but pieces vanish.")).toBeInTheDocument();
    expect(screen.getByText("1. Place")).toBeInTheDocument();
    expect(screen.getByText("Tap an empty cell.")).toBeInTheDocument();
    expect(screen.getByText("2. Age")).toBeInTheDocument();
    expect(screen.getByText("3. Vanish")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<HowSheet open onOpenChange={onOpenChange} sentence="x" frames={frames} />);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("degrades to sentence-only (never blocks) when every frame is empty", () => {
    const emptyFrames: [Frame, Frame, Frame] = [
      { title: "", body: "" },
      { title: "", body: "" },
      { title: "", body: "" },
    ];
    render(<HowSheet open onOpenChange={() => {}} sentence="Just the sentence." frames={emptyFrames} />);
    expect(screen.getByText("Just the sentence.")).toBeInTheDocument();
  });

  it("has no axe violations when open", async () => {
    const { container } = render(<HowSheet open onOpenChange={() => {}} sentence="x" frames={frames} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// HOW-002 / A11Y-007 (stage-4 finding): Escape left `document.activeElement === document.body`
// instead of returning focus to the button that opened the sheet.
//
// The reporter's diagnosis ("neither dialog wires the trigger as a Radix DialogTrigger") is
// correct as far as it goes, but wiring a plain `<DialogTrigger>` is NOT a sufficient fix for
// THIS dialog specifically: HowSheet has two independent, simultaneously-mounted openers in
// the real app (RuleCard's "How?" and ControlsRow's "? How", both wired to the same
// setHowOpen(true) in GameShell — see GameShell.tsx). Radix's Dialog context has exactly ONE
// mutable `triggerRef`, set once by whichever `<DialogTrigger>` commits its ref last; with two
// always-mounted triggers that ref settles permanently on one of them regardless of which
// button the user actually clicked, so it could restore focus to the WRONG button on every
// other Escape. The real fix: the caller captures the actual invoking element itself
// (`document.activeElement` at click time, which is guaranteed correct for both mouse and
// keyboard activation) and hands it to HowSheet as `restoreFocusRef`; HowSheet wires that ref
// into `onCloseAutoFocus` — Radix's own documented extension point for this exact case, not a
// hand-rolled replacement for FocusScope's trap/loop behavior.
//
// This harness renders BOTH triggers, exactly like GameShell does, and proves each one
// restores to ITSELF, not to whichever mounted last — the part a naive DialogTrigger fix would
// get wrong.
function TwoTriggerHarness() {
  const [open, setOpen] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  function openFrom() {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }
  return (
    <>
      <button type="button" onClick={openFrom}>
        How?
      </button>
      <button type="button" onClick={openFrom}>
        ? How
      </button>
      <HowSheet open={open} onOpenChange={setOpen} sentence="x" frames={frames} restoreFocusRef={restoreFocusRef} />
    </>
  );
}

describe("HowSheet — focus return on dismiss (HOW-002 / A11Y-007)", () => {
  it("returns focus to the 'How?' button specifically when THAT button opened it", async () => {
    const user = userEvent.setup();
    render(<TwoTriggerHarness />);

    await user.click(screen.getByRole("button", { name: "How?" }));
    await user.keyboard("{Escape}");

    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "How?" })).toHaveFocus();
  });

  it("returns focus to the '? How' button specifically when THAT button opened it (not the other trigger)", async () => {
    const user = userEvent.setup();
    render(<TwoTriggerHarness />);

    await user.click(screen.getByRole("button", { name: "? How" }));
    await user.keyboard("{Escape}");

    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "? How" })).toHaveFocus();
  });

  it("returns focus to the opening trigger on outside/scrim click too", async () => {
    const user = userEvent.setup();
    render(<TwoTriggerHarness />);

    await user.click(screen.getByRole("button", { name: "How?" }));

    // See ResultModal.test.tsx's matching case for why this targets the overlay (dialog's
    // previous DOM sibling) rather than `document.body`: a real modal sets
    // `pointer-events: none` on `document.body` itself while open, so only the overlay (which
    // explicitly re-enables `pointer-events: auto`) is actually clickable — a scrim-tap.
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.previousElementSibling as HTMLElement;
    await user.click(overlay);

    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "How?" })).toHaveFocus();
  });

  it("keeps initial focus trapped inside the sheet on open (must not regress)", async () => {
    const user = userEvent.setup();
    render(<TwoTriggerHarness />);
    await user.click(screen.getByRole("button", { name: "How?" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

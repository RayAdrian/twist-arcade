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

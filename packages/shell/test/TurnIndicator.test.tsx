import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { TurnIndicator } from "../src/components/TurnIndicator";

// plan §4.8: player glyph + name chips; active seat marked by weight + underline AND the
// StatusLine words (never a colored dot alone) — TurnIndicator itself never renders a
// color-only cue, so this component's own contract is just: expose which seat is active via
// both a text-decoration cue AND aria-current, never color alone.

describe("TurnIndicator", () => {
  const seats = [
    { glyph: <span>X</span>, label: "You", active: true },
    { glyph: <span>O</span>, label: "Bot", active: false },
  ];

  it("renders both seat labels", () => {
    render(<TurnIndicator seats={seats} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  it("marks the active seat with aria-current (not color alone)", () => {
    render(<TurnIndicator seats={seats} />);
    const active = screen.getByText("You").closest("[aria-current]");
    expect(active).not.toBeNull();
    expect(screen.getByText("Bot").closest("[aria-current]")).toBeNull();
  });

  it("gives the active seat a distinct font weight (underline/bold), not just a color change", () => {
    render(<TurnIndicator seats={seats} />);
    const activeChip = screen.getByText("You").closest("li");
    expect(activeChip?.className).toMatch(/font-bold|underline/);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TurnIndicator seats={seats} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

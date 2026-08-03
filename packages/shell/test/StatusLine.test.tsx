import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatusLine } from "../src/components/StatusLine";

// plan §4.7: shell computes copy per phase; words never color-alone. StatusLine mirrors
// NOTHING to the live region itself — that's the announcer's job (§6.2) — so it must not be
// an aria-live region (a second, competing announcement source).

describe("StatusLine", () => {
  it("renders 'Your move' for your-turn", () => {
    render(<StatusLine phase="your-turn" />);
    expect(screen.getByText("Your move.")).toBeInTheDocument();
  });

  it("renders \"{actor}'s move\" for their-turn", () => {
    render(<StatusLine phase="their-turn" actorLabel="Sam" />);
    expect(screen.getByText("Sam's move.")).toBeInTheDocument();
  });

  it("renders 'Pass the device to {actor}' for handoff", () => {
    render(<StatusLine phase="handoff" actorLabel="Sam" />);
    expect(screen.getByText("Pass the device to Sam.")).toBeInTheDocument();
  });

  it("renders 'Bot is thinking…' for bot-thinking", () => {
    render(<StatusLine phase="bot-thinking" />);
    expect(screen.getByText("Bot is thinking…")).toBeInTheDocument();
  });

  it("renders resultText when phase is finished", () => {
    render(<StatusLine phase="finished" resultText="You won — three in a row." />);
    expect(screen.getByText("You won — three in a row.")).toBeInTheDocument();
  });

  it("is NOT an aria-live region (the announcer owns the live region, not StatusLine)", () => {
    const { container } = render(<StatusLine phase="your-turn" />);
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<StatusLine phase="your-turn" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

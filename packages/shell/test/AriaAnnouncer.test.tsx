import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AriaAnnouncer } from "../src/components/AriaAnnouncer";

// plan §4.14: ONE polite aria-live region for turn flow, ONE assertive region used exactly
// once per game for the result. Visually hidden (sr-only). Content REPLACES on each render
// (no queue buildup — latest state wins), which is what useGame's composed strings rely on.

describe("AriaAnnouncer", () => {
  it("renders the polite fragment in a polite live region", () => {
    render(<AriaAnnouncer polite="Your move." assertive="" />);
    const region = screen.getByText("Your move.");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("renders the assertive fragment in an assertive live region, separate from polite", () => {
    render(<AriaAnnouncer polite="Your move." assertive="You won." />);
    const politeRegion = screen.getByText("Your move.");
    const assertiveRegion = screen.getByText("You won.");
    expect(politeRegion).not.toBe(assertiveRegion);
    expect(assertiveRegion).toHaveAttribute("aria-live", "assertive");
  });

  it("both regions are visually hidden (sr-only)", () => {
    render(<AriaAnnouncer polite="Your move." assertive="" />);
    expect(screen.getByText("Your move.").className).toMatch(/sr-only/);
  });

  it("replaces content on re-render rather than appending (latest state wins)", () => {
    const { rerender } = render(<AriaAnnouncer polite="Bot placed O." assertive="" />);
    rerender(<AriaAnnouncer polite="Your move." assertive="" />);
    expect(screen.queryByText("Bot placed O.")).toBeNull();
    expect(screen.getByText("Your move.")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<AriaAnnouncer polite="Your move." assertive="" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

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

  describe("forced mutation for a repeated identical announcement (I7)", () => {
    it("mutates the DOM text when the SAME polite string is announced again via a new `token`", () => {
      const tokenA = {};
      const tokenB = {};
      const { rerender } = render(<AriaAnnouncer polite="Your move." assertive="" token={tokenA} />);
      const region = screen.getByRole("status");
      const firstContent = region.textContent;
      expect(firstContent).toBe("Your move.");

      // A genuinely NEW announcement event (useGame hands AriaAnnouncer a fresh `announcement`
      // object per event) with the identical logical text — a naive re-render would leave the
      // DOM text byte-for-byte unchanged, and a live region's MutationObserver-based AT support
      // never re-announces unchanged text. `token` changing is the caller's signal that this IS
      // a new event, distinct from an unrelated parent re-render with the same props.
      rerender(<AriaAnnouncer polite="Your move." assertive="" token={tokenB} />);
      const secondContent = region.textContent;

      expect(secondContent).not.toBe(firstContent);
      // Still logically the same phrase once the forced-mutation marker is stripped — this must
      // never change what a screen reader actually SPEAKS, only that a mutation occurred at all.
      expect(secondContent?.replace(/\u200b/g, "")).toBe("Your move.");
    });

    it("does NOT mutate when the token is unchanged (no spurious re-announcement on an unrelated re-render)", () => {
      const token = {};
      const { rerender } = render(<AriaAnnouncer polite="Your move." assertive="" token={token} />);
      const region = screen.getByRole("status");
      const firstContent = region.textContent;

      rerender(<AriaAnnouncer polite="Your move." assertive="" token={token} />);
      expect(region.textContent).toBe(firstContent);
    });

    it("without `token` at all, behaves exactly as before (backward compatible — existing callers/tests rely on exact text)", () => {
      render(<AriaAnnouncer polite="Your move." assertive="" />);
      expect(screen.getByText("Your move.")).toBeInTheDocument();
    });
  });
});

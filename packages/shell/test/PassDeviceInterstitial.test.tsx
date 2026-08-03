import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PassDeviceInterstitial } from "../src/components/PassDeviceInterstitial";

// plan §4.12: variant chosen by engine.meta.hiddenInformation. true -> full-screen BLOCKING
// interstitial (board hidden, focus on "I'm {label} — show board"). false (open-info, e.g.
// Fadeout) -> non-blocking turn BANNER, board stays visible, input already enabled — so the
// banner variant has no confirm button at all (there's nothing to confirm).

describe("PassDeviceInterstitial — blocking variant (hidden-information games)", () => {
  it("renders a confirm button labeled with the next player and calls onReady when activated", async () => {
    const onReady = vi.fn();
    render(<PassDeviceInterstitial nextLabel="Sam" variant="blocking" onReady={onReady} />);
    const button = screen.getByRole("button", { name: /I'm Sam.*show board/i });
    await userEvent.click(button);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("puts initial focus on the confirm button (blocking interstitial demands acknowledgment)", () => {
    render(<PassDeviceInterstitial nextLabel="Sam" variant="blocking" onReady={() => {}} />);
    expect(screen.getByRole("button", { name: /I'm Sam.*show board/i })).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(<PassDeviceInterstitial nextLabel="Sam" variant="blocking" onReady={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("PassDeviceInterstitial — banner variant (open-information games)", () => {
  it("renders an informational banner with no confirm button (input is already enabled)", () => {
    render(<PassDeviceInterstitial nextLabel="Sam" variant="banner" onReady={() => {}} />);
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<PassDeviceInterstitial nextLabel="Sam" variant="banner" onReady={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

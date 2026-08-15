import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StreakBadge } from "./StreakBadge";
import { writeStreak, type StreakRecord } from "@twist-arcade/shell";

function streak(current: number): StreakRecord {
  return { current, best: current, lastDailyN: 5, lastDay: "2026-08-10" };
}

describe("StreakBadge — masthead streak flame (design 1b, §2.1: only when >0)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing before mount settles and nothing after when there is no stored streak", async () => {
    render(<StreakBadge />);
    // Never renders a hollow "🔥0" — absence, not an invented stat.
    await waitFor(() => expect(screen.queryByLabelText(/day streak/i)).not.toBeInTheDocument());
  });

  it("renders nothing when the stored streak's current is exactly 0", async () => {
    writeStreak(streak(0));
    render(<StreakBadge />);
    await waitFor(() => expect(screen.queryByLabelText(/day streak/i)).not.toBeInTheDocument());
  });

  it("renders the real streak count once mounted", async () => {
    writeStreak(streak(3));
    render(<StreakBadge />);
    await waitFor(() => expect(screen.getByLabelText("3 day streak")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

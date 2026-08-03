import { beforeEach, describe, expect, it } from "vitest";
import { readStreak, recordDailyCompletion } from "../src/streak";

// §11.1: "Streak: same-day idempotence, consecutive-day increment, gap reset."
// One streak, site-level, "played today's Twist" — never per-game (plan §5.5).

describe("streak.ts — site-level daily streak", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts unset", () => {
    expect(readStreak()).toBeUndefined();
  });

  it("first completion ever sets count to 1", () => {
    const result = recordDailyCompletion("2026-08-01");
    expect(result).toEqual({ v: 1, lastDay: "2026-08-01", count: 1 });
    expect(readStreak()).toEqual(result);
  });

  it("completing the SAME day again is idempotent (does not double-increment)", () => {
    recordDailyCompletion("2026-08-01");
    const result = recordDailyCompletion("2026-08-01");
    expect(result.count).toBe(1);
  });

  it("completing the very next UTC day increments the streak", () => {
    recordDailyCompletion("2026-08-01");
    const result = recordDailyCompletion("2026-08-02");
    expect(result).toEqual({ v: 1, lastDay: "2026-08-02", count: 2 });
  });

  it("three consecutive days accumulate to 3", () => {
    recordDailyCompletion("2026-08-01");
    recordDailyCompletion("2026-08-02");
    const result = recordDailyCompletion("2026-08-03");
    expect(result.count).toBe(3);
  });

  it("a gap of more than one day resets the streak to 1", () => {
    recordDailyCompletion("2026-08-01");
    recordDailyCompletion("2026-08-02");
    const result = recordDailyCompletion("2026-08-10");
    expect(result.count).toBe(1);
    expect(result.lastDay).toBe("2026-08-10");
  });

  it("month boundaries count as consecutive when the calendar day is consecutive", () => {
    recordDailyCompletion("2026-07-31");
    const result = recordDailyCompletion("2026-08-01");
    expect(result.count).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { DAILY_EPOCH, dailyNumber, isValidDailyDay, toUTCDateString, todayUTC } from "../src/day";

// Orchestrator addendum §12 Q3: DAILY_EPOCH = 2026-09-01 UTC, Daily #1. Frozen as a wire
// constant with a golden vector — the same discipline as the seed formula (plan §2.1).

describe("day.ts — DAILY_EPOCH and dailyNumber()", () => {
  it("DAILY_EPOCH is frozen at 2026-09-01", () => {
    expect(DAILY_EPOCH).toBe("2026-09-01");
  });

  it("golden vector: dailyNumber(DAILY_EPOCH) === 1", () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
  });

  it("golden vector: dailyNumber further out is a plain day-count offset", () => {
    // 2026-09-01 -> 2026-10-01 is 30 days later => Daily #31.
    expect(dailyNumber("2026-10-01")).toBe(31);
  });

  it("dailyNumber the day before the epoch is not a valid daily (0 or negative)", () => {
    expect(dailyNumber("2026-08-31")).toBeLessThanOrEqual(0);
  });

  it("dailyNumber is a pure day-count — one UTC day always advances N by exactly 1", () => {
    expect(dailyNumber("2026-09-15")).toBe(dailyNumber("2026-09-14") + 1);
  });

  it("throws on a malformed day string rather than silently miscounting", () => {
    expect(() => dailyNumber("2026-9-1")).toThrow();
    expect(() => dailyNumber("09-01-2026")).toThrow();
    expect(() => dailyNumber("not-a-date")).toThrow();
  });

  it("isValidDailyDay rejects days before the epoch and malformed strings, accepts the epoch and after", () => {
    expect(isValidDailyDay(DAILY_EPOCH)).toBe(true);
    expect(isValidDailyDay("2026-09-02")).toBe(true);
    expect(isValidDailyDay("2026-08-31")).toBe(false);
    expect(isValidDailyDay("garbage")).toBe(false);
  });

  it("toUTCDateString formats a Date as yyyy-mm-dd using its UTC components, not local", () => {
    // 2026-09-01T23:30:00Z is still 2026-09-01 in UTC regardless of host timezone.
    expect(toUTCDateString(new Date("2026-09-01T23:30:00Z"))).toBe("2026-09-01");
    expect(toUTCDateString(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("todayUTC() resolves to a valid yyyy-mm-dd string derived from the real clock", () => {
    const day = todayUTC();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toUTCDateString(new Date())).toBe(day);
  });
});

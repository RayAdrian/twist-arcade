// packages/shell/src/streak.ts — the SITE-LEVEL daily streak (plan §5.5): "played today's
// Twist", one streak, localStorage only, never per-game. Pure date arithmetic on the "day"
// string the caller supplies (resolveDaily()'s UTC day) — this module never reads the
// wall clock itself; the day always arrives as an argument.

import { readVersioned, STREAK_KEY, writeVersioned } from "./persistence";

export interface StreakRecord {
  v: 1;
  lastDay: string; // "YYYY-MM-DD" (UTC)
  count: number;
}

export function readStreak(): StreakRecord | undefined {
  return readVersioned<StreakRecord>(STREAK_KEY, 1);
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / msPerDay);
}

/**
 * Records a completed daily for `day` (UTC "YYYY-MM-DD"). Same-day calls are idempotent;
 * exactly-consecutive days increment; anything else (a gap, or an out-of-order/duplicate day
 * older than lastDay) resets to 1 for that day.
 */
export function recordDailyCompletion(day: string): StreakRecord {
  const prev = readStreak();
  let next: StreakRecord;
  if (!prev) {
    next = { v: 1, lastDay: day, count: 1 };
  } else if (prev.lastDay === day) {
    next = prev; // idempotent — already recorded today
  } else if (daysBetween(prev.lastDay, day) === 1) {
    next = { v: 1, lastDay: day, count: prev.count + 1 };
  } else {
    next = { v: 1, lastDay: day, count: 1 }; // gap (or out-of-order) — reset
  }
  writeVersioned(STREAK_KEY, next);
  return next;
}

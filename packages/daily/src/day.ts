// packages/daily/src/day.ts — the UTC calendar day and Daily #N (plan §1.1, §1.3).
//
// DAILY_EPOCH is a WIRE-FORMAT CONSTANT (orchestrator addendum §12 Q3), same discipline as
// the seed formula (seed.ts) and the rng algorithm (packages/engine/src/rng.ts): changing it
// renumbers every artifact ever shared. It is NOT environment-configurable — no env var, no
// build flag reads or overrides it. Frozen at launch, ADR-only thereafter.
export const DAILY_EPOCH = "2026-09-01";

const DAY_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parses a "yyyy-mm-dd" string as a UTC midnight timestamp. Throws on anything that isn't
 *  exactly that shape or doesn't name a real calendar date — a malformed day must never
 *  silently miscount (a daily manifest with a typo'd `day` should fail loudly, not resolve
 *  to some other Daily #N). */
function parseUTCDay(day: string): number {
  if (!DAY_STRING_RE.test(day)) {
    throw new Error(`day.ts: "${day}" is not a valid "yyyy-mm-dd" day string`);
  }
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`day.ts: "${day}" does not name a real calendar date`);
  }
  // Date.parse is lenient about out-of-range components (e.g. "2026-13-40" rolls forward
  // rather than throwing) — round-trip through toUTCDateString to catch that silently-wrong
  // case rather than accept it.
  if (toUTCDateString(new Date(ms)) !== day) {
    throw new Error(`day.ts: "${day}" does not name a real calendar date`);
  }
  return ms;
}

/**
 * dailyNumber(day) = daysBetween(DAILY_EPOCH, day) + 1 — plan §1.1. The epoch day itself is
 * Daily #1; days before the epoch resolve to <= 0 (never scheduled — isValidDailyDay rejects
 * them; dailyNumber itself stays total/pure and simply reports the arithmetic).
 */
export function dailyNumber(day: string): number {
  const dayMs = parseUTCDay(day);
  const epochMs = parseUTCDay(DAILY_EPOCH);
  return Math.round((dayMs - epochMs) / MS_PER_DAY) + 1;
}

/** True iff `day` is a well-formed UTC day string naming DAILY_EPOCH or later — the only
 *  days a manifest may ever be scheduled for. */
export function isValidDailyDay(day: string): boolean {
  try {
    return dailyNumber(day) >= 1;
  } catch {
    return false;
  }
}

/** Formats a Date as "yyyy-mm-dd" using its UTC components — never local time (plan §1.4:
 *  "one clock, one truth"). */
export function toUTCDateString(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's UTC day, from the real clock. The one place production code should call `new
 *  Date()` for daily-resolution purposes — everything else takes `day` as an argument so it
 *  stays testable and replay-deterministic. */
export function todayUTC(): string {
  return toUTCDateString(new Date());
}

/** Adds `n` UTC days to `day` (n may be negative), returning a new "yyyy-mm-dd" string.
 *  Used by the rotation generator to walk the buffer forward and by the countdown/rollover
 *  UI to name "tomorrow". */
export function addUTCDays(day: string, n: number): string {
  const ms = parseUTCDay(day) + n * MS_PER_DAY;
  return toUTCDateString(new Date(ms));
}

/** Milliseconds from `now` until the next UTC midnight — the daily's rollover instant (plan
 *  §7.1's `nextTwistInMs`, ux-lens §5's "Next Twist in 9h 14m"). */
export function msUntilNextUTCMidnight(now: Date = new Date()): number {
  const today = toUTCDateString(now);
  const tomorrow = addUTCDays(today, 1);
  return Date.parse(`${tomorrow}T00:00:00Z`) - now.getTime();
}

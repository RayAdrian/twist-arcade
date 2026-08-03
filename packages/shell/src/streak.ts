// packages/shell/src/streak.ts — the SITE-LEVEL daily streak (plan §6): one streak, keyed on
// consecutive DAILY NUMBERS (never local dates or day-string arithmetic), localStorage only, no
// account. Keying on `n` rather than the day string is what makes the timezone rule exact (plan
// §6.2): a player in Manila playing at 7am local plays *yesterday's* UTC daily, a 9am player
// plays *today's* — both see consecutive N's regardless, so both keep their streak. The reducer
// itself never reads a clock or a date library; `n`/`day` always arrive from the caller (the
// resolved daily manifest), which is what keeps this pure and fully property-testable.
//
// Consolidated here per platform-corrections.md C8 (2026-08-03 ruling): this module previously
// existed in TWO diverging copies — this file (shell), keyed on a bare day string with no `best`
// field and no protection against a resumed old daily resetting the count, and a plan-correct
// rewrite in packages/daily/src/streak.ts. C8 ruled the corrected logic belongs here (shell is
// the lower-level package useGame()/GameShell/ResultModal already sit on top of) and
// packages/daily now imports from here instead of shipping its own copy. `readStreak()`'s
// contract also changed as part of the port: it used to return `undefined` when nothing was
// stored; it now always returns a StreakRecord (INITIAL_STREAK when nothing is stored), matching
// the ported reducer's own convention and letting callers skip an undefined-check.

export interface StreakRecord {
  current: number; // consecutive dailies played (played = completed; a loss counts, plan §6.2).
  best: number; // highest `current` ever reached — retained forever (plan §6.3).
  lastDailyN: number; // highest daily # this device has ever recorded a completion for.
  lastDay: string; // that daily's UTC date string — display/debug only, never used for math.
}

/** The empty streak — no daily ever completed on this device. `lastDailyN: 0` is safe because
 *  real daily numbers start at 1 (DAILY_EPOCH is Daily #1, packages/daily's day.ts) — 0 can
 *  never collide with a genuine completion. */
export const INITIAL_STREAK: StreakRecord = { current: 0, best: 0, lastDailyN: 0, lastDay: "" };

/**
 * Applies one daily completion (`n`, its UTC `day`) to `prev`, returning the next record.
 * Total and pure — never throws, never reads a clock. The four branches are plan §6.2 verbatim:
 *
 *   n === prev.lastDailyN   -> no-op (repeat/practice completion of the same daily)
 *   n === prev.lastDailyN+1 -> current++ (the ordinary case, including the very first play ever)
 *   n >  prev.lastDailyN+1  -> current = 1 (a gap — at least one daily number was skipped)
 *   n <  prev.lastDailyN    -> NO CHANGE (a stale/resumed old daily finishing after a newer one
 *                              was already recorded — must never silently reset a live streak)
 *
 * `lastDailyN`/`lastDay` only ever move forward (`n > prev.lastDailyN`); `best` only ever grows.
 */
export function applyDailyCompletion(prev: StreakRecord, n: number, day: string): StreakRecord {
  let current: number;
  if (n === prev.lastDailyN) {
    current = prev.current;
  } else if (n === prev.lastDailyN + 1) {
    current = prev.current + 1;
  } else if (n > prev.lastDailyN + 1) {
    current = 1;
  } else {
    // n < prev.lastDailyN — a stale completion; the live streak is untouched.
    current = prev.current;
  }

  const advances = n > prev.lastDailyN;
  return {
    current,
    best: Math.max(prev.best, current),
    lastDailyN: advances ? n : prev.lastDailyN,
    lastDay: advances ? day : prev.lastDay,
  };
}

const STREAK_KEY = "ta:streak:v1";

function isStreakRecord(value: unknown): value is StreakRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.current === "number" &&
    typeof v.best === "number" &&
    typeof v.lastDailyN === "number" &&
    typeof v.lastDay === "string"
  );
}

/** Reads the streak from localStorage. Never throws: a missing key, corrupt JSON, a foreign
 *  shape, or storage being unavailable (private mode) all resolve to `INITIAL_STREAK` — a fresh
 *  start, exactly like this package's own persistence.ts convention (this module intentionally
 *  does not route through persistence.ts's readVersioned/writeVersioned — StreakRecord has no
 *  `v` field of its own, and its shape/migration story is this module's alone to own). */
export function readStreak(): StreakRecord {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STREAK_KEY);
  } catch {
    return INITIAL_STREAK;
  }
  if (raw === null) return INITIAL_STREAK;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return INITIAL_STREAK;
  }

  return isStreakRecord(parsed) ? parsed : INITIAL_STREAK;
}

/** Writes the streak to localStorage. Silently no-ops on a storage failure (quota exceeded,
 *  private-mode throw, storage disabled) — never surfaces a crash for a local-pride feature. */
export function writeStreak(record: StreakRecord): void {
  try {
    window.localStorage.setItem(STREAK_KEY, JSON.stringify(record));
  } catch {
    // Degrade silently — same posture as persistence.ts.
  }
}

/**
 * Read-apply-write convenience for the single call site that actually records a completion
 * (useGame()'s terminal-transition effect, plan §5.5) — reads the current record, applies this
 * completion, persists the result, and returns it (e.g. for a caller that wants to render the
 * new streak immediately without a second read).
 */
export function recordDailyCompletion(n: number, day: string): StreakRecord {
  const next = applyDailyCompletion(readStreak(), n, day);
  writeStreak(next);
  return next;
}

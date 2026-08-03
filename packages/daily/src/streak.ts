// packages/daily/src/streak.ts — the SITE-LEVEL daily streak (plan §6): one streak, keyed on
// consecutive DAILY NUMBERS (never local dates or day-string arithmetic), localStorage only, no
// account. Keying on `n` rather than the day string is what makes the timezone rule exact (plan
// §6.2): a player in Manila playing at 7am local plays *yesterday's* UTC daily, a 9am player
// plays *today's* — both see consecutive N's regardless, so both keep their streak. The reducer
// itself never reads a clock or a date library; `n`/`day` always arrive from the caller (the
// resolved daily manifest), which is what keeps this pure and fully property-testable.
//
// Note (S1 scope, flagged for the orchestrator): packages/shell/src/streak.ts already exists,
// wired directly into useGame()'s daily-completion path, under the DIFFERENT key "ta:streak"
// and a DIFFERENT (day-string) reducer shape. That shell reducer resets `current` to 1 on ANY
// day that isn't exactly lastDay+1 — including the "finishing a resumed old daily after a newer
// one" case this plan explicitly calls out (§6.2: "N < lastDailyN -> no change"), and it carries
// no `best` field at all, so §6.3's "best is retained forever" consolation cannot be displayed.
// This module is the plan-correct, fully-tested implementation living in this team's package,
// per §11.1 DY0's inventory ("streak.ts reducer, full TDD") and §11.5's Definition of Done
// (property tests incl. resumed-old-daily and the Manila 7am/9am case). Wiring useGame() to call
// THIS reducer instead of (or in addition to) shell's is DY3/shell-team-integration work — an
// external dependency per the orchestrator's Q2 ruling — not this file's job. Reported as a
// found gap rather than silently patched into packages/shell (out of this team's worktree scope
// per this task's explicit "build on the shell, don't replace it").

export interface StreakRecord {
  current: number; // consecutive dailies played (played = completed; a loss counts, plan §6.2).
  best: number; // highest `current` ever reached — retained forever (plan §6.3).
  lastDailyN: number; // highest daily # this device has ever recorded a completion for.
  lastDay: string; // that daily's UTC date string — display/debug only, never used for math.
}

/** The empty streak — no daily ever completed on this device. `lastDailyN: 0` is safe because
 *  real daily numbers start at 1 (DAILY_EPOCH is Daily #1, day.ts) — 0 can never collide with a
 *  genuine completion. */
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
 *  start, exactly like shell's own persistence.ts convention (this module intentionally does not
 *  import that module — see the file-header note on the key/shape divergence). */
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
    // Degrade silently — same posture as shell's persistence.ts.
  }
}

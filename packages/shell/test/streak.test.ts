import { describe, expect, it } from "vitest";
import { INITIAL_STREAK, applyDailyCompletion, readStreak, recordDailyCompletion, writeStreak, type StreakRecord } from "../src/streak";

// packages/shell/src/streak.ts — the SITE-LEVEL daily streak, consolidated here per
// platform-corrections.md C8 (2026-08-03 ruling): this is now the ONE implementation (ported
// from packages/daily/src/streak.ts, which duplicated it and diverged in two load-bearing ways
// shell's original lacked: a `best` field, and protection against a resumed old daily
// completing AFTER a newer one — see the "finishing a resumed OLD daily" test below, plan
// §6.2). packages/daily now imports this module rather than shipping its own copy.
//
// Keyed on DAILY NUMBERS (never local dates or day-string arithmetic) — this is what makes the
// Manila 7am/9am rollover case correct by construction (both players see consecutive N's
// regardless of which UTC calendar day they land on), and what protects a player who finishes
// an old resumed daily after already playing a newer one. Rules, restated as the exact branches
// under test:
//
//   N === lastDailyN        -> no-op (repeat play same day)
//   N === lastDailyN + 1     -> current++
//   N > lastDailyN + 1       -> current = 1 (gap, or the very first daily ever played)
//   N < lastDailyN           -> NO CHANGE (a stale/resumed old daily completing late)
//   always: lastDailyN = max(N, lastDailyN); best = max(best, current)

describe("streak.ts — applyDailyCompletion() (plan §6.2)", () => {
  it("first-ever completion starts a streak of 1, regardless of which daily number it is", () => {
    const next = applyDailyCompletion(INITIAL_STREAK, 5, "2026-09-05");
    expect(next).toEqual<StreakRecord>({ current: 1, best: 1, lastDailyN: 5, lastDay: "2026-09-05" });
  });

  it("consecutive daily numbers increment the streak", () => {
    let s = applyDailyCompletion(INITIAL_STREAK, 1, "2026-09-01");
    s = applyDailyCompletion(s, 2, "2026-09-02");
    s = applyDailyCompletion(s, 3, "2026-09-03");
    expect(s).toEqual<StreakRecord>({ current: 3, best: 3, lastDailyN: 3, lastDay: "2026-09-03" });
  });

  it("repeat play of the SAME daily number is a no-op", () => {
    let s = applyDailyCompletion(INITIAL_STREAK, 1, "2026-09-01");
    s = applyDailyCompletion(s, 2, "2026-09-02");
    const beforeRepeat = s;
    s = applyDailyCompletion(s, 2, "2026-09-02"); // practice replay completing again
    expect(s).toEqual(beforeRepeat);
  });

  it("a gap (skipped daily number) resets current to 1 but keeps `best`", () => {
    let s = applyDailyCompletion(INITIAL_STREAK, 1, "2026-09-01");
    s = applyDailyCompletion(s, 2, "2026-09-02");
    s = applyDailyCompletion(s, 3, "2026-09-03");
    expect(s.best).toBe(3);
    s = applyDailyCompletion(s, 7, "2026-09-07"); // skipped 4, 5, 6
    expect(s).toEqual<StreakRecord>({ current: 1, best: 3, lastDailyN: 7, lastDay: "2026-09-07" });
  });

  it("finishing a resumed OLD daily after a newer one is already completed changes NOTHING", () => {
    let s = applyDailyCompletion(INITIAL_STREAK, 1, "2026-09-01");
    s = applyDailyCompletion(s, 2, "2026-09-02");
    s = applyDailyCompletion(s, 5, "2026-09-05");
    const beforeStale = s;
    s = applyDailyCompletion(s, 4, "2026-09-04");
    expect(s).toEqual(beforeStale);
  });

  it("`best` is retained forever even after the streak breaks — the consolation the UI leans on", () => {
    let s = applyDailyCompletion(INITIAL_STREAK, 1, "2026-09-01");
    for (let n = 2; n <= 21; n++) s = applyDailyCompletion(s, n, `day-${n}`);
    expect(s.best).toBe(21);
    s = applyDailyCompletion(s, 40, "day-40"); // big gap, streak resets
    expect(s.current).toBe(1);
    expect(s.best).toBe(21);
  });

  it("Manila 7am/9am rollover case: both an every-morning-7am and every-morning-9am player hold their streak", () => {
    // The daily rolls at 08:00 Manila local (UTC+8) each UTC midnight. A 7am player plays
    // YESTERDAY's UTC daily every real-world morning; a 9am player plays TODAY's. Both play
    // exactly one daily per calendar day and each sees consecutive daily NUMBERS — the streak
    // reducer never looks at wall-clock time, only at the N the caller resolved.
    const day1 = "2026-09-10";
    const day2 = "2026-09-11";
    const day3 = "2026-09-12";

    let sevenAm = applyDailyCompletion(INITIAL_STREAK, 100, day1);
    sevenAm = applyDailyCompletion(sevenAm, 101, day2);
    sevenAm = applyDailyCompletion(sevenAm, 102, day3);
    expect(sevenAm.current).toBe(3);

    let nineAm = applyDailyCompletion(INITIAL_STREAK, 100, day1);
    nineAm = applyDailyCompletion(nineAm, 101, day2);
    nineAm = applyDailyCompletion(nineAm, 102, day3);
    expect(nineAm.current).toBe(3);
  });

  it("property: current never exceeds best after any sequence of completions", () => {
    let s = INITIAL_STREAK;
    let n = 0;
    // A pseudo-random but deterministic walk over daily numbers, including repeats and gaps.
    const steps = [1, 1, 2, 3, 5, 6, 6, 7, 4, 20, 21, 22, 22, 1];
    for (const delta of steps) {
      n = n + delta;
      s = applyDailyCompletion(s, n, `d${n}`);
      expect(s.current).toBeLessThanOrEqual(s.best);
    }
  });
});

describe("streak.ts — localStorage persistence (ta:streak:v1 — shell's OLD 'ta:streak' key is dropped, C8)", () => {
  it("readStreak() returns INITIAL_STREAK when nothing is stored yet", () => {
    window.localStorage.clear();
    expect(readStreak()).toEqual(INITIAL_STREAK);
  });

  it("writeStreak() then readStreak() round-trips", () => {
    window.localStorage.clear();
    const record: StreakRecord = { current: 4, best: 9, lastDailyN: 40, lastDay: "2026-10-10" };
    writeStreak(record);
    expect(readStreak()).toEqual(record);
  });

  it("writes under the ta:streak:v1 key specifically", () => {
    window.localStorage.clear();
    writeStreak({ current: 1, best: 1, lastDailyN: 1, lastDay: "2026-09-01" });
    expect(window.localStorage.getItem("ta:streak:v1")).not.toBeNull();
    expect(window.localStorage.getItem("ta:streak")).toBeNull();
  });

  it("readStreak() ignores a corrupt or foreign-shaped value and returns INITIAL_STREAK", () => {
    window.localStorage.clear();
    window.localStorage.setItem("ta:streak:v1", "{not json");
    expect(readStreak()).toEqual(INITIAL_STREAK);

    window.localStorage.setItem("ta:streak:v1", JSON.stringify({ hello: "world" }));
    expect(readStreak()).toEqual(INITIAL_STREAK);
  });
});

describe("streak.ts — recordDailyCompletion() (the read-apply-write convenience useGame() calls)", () => {
  it("reads the current record, applies the completion, writes it back, and returns the result", () => {
    window.localStorage.clear();
    const first = recordDailyCompletion(1, "2026-09-01");
    expect(first).toEqual<StreakRecord>({ current: 1, best: 1, lastDailyN: 1, lastDay: "2026-09-01" });
    expect(readStreak()).toEqual(first);

    const second = recordDailyCompletion(2, "2026-09-02");
    expect(second).toEqual<StreakRecord>({ current: 2, best: 2, lastDailyN: 2, lastDay: "2026-09-02" });
    expect(readStreak()).toEqual(second);
  });

  it("protects a resumed old daily finishing late, same as applyDailyCompletion directly", () => {
    window.localStorage.clear();
    recordDailyCompletion(1, "2026-09-01");
    recordDailyCompletion(5, "2026-09-05");
    const beforeStale = readStreak();
    const result = recordDailyCompletion(4, "2026-09-04");
    expect(result).toEqual(beforeStale);
  });
});

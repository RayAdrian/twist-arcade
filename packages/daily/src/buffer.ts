// packages/daily/src/buffer.ts — the daily-manifest buffer policy (plan §1.2, mirroring the
// certificate buffer, platform §7.7): ">=90 days of manifests committed at all times; CI alerts
// below 30, hard-fails below 7." A missing day is a build-time problem, never a 6am incident.

import { addUTCDays } from "./day";

export type BufferLevel = "ok" | "alert" | "fail";

export function classifyBuffer(count: number): BufferLevel {
  if (count < 7) return "fail";
  if (count < 30) return "alert";
  return "ok";
}

/**
 * Should-fix 7 (stage-6 review): `classifyBuffer` only ever sees a COUNT of upcoming manifests —
 * "90 files over 200 days with a hole next Tuesday" still reports `count=90, level=ok`, because
 * nothing about a bare count can see a gap in the MIDDLE of the range. That is exactly the 6am
 * incident plan §1.2 promises can't happen ("a missing day is a build-time problem, never a 6am
 * incident") — a count-only check structurally cannot keep that promise.
 *
 * Walks `today`, `today+1`, `today+2`, ... up to the FURTHEST day actually present in
 * `committedDays`, and returns the first day in that walk that is NOT in `committedDays` — or
 * `null` if every day in that range is present (including when `committedDays` has nothing at or
 * after `today` at all — that's `classifyBuffer`'s job to flag via the count, not a contiguity
 * question). Days before `today` are never considered "missing" (already-shipped history is not
 * this function's concern; immutability.ts owns that).
 */
export function findFirstMissingDay(committedDays: readonly string[], today: string): string | null {
  const committed = new Set(committedDays);
  const upcoming = committedDays.filter((day) => day >= today);
  if (upcoming.length === 0) return null;

  const furthest = upcoming.reduce((latest, day) => (day > latest ? day : latest));

  let day = today;
  while (day <= furthest) {
    if (!committed.has(day)) return day;
    day = addUTCDays(day, 1);
  }
  return null;
}

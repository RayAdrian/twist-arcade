// packages/daily/src/immutability.ts — the manifest immutability guard (plan §2.3, point 2):
// "CI diffs COMMITTED CHANGES ON THIS BRANCH VS. THE BASE REF for data/daily/*.json and hard-
// fails if any file whose day <= today-at-build changes at all (byte-diff). Shipped days are
// frozen forever; era bumps apply only to not-yet-shipped days." (should-fix 8: spelled out
// explicitly — "against main" alone was ambiguous about whether this is a working-tree diff or a
// committed-history diff; it is the latter, `git diff <base>...HEAD`, exactly what src/bin/
// check-daily-immutability.ts below runs.)
//
// This is the guard against the roadmap's standing risk "Daily bot retuned silently": if
// `tier`/`budget.n`/`blunder`/`botsVersion`/`engineVersion`/`humanSeat`/the seed formula changed
// on a day that already shipped without a new era, every result recorded that day becomes
// silently incomparable with every other — nothing errors, the numbers just stop meaning
// anything. This module turns that into a build break. The pure predicate lives here so it is
// unit-testable (including a PLANTED VIOLATION, per this task's standing instruction) without
// needing a real git checkout; src/bin/check-daily-immutability.ts (should-fix 8: this comment
// previously named a nonexistent scripts/check-daily-immutability.mjs) is the thin CLI that
// feeds it real `git diff` output.

export interface ImmutabilityViolation {
  day: string;
  reason: string;
}

/** A day counts as "shipped" (frozen forever) once it is <= `todayUTC` — string comparison is
 *  safe and correct here because every day is a fixed-width zero-padded "yyyy-mm-dd", so
 *  lexicographic order IS chronological order. `today` itself counts as shipped: by the time a
 *  build runs, today's daily may already be in a player's hands. */
export function findImmutabilityViolations(changedManifestDays: readonly string[], todayUTC: string): ImmutabilityViolation[] {
  return changedManifestDays
    .filter((day) => day <= todayUTC)
    .map((day) => ({
      day,
      reason: `manifest for shipped day "${day}" (<= today "${todayUTC}") was modified — shipped days are frozen forever (plan §2.3); the fix is always "bump the era for FUTURE days," never "edit history."`,
    }));
}

/** Throws (a build break, never a warning) if any changed manifest belongs to an already-shipped
 *  day. See findImmutabilityViolations for the exact rule. */
export function assertNoShippedManifestChanged(changedManifestDays: readonly string[], todayUTC: string): void {
  const violations = findImmutabilityViolations(changedManifestDays, todayUTC);
  if (violations.length === 0) return;
  throw new Error(
    `immutability.ts: ${violations.length} shipped daily manifest(s) were modified:\n` +
      violations.map((v) => `  - ${v.reason}`).join("\n")
  );
}

// packages/daily/src/era-guard.ts — the era-snapshot review guard (plan §2.3, point 1): any
// edit to data/daily/era.json must bump the changed entry's `era` AND touch
// data/daily/CHANGELOG.md in the same diff — otherwise a bot retune is a silent, unreviewed
// event, which is the exact failure this whole guard system exists to make structurally
// impossible. scripts/check-era-changelog.mjs is the git-diff-driven CLI that feeds this pure
// predicate real before/after era.json content plus whether CHANGELOG.md changed.

import type { DailyBotRecord, EraFile } from "./era";

export interface EraReviewViolation {
  gameId: string;
  reason: string;
}

function recordsEqual(a: DailyBotRecord, b: DailyBotRecord): boolean {
  // Exact byte-shape equality is what matters for "did this record change at all" — a
  // structural JSON comparison rather than a field-by-field allowlist, so a NEW field added to
  // DailyBotRecord in the future is covered automatically without touching this file.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compares `oldEra` (the base ref's era.json) against `newEra` (the working tree's), flagging:
 *   - any EXISTING game whose record changed without `era` strictly increasing;
 *   - the file changing at all (any entry added, removed, or modified) while
 *     `changelogChanged` is false — "a bot change is always a visible, reviewed event."
 * A brand-new game entry (present only in `newEra`) needs no prior era to have bumped FROM, so
 * it is never itself flagged for the era-bump rule — but it still counts toward "the file
 * changed," so the CHANGELOG requirement still applies.
 */
export function findEraReviewViolations(oldEra: EraFile, newEra: EraFile, changelogChanged: boolean): EraReviewViolation[] {
  const violations: EraReviewViolation[] = [];
  const gameIds = new Set([...Object.keys(oldEra), ...Object.keys(newEra)]);
  let anyChanged = false;

  for (const gameId of gameIds) {
    const before = oldEra[gameId];
    const after = newEra[gameId];
    if (before && after && recordsEqual(before, after)) continue; // unchanged entry
    anyChanged = true;

    if (!after || !before) continue; // removed, or brand-new — no era-bump comparison applies
    if (!(after.era > before.era)) {
      violations.push({
        gameId,
        reason: `era.json["${gameId}"] changed without bumping era (${before.era} -> ${after.era}) — any edit to a pinned daily bot must bump its era in the same diff.`,
      });
    }
  }

  if (anyChanged && !changelogChanged) {
    violations.push({
      gameId: "*",
      reason: "data/daily/era.json changed but data/daily/CHANGELOG.md was not — a bot change must always be a visible, reviewed event.",
    });
  }

  return violations;
}

/** Throws (a build break) on any review violation. See findEraReviewViolations for the rules. */
export function assertEraChangeIsReviewed(oldEra: EraFile, newEra: EraFile, changelogChanged: boolean): void {
  const violations = findEraReviewViolations(oldEra, newEra, changelogChanged);
  if (violations.length === 0) return;
  throw new Error(
    `era-guard.ts: ${violations.length} unreviewed era.json change(s):\n` + violations.map((v) => `  - [${v.gameId}] ${v.reason}`).join("\n")
  );
}

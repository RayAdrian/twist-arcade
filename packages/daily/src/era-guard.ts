// packages/daily/src/era-guard.ts — the era-snapshot review guard (plan §2.3, point 1): any
// edit to data/daily/era.json must bump the changed entry's `era` AND touch
// data/daily/CHANGELOG.md in the same diff — otherwise a bot retune is a silent, unreviewed
// event, which is the exact failure this whole guard system exists to make structurally
// impossible. src/bin/check-era-changelog.ts (should-fix 8: this comment previously named a
// nonexistent scripts/check-era-changelog.mjs) is the git-diff-driven CLI that feeds this pure
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

/**
 * Plan §2.2: "Each day's manifest embeds a resolved copy of the record (self-contained client)
 * ... CI asserts the embedded copy is byte-identical to era.json for that era." This is that
 * assertion — a check a LIVE demonstration of the immutability guard surfaced as missing: a
 * manifest's own embedded `bot` field can be retuned in place while data/daily/era.json (and
 * therefore the era-changelog guard, which only ever looks at era.json) sees nothing change at
 * all. Without this check that specific divergence sails past every other guard in this module.
 * Throws naming the gameId on any mismatch, including "era.json has no entry for this game at
 * all" — a manifest can never reference a bot record that doesn't exist in the reviewed file.
 */
export function assertManifestBotMatchesEra(gameId: string, manifestBot: DailyBotRecord, era: EraFile): void {
  const canonical = era[gameId];
  if (!canonical) {
    throw new Error(`era-guard.ts: manifest for "${gameId}" embeds a bot record, but there is no era.json entry for "${gameId}" at all.`);
  }
  if (!recordsEqual(canonical, manifestBot)) {
    throw new Error(
      `era-guard.ts: manifest for "${gameId}"'s embedded bot record does not byte-match era.json["${gameId}"] — ` +
        "the manifest's copy has silently diverged from the reviewed record (plan §2.2)."
    );
  }
}

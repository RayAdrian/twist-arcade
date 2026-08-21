// packages/shell/src/persistence.ts — the versioned localStorage envelope (plan §5.6).
//
// Every key is `ta:`-prefixed. All reads go through `readVersioned`: a JSON parse failure or
// a version mismatch returns `undefined` (fresh start) — never throws. Writes go through
// `writeVersioned`, which degrades silently (no persistence, no error surfaced) if
// localStorage throws (private-mode storage failure, quota exceeded, or storage disabled).
// This module never reads any game's rules — it is pure key/value plumbing.

// STREAK_KEY ("ta:streak") is deliberately GONE (platform-corrections.md C8): streak.ts owns
// its own key ("ta:streak:v1") directly rather than routing through readVersioned/writeVersioned
// here, since StreakRecord carries no `v` field of its own — see streak.ts's header comment.
export const SETTINGS_KEY = "ta:settings";

export function gameKey(gameId: string, mode: string): string {
  return `ta:game:${gameId}:${mode}`;
}

export function firstsKey(gameId: string): string {
  return `ta:firsts:${gameId}`;
}

export function dailyKey(day: string): string {
  return `ta:daily:${day}`;
}

interface Versioned {
  v: number;
}

/**
 * Reads and JSON-parses `key`, returning `undefined` (never throwing) if: the key is absent,
 * the stored value isn't valid JSON, the parsed value has no numeric `v`, the `v` doesn't
 * match `expectedVersion`, `isValid` rejects the parsed shape, or localStorage itself is
 * unavailable/throws (private mode).
 *
 * `isValid` is REQUIRED, not optional (PERS-001 postmortem): this function is generic over `T`
 * and cannot know `T`'s shape on its own, so before this fix the only check performed was the
 * `{v}` envelope — every field beyond `v` was an unchecked `as T` cast. That cast was the actual
 * defect: `{"v":1}` (well-formed JSON, right version, wrong shape — e.g. a write truncated by a
 * killed tab, a quota failure mid-JSON.stringify, or an older/partial schema) came back as if it
 * were a full record, and a caller that dereferenced further (`stored.record.seed`) threw. Making
 * the type predicate mandatory closes the door on that class of bug for every current AND future
 * caller — there is no signature under which a caller can get an unchecked cast out of this
 * function again. (streak.ts independently arrived at the same shape — its own hand-rolled
 * `isStreakRecord` — because it doesn't route through here; that guard is precisely what every
 * `readVersioned` caller gets for free with this change.)
 *
 * On an invalid shape the bad key is REMOVED (not merely ignored), matching writeVersioned/
 * removeVersioned's own "degrade silently" posture. Rationale: this is client-local, ephemeral
 * resume-state with no forensic/support tooling that reads raw localStorage (grepped: nothing in
 * this codebase inspects these keys except through this module) — nothing of value is lost by
 * clearing it, and writeVersioned will overwrite it on the next successful write regardless.
 * Deleting is what makes "fresh start" actually non-sticky: leaving the bad value in place would
 * still fix TODAY's caller (it now validates), but would leave a landmine for any future caller
 * that reads this same key with a less careful cast — exactly the bug this fix exists to retire.
 * A `console.warn`-and-keep approach was considered and rejected: it would surface (or risk
 * surfacing) the raw stored value in a client-visible log, and this module has no logging
 * convention today to make that safe.
 */
export function readVersioned<T extends Versioned>(
  key: string,
  expectedVersion: number,
  isValid: (value: unknown) => value is T
): T | undefined {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return undefined; // storage disabled/throws — degrade silently, no persistence.
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // corrupt JSON — fresh start, never crash.
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Versioned).v !== "number" ||
    (parsed as Versioned).v !== expectedVersion
  ) {
    // missing/mismatched version — fresh start. Deliberately NOT removed: an older-version
    // record is not corrupt, it's pre-migration data a future schema bump may still want to
    // read and transform forward. (No such migration path exists in this codebase today —
    // grepped — so this is a forward-looking distinction, not a currently-exercised one.)
    return undefined;
  }

  if (!isValid(parsed)) {
    // Right envelope (correct v), WRONG SHAPE — PERS-001. Unlike a version mismatch, this is
    // genuine corruption (a truncated write, a killed tab mid-write, quota failure): there is
    // no future code that legitimately wants this exact value back. Removed so the failure is
    // NOT sticky — see this function's doc comment above for the full rationale.
    removeVersioned(key);
    return undefined;
  }

  return parsed;
}

/** Writes `value` (which must carry its own `v`). Silently no-ops if storage throws. */
export function writeVersioned<T extends Versioned>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode / quota-exceeded / storage disabled: degrade silently (plan §5.6).
  }
}

/** Removes a key. Silently no-ops if storage throws. */
export function removeVersioned(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Degrade silently, same as above.
  }
}

// packages/shell/src/persistence.ts — the versioned localStorage envelope (plan §5.6).
//
// Every key is `ta:`-prefixed. All reads go through `readVersioned`: a JSON parse failure or
// a version mismatch returns `undefined` (fresh start) — never throws. Writes go through
// `writeVersioned`, which degrades silently (no persistence, no error surfaced) if
// localStorage throws (private-mode storage failure, quota exceeded, or storage disabled).
// This module never reads any game's rules — it is pure key/value plumbing.

export const STREAK_KEY = "ta:streak";
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
 * match `expectedVersion`, or localStorage itself is unavailable/throws (private mode).
 */
export function readVersioned<T extends Versioned>(key: string, expectedVersion: number): T | undefined {
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
    return undefined; // missing/mismatched version — fresh start.
  }

  return parsed as T;
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

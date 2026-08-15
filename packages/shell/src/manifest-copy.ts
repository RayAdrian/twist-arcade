// packages/shell/src/manifest-copy.ts — shared manifest-derived copy formatting. Currently one
// function, used by BOTH GameCard.tsx and the home page hero (app/page.tsx) — pulled out of
// each so the fix lives in exactly one place.

/**
 * Formats the "a twist on {classic}" attribution line shown under a game's title (GameCard,
 * the home hero).
 *
 * Most manifests' `classic` field really is a classic-game name ("Tic-Tac-Toe",
 * "Minesweeper") that reads naturally behind that prefix. `classic: null` means the opposite —
 * this game has no classic-game ancestor to attribute (an original design, e.g. Crackstep) —
 * and returns `null` (render nothing) rather than "a twist on null".
 *
 * Historical note: before `classic` was `string | null` (platform-corrections.md C77 item 4,
 * task #23), "no classic" was encoded as a string STARTING WITH "N/A", and this function tested
 * for that sentinel with a case-insensitive, word-boundary regex. That string-sentinel check is
 * DELETED, not kept alongside the real `null` check — a sentinel test left beside a real type is
 * how the next reader concludes the sentinel is still meaningful. `classic` is a real type now;
 * `null` is the only "no classic" signal, and no manifest should ever set `classic` to an
 * "N/A"-shaped string again.
 *
 * The blank/whitespace-only guard below is unrelated to the retired sentinel and stays: it
 * guards a still-possible data bug (a manifest author setting `classic: ""` instead of `null`),
 * not a convention this function needs to understand.
 */
export function classicAttributionLine(classic: string | null): string | null {
  if (classic === null) return null;
  const trimmed = classic.trim();
  if (trimmed.length === 0) return null;
  return `a twist on ${trimmed}`;
}

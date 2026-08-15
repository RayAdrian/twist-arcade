// packages/shell/src/manifest-copy.ts — shared manifest-derived copy formatting. Currently one
// function, used by BOTH GameCard.tsx and the home page hero (app/page.tsx) — pulled out of
// each so the fix lives in exactly one place.

// The "N/A" sentinel, case-insensitive, requiring a word boundary right after it (so a
// hypothetical classic like "N/Athletics" is NOT mistaken for the sentinel — only "N/A",
// "n/a", "N/A — ..." etc., where what follows "a"/"A" is punctuation, whitespace, or the end of
// the string). Matched against the TRIMMED classic so leading whitespace can't dodge it.
const NA_SENTINEL = /^n\/a\b/i;

/**
 * Formats the "a twist on {classic}" attribution line shown under a game's title (GameCard,
 * the home hero).
 *
 * Most manifests' `classic` field really is a classic-game name ("Tic-Tac-Toe",
 * "Minesweeper") that reads naturally behind that prefix. Crackstep is the one exception:
 * games/crackstep/manifest.ts sets `classic` to the explanatory placeholder
 * `"N/A — an original twist on a floor-coverage path puzzle"` (this puzzle has no classic-game
 * ancestor to attribute) — prefixing "a twist on " onto THAT string produced the reported
 * defect: "a twist on N/A — an original twist on a floor-coverage path puzzle" on both the
 * Crackstep card and the home hero. Returns `null` (render nothing) for:
 *   - any `classic` starting with the case-insensitive "N/A" sentinel (see `NA_SENTINEL`)
 *     above — this convention is documented on `GameManifest.classic` itself (packages/
 *     game-spec/src/manifest.ts) so game authors know it exists;
 *   - a blank or whitespace-only `classic` (C77 item 4: `""` used to fall through the
 *     `startsWith` check and render the dangling "a twist on " with nothing after it).
 *
 * Deliberately does NOT touch the manifest itself, and does NOT widen `classic`'s TYPE to admit
 * `null` — `classic: string | null` has been ruled the right end state (task #23), but that's a
 * cross-team, five-game migration scheduled separately; this function only changes how ONE
 * piece of DERIVED copy reads a still-`string` field, via a string-level sentinel convention.
 */
export function classicAttributionLine(classic: string): string | null {
  const trimmed = classic.trim();
  if (trimmed.length === 0) return null;
  if (NA_SENTINEL.test(trimmed)) return null;
  return `a twist on ${trimmed}`;
}

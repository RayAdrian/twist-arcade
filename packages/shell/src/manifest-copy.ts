// packages/shell/src/manifest-copy.ts — shared manifest-derived copy formatting. Currently one
// function, used by BOTH GameCard.tsx and the home page hero (app/page.tsx) — pulled out of
// each so the fix lives in exactly one place.

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
 * Crackstep card and the home hero. Returns `null` (render nothing) for any `classic` starting
 * with `"N/A"` rather than a garbled sentence.
 *
 * Deliberately does NOT touch the manifest itself — `classic` is shared, load-bearing data
 * (buildShelves groups by it; the string is correct for that purpose). This function only
 * changes how ONE piece of copy is derived from it.
 */
export function classicAttributionLine(classic: string): string | null {
  if (classic.startsWith("N/A")) return null;
  return `a twist on ${classic}`;
}

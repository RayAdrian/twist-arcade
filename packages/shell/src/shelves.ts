// packages/shell/src/shelves.ts — buildShelves (plan §8.2): the library home's shelf
// derivation. A pure function so the SAME code serves 6, 15, and 40+ games with no rewrite —
// only the home page's render layer decides how many shelves to show/curate at 40+.

import type { GameManifest } from "@twist-arcade/game-spec";

const SHELF_CAP = 8;

export interface Shelf {
  title: string;
  /** Present for a named classic-family shelf; absent for the "All games" remainder shelf. */
  classic?: string;
  games: GameManifest[];
  /** True when the classic family has more games than SHELF_CAP ("See all" affordance). */
  hasMore: boolean;
}

export function buildShelves(manifests: readonly GameManifest[]): Shelf[] {
  const byClassic = new Map<string, GameManifest[]>();
  const remainder: GameManifest[] = [];

  for (const m of manifests) {
    // `classic: null` means "no classic-game ancestor" (GameManifest.classic doc) — an
    // original design. It routes straight to the remainder shelf and is NEVER grouped with
    // another `null` game: two originals sharing "no classic" are not a shared classic family,
    // and grouping them by the shared `null` key would produce a shelf titled "Twists on null"
    // — the same garbled-copy defect platform-corrections.md C77 fixed one level up, just with
    // `null` standing in for the old string sentinel. Handled explicitly here, not by accident
    // of every `null` group having size 1 — that accident is exactly what let two DIFFERENT
    // original games (both `null`) silently collide into one shelf under the old string-keyed
    // Map, since `null === null` but two distinct sentinel strings never collided.
    if (m.classic === null) {
      remainder.push(m);
      continue;
    }
    const group = byClassic.get(m.classic);
    if (group) group.push(m);
    else byClassic.set(m.classic, [m]);
  }

  const shelves: Shelf[] = [];

  // Map preserves first-insertion order, so shelf order is deterministic given the same
  // (registry-ordered) input.
  for (const [classic, games] of byClassic) {
    if (games.length >= 2) {
      shelves.push({
        title: `Twists on ${classic}`,
        classic,
        games: games.slice(0, SHELF_CAP),
        hasMore: games.length > SHELF_CAP,
      });
    } else {
      remainder.push(...games);
    }
  }

  if (remainder.length > 0) {
    shelves.push({
      title: "All games",
      games: remainder.slice(0, SHELF_CAP),
      hasMore: remainder.length > SHELF_CAP,
    });
  }

  return shelves;
}

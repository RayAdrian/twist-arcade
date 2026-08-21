// games/crackstep/ui/materials.ts — the ONE source of truth for Crackstep's four material
// colors. Board.tsx (the actual tile render) and SidePanel.tsx (the "Floor left" legend) each
// need the same four hex values, and previously declared them independently — two copies of one
// fact that could silently drift apart (a board retune would leave the legend describing a
// color the board no longer shows). Both now import this module instead of hardcoding their own
// copy; test/materials-consistency.test.tsx cross-renders both components and asserts their
// computed colors actually match, so a future hand-edit to either file's own literal (not just a
// missed import) still fails loudly rather than silently drifting.
//
// Keyed by the same `CellVisualState`-shaped names Board.tsx's TileFace already used
// ("crumbling" = wood, not yet crossed; "crumbled" = rubble, gone) rather than SidePanel's more
// reader-friendly legend labels ("wood"/"rubble") — SidePanel maps these onto its own labels
// itself; this module only owns the literal color values.

export const MATERIAL_COLORS = {
  /** Wooden tile, not yet crossed — crumbles the instant you leave it. */
  crumbling: "#b98a52",
  /** Stone tile — never crumbles. */
  stone: "#cfcabe",
  /** A wooden tile that has already crumbled — gone for good ("rubble" in the legend). */
  crumbled: "#4a4238",
  /** Never was floor. */
  hole: "#171310",
} as const;

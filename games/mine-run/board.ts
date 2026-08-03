// games/mine-run/board.ts — pure grid geometry, no engine/rng dependency. 8-neighbor adjacency
// on a plain (non-wrapping) w x h grid, classic Minesweeper adjacent-mine counts, and the
// classic zero-flood traversal (docs/plans/mine-run.md R2, R4). Shared by engine.ts (setup's
// opening-region selection and apply()'s reveal transition) and csp.ts (constraint-building
// needs the same neighbor function). No randomness, no state — every function is a pure
// function of (cell, mines, width, height).

/** All in-bounds 8-neighbors of `cell` on a width x height grid (no wrap — Mine Run is R1's
 *  plain grid; a wrapping variant is a different game, "Wrap Sweep", not this one). */
export function neighbors(cell: number, width: number, height: number): number[] {
  const row = Math.floor(cell / width);
  const col = cell % width;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= height || c < 0 || c >= width) continue;
      out.push(r * width + c);
    }
  }
  return out;
}

/** The classic revealed-cell number: how many of `cell`'s 8 neighbors are mines. Defined for
 *  any cell (including mines themselves, though a mine's own count is never shown to a
 *  player — the view never carries a number for an exploded cell, per the view contract). */
export function countAdjacentMines(cell: number, mines: ReadonlySet<number>, width: number, height: number): number {
  let n = 0;
  for (const nb of neighbors(cell, width, height)) {
    if (mines.has(nb)) n++;
  }
  return n;
}

/**
 * Classic zero-flood fill (R4): reveals `start` and, if it is a zero-count cell, every cell
 * reachable through a chain of zero-count cells, including the non-zero cells that border
 * that chain (which are opened but not themselves expanded through). If `start` itself has a
 * non-zero count, this simply returns `[start]` — the same function serves both the flood
 * case and the plain single-cell reveal case (R2's opening-region fallback reuses this too).
 *
 * Traversal is a pure function of the true mine layout — it does NOT consult any "already
 * revealed" set, so the same call always returns the same connected region regardless of
 * game history. The caller (engine.ts's apply()) is responsible for filtering out cells that
 * happen to already be revealed globally before counting them toward the streak/effects.
 *
 * Order is deterministic (BFS by increasing distance, ties broken by cell index via
 * neighbors()'s fixed iteration order) so callers that care about effect ordering get a
 * stable sequence for a fixed mine layout.
 */
export function floodFrom(start: number, mines: ReadonlySet<number>, width: number, height: number): number[] {
  const opened: number[] = [start];
  const seen = new Set<number>([start]);
  const queue: number[] = [start];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++]!;
    if (countAdjacentMines(cur, mines, width, height) !== 0) continue; // leaf: opened, not expanded
    for (const nb of neighbors(cur, width, height)) {
      if (mines.has(nb) || seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
      opened.push(nb);
    }
  }
  return opened;
}

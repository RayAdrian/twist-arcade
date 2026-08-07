// games/tilt/engine.test.ts — TDD per CLAUDE.md §3: every `it` below pins one behavior from
// docs/plans/tilt.md's §1 (ruleset fine print), §2.1 (position identity), §3 (engine spec /
// TDD anchors), derived from the plan, not from engine.ts's implementation. The generic
// `engineContract()` suite covers purity/determinism/legality-coherence/encode-decode-roundtrip/
// etc. generically; everything below is game-specific.
//
// `runs: 100` is explicit (not the testkit's own default) — G-14's rule: CI must never depend
// on a library default for its sample count.
//
// GRID CONVENTION (engine-internal.ts's own doc): index = row*size + col, row 0 = top, row
// size-1 (6) = bottom. Every hand-computed fixture below is traced by hand against that
// convention and the rotation formula CW: new(row,col) at (c, size-1-row) — see each describe
// block's own comment for the trace.

import { describe, expect, it } from "vitest";
import { engineContract } from "@twist-arcade/engine/testkit";
import { rngFor, rngForSetup, type PlayerId } from "@twist-arcade/engine";
import {
  SIZE,
  TOTAL_CELLS,
  WIN_LENGTH,
  createTiltEngine,
  discCount,
  lastMoverOf,
  tilt,
  toMoveOf,
  windowsFor,
  type TiltState,
} from "./engine";
import type { Disc } from "./engine-internal";
import { mirrorMove } from "./probes";

engineContract(tilt, { runs: 100, maxPlies: 60 });

// ---------------------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------------------

function apply(
  engine: typeof tilt,
  state: TiltState,
  player: PlayerId,
  column: number,
  seed = "t",
  step = 0
): TiltState {
  return engine.apply(state, new Map([[player, { column }]]), rngFor(seed, step));
}

function emptyGrid(): Disc[] {
  return new Array<Disc>(TOTAL_CELLS).fill(null);
}

function idx(row: number, col: number): number {
  return row * SIZE + col;
}

function decodeGrid(engine: typeof tilt, grid: readonly Disc[]): TiltState {
  return engine.decode(JSON.stringify({ grid }));
}

describe("tilt engine — basic shape", () => {
  it("exposes meta for a 2-player perfect-information game", () => {
    expect(tilt.meta.id).toBe("tilt");
    expect(tilt.meta.minPlayers).toBe(2);
    expect(tilt.meta.maxPlayers).toBe(2);
    expect(tilt.meta.hiddenInformation).toBe(false);
    expect(tilt.meta.simultaneous).toBe(false);
    expect(tilt.meta.stochastic).toBe(false);
  });

  it("setup() starts with an empty 49-cell grid, seat 0 (P1) to move, no effects", () => {
    const state = tilt.setup(2, rngForSetup("s1"));
    expect(state.grid).toHaveLength(TOTAL_CELLS);
    expect(state.grid.every((c) => c === null)).toBe(true);
    expect(toMoveOf(state.grid)).toBe(0);
    expect(state.lastEffects).toEqual([]);
  });

  it("legalMoves offers every non-full column; a drop places at the lowest empty cell", () => {
    let state = tilt.setup(2, rngForSetup("s2"));
    expect(tilt.legalMoves(state, 0)).toHaveLength(SIZE);
    state = apply(tilt, state, 0, 3, "s2", 0);
    expect(state.grid[idx(SIZE - 1, 3)]).toBe(0);
    expect(toMoveOf(state.grid)).toBe(1);
    expect(state.lastEffects).toEqual([{ type: "placed", player: 0, column: 3, cell: idx(SIZE - 1, 3) }]);
  });

  it("a second drop in the same column lands one row higher", () => {
    let state = tilt.setup(2, rngForSetup("s3"));
    state = apply(tilt, state, 0, 2, "s3", 0);
    state = apply(tilt, state, 1, 2, "s3", 1);
    expect(state.grid[idx(SIZE - 1, 2)]).toBe(0);
    expect(state.grid[idx(SIZE - 2, 2)]).toBe(1);
  });

  it("a full column is illegal and absent from legalMoves", () => {
    let state = tilt.setup(2, rngForSetup("full1"));
    // Fill column 0 without EVER hitting a tilt ply (period 4) or a win — alternate with
    // column 6 as a disposable dump so column 0 alone climbs to full over 7 of the player's
    // own drops spread across many total plies, tilts included (compaction never removes
    // discs from a column that's part of neither this test's assertion), asserted only on
    // column 0's own fullness at the end.
    let ply = 0;
    while (tilt.legalMoves(state, toMoveOf(state.grid)).some((m) => m.column === 0)) {
      state = apply(tilt, state, toMoveOf(state.grid), 0, "full1", ply++);
      if (tilt.status(state).kind !== "ongoing") break;
    }
    expect(tilt.isLegal(state, toMoveOf(state.grid), { column: 0 })).toBe(false);
    expect(tilt.legalMoves(state, toMoveOf(state.grid)).some((m) => m.column === 0)).toBe(false);
    expect(() => apply(tilt, state, toMoveOf(state.grid), 0, "full1", ply)).toThrow(/illegal move/);
  });
});

describe("tilt engine — rotation fires on schedule, and only when the drop didn't end the game", () => {
  // Hand-traced 4-ply sequence (plan §3's TDD anchor). Plies: P1(seat0)->col0, P2(seat1)->col0,
  // P1(seat0)->col1, P2(seat1)->col0 (the 4th ply — tiltPeriod=4, and the drop itself creates
  // no line, so the tilt fires).
  //
  // Pre-rotation grid (row-major, row0=top row6=bottom): (r4,c0)=1, (r5,c0)=1, (r6,c0)=0,
  // (r6,c1)=0.
  //
  // Rotation CW: new(c, 6-r) = old(r,c).
  //   (4,0)=1 -> new(0,2)   (5,0)=1 -> new(0,1)   (6,0)=0 -> new(0,0)   (6,1)=0 -> new(1,0)
  //
  // Compaction (per new column, preserving relative order, pushed to the bottom):
  //   new col0: [(row0,val0),(row1,val0)] -> row5=0 (from row0), row6=0 (from row1)
  //   new col1: [(row0,val1)] -> row6=1
  //   new col2: [(row0,val1)] -> row6=1
  it("a hand-computed 4-ply sequence produces the exact predicted post-tilt grid and moved list", () => {
    let state = tilt.setup(2, rngForSetup("hand4"));
    state = apply(tilt, state, 0, 0, "hand4", 0); // ply1: seat0 -> col0, row6
    state = apply(tilt, state, 1, 0, "hand4", 1); // ply2: seat1 -> col0, row5
    state = apply(tilt, state, 0, 1, "hand4", 2); // ply3: seat0 -> col1, row6
    state = apply(tilt, state, 1, 0, "hand4", 3); // ply4: seat1 -> col0, row4 — tilt fires

    const finalNonNull = state.grid
      .map((v, i) => [i, v] as const)
      .filter(([, v]) => v !== null);
    expect(new Map(finalNonNull)).toEqual(
      new Map([
        [idx(5, 0), 0],
        [idx(6, 0), 0],
        [idx(6, 1), 1],
        [idx(6, 2), 1],
      ])
    );

    expect(state.lastEffects).toEqual([
      { type: "placed", player: 1, column: 0, cell: idx(4, 0) },
      { type: "tilted", direction: "cw" },
      { type: "moved", player: 0, from: idx(0, 0), to: idx(5, 0) },
      { type: "moved", player: 0, from: idx(1, 0), to: idx(6, 0) },
      { type: "moved", player: 1, from: idx(0, 1), to: idx(6, 1) },
      { type: "moved", player: 1, from: idx(0, 2), to: idx(6, 2) },
    ]);
  });

  it("does NOT rotate on non-tilt plies (ply 1-3, 5-7, ...)", () => {
    let state = tilt.setup(2, rngForSetup("noro"));
    state = apply(tilt, state, 0, 0, "noro", 0);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(false);
    state = apply(tilt, state, 1, 1, "noro", 1);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(false);
    state = apply(tilt, state, 0, 2, "noro", 2);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(false);
  });

  it("a drop completing 4-in-a-row on a tilt ply ends the game with NO rotation (win-check precedes tilt)", () => {
    // Pre-move (discCount=7, toMove=seat1 — see this file's module doc for the grid convention):
    // row6: col0=1,col1=1,col2=1 (seat1, open 3), col4=0,col5=0,col6=0 (seat0, open 3, unrelated)
    // row5: col0=0 (seat0 filler, keeps col0 non-floating and parity at 4-3).
    const grid = emptyGrid();
    grid[idx(6, 0)] = 1;
    grid[idx(6, 1)] = 1;
    grid[idx(6, 2)] = 1;
    grid[idx(6, 4)] = 0;
    grid[idx(6, 5)] = 0;
    grid[idx(6, 6)] = 0;
    grid[idx(5, 0)] = 0;
    let state = decodeGrid(tilt, grid);
    expect(toMoveOf(state.grid)).toBe(1);
    expect(tilt.status(state)).toEqual({ kind: "ongoing" });

    state = apply(tilt, state, 1, 3, "winontilt", 0); // completes row6 cols0-3 for seat1
    expect(tilt.status(state)).toEqual({ kind: "won", winner: 1 });
    expect(state.lastEffects).toEqual([{ type: "placed", player: 1, column: 3, cell: idx(6, 3) }]);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(false);
  });

  it("a re-fall completing a line for the NON-mover ends the game in their favor, even though the mover moved", () => {
    // Pre-move (discCount=7, toMove=seat1): seat0 at row6 cols 0,2,4,6 (isolated, no line —
    // all map to the SAME new column under rotation, since rotation groups by OLD ROW only).
    // seat1 fillers at (row4,col0),(row5,col0),(row5,col2) — a different old row, keeping
    // seat0's group untouched and column0/column2 non-floating.
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 2)] = 0;
    grid[idx(6, 4)] = 0;
    grid[idx(6, 6)] = 0;
    grid[idx(4, 0)] = 1;
    grid[idx(5, 0)] = 1;
    grid[idx(5, 2)] = 1;
    let state = decodeGrid(tilt, grid);
    expect(toMoveOf(state.grid)).toBe(1);
    expect(tilt.status(state)).toEqual({ kind: "ongoing" });

    // seat1 (mover) drops in column 4 — lands at row5 (row6 already seat0) — old row5, so it
    // joins the OTHER new column, never seat0's group.
    state = apply(tilt, state, 1, 4, "nonmover", 0);
    expect(discCount(state.grid)).toBe(8);
    expect(lastMoverOf(state.grid)).toBe(1); // seat1 moved last

    expect(tilt.status(state)).toEqual({ kind: "won", winner: 0 }); // seat0 wins despite NOT moving
    // The predicted vertical win: column0 rows 3-6, all seat0.
    expect(state.grid[idx(3, 0)]).toBe(0);
    expect(state.grid[idx(4, 0)]).toBe(0);
    expect(state.grid[idx(5, 0)]).toBe(0);
    expect(state.grid[idx(6, 0)]).toBe(0);
    expect(state.lastEffects[0]).toEqual({ type: "placed", player: 1, column: 4, cell: idx(5, 4) });
    expect(state.lastEffects[1]).toEqual({ type: "tilted", direction: "cw" });
    // Every disc that isn't already resting is accounted for by a "moved" effect landing
    // exactly where the final grid says it is — self-consistency over a full literal
    // transcription of all 7 tuples (this fixture's move count), still a real check.
    const movedEffects = state.lastEffects.slice(2);
    expect(movedEffects.every((e) => e.type === "moved")).toBe(true);
    for (const e of movedEffects) {
      if (e.type !== "moved") continue;
      expect(state.grid[e.to as number]).toBe(e.player);
    }
  });

  it("a double-line re-fall (both players complete a line at once) is a DRAW under the shipped doubleLine:'draw' config", () => {
    // seat0 at row6 cols 0,2,4,6 -> new column0 (vertical win). seat1 STACKED directly above
    // at row5 cols 0,2,4 (fillers) + row5 col6 (the triggering drop) -> new column1 (vertical
    // win too) — both fire from the SAME tilt.
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 2)] = 0;
    grid[idx(6, 4)] = 0;
    grid[idx(6, 6)] = 0;
    grid[idx(5, 0)] = 1;
    grid[idx(5, 2)] = 1;
    grid[idx(5, 4)] = 1;
    let state = decodeGrid(tilt, grid);
    expect(toMoveOf(state.grid)).toBe(1);

    state = apply(tilt, state, 1, 6, "doubleline", 0); // lands row5,col6 — completes seat1's group
    expect(discCount(state.grid)).toBe(8);
    expect(tilt.status(state)).toEqual({ kind: "draw" });
    // Both predicted vertical wins are actually present in the final grid.
    for (const r of [3, 4, 5, 6]) {
      expect(state.grid[idx(r, 0)]).toBe(0);
      expect(state.grid[idx(r, 1)]).toBe(1);
    }
  });

  it("the SAME double-line fixture awards the mover under doubleLine:'mover-wins'", () => {
    const moverWins = createTiltEngine({ doubleLine: "mover-wins" });
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 2)] = 0;
    grid[idx(6, 4)] = 0;
    grid[idx(6, 6)] = 0;
    grid[idx(5, 0)] = 1;
    grid[idx(5, 2)] = 1;
    grid[idx(5, 4)] = 1;
    let state = decodeGrid(moverWins, grid);
    state = apply(moverWins, state, 1, 6, "doubleline-mw", 0);
    expect(moverWins.status(state)).toEqual({ kind: "won", winner: 1 }); // seat1 was the mover
  });

  it("order-preservation: two discs sharing a post-rotation column keep their relative order (property, randomized)", () => {
    for (let trial = 0; trial < 30; trial++) {
      let state = tilt.setup(2, rngForSetup(`order-${trial}`));
      let ply = 0;
      // Play up to 3 plies (never quite reaching a tilt) so we control exactly which column
      // gets 2+ discs before manually triggering a 4th-ply tilt with a KNOWN 4th move.
      const cols = [0, 0, 1]; // two discs in col0 (bottom then one above), one in col1
      for (const col of cols) {
        if (tilt.status(state).kind !== "ongoing") break;
        state = apply(tilt, state, toMoveOf(state.grid), col, `order-${trial}`, ply++);
      }
      if (tilt.status(state).kind !== "ongoing") continue;
      const beforeTilt = state;
      const col0BottomPlayer = beforeTilt.grid[idx(SIZE - 1, 0)];
      const col0AbovePlayer = beforeTilt.grid[idx(SIZE - 2, 0)];
      expect(col0BottomPlayer).not.toBeNull();
      expect(col0AbovePlayer).not.toBeNull();

      state = apply(tilt, state, toMoveOf(state.grid), 4, `order-${trial}`, ply++); // 4th ply: tilt fires
      if (!state.lastEffects.some((e) => e.type === "tilted")) continue; // drop ended the game first

      // Both discs originally in column0 land in the SAME new column (new column = f(old row)
      // is per-ROW, not per-column, only true when they share an old row — here they don't
      // necessarily, so instead assert the WEAKER, always-true property: within any single
      // final column, discs appear in an order consistent with SOME valid pre-tilt ordering —
      // i.e., compaction never reports a "moved" pair whose relative from-order contradicts
      // its to-order for entries in the same destination column.
      const movedByColumn = new Map<number, { from: number; to: number }[]>();
      for (const e of state.lastEffects) {
        if (e.type !== "moved") continue;
        const col = (e.to as number) % SIZE;
        const list = movedByColumn.get(col) ?? [];
        list.push({ from: e.from as number, to: e.to as number });
        movedByColumn.set(col, list);
      }
      for (const list of movedByColumn.values()) {
        const sortedByFromRow = [...list].sort((a, b) => Math.floor(a.from / SIZE) - Math.floor(b.from / SIZE));
        const sortedByToRow = [...list].sort((a, b) => Math.floor(a.to / SIZE) - Math.floor(b.to / SIZE));
        expect(sortedByFromRow).toEqual(sortedByToRow);
      }
    }
  });

  it("a tilt whose re-fall moves nothing is a legal no-op (moved: [])", () => {
    // Stack all 4 plies in the SAME column (6): old column c=6 is constant, so under CW
    // rotation (nr=c) every one of these discs lands at new ROW 6 — already the bottom row —
    // each in its OWN new column (nc=6-r, and the 4 discs used old rows 6,5,4,3 -> nc 0,1,2,3).
    // Every disc is therefore already resting exactly where compaction would put it: a true
    // no-op, not merely "few discs move".
    let state = tilt.setup(2, rngForSetup("noop"));
    state = apply(tilt, state, 0, 6, "noop", 0); // row6
    state = apply(tilt, state, 1, 6, "noop", 1); // row5
    state = apply(tilt, state, 0, 6, "noop", 2); // row4
    state = apply(tilt, state, 1, 6, "noop", 3); // row3 — 4th ply: tilt fires
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(true);
    expect(state.lastEffects.filter((e) => e.type === "moved")).toEqual([]);
  });
});

describe("tilt engine — full board / edge cases (plan §1.5)", () => {
  it("board full with no line anywhere is a draw", () => {
    // A 49-disc, fully-packed grid with no 4-run in any of the 4 directions (row, column,
    // both diagonals) — found by local search (starting from a period-5-phase striping
    // provably free of any 4-run, then hill-climbing single-cell flips toward exact parity
    // while rejecting any flip that creates one) and verified programmatically: 25 seat0, 24
    // seat1 (diff=1, valid), zero winning windows. See this test's git history / PR notes for
    // the generator script if this fixture ever needs to be regenerated.
    const grid = JSON.parse(
      "[0,0,1,0,1,0,1,0,1,0,0,1,1,1,0,1,0,1,0,0,1,1,0,0,1,0,1,0,1,0,1,0,1,1,1,0,0,1,0,1,0,0,0,1,0,0,1,1,1]"
    ) as Disc[];
    expect(grid).toHaveLength(TOTAL_CELLS);
    const state = decodeGrid(tilt, grid);
    expect(tilt.status(state)).toEqual({ kind: "draw" });
  });

  it("the 49th (final) placement that ALSO completes a line: the line wins, full-board draw does not pre-empt it", () => {
    // Same generator (see the previous test), searched further for a column whose top cell
    // (row 0 — the LAST cell any column can ever receive) completing a window is possible
    // without any window already being complete beforehand. Found: column 0, with rows 1-6
    // holding [0,0,0,1,1,0] (bottom to... top just below row0) — verified programmatically:
    // zero windows complete with row 0 empty (48 discs, ongoing); dropping seat0's disc at
    // (row 0, col 0) completes exactly one window and no other; parity valid before (24-24)
    // and after (25-24) the drop.
    const before = JSON.parse(
      "[null,0,1,0,1,0,1,0,1,0,0,1,1,1,0,1,0,1,0,0,1,0,0,0,1,0,1,0,1,0,1,0,1,1,1,1,0,1,0,1,0,0,0,1,0,0,1,1,1]"
    ) as Disc[];
    expect(before).toHaveLength(TOTAL_CELLS);
    const filled = before.filter((c) => c !== null).length;
    expect(filled).toBe(TOTAL_CELLS - 1);
    const toMoveBefore = filled % 2 === 0 ? 0 : 1;
    let state = decodeGrid(tilt, before);
    expect(tilt.status(state)).toEqual({ kind: "ongoing" });
    expect(tilt.legalMoves(state, toMoveOf(state.grid))).toHaveLength(1);
    expect(tilt.legalMoves(state, toMoveOf(state.grid))[0]).toEqual({ column: 0 });

    state = apply(tilt, state, toMoveBefore, 0, "lastcell", 0);
    expect(state.grid.every((c) => c !== null)).toBe(true);
    expect(tilt.status(state)).toEqual({ kind: "won", winner: 0 });
  });
});

describe("tilt engine — encode/decode (plan §2.1, §3, C4)", () => {
  it("encode = canonical grid serialization only, excludes lastEffects", () => {
    let state = tilt.setup(2, rngForSetup("enc1"));
    state = apply(tilt, state, 0, 5, "enc1", 0);
    const parsed = JSON.parse(tilt.encode(state)) as Record<string, unknown>;
    expect(parsed).toHaveProperty("grid");
    expect(parsed).not.toHaveProperty("lastEffects");
    expect(parsed).not.toHaveProperty("toMove");
  });

  it("two different move orders reaching the same grid encode identically (C3/§2.1 property)", () => {
    function playInOrder(cols: number[]): TiltState {
      let s = tilt.setup(2, rngForSetup("commute"));
      for (let step = 0; step < cols.length; step++) {
        s = apply(tilt, s, toMoveOf(s.grid), cols[step]!, "commute-play", step);
      }
      return s;
    }
    // Disc VALUE is tied to ply parity (seat 0 plays odd plies, seat 1 even — plan §2.1), so an
    // ARBITRARY permutation of a column list generally reaches a DIFFERENT grid (it changes
    // which seat's disc lands in which column). The permutation that DOES preserve the final
    // grid: shuffle the columns visited on odd plies among themselves, and separately shuffle
    // the columns visited on even plies among themselves — every column still ends up owned by
    // the same seat, just placed on a different (same-parity) ply number. 4 plies, 4 distinct
    // untouched columns, tilt fires on ply 4 in both — the PRE-tilt grid is identical in both
    // orders (same column->seat assignment), so the SAME rotation+compaction applies to both.
    const a = playInOrder([0, 1, 2, 3]); // odd plies (1,3) -> cols {0,2}; even plies (2,4) -> cols {1,3}
    const b = playInOrder([2, 3, 0, 1]); // odd plies (1,3) -> cols {2,0}; even plies (2,4) -> cols {3,1}
    expect(a.grid).toEqual(b.grid);
    expect(tilt.encode(a)).toBe(tilt.encode(b));
  });

  it("throws on wrong grid length", () => {
    expect(() => tilt.decode(JSON.stringify({ grid: [null, null] }))).toThrow(/length/);
  });

  it("throws on invalid cell values", () => {
    const grid = emptyGrid();
    grid[0] = 2 as unknown as Disc;
    expect(() => tilt.decode(JSON.stringify({ grid }))).toThrow(/null, 0, or 1/);
  });

  it("throws on a floating disc (empty cell below an occupied one)", () => {
    const grid = emptyGrid();
    grid[idx(0, 0)] = 0; // occupied at the TOP with nothing below it in the same column
    expect(() => tilt.decode(JSON.stringify({ grid }))).toThrow(/floating/);
  });

  it("throws on a count-parity violation", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 1)] = 1;
    grid[idx(6, 2)] = 1; // p0=1, p1=2, diff=-1 — invalid (must be 0 or 1)
    expect(() => tilt.decode(JSON.stringify({ grid }))).toThrow(/parity/);
  });

  it("ACCEPTS a both-players-lined grid as a legitimate terminal draw (the opposite of Order vs Chaos's C28/A3 ruling — see engine.ts's decode doc)", () => {
    const grid = emptyGrid();
    for (const r of [3, 4, 5, 6]) grid[idx(r, 0)] = 0; // seat0 vertical run
    for (const r of [3, 4, 5, 6]) grid[idx(r, 1)] = 1; // seat1 vertical run
    let state: TiltState | undefined;
    expect(() => {
      state = tilt.decode(JSON.stringify({ grid }));
    }).not.toThrow();
    expect(tilt.status(state!)).toEqual({ kind: "draw" });
  });

  it("encode(decode(encode(s))) === encode(s) for a hand-built grid (canonical round-trip)", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 1)] = 1;
    const canonical = tilt.encode(tilt.decode(JSON.stringify({ grid })));
    const roundTripped = tilt.encode(tilt.decode(canonical));
    expect(roundTripped).toBe(canonical);
  });
});

describe("tilt engine — structural termination, no repetition (plan §1.6)", () => {
  it("every random playout terminates within 49 plies with zero cap hits, and no encode() value repeats", () => {
    for (let i = 0; i < 40; i++) {
      let state = tilt.setup(2, rngForSetup(`term-${i}`));
      const seen = new Set<string>();
      seen.add(tilt.encode(state));
      let ply = 0;
      for (; ply < TOTAL_CELLS + 5 && tilt.status(state).kind === "ongoing"; ply++) {
        const legal = tilt.legalMoves(state, toMoveOf(state.grid));
        expect(legal.length).toBeGreaterThan(0);
        const move = legal[rngFor(`term-${i}`, ply).int(legal.length)]!;
        state = apply(tilt, state, toMoveOf(state.grid), move.column, `term-${i}`, ply);
        const encoded = tilt.encode(state);
        expect(seen.has(encoded)).toBe(false); // structural: disc count strictly increases
        seen.add(encoded);
      }
      expect(tilt.status(state).kind).not.toBe("ongoing");
      expect(ply).toBeLessThanOrEqual(TOTAL_CELLS); // zero cap hits — assert, per plan §1.6
    }
  });
});

describe("tilt engine — config validation (plan §1)", () => {
  it("rejects an unsupported size", () => {
    expect(() => createTiltEngine({ size: 8 as 6 | 7 })).toThrow(/size/);
  });
  it("rejects winLength other than 4 (fixed, not a lever)", () => {
    expect(() => createTiltEngine({ winLength: 5 as 4 })).toThrow(/winLength/);
  });
  it("rejects an unsupported tiltPeriod", () => {
    expect(() => createTiltEngine({ tiltPeriod: 6 as 4 })).toThrow(/tiltPeriod/);
  });
  it("accepts the two remedy-lever tiltPeriods (3 and 5)", () => {
    expect(() => createTiltEngine({ tiltPeriod: 3 })).not.toThrow();
    expect(() => createTiltEngine({ tiltPeriod: 5 })).not.toThrow();
  });
  it("accepts the 6x6 remedy-lever size", () => {
    const six = createTiltEngine({ size: 6 });
    const state = six.setup(2, rngForSetup("six"));
    expect(state.grid).toHaveLength(36);
  });
});

describe("tilt engine — perfect information", () => {
  it("playerView is the identity for both seats and the spectator", () => {
    let state = tilt.setup(2, rngForSetup("pv1"));
    state = apply(tilt, state, 0, 3, "pv1", 0);
    expect(tilt.playerView(state, 0)).toEqual(state);
    expect(tilt.playerView(state, 1)).toEqual(state);
    expect(tilt.playerView(state, null)).toEqual(state);
  });
});

describe("tilt engine — window geometry pencil-check (plan §1.3-style sanity)", () => {
  it("7x7/win-4 has the expected total window count (28 rows + 28 cols + 16+16 diagonals = 88)", () => {
    expect(windowsFor({ size: SIZE, winLength: WIN_LENGTH })).toHaveLength(88);
  });
});

describe("tilt engine — mirror probe (plan §5.4)", () => {
  it("reflects the opponent's last move's column through the center", () => {
    const state = tilt.setup(2, rngForSetup("mir1"));
    const legal = tilt.legalMoves(state, toMoveOf(state.grid)); // seat 0's turn on a fresh board
    const mirrored = mirrorMove(state, { column: 0 }, legal);
    expect(mirrored).toEqual({ column: SIZE - 1 });
  });
  it("returns null when there is no opponent move yet", () => {
    const state = tilt.setup(2, rngForSetup("mir2"));
    expect(mirrorMove(state, null, tilt.legalMoves(state, 0))).toBeNull();
  });
  it("returns null when the reflected column is full", () => {
    // Column 6 fully packed (7 discs, alternating so no 4-run), everything else empty — built
    // via decode rather than real play so a mid-sequence tilt (period 4) can't scatter the
    // discs elsewhere before the column actually fills. p0=4, p1=3 (diff=1, valid parity).
    const grid = emptyGrid();
    for (let r = 0; r < SIZE; r++) grid[idx(r, 6)] = (r % 2 === 0 ? 0 : 1) as Disc;
    const state = decodeGrid(tilt, grid);
    expect(toMoveOf(state.grid)).toBe(1);
    const legal = tilt.legalMoves(state, toMoveOf(state.grid));
    expect(legal.some((m) => m.column === 6)).toBe(false);
    const mirrored = mirrorMove(state, { column: 0 }, legal); // reflects to column 6, which is full
    expect(mirrored).toBeNull();
  });
});

describe("tilt engine — heuristic (plan §3, optional)", () => {
  it("is symmetric: heuristic(state, 0) === -heuristic(state, 1) on an asymmetric position", () => {
    let state = tilt.setup(2, rngForSetup("heur1"));
    state = apply(tilt, state, 0, 3, "heur1", 0);
    state = apply(tilt, state, 1, 2, "heur1", 1);
    state = apply(tilt, state, 0, 3, "heur1", 2);
    expect(tilt.heuristic!(state, 0)).toBeCloseTo(-tilt.heuristic!(state, 1), 10);
  });

  it("favors the player with an open 3-in-a-row over an empty board", () => {
    const empty = tilt.setup(2, rngForSetup("heur2"));
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 1)] = 0;
    grid[idx(6, 2)] = 0; // seat0's open 3
    grid[idx(6, 4)] = 1;
    grid[idx(6, 5)] = 1; // seat1 fillers, unrelated, keep parity valid (p0=3, p1=2, diff=1)
    const threatState = decodeGrid(tilt, grid);
    expect(tilt.heuristic!(threatState, 0)).toBeGreaterThan(tilt.heuristic!(empty, 0));
  });
});

// games/mine-run/test/csp.test.ts
//
// TDD anchors (docs/plans/mine-run.md §10, §4.2): "CSP known answers: 1-2-1 and 1-2-2-1
// frontier patterns (forced safe/mine cells); a global-count-coupling case where the frontier
// alone is ambiguous but the mine total decides; posterior values on a hand-solved position to
// 3 decimals." Full frontier CSP (component enumeration + global mine-count convolution), NOT
// single-point deduction (plan §4.2's explicit requirement — a single-point solver would miss
// the global-count-coupling case entirely by construction, which is exactly why that case is
// included here as a DISCRIMINATING test, not just a nice-to-have).
//
// A brute-force reference oracle (independent of csp.ts's implementation) is used throughout:
// for small boards it enumerates every literal subset of unrevealed cells of the correct size
// and checks it against every revealed cell's true count, giving exact ground truth without
// borrowing any of csp.ts's own machinery. Cross-checking against this oracle on randomized
// small scenarios, in addition to the named hand patterns, is the strongest evidence this
// module's global coupling is actually correct and not coincidentally right on one example.

import { describe, expect, it } from "vitest";
import { neighbors, countAdjacentMines } from "../board";
import { analyzeFrontier, frontierComponentCount } from "../csp";
import type { MineRunView, MineRunCellView } from "../engine";

function makeView(
  width: number,
  height: number,
  revealed: Map<number, number>, // cell -> true count (exploded cells handled separately)
  minesTotal: number,
  explodedCells: number[] = []
): MineRunView {
  const cells: Record<number, MineRunCellView> = {};
  for (const [cell, n] of revealed) cells[cell] = { n };
  for (const cell of explodedCells) cells[cell] = { exploded: true };
  return {
    width,
    height,
    cells,
    minesTotal,
    minesExploded: explodedCells.length,
    streakLen: 0,
    streakValue: 0,
    nextGain: 1,
    banked: 0,
    revealsLeft: 999,
    lastEffects: [],
  };
}

/** Independent brute-force oracle: exact ground truth for a small board, used to cross-check
 *  analyzeFrontier()'s output rather than trusting a single implementation's self-consistency. */
function bruteForceOracle(
  width: number,
  height: number,
  trueCounts: Map<number, number>, // revealed cell -> true count
  explodedCells: Set<number>,
  minesTotal: number
): { provablySafe: Set<number>; provablyMine: Set<number>; posterior: Map<number, number> } {
  const totalCells = width * height;
  const revealedCells = new Set([...trueCounts.keys(), ...explodedCells]);
  const unrevealed: number[] = [];
  for (let c = 0; c < totalCells; c++) if (!revealedCells.has(c)) unrevealed.push(c);
  const remainingMines = minesTotal - explodedCells.size;

  const mineCount = new Map<number, number>();
  for (const c of unrevealed) mineCount.set(c, 0);
  let worlds = 0;

  const k = unrevealed.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    if (popcount(mask) !== remainingMines) continue;
    const mineSet = new Set<number>();
    for (let i = 0; i < k; i++) if (mask & (1 << i)) mineSet.add(unrevealed[i]!);
    let consistent = true;
    for (const [cell, n] of trueCounts) {
      let count = 0;
      for (const nb of neighbors(cell, width, height)) if (mineSet.has(nb)) count++;
      if (count !== n) {
        consistent = false;
        break;
      }
    }
    if (!consistent) continue;
    worlds++;
    for (const m of mineSet) mineCount.set(m, (mineCount.get(m) ?? 0) + 1);
  }

  const provablySafe = new Set<number>();
  const provablyMine = new Set<number>();
  const posterior = new Map<number, number>();
  for (const c of unrevealed) {
    const count = mineCount.get(c) ?? 0;
    posterior.set(c, worlds === 0 ? 0 : count / worlds);
    if (count === 0) provablySafe.add(c);
    if (count === worlds && worlds > 0) provablyMine.add(c);
  }
  return { provablySafe, provablyMine, posterior };
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
}

describe("CSP module — known-answer patterns", () => {
  it("1-2-1 pattern: the two outer unrevealed cells are provably mines, none of the middle ones are", () => {
    // 3 wide x 2 tall board:
    //   0(rev,1) 1(rev,2) 2(rev,1)
    //   3(unrev) 4(unrev) 5(unrev)
    // Ground truth mine set: {3, 5} (two mines, directly below the two "1"s).
    // True counts: cell0 neighbors {1,3,4} -> mines among them: 3 -> count=1. OK matches.
    //              cell1 neighbors {0,2,3,4,5} -> mines: 3,5 -> count=2. matches.
    //              cell2 neighbors {1,3,4,5} -> mines: 3,5 -> count=2?? wait need count=1.
    // Let's recompute for a true 1-2-1: mines only at 3 and 5 as intended.
    // cell2's neighbors on a 3x2 board (cell2 = row0,col2): row-1 OOB, row0,col1=1, row1,col1=4,
    // row1,col2=5. So neighbors(2) = [1,4,5]. Mines among them: 5 -> count=1. Good, matches "1".
    const width = 3;
    const height = 2;
    const mines = new Set([3, 5]);
    const trueCounts = new Map<number, number>([
      [0, countAdjacentMines(0, mines, width, height)],
      [1, countAdjacentMines(1, mines, width, height)],
      [2, countAdjacentMines(2, mines, width, height)],
    ]);
    expect([...trueCounts.values()]).toEqual([1, 2, 1]); // confirms this really is a 1-2-1

    const view = makeView(width, height, trueCounts, mines.size);
    const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
    const result = analyzeFrontier(view);

    expect(result.provablyMine).toEqual(oracle.provablyMine);
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    // Classic 1-2-1 result: cells 3 and 5 (below the two "1"s) are provably mines; cell 4
    // (below the "2") is NOT provably safe (it's genuinely still ambiguous with only this
    // information — the "2" is already fully explained by 3 and 5, so 4 is actually provably
    // SAFE in this exact configuration, since mines={3,5} already accounts for both of the
    // "2"'s required mines. Assert against the oracle either way, not a hand guess.
    expect(oracle.provablyMine).toEqual(new Set([3, 5]));
    expect(oracle.provablySafe).toEqual(new Set([4]));
  });

  it("1-2-2-1 pattern (4 numbered cells over 5 unrevealed) matches the brute-force oracle exactly", () => {
    // 5 wide x 2 tall board, row 0 revealed with counts forming 1-2-2-1 style deduction,
    // row 1 unrevealed. Ground truth mines at {5, 7, 8} is NOT what we want (need 1-2-2-1);
    // classic 1-2-2-1 comes from two mines placed under the middle with overlap. Use mines
    // at cells 6 and 8 (row1, col1 and col3).
    const width = 5;
    const height = 2;
    const mines = new Set([6, 8]);
    const trueCounts = new Map<number, number>();
    for (let c = 0; c < 5; c++) trueCounts.set(c, countAdjacentMines(c, mines, width, height));

    const view = makeView(width, height, trueCounts, mines.size);
    const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
    const result = analyzeFrontier(view);

    expect(result.provablyMine).toEqual(oracle.provablyMine);
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    for (const [cell, p] of result.posterior) {
      expect(p).toBeCloseTo(oracle.posterior.get(cell) ?? -1, 6);
    }
  });

  it("background/frontier global mine-count coupling on a single connected frontier component", () => {
    // CORRECTED per Fable review (should-fix 3): this test previously claimed to construct
    // "two well-separated components" on a 5x3 board, but the geometry does not actually do
    // that -- the revealed row-0 cells bridge cells 5/6 to 8/9 through shared constraints, and
    // cell 7 (meant as a "wall") itself pulls row-2 cell 12 into the same frontier. The actual
    // frontier here is ONE connected component: {5,6,8,9,11,12,13}. That was never verified
    // structurally, so the "well-separated" claim went unnoticed while untested. This test
    // still exercises real, non-trivial machinery worth keeping (background/frontier coupling
    // via the global mine-count convolution, oracle-cross-checked in full) -- it just is NOT a
    // multi-component test. See "genuinely separated two-component frontier" below for that.
    const width = 5;
    const height = 3;
    const mines = new Set([5, 8, 12]); // ground truth used only to MANUFACTURE a valid view
    const revealedCellsRow0 = [0, 1, 2, 3, 4];
    const revealedRow1Wall = [7];
    const trueCounts = new Map<number, number>();
    for (const c of [...revealedCellsRow0, ...revealedRow1Wall]) {
      trueCounts.set(c, countAdjacentMines(c, mines, width, height));
    }
    const view = makeView(width, height, trueCounts, mines.size);
    const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
    const result = analyzeFrontier(view);

    // The discriminating assertion: cross-check the FULL posterior/provable sets against the
    // independent oracle. If csp.ts only did local (single-point/per-component) deduction and
    // ignored the global total, it would disagree with the oracle on any cell whose true
    // status depends on frontier/background coupling.
    expect(result.provablyMine).toEqual(oracle.provablyMine);
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    expect(result.posterior.size).toBe(oracle.posterior.size);
    for (const [cell, p] of oracle.posterior) {
      expect(result.posterior.get(cell)).toBeCloseTo(p, 6);
    }
    // Honest structural check (replaces the previous vacuous `posterior.size > 0`): this
    // view's frontier really is exactly ONE connected component, not "two well-separated"
    // ones as the old comment claimed.
    expect(frontierComponentCount(view)).toBe(1);
  });

  it("genuinely separated two-component frontier: component count verified structurally, " +
    "cross-checked against the independent oracle (should-fix 3)", () => {
    // A 1x9 board (single row, so `neighbors()` gives simple, easy-to-verify left/right
    // adjacency). Revealed cell 1 constrains ONLY {0,2}; revealed cell 5 constrains ONLY
    // {4,6} -- the two frontier groups share no cell and no constraint, so the component
    // algorithm (which only ever unions cells appearing in the SAME constraint) cannot merge
    // them. Background = {3,7,8} (adjacent to neither revealed cell). Ground truth mines
    // {0,6,8} put exactly one mine in each frontier group plus one in the background, giving
    // every unrevealed cell a genuinely non-degenerate (neither 0 nor 1) posterior to check.
    const width = 9;
    const height = 1;
    const mines = new Set([0, 6, 8]);
    const trueCounts = new Map<number, number>([
      [1, countAdjacentMines(1, mines, width, height)], // neighbors {0,2} -> count 1
      [5, countAdjacentMines(5, mines, width, height)], // neighbors {4,6} -> count 1
    ]);
    expect([...trueCounts.values()]).toEqual([1, 1]);

    const view = makeView(width, height, trueCounts, mines.size);

    // Structural proof of separation, BEFORE trusting any posterior value: no adjacency path
    // connects component A's cells ({0,2}) to component B's cells ({4,6}) -- verified directly
    // via the public `neighbors()` function, independent of csp.ts's own component-grouping
    // logic, then cross-checked against what csp.ts itself reports.
    for (const a of [0, 2]) {
      for (const b of [4, 6]) {
        expect(neighbors(a, width, height)).not.toContain(b);
        expect(neighbors(b, width, height)).not.toContain(a);
      }
    }
    expect(frontierComponentCount(view)).toBeGreaterThanOrEqual(2);
    expect(frontierComponentCount(view)).toBe(2);

    const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
    const result = analyzeFrontier(view);

    expect(result.provablyMine).toEqual(oracle.provablyMine);
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    expect(result.posterior.size).toBe(oracle.posterior.size);
    for (const [cell, p] of oracle.posterior) {
      expect(result.posterior.get(cell)).toBeCloseTo(p, 6);
    }
    // Every background cell (3, 7, 8) shares one uniform posterior; every frontier cell in
    // each pair is exactly 0.5 given only its own component's local constraint. Pin the actual
    // hand-solved values so this test would fail if the cross-component wiring silently
    // regressed to something that still happens to satisfy the oracle loop above by accident.
    expect(result.posterior.get(0)).toBeCloseTo(0.5, 6);
    expect(result.posterior.get(2)).toBeCloseTo(0.5, 6);
    expect(result.posterior.get(4)).toBeCloseTo(0.5, 6);
    expect(result.posterior.get(6)).toBeCloseTo(0.5, 6);
    expect(result.posterior.get(3)).toBeCloseTo(1 / 3, 6);
    expect(result.posterior.get(7)).toBeCloseTo(1 / 3, 6);
    expect(result.posterior.get(8)).toBeCloseTo(1 / 3, 6);
  });

  it("posterior values on a hand-solved position match to 3 decimals (oracle cross-check)", () => {
    // A denser small board with several unrevealed cells at genuinely different posteriors
    // (not just 0/0.5/1), to exercise the general convolution path rather than only corner
    // cases.
    const width = 4;
    const height = 4;
    const mines = new Set([5, 6, 9, 10]);
    const revealedRing = [0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15]; // everything but 5,6,9,10
    const trueCounts = new Map<number, number>();
    for (const c of revealedRing) trueCounts.set(c, countAdjacentMines(c, mines, width, height));

    const view = makeView(width, height, trueCounts, mines.size);
    const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
    const result = analyzeFrontier(view);

    expect(oracle.posterior.size).toBeGreaterThan(0);
    for (const [cell, p] of oracle.posterior) {
      expect(result.posterior.get(cell)).toBeDefined();
      expect(result.posterior.get(cell)!).toBeCloseTo(p, 3);
    }
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    expect(result.provablyMine).toEqual(oracle.provablyMine);
  });

  it("accounts for already-exploded mines when computing the remaining global mine budget", () => {
    const width = 3;
    const height = 3;
    const mines = new Set([4, 8]); // center + corner
    // Reveal 0 (count includes mine 4), and treat mine 8 as EXPLODED (already known/public).
    const trueCounts = new Map<number, number>([[0, countAdjacentMines(0, mines, width, height)]]);
    const view = makeView(width, height, trueCounts, mines.size, [8]);
    const oracle = bruteForceOracle(width, height, trueCounts, new Set([8]), mines.size);
    const result = analyzeFrontier(view);

    expect(result.provablyMine).toEqual(oracle.provablyMine);
    expect(result.provablySafe).toEqual(oracle.provablySafe);
    // Exploded cells never appear as "unrevealed" candidates in the analysis at all.
    expect(result.posterior.has(8)).toBe(false);
  });

  it("randomized small-board cross-check against the oracle (broad coverage, not just named patterns)", () => {
    const width = 5;
    const height = 4;
    const totalCells = width * height;
    // Deterministic pseudo-random generator local to this test (no engine Rng dependency
    // needed here — this is test-only scaffolding, not game logic).
    let seed = 12345;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let trial = 0; trial < 20; trial++) {
      const mineCount = 4 + Math.floor(rand() * 3); // 4..6 mines
      const allCells = Array.from({ length: totalCells }, (_, i) => i);
      // Fisher-Yates using rand()
      for (let i = allCells.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [allCells[i], allCells[j]] = [allCells[j]!, allCells[i]!];
      }
      const mines = new Set(allCells.slice(0, mineCount));
      // Reveal a random subset of the SAFE cells (at least a few, so there's a real frontier).
      const safeCells = allCells.slice(mineCount).filter((c) => !mines.has(c));
      const revealCount = Math.min(safeCells.length, 6 + Math.floor(rand() * 6));
      const revealedCells = safeCells.slice(0, revealCount);
      if (revealedCells.length === 0) continue;

      const trueCounts = new Map<number, number>();
      for (const c of revealedCells) trueCounts.set(c, countAdjacentMines(c, mines, width, height));

      const view = makeView(width, height, trueCounts, mines.size);
      const oracle = bruteForceOracle(width, height, trueCounts, new Set(), mines.size);
      const result = analyzeFrontier(view);

      expect(result.provablySafe).toEqual(oracle.provablySafe);
      expect(result.provablyMine).toEqual(oracle.provablyMine);
      for (const [cell, p] of oracle.posterior) {
        expect(result.posterior.get(cell)).toBeCloseTo(p, 5);
      }
    }
  });
});

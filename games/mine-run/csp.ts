// games/mine-run/csp.ts — the frontier CSP module (docs/plans/mine-run.md §4.2).
//
// A real minesweeper constraint-satisfaction solver: connected-component enumeration over the
// frontier (unrevealed cells adjacent to a revealed number) plus GLOBAL mine-count coupling via
// convolving per-component mine-count histograms with the background's combinatorial choose
// distribution. This is deliberately NOT single-point deduction (the plan is explicit that a
// weaker solver would understate real safety and let a human expert out-deduce the
// Always-Safe probe). One module, three consumers (plan §4.2/§4.4): `analyzeFrontier` backs
// `probes.ts`'s `safeMove`, `sampleConsistentState` (below) backs determinized MCTS/hint, and
// both are exercised directly here.
//
// View-honest by construction: every function in this file takes a MineRunView (or values
// derived from one) — never MineRunState, never `mines`. There is no code path here that
// could read an unrevealed mine's true identity.

import type { MineRunCellView, MineRunState, MineRunView } from "./engine";
import { neighbors } from "./board";
import type { Rng } from "@twist-arcade/engine";

export interface FrontierAnalysis {
  /** Unrevealed cells that are safe in EVERY mine assignment consistent with the view and
   *  the total mine count. */
  readonly provablySafe: ReadonlySet<number>;
  /** Unrevealed cells that are a mine in EVERY consistent assignment. */
  readonly provablyMine: ReadonlySet<number>;
  /** P(mine) for every unrevealed cell (frontier cells individually; background cells share
   *  one uniform value, since they are interchangeable given no distinguishing information). */
  readonly posterior: ReadonlyMap<number, number>;
  /** True iff any frontier connected component exceeded the enumeration cap and was folded
   *  into the background treatment instead (plan §4.2's documented, conservative-only
   *  degradation — such cells are never marked provablySafe/provablyMine). */
  readonly fallbackUsed: boolean;
}

interface Constraint {
  readonly cells: readonly number[]; // unrevealed neighbor cells of some revealed number
  readonly required: number; // remaining (not-yet-known) mines among `cells`
}

interface ComponentModel {
  readonly cells: readonly number[];
  readonly assignments: readonly ReadonlySet<number>[]; // each: the mine cells in one valid world
  readonly histogram: readonly bigint[]; // histogram[k] = # assignments with exactly k mines
  readonly perCell: ReadonlyMap<number, readonly bigint[]>; // cell -> histogram of assignments CONTAINING it, by k
}

interface FrontierModel {
  readonly components: readonly ComponentModel[];
  readonly background: readonly number[];
  readonly remainingMines: number;
  readonly fallbackUsed: boolean;
}

function isKnownMineCell(v: MineRunCellView): boolean {
  return "exploded" in v || "mine" in v;
}

/** Component-size / search-effort caps (plan §4.2: "component-size cap with a sampling
 *  fallback for pathological frontiers"). Generous relative to a 10x10/20-mine board, where
 *  frontier components are almost always small. */
const COMPONENT_CELL_CAP = 22;
const COMPONENT_NODE_CAP = 400_000;

class UnionFind {
  private readonly parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let p = this.parent.get(x)!;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function buildConstraints(view: MineRunView): {
  constraints: Constraint[];
  frontier: Set<number>;
  background: number[];
  remainingMines: number;
} {
  const revealedSet = new Set<number>();
  let knownMines = 0;
  for (const key of Object.keys(view.cells)) {
    const cell = Number(key);
    revealedSet.add(cell);
    if (isKnownMineCell(view.cells[cell]!)) knownMines++;
  }

  const constraints: Constraint[] = [];
  const frontier = new Set<number>();
  for (const key of Object.keys(view.cells)) {
    const cell = Number(key);
    const v = view.cells[cell]!;
    if (!("n" in v)) continue; // only revealed SAFE numbered cells constrain anything
    const candidates: number[] = [];
    let explodedOrDisclosedNeighbors = 0;
    for (const nb of neighbors(cell, view.width, view.height)) {
      if (revealedSet.has(nb)) {
        if (isKnownMineCell(view.cells[nb]!)) explodedOrDisclosedNeighbors++;
        // else: a revealed SAFE neighbor contributes 0 and is not a candidate.
      } else {
        candidates.push(nb);
      }
    }
    if (candidates.length > 0) {
      constraints.push({ cells: candidates, required: v.n - explodedOrDisclosedNeighbors });
      for (const c of candidates) frontier.add(c);
    }
  }

  const totalCells = view.width * view.height;
  const background: number[] = [];
  for (let c = 0; c < totalCells; c++) {
    if (revealedSet.has(c) || frontier.has(c)) continue;
    background.push(c);
  }

  return { constraints, frontier, background, remainingMines: view.minesTotal - knownMines };
}

function computeComponentCellGroups(frontier: ReadonlySet<number>, constraints: readonly Constraint[]): number[][] {
  const uf = new UnionFind();
  for (const c of frontier) uf.find(c);
  for (const constraint of constraints) {
    const cells = constraint.cells;
    for (let i = 1; i < cells.length; i++) uf.union(cells[0]!, cells[i]!);
  }
  const groups = new Map<number, number[]>();
  for (const c of frontier) {
    const root = uf.find(c);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a - b));
}

/** Exact enumeration (with constraint-propagation pruning) of every mine/safe assignment of
 *  `cells` consistent with every constraint whose full cell-set lies within this component.
 *  Returns `fallback: true` (and no assignments) if the search exceeds either cap — the
 *  caller folds such a component into the background treatment instead of trusting a partial
 *  or biased sample (plan §4.2). */
function enumerateComponent(
  cells: readonly number[],
  constraints: readonly Constraint[]
): { assignments: Set<number>[]; fallback: boolean } {
  if (cells.length > COMPONENT_CELL_CAP) return { assignments: [], fallback: true };

  const cellIndex = new Map<number, number>();
  cells.forEach((c, i) => cellIndex.set(c, i));
  const localConstraints = constraints
    .filter((c) => c.cells.every((x) => cellIndex.has(x)))
    .map((c) => ({ idx: c.cells.map((x) => cellIndex.get(x)!), required: c.required }));

  const assignment = new Array<0 | 1>(cells.length).fill(0);
  const results: Set<number>[] = [];
  let nodes = 0;
  let aborted = false;

  function feasible(assignedUpto: number): boolean {
    for (const lc of localConstraints) {
      let assignedMines = 0;
      let unassigned = 0;
      for (const idx of lc.idx) {
        if (idx < assignedUpto) {
          if (assignment[idx] === 1) assignedMines++;
        } else {
          unassigned++;
        }
      }
      if (assignedMines > lc.required) return false;
      if (assignedMines + unassigned < lc.required) return false;
    }
    return true;
  }

  function backtrack(i: number): void {
    if (aborted) return;
    nodes++;
    if (nodes > COMPONENT_NODE_CAP) {
      aborted = true;
      return;
    }
    if (i === cells.length) {
      for (const lc of localConstraints) {
        let count = 0;
        for (const idx of lc.idx) if (assignment[idx] === 1) count++;
        if (count !== lc.required) return;
      }
      const mineSet = new Set<number>();
      for (let j = 0; j < cells.length; j++) if (assignment[j] === 1) mineSet.add(cells[j]!);
      results.push(mineSet);
      return;
    }
    for (const bit of [0, 1] as const) {
      assignment[i] = bit;
      if (feasible(i + 1)) backtrack(i + 1);
      if (aborted) return;
    }
    assignment[i] = 0;
  }
  backtrack(0);
  if (aborted) return { assignments: [], fallback: true };
  return { assignments: results, fallback: false };
}

function histogramOf(size: number, assignments: readonly ReadonlySet<number>[]): bigint[] {
  const hist = new Array<bigint>(size + 1).fill(0n);
  for (const a of assignments) hist[a.size] = (hist[a.size] ?? 0n) + 1n;
  return hist;
}

function perCellHistogramsOf(
  cells: readonly number[],
  size: number,
  assignments: readonly ReadonlySet<number>[]
): Map<number, bigint[]> {
  const map = new Map<number, bigint[]>();
  for (const c of cells) map.set(c, new Array<bigint>(size + 1).fill(0n));
  for (const a of assignments) {
    const k = a.size;
    for (const c of a) {
      const h = map.get(c)!;
      h[k] = h[k]! + 1n;
    }
  }
  return map;
}

function convolve(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0n) continue;
      out[i + j] = out[i + j]! + a[i]! * b[j]!;
    }
  }
  return out;
}

function chooseBig(n: number, kRaw: number): bigint {
  if (kRaw < 0 || kRaw > n) return 0n;
  const k = Math.min(kRaw, n - kRaw);
  let result = 1n;
  for (let i = 0; i < k; i++) {
    result = (result * BigInt(n - i)) / BigInt(i + 1);
  }
  return result;
}

function backgroundChooseHistogram(backgroundLen: number): bigint[] {
  const hist = new Array<bigint>(backgroundLen + 1);
  for (let b = 0; b <= backgroundLen; b++) hist[b] = chooseBig(backgroundLen, b);
  return hist;
}

function buildFrontierModel(view: MineRunView): FrontierModel {
  const { constraints, frontier, background: bg0, remainingMines } = buildConstraints(view);
  const componentCellGroups = computeComponentCellGroups(frontier, constraints);
  const components: ComponentModel[] = [];
  const background = [...bg0];
  let fallbackUsed = false;

  for (const cells of componentCellGroups) {
    const enumResult = enumerateComponent(cells, constraints);
    if (enumResult.fallback) {
      // Conservative degradation (plan §4.2): fold into background rather than trust a
      // partial/biased sample. These cells will never be marked provablySafe/provablyMine.
      fallbackUsed = true;
      background.push(...cells);
      continue;
    }
    const histogram = histogramOf(cells.length, enumResult.assignments);
    const perCell = perCellHistogramsOf(cells, cells.length, enumResult.assignments);
    components.push({ cells, assignments: enumResult.assignments, histogram, perCell });
  }

  return { components, background, remainingMines, fallbackUsed };
}

/** True iff any frontier component exceeded the enumeration caps for this view. Exposed
 *  separately from `analyzeFrontier` so the harness can log the fallback rate (plan §4.2's
 *  <1% design-review requirement) without recomputing the whole analysis. */
export function frontierFallbackUsed(view: MineRunView): boolean {
  return buildFrontierModel(view).fallbackUsed;
}

/**
 * The main CSP entry point (plan §4.2): full frontier analysis with global mine-count
 * coupling. `posterior` covers every unrevealed cell — frontier cells individually (via
 * per-component/per-cell histograms convolved against every OTHER component plus the
 * background's combinatorial choose distribution), background cells uniformly (they are
 * interchangeable given no distinguishing information about any specific one of them).
 */
export function analyzeFrontier(view: MineRunView): FrontierAnalysis {
  const model = buildFrontierModel(view);
  const backgroundLen = model.background.length;
  const backgroundHist = backgroundChooseHistogram(backgroundLen);

  let hTotal: bigint[] = [1n];
  for (const comp of model.components) hTotal = convolve(hTotal, comp.histogram);

  function weightAt(hist: readonly bigint[], T: number): bigint {
    const h = hist[T] ?? 0n;
    if (h === 0n) return 0n;
    const b = model.remainingMines - T;
    if (b < 0 || b > backgroundLen) return 0n;
    return h * backgroundHist[b]!;
  }

  let Z = 0n;
  for (let T = 0; T < hTotal.length; T++) Z += weightAt(hTotal, T);

  const provablySafe = new Set<number>();
  const provablyMine = new Set<number>();
  const posterior = new Map<number, number>();

  if (Z === 0n) {
    throw new Error(
      "analyzeFrontier: no mine assignment is consistent with this view's numbers and total " +
        "mine count -- the view is internally inconsistent (this should never happen for a " +
        "state reachable via legal play)."
    );
  }

  if (backgroundLen > 0) {
    let numerator = 0n;
    for (let T = 0; T < hTotal.length; T++) {
      const w = weightAt(hTotal, T);
      if (w === 0n) continue;
      numerator += w * BigInt(model.remainingMines - T);
    }
    const p = Number(numerator) / Number(Z) / backgroundLen;
    for (const c of model.background) posterior.set(c, p);
    if (numerator === 0n) for (const c of model.background) provablySafe.add(c);
    if (numerator === Z * BigInt(backgroundLen)) for (const c of model.background) provablyMine.add(c);
  }

  for (let ci = 0; ci < model.components.length; ci++) {
    const comp = model.components[ci]!;
    let otherHist: bigint[] = [1n];
    for (let cj = 0; cj < model.components.length; cj++) {
      if (cj === ci) continue;
      otherHist = convolve(otherHist, model.components[cj]!.histogram);
    }
    const maxOther = otherHist.length - 1;
    function rOther(m: number): bigint {
      if (m < 0) return 0n;
      let total = 0n;
      for (let j = 0; j <= Math.min(m, maxOther); j++) {
        const bj = m - j;
        if (bj < 0 || bj > backgroundLen) continue;
        total += otherHist[j]! * backgroundHist[bj]!;
      }
      return total;
    }

    for (const cell of comp.cells) {
      const perCellHist = comp.perCell.get(cell)!;
      let numerator = 0n;
      for (let k = 0; k < perCellHist.length; k++) {
        const cnt = perCellHist[k] ?? 0n;
        if (cnt === 0n) continue;
        numerator += cnt * rOther(model.remainingMines - k);
      }
      posterior.set(cell, Number(numerator) / Number(Z));
      if (numerator === 0n) provablySafe.add(cell);
      if (numerator === Z) provablyMine.add(cell);
    }
  }

  return { provablySafe, provablyMine, posterior, fallbackUsed: model.fallbackUsed };
}

function weightedChoiceBig(weights: readonly bigint[], rng: Rng): number {
  let totalNum = 0;
  for (const w of weights) totalNum += Number(w);
  if (!(totalNum > 0)) {
    throw new Error("weightedChoiceBig: all weights are zero -- no consistent option to sample from");
  }
  const r = rng.next() * totalNum;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Number(weights[i]);
    if (r < acc) return i;
  }
  return weights.length - 1;
}

/** Uniformly samples a k-subset of `cells` via partial Fisher-Yates (standard reservoir-style
 *  partial shuffle — every k-subset equally likely). */
function sampleSubset(cells: readonly number[], k: number, rng: Rng): Set<number> {
  const arr = cells.slice();
  const n = arr.length;
  const take = Math.min(k, n);
  for (let i = 0; i < take; i++) {
    const j = i + rng.int(n - i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return new Set(arr.slice(0, take));
}

/** Uniformly samples ONE assignment from a component's enumerated list. */
function samplePlainUniform<T>(items: readonly T[], rng: Rng): T {
  return items[rng.int(items.length)]!;
}

/**
 * Samples a full canonical state consistent with `view` (plan §4.2/§4.4's `sampleConsistentState`
 * hook — powers determinized MCTS/hint and, here, its own correctness tests). Exact weighted
 * sampling, not an approximation: first samples the total frontier mine count T proportional
 * to the true global weight distribution, then sequentially samples each component's own mine
 * count conditioned on the running total (via suffix convolutions), picks uniformly among that
 * component's assignments of the chosen size, and finally samples a uniformly random subset of
 * the remaining background cells for the leftover mine budget.
 */
export function sampleConsistentState(view: MineRunView, rng: Rng): MineRunState {
  const model = buildFrontierModel(view);
  const backgroundLen = model.background.length;
  const backgroundHist = backgroundChooseHistogram(backgroundLen);

  let hTotal: bigint[] = [1n];
  for (const comp of model.components) hTotal = convolve(hTotal, comp.histogram);

  const weights: bigint[] = [];
  for (let T = 0; T < hTotal.length; T++) {
    const b = model.remainingMines - T;
    weights.push(b < 0 || b > backgroundLen ? 0n : hTotal[T]! * backgroundHist[b]!);
  }
  const T = weightedChoiceBig(weights, rng);

  // Suffix convolutions: suffixHist[i] = convolution of components[i..end]'s histograms.
  const suffixHist: bigint[][] = new Array(model.components.length + 1);
  suffixHist[model.components.length] = [1n];
  for (let i = model.components.length - 1; i >= 0; i--) {
    suffixHist[i] = convolve(model.components[i]!.histogram, suffixHist[i + 1]!);
  }

  let remaining = T;
  const chosenK: number[] = [];
  for (let i = 0; i < model.components.length; i++) {
    const comp = model.components[i]!;
    if (i === model.components.length - 1) {
      chosenK.push(remaining);
      continue;
    }
    const rest = suffixHist[i + 1]!;
    const kWeights: bigint[] = [];
    for (let k = 0; k < comp.histogram.length; k++) {
      const restIdx = remaining - k;
      const w = restIdx < 0 || restIdx >= rest.length ? 0n : comp.histogram[k]! * rest[restIdx]!;
      kWeights.push(w);
    }
    const k = weightedChoiceBig(kWeights, rng);
    chosenK.push(k);
    remaining -= k;
  }

  const sampledMines = new Set<number>();
  for (let i = 0; i < model.components.length; i++) {
    const comp = model.components[i]!;
    const k = chosenK[i]!;
    const candidates = comp.assignments.filter((a) => a.size === k);
    if (candidates.length === 0) {
      throw new Error(`sampleConsistentState: no assignment of size ${k} exists for a component -- internal inconsistency`);
    }
    const chosen = samplePlainUniform(candidates, rng);
    for (const c of chosen) sampledMines.add(c);
  }

  const backgroundMineCount = model.remainingMines - T;
  const backgroundMines = sampleSubset(model.background, backgroundMineCount, rng);
  for (const c of backgroundMines) sampledMines.add(c);

  const revealed: number[] = [];
  const exploded: number[] = [];
  for (const key of Object.keys(view.cells)) {
    const cell = Number(key);
    const v = view.cells[cell]!;
    if ("mine" in v) {
      // Spectator-terminal-only disclosure: a real mine, but never actually revealed by play.
      sampledMines.add(cell);
      continue;
    }
    revealed.push(cell);
    if ("exploded" in v) {
      exploded.push(cell);
      sampledMines.add(cell);
    }
  }

  return {
    mines: [...sampledMines].sort((a, b) => a - b),
    revealed: revealed.sort((a, b) => a - b),
    exploded: exploded.sort((a, b) => a - b),
    streakLen: view.streakLen,
    streakValue: view.streakValue,
    banked: view.banked,
    revealsLeft: view.revealsLeft,
    lastEffects: [],
  };
}

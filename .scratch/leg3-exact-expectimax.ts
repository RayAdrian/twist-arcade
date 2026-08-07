// Leg 3 of the three-leg kill standard (docs/plans/mine-run-risk-aware-policy.md §6 leg 3):
// the reduced-board EXACT check. Independent of any policy family (§2's model, the threshold
// family, Strong) — this computes the true optimal view-policy by expectimax over reachable
// BELIEF states (never over hidden mine layouts directly, C1), on boards small enough that the
// belief state itself can be fully enumerated rather than sampled.
//
// "Belief == view here" (task brief): a belief state is exactly the information a real
// MineRunView carries — which cells are revealed and their shown numbers/exploded flags, plus
// streak/banked/revealsLeft. Two different hidden mine layouts that agree on all of that are
// PROVABLY indistinguishable to any view-honest policy (C1), so they belong in the same
// expectimax node by construction, not by assumption.
//
// Method (reusing the REAL engine's apply()/status()/legalMoves()/playerView() throughout,
// never a reimplementation of game rules — apply() is a pure function of (state, move) here,
// meta.stochastic:false, so this is safe and removes an entire class of rule-divergence risk):
//
//   1. Root: run a real engine.setup() for a fixed seed to get a real opening. Enumerate EVERY
//      mine layout (a plain combinatorial choose over the unrevealed cells) consistent with the
//      observed revealed numbers -- the "witnesses" for the root belief state. Sanity-checked
//      against analyzeFrontier's own posterior at the root before trusting anything further
//      (two independently-computed exact numbers must agree).
//   2. Recursive value function, memoized on the belief state's own content (a pure function of
//      revealed-cell-numbers + exploded set + streak/banked/revealsLeft -- provably
//      path-independent, so memoizing here is sound, not just an optimization):
//        - terminal belief -> value = banked (identical across every witness by construction).
//        - "optimal" mode -> max over every legal move of that move's expected continuation.
//        - "always-safe" mode -> the single move chooseSafeMove/analyzeFrontier would pick (a
//          POLICY EVALUATION under the identical belief distribution, not a simulated score --
//          this is what makes it comparable to the optimal figure).
//        - "bank" is deterministic (doesn't touch mines) -> one continuation, no branching.
//        - "reveal(c)" branches: apply the move to EVERY witness (real engine.apply, since the
//          resulting flood region/numbers/exploded flag genuinely depend on the full layout, not
//          just cell c's own count), group the results by the resulting belief content, recurse
//          into each group weighted by its share of the parent's witness count.
//   3. Feasibility guard, pre-registered (per the brief): a hard cap on root-enumeration size AND
//      on total expectimax nodes visited. Exceeding either aborts with INFEASIBLE for that board,
//      not a silent partial answer -- per §6's own fallback, legs 1-2 would then decide alone.

import { createMineRun } from "../games/mine-run/engine";
import type { MineRunMove, MineRunState, MineRunView } from "../games/mine-run/engine";
import { analyzeFrontier, chooseSafeMove, countAdjacentMines } from "@twist-arcade/mine-run";
import { pairedSeeds } from "@twist-arcade/harness";
import { rngForSetup, rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine, Rng } from "@twist-arcade/engine";

// ---------------------------------------------------------------------------------------------
// Feasibility caps -- pre-registered, not tuned after seeing a number.
// ---------------------------------------------------------------------------------------------
const ROOT_ENUMERATION_CAP = 2_000_000;
const NODE_BUDGET_CAP = 3_000_000;

class InfeasibleError extends Error {}

function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

function* combinations(arr: readonly number[], k: number): Generator<number[]> {
  const n = arr.length;
  if (k < 0 || k > n) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => arr[i]!);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i] = idx[i]! + 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Belief-state plumbing. A "belief" is carried as a MineRunView (the honest, exact thing a
// player sees) plus the list of mine layouts ("witnesses") consistent with it. Any witness can
// reconstruct a full playable MineRunState from the view alone (C1: only view-derived data goes
// into the reconstruction, the witness supplies only the one thing a view can never carry).
// ---------------------------------------------------------------------------------------------
function stateFromViewAndMines(view: MineRunView, mines: readonly number[]): MineRunState {
  const revealed: number[] = [];
  const exploded: number[] = [];
  for (const [cStr, cv] of Object.entries(view.cells)) {
    const c = Number(cStr);
    revealed.push(c);
    if ("exploded" in cv) exploded.push(c);
  }
  revealed.sort((a, b) => a - b);
  exploded.sort((a, b) => a - b);
  return {
    mines: [...mines].sort((a, b) => a - b),
    revealed,
    exploded,
    streakLen: view.streakLen,
    streakValue: view.streakValue,
    banked: view.banked,
    revealsLeft: view.revealsLeft,
    lastEffects: [],
  };
}

function viewKey(view: MineRunView): string {
  const cellsPart = Object.keys(view.cells)
    .map(Number)
    .sort((a, b) => a - b)
    .map((c) => `${c}:${JSON.stringify(view.cells[c])}`)
    .join(",");
  return `${cellsPart}|sL${view.streakLen}|sV${view.streakValue}|b${view.banked}|r${view.revealsLeft}`;
}

interface NodeBudget {
  count: number;
  cap: number;
}

type Mode = "optimal" | "always-safe";

const DUMMY_RNG: Rng = rngFromSeed("leg3-dummy-unused-by-mine-run-apply");

function exactValue(
  engine: GameEngine<MineRunState, MineRunMove, MineRunView>,
  view: MineRunView,
  witnesses: readonly (readonly number[])[],
  mode: Mode,
  memo: Map<string, number>,
  budget: NodeBudget
): number {
  const key = `${mode}|${viewKey(view)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  budget.count += 1;
  if (budget.count > budget.cap) {
    throw new InfeasibleError(`node budget (${budget.cap}) exceeded`);
  }

  const repState = stateFromViewAndMines(view, witnesses[0]!);
  const status = engine.status(repState);
  if (status.kind !== "ongoing") {
    memo.set(key, view.banked);
    return view.banked;
  }

  const legal = engine.legalMoves(repState, 0);
  const candidateMoves: MineRunMove[] =
    mode === "always-safe" ? [chooseSafeMove(view, analyzeFrontier(view))] : legal;

  let best = -Infinity;
  for (const move of candidateMoves) {
    let value: number;
    if (move.t === "bank") {
      const resultState = engine.apply(repState, new Map([[0, move]]), DUMMY_RNG);
      const newView = engine.playerView(resultState, 0);
      value = exactValue(engine, newView, witnesses, mode, memo, budget);
    } else {
      const groups = new Map<string, { view: MineRunView; mines: number[][] }>();
      for (const mines of witnesses) {
        const w = stateFromViewAndMines(view, mines);
        const resultState = engine.apply(w, new Map([[0, move]]), DUMMY_RNG);
        const rv = engine.playerView(resultState, 0);
        const rk = viewKey(rv);
        let g = groups.get(rk);
        if (!g) {
          g = { view: rv, mines: [] };
          groups.set(rk, g);
        }
        g.mines.push([...mines]);
      }
      let expected = 0;
      for (const g of groups.values()) {
        const p = g.mines.length / witnesses.length;
        expected += p * exactValue(engine, g.view, g.mines, mode, memo, budget);
      }
      value = expected;
    }
    if (value > best) best = value;
  }

  memo.set(key, best);
  return best;
}

// ---------------------------------------------------------------------------------------------
// Root construction + the two independent-computation cross-checks (C41's sharpened standing
// instruction: verify a check actually bites, not just that machinery ran).
// ---------------------------------------------------------------------------------------------
interface RootResult {
  view0: MineRunView;
  witnesses: number[][];
  trueMines: number[];
}

function buildRoot(
  engine: GameEngine<MineRunState, MineRunMove, MineRunView>,
  width: number,
  height: number,
  mines: number,
  seed: string
): RootResult {
  const state0 = engine.setup(1, rngForSetup(seed));
  const view0 = engine.playerView(state0, 0);
  const totalCells = width * height;
  const revealedSet = new Set(Object.keys(view0.cells).map(Number));
  const unrevealed: number[] = [];
  for (let c = 0; c < totalCells; c++) if (!revealedSet.has(c)) unrevealed.push(c);

  const count = nCk(unrevealed.length, mines);
  if (count > ROOT_ENUMERATION_CAP) {
    throw new InfeasibleError(`root enumeration C(${unrevealed.length},${mines})=${count} exceeds cap`);
  }

  const witnesses: number[][] = [];
  for (const combo of combinations(unrevealed, mines)) {
    const candidateSet = new Set(combo);
    let ok = true;
    for (const [cStr, cv] of Object.entries(view0.cells)) {
      if ("exploded" in cv) continue; // never true at a fresh root (opening never contains a mine, R2)
      const c = Number(cStr);
      const n = (cv as { n: number }).n;
      if (countAdjacentMines(c, candidateSet, width, height) !== n) {
        ok = false;
        break;
      }
    }
    if (ok) witnesses.push([...combo].sort((a, b) => a - b));
  }
  if (witnesses.length === 0) {
    throw new Error(`buildRoot: zero consistent witnesses for seed ${seed} -- enumeration bug`);
  }

  // Cross-check 1: the TRUE mine layout for this seed must be among the enumerated witnesses --
  // a direct check that the consistency filter isn't silently excluding the real world.
  const trueMines = [...state0.mines].sort((a, b) => a - b);
  const trueKey = JSON.stringify(trueMines);
  if (!witnesses.some((w) => JSON.stringify(w) === trueKey)) {
    throw new Error(`buildRoot: TRUE mine layout for seed ${seed} is NOT among the enumerated witnesses -- bug`);
  }

  // Cross-check 2: empirical marginal P(mine=c) from this enumeration must equal
  // analyzeFrontier's own posterior at the root -- two independently-computed exact numbers.
  const analysis0 = analyzeFrontier(view0);
  for (const c of unrevealed) {
    const empirical = witnesses.filter((w) => w.includes(c)).length / witnesses.length;
    const expected = analysis0.posterior.get(c);
    if (expected === undefined || Math.abs(empirical - expected) > 1e-9) {
      throw new Error(
        `buildRoot: posterior mismatch at cell ${c} for seed ${seed} -- empirical=${empirical} ` +
          `analyzeFrontier=${expected} (root enumeration and the trusted CSP module disagree)`
      );
    }
  }

  return { view0, witnesses, trueMines };
}

// ---------------------------------------------------------------------------------------------
// Per-board runner.
// ---------------------------------------------------------------------------------------------
interface BoardConfig {
  label: string;
  width: number;
  height: number;
  mines: number;
  budget: number;
  seedCount: number;
}

const boards: BoardConfig[] = [
  { label: "4x4/3mines/budget8", width: 4, height: 4, mines: 3, budget: 8, seedCount: 8 },
  { label: "5x5/4mines/budget12", width: 5, height: 5, mines: 4, budget: 12, seedCount: 5 },
];

interface SeedOutcome {
  seed: string;
  rootWitnessCount: number;
  optimalEV: number;
  alwaysSafeEV: number;
  nodesVisitedOptimal: number;
  nodesVisitedAlwaysSafe: number;
  elapsedMs: number;
}

interface BoardRunResult {
  outcomes: SeedOutcome[];
  infeasibleSeeds: { seed: string; reason: string }[];
}

function runBoard(board: BoardConfig): BoardRunResult {
  const engine = createMineRun({ width: board.width, height: board.height, mines: board.mines, budget: board.budget });
  const seeds = pairedSeeds(`c37:mine-run:leg3-exact:${board.label}`, board.seedCount);
  const outcomes: SeedOutcome[] = [];
  const infeasibleSeeds: { seed: string; reason: string }[] = [];

  for (const seed of seeds) {
    const t0 = Date.now();
    let root: RootResult;
    try {
      root = buildRoot(engine, board.width, board.height, board.mines, seed);
    } catch (err) {
      if (err instanceof InfeasibleError) {
        console.log(`  ${board.label} seed=${seed}: INFEASIBLE at root — ${err.message}`);
        infeasibleSeeds.push({ seed, reason: err.message });
        continue;
      }
      throw err;
    }

    const memoOptimal = new Map<string, number>();
    const budgetOptimal: NodeBudget = { count: 0, cap: NODE_BUDGET_CAP };
    const memoSafe = new Map<string, number>();
    const budgetSafe: NodeBudget = { count: 0, cap: NODE_BUDGET_CAP };

    let optimalEV: number;
    let alwaysSafeEV: number;
    try {
      optimalEV = exactValue(engine, root.view0, root.witnesses, "optimal", memoOptimal, budgetOptimal);
      alwaysSafeEV = exactValue(engine, root.view0, root.witnesses, "always-safe", memoSafe, budgetSafe);
    } catch (err) {
      if (err instanceof InfeasibleError) {
        console.log(
          `  ${board.label} seed=${seed}: INFEASIBLE during search (rootWitnesses=${root.witnesses.length}) — ${err.message}`
        );
        infeasibleSeeds.push({ seed, reason: err.message });
        continue;
      }
      throw err;
    }

    // Invariant cross-check: optimal is a max over the SAME action set always-safe is a fixed
    // member of, at every node -- optimalEV must never be < alwaysSafeEV. A violation means the
    // recursion has a bug, not that the mechanic is somehow perverse.
    if (optimalEV < alwaysSafeEV - 1e-9) {
      throw new Error(
        `INVARIANT VIOLATED for ${board.label} seed=${seed}: optimalEV=${optimalEV} < alwaysSafeEV=${alwaysSafeEV}`
      );
    }

    outcomes.push({
      seed,
      rootWitnessCount: root.witnesses.length,
      optimalEV,
      alwaysSafeEV,
      nodesVisitedOptimal: budgetOptimal.count,
      nodesVisitedAlwaysSafe: budgetSafe.count,
      elapsedMs: Date.now() - t0,
    });
    console.log(
      `  ${board.label} seed=${seed} rootWitnesses=${root.witnesses.length} ` +
        `optimalEV=${optimalEV.toFixed(4)} alwaysSafeEV=${alwaysSafeEV.toFixed(4)} ` +
        `ratio(opt/safe)=${(optimalEV / alwaysSafeEV).toFixed(4)} ` +
        `nodes(opt=${budgetOptimal.count},safe=${budgetSafe.count}) elapsed=${Date.now() - t0}ms`
    );
  }

  return { outcomes, infeasibleSeeds };
}

// ---------------------------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------------------------
console.log("=== LEG 3 — reduced-board exact expectimax ===");

for (const board of boards) {
  console.log(`\n--- ${board.label} (n=${board.seedCount} seeds, exact per seed) ---`);
  const { outcomes, infeasibleSeeds } = runBoard(board);

  if (infeasibleSeeds.length > 0) {
    console.log(
      `  ${infeasibleSeeds.length}/${board.seedCount} seed(s) INFEASIBLE (node budget ${NODE_BUDGET_CAP}): ` +
        infeasibleSeeds.map((s) => s.seed).join(", ")
    );
  }

  if (outcomes.length === 0) {
    console.log(`LEG3_${board.label}_INFEASIBLE: all seeds exceeded the node budget`);
    continue;
  }

  const sumOptimal = outcomes.reduce((a, o) => a + o.optimalEV, 0);
  const sumSafe = outcomes.reduce((a, o) => a + o.alwaysSafeEV, 0);
  const pooledRatio = sumOptimal / sumSafe; // optimal / alwaysSafe, spec's own direction
  const perSeedRatios = outcomes.map((o) => o.optimalEV / o.alwaysSafeEV);
  const meanOfRatios = perSeedRatios.reduce((a, b) => a + b, 0) / perSeedRatios.length;

  console.log(`\n  ${board.label} SUMMARY (n=${outcomes.length}/${board.seedCount} seeds completed exactly):`);
  console.log(`    sum(optimalEV)=${sumOptimal.toFixed(4)} sum(alwaysSafeEV)=${sumSafe.toFixed(4)}`);
  console.log(`    pooled ratio (optimal/alwaysSafe) = ${pooledRatio.toFixed(4)}`);
  console.log(`    mean of per-seed ratios           = ${meanOfRatios.toFixed(4)}`);
  console.log(`    per-seed ratios: ${perSeedRatios.map((r) => r.toFixed(4)).join(", ")}`);
  console.log(`    spec's criterion: optimalEV <= 1.05 * alwaysSafeEV  =>  pooled: ${pooledRatio <= 1.05}`);
  console.log(
    `LEG3_${board.label}_COMPLETE n=${outcomes.length}/${board.seedCount} pooledRatio=${pooledRatio.toFixed(4)} ` +
      `meanRatio=${meanOfRatios.toFixed(4)} infeasibleCount=${infeasibleSeeds.length}`
  );
}

console.log("\nLEG3_ALL_COMPLETE");

// packages/harness/src/probes-solo.ts — the solo degeneracy probes (solo-games-lens §3.6,
// phase-0 plan §7.4): Grind (any zero-risk unbounded farming loop) and the Always-Safe driver
// (runs the per-game `safeMove` hook as a full agent and compares its score distribution to
// Strong's). Greedy-Only is not a separate function here — packages/bots's `greedyOnlyPolicy`
// IS the roster's "greedy" agent, and the dominant-strategy check is just the
// strongVsGreedyRatio computed by solo-metrics.ts from the same runs (solo-games-lens §3.5
// names Greedy-Only as "§3.5's dominant-strategy probe", i.e. the same comparison, not a
// second agent). Suicide (misère-tagged games only) is a thin re-export of
// `@twist-arcade/bots`'s `suicidePolicy`, run the same way as any other roster agent.

import { rngFor, rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { buildSafeMoveAgent, type SafeMoveFn } from "./agents";
import { median } from "./solo-metrics";
import { pairedSeeds, runSoloAgentOverSeeds, type PlaySoloRunOptions, type SoloRunSummary } from "./solo-runner";

// ---------------------------------------------------------------------------------------
// Grind: breadth-limited cycle search on encode(S) (solo-games-lens §3.6, platform §7.4).
// ---------------------------------------------------------------------------------------

export interface GrindCycleStep {
  move: Json;
  scoreBefore: number;
  scoreAfter: number;
}

export interface GrindResult {
  found: boolean;
  /** The move sequence proven to be indefinitely repeatable (platform-corrections.md C9 —
   *  NOT necessarily a full-state `encode()` repeat; see `searchForCycle`'s doc comment for
   *  why that used to be, and no longer is, the criterion), when found. */
  cycle?: GrindCycleStep[];
  scoreDelta?: number;
  startSeed?: string;
}

export interface GrindOptions {
  /** Cap on cycle length searched, per solo-games-lens §3.6 ("sequences up to length ~8"). */
  maxCycleLength?: number;
  /** Total DFS node budget PER starting state — bounds the search cost regardless of
   *  branching factor. This is explicitly a tripwire, not a proof (solo-games-lens §7.4's own
   *  "honest limitation, on the record": a bounded search can miss long/conditional loops;
   *  structural termination arguments, not this probe, are the real defense). */
  maxNodesPerStart?: number;
  /** Seeds to draw starting states from (each seed's setup() state, plus a short random walk
   *  from it — a farming loop need not be reachable only from the very first move). */
  startSeeds?: string[];
  /** Length of the random walk sampled per seed to generate additional candidate start
   *  states beyond the raw setup() state. */
  walkLength?: number;
  /** platform-corrections.md C9: how many ADDITIONAL times a candidate move sequence must
   *  replay — staying legal and producing the exact same non-negative score delta every
   *  time — before it's accepted as a genuine, indefinitely-repeatable farm (so
   *  `confirmations + 1` total occurrences in a row). Set high enough that a real,
   *  budget-bounded action (one that costs a unit of some finite resource, e.g. a reveal
   *  budget) exhausts that resource and becomes illegal well before this many repeats, while
   *  a genuinely zero-marginal-cost farm (nothing it touches is ever consumed) survives
   *  indefinitely no matter how high this is set — see this file's own bounded-vs-unbounded
   *  test fixtures for why 5 was chosen (comfortably above any of this milestone's small test
   *  budgets, still cheap to check). */
  confirmations?: number;
}

const DEFAULT_MAX_CYCLE_LENGTH = 8;
const DEFAULT_MAX_NODES_PER_START = 20_000;
const DEFAULT_WALK_LENGTH = 20;
const DEFAULT_CONFIRMATIONS = 5;

function scoreOfState<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  state: S
): number {
  if (engine.score) return engine.score(state, 0);
  const status = engine.status(state);
  return status.kind === "scored" ? (status.scores[0] ?? 0) : 0;
}

/**
 * DFS from `start`, looking for ANY move sequence of length 1..maxDepth that is a genuine,
 * indefinitely-repeatable, zero-risk farm.
 *
 * platform-corrections.md C9: an earlier version of this function required
 * `encode(next) === encode(start)` — a FULL-state repeat. Score (e.g. Mine Run's `banked`)
 * lives INSIDE canonical state, so that check could only ever match a byte-identical repeat;
 * a real farm where the score itself keeps climbing every iteration (banked strictly
 * increasing, nothing else ever changing) was structurally invisible to it, which defeated
 * the probe's own headline case. Spine §7.4's "cycle detection on encode(S) … score delta >=
 * 0" turned out to describe two clauses that contradict each other under that check.
 *
 * The fix drops the full-state-equality requirement entirely and instead verifies
 * repeatability DIRECTLY: does this exact move sequence stay legal, and does it keep
 * producing the exact same non-negative score delta, over `confirmations` additional replays
 * in a row (`confirmRepeatable` below)? This is provably robust to both directions:
 *   - a genuine zero-marginal-cost farm (nothing the sequence touches is ever consumed, e.g.
 *     Mine Run's `bank` not costing a reveal) survives any number of replays, so it is caught
 *     regardless of how high `confirmations` is set;
 *   - a bounded action (one that costs a unit of some finite resource) exhausts that resource
 *     and becomes illegal well before a `confirmations` set comfortably above any realistic
 *     test budget, so it is correctly NOT flagged (see probes-solo.test.ts's bounded-vs-
 *     unbounded fixture pair for both directions proven side by side).
 *
 * Because these games draw no further randomness in `apply()` beyond setup (Mine Run,
 * Crackstep, and every shipped launch game — stochastic games are out of scope for this
 * probe's exactness and would need a probabilistic survival estimate instead), a confirmed
 * replay is deterministic proof the same outcome repeats every time: "termination risk ~= 0"
 * is implied by determinism, not separately estimated.
 */
function searchForCycle<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  start: S,
  maxDepth: number,
  maxNodes: number,
  confirmations: number
): GrindResult | undefined {
  let nodes = 0;
  let rngCounter = 0;

  /** Replays `path` once from `state`, checking each move's legality as it goes (a path
   *  found via `legalMoves` at the ORIGINAL state may no longer be legal once resources
   *  have drifted — that drift is exactly what distinguishes a bounded action from a real
   *  farm). Returns the resulting state and the path's total score delta, or `undefined` if
   *  a move stopped being legal or the node budget ran out. */
  function replayPathOnce(state: S, path: readonly M[]): { next: S; delta: number } | undefined {
    let cur = state;
    const before = scoreOfState(engine, cur);
    for (const move of path) {
      if (nodes >= maxNodes) return undefined;
      nodes += 1;
      if (!engine.isLegal(cur, 0, move)) return undefined;
      cur = engine.apply(cur, new Map([[0, move]]), rngFor("__grind_probe__", rngCounter++));
    }
    return { next: cur, delta: scoreOfState(engine, cur) - before };
  }

  /** `path` produced `afterFirst` from its own start with `firstDelta`. Confirms the SAME
   *  path keeps replaying, legally, with the SAME delta, `confirmations` more times in a
   *  row. */
  function confirmRepeatable(afterFirst: S, firstDelta: number, path: readonly M[]): boolean {
    let state = afterFirst;
    for (let rep = 0; rep < confirmations; rep++) {
      const replay = replayPathOnce(state, path);
      if (!replay || replay.delta !== firstDelta) return false;
      state = replay.next;
    }
    return true;
  }

  function dfs(state: S, depth: number, path: GrindCycleStep[], moves: readonly M[]): GrindResult | undefined {
    if (depth >= maxDepth) return undefined;
    const legal = engine.legalMoves(state, 0);
    for (const move of legal) {
      if (nodes >= maxNodes) return undefined;
      nodes += 1;
      const before = scoreOfState(engine, state);
      const applyRng = rngFor("__grind_probe__", rngCounter++);
      const next = engine.apply(state, new Map([[0, move]]), applyRng);
      const after = scoreOfState(engine, next);
      const delta = after - before;
      const nextPath: GrindCycleStep[] = [...path, { move: move as unknown as Json, scoreBefore: before, scoreAfter: after }];
      const nextMoves: M[] = [...moves, move];

      if (delta >= 0 && confirmRepeatable(next, delta, nextMoves)) {
        return { found: true, cycle: nextPath, scoreDelta: delta };
      }
      if (engine.status(next).kind !== "ongoing") continue; // a terminal can't extend a loop
      const deeper = dfs(next, depth + 1, nextPath, nextMoves);
      if (deeper) return deeper;
    }
    return undefined;
  }

  return dfs(start, 0, [], []);
}

/** Searches for a zero-risk unbounded farming loop (solo-games-lens §3.6): any repeatable
 *  cycle of moves whose score delta is >= 0. Runs from each seed's setup() state AND from a
 *  handful of states sampled along a short random walk (a loop need not be reachable only
 *  from move 1). Hard fail if `found` — the CI gate. */
export function grindProbe<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: GrindOptions = {}
): GrindResult {
  const maxCycleLength = opts.maxCycleLength ?? DEFAULT_MAX_CYCLE_LENGTH;
  const maxNodesPerStart = opts.maxNodesPerStart ?? DEFAULT_MAX_NODES_PER_START;
  const walkLength = opts.walkLength ?? DEFAULT_WALK_LENGTH;
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
  const seeds = opts.startSeeds ?? pairedSeeds("grind-probe", 3);

  for (const seed of seeds) {
    let walker = engine.setup(1, rngFromSeed(`${seed}:setup`));
    const candidates: S[] = [walker];
    const walkRng = rngFromSeed(`${seed}:grind-walk`);
    for (let i = 0; i < walkLength; i++) {
      if (engine.status(walker).kind !== "ongoing") break;
      const legal = engine.legalMoves(walker, 0);
      if (legal.length === 0) break;
      const move = legal[walkRng.int(legal.length)]!;
      walker = engine.apply(walker, new Map([[0, move]]), rngFor(`${seed}:grind-walk`, i));
      candidates.push(walker);
    }

    for (const candidate of candidates) {
      if (engine.status(candidate).kind !== "ongoing") continue;
      const result = searchForCycle(engine, candidate, maxCycleLength, maxNodesPerStart, confirmations);
      if (result) return { ...result, startSeed: seed };
    }
  }

  return { found: false };
}

// ---------------------------------------------------------------------------------------
// Always-Safe driver (mine-run plan §4.2, platform §6/§7.4).
// ---------------------------------------------------------------------------------------

export class MissingSafeMoveError extends Error {
  constructor(gameId: string) {
    super(
      `runAlwaysSafeProbe: no safeMove hook was supplied for "${gameId}". Every solo score ` +
        "chase MUST export one (platform §6/§7.4) — the Always-Safe gate (is the risk in " +
        "press-your-luck real?) cannot run without it, and a chase manifest is REQUIRED to " +
        "ship one. This is a hard error, not a skipped gate: a missing hook must never look " +
        "like a passing one."
    );
    this.name = "MissingSafeMoveError";
  }
}

/** Runs the per-game `safeMove` hook as a full agent over `seeds`, exactly like any roster
 *  policy — this IS the Always-Safe bot (mine-run plan §4.2). */
export function runAlwaysSafeProbe<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  safeMove: SafeMoveFn<M, V> | undefined,
  seeds: readonly string[],
  opts: PlaySoloRunOptions = {}
): SoloRunSummary {
  if (!safeMove) throw new MissingSafeMoveError(engine.meta.id);
  const agent = buildSafeMoveAgent(engine, safeMove);
  return runSoloAgentOverSeeds(engine, agent, seeds, opts);
}

/** Always-Safe's median as a fraction of Strong's median. Hard fail >= 0.95 (the risk
 *  mechanic is decorative); design target <= 0.70 (platform §7.4, solo-games-lens §3.6). */
export function alwaysSafeVsStrongRatio(alwaysSafe: SoloRunSummary, strong: SoloRunSummary): number {
  const strongMedian = strong.scores.length === 0 ? 0 : median(strong.scores);
  const safeMedian = alwaysSafe.scores.length === 0 ? 0 : median(alwaysSafe.scores);
  if (strongMedian === 0) return safeMedian === 0 ? 1 : Number.POSITIVE_INFINITY;
  return safeMedian / strongMedian;
}

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
  /** The move sequence that returns to an identically-`encode()`d state, when found. */
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
}

const DEFAULT_MAX_CYCLE_LENGTH = 8;
const DEFAULT_MAX_NODES_PER_START = 20_000;
const DEFAULT_WALK_LENGTH = 20;

function scoreOfState<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  state: S
): number {
  if (engine.score) return engine.score(state, 0);
  const status = engine.status(state);
  return status.kind === "scored" ? (status.scores[0] ?? 0) : 0;
}

/** DFS from `start`, looking for ANY move sequence of length 1..maxDepth that returns to a
 *  state whose `encode()` equals `encode(start)` again, with a non-negative score delta over
 *  the loop. Because these games draw no further randomness in `apply()` beyond setup (Mine
 *  Run, Crackstep, and every shipped launch game — stochastic games are out of scope for this
 *  probe's exactness and would need a probabilistic survival estimate instead), an EXACT
 *  repeat of the encoded state is deterministic proof the loop repeats forever: "termination
 *  risk ~= 0" is implied by determinism, not separately estimated. */
function searchForCycle<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  start: S,
  maxDepth: number,
  maxNodes: number
): GrindResult | undefined {
  const startEncoded = engine.encode(start);
  const startScore = scoreOfState(engine, start);
  let nodes = 0;
  let rngCounter = 0;

  function dfs(state: S, depth: number, path: GrindCycleStep[]): GrindResult | undefined {
    if (depth >= maxDepth) return undefined;
    const legal = engine.legalMoves(state, 0);
    for (const move of legal) {
      if (nodes >= maxNodes) return undefined;
      nodes += 1;
      const before = scoreOfState(engine, state);
      const applyRng = rngFor("__grind_probe__", rngCounter++);
      const next = engine.apply(state, new Map([[0, move]]), applyRng);
      const after = scoreOfState(engine, next);
      const nextPath: GrindCycleStep[] = [...path, { move: move as unknown as Json, scoreBefore: before, scoreAfter: after }];

      if (engine.encode(next) === startEncoded && after - startScore >= 0) {
        return { found: true, cycle: nextPath, scoreDelta: after - startScore };
      }
      if (engine.status(next).kind !== "ongoing") continue; // a terminal can't extend a loop
      const deeper = dfs(next, depth + 1, nextPath);
      if (deeper) return deeper;
    }
    return undefined;
  }

  return dfs(start, 0, []);
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
      const result = searchForCycle(engine, candidate, maxCycleLength, maxNodesPerStart);
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

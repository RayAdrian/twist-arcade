// packages/harness/src/solo-runner.ts — the policy-vs-distribution executor over paired seed
// sets (solo-games-lens §3.1, phase-0 plan §7.1/§7.3): "run each policy N times over the SAME
// fixed seed set (paired seeds — the solo analogue of mirrored seats, same variance reduction)
// and compare the resulting score/steps distributions." There is no opponent, so there is no
// head-to-head win/loss here — only per-seed outcomes, later compared distributionally by
// solo-metrics.ts.

import { rngFor, rngForSetup, rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { SearchBudget } from "@twist-arcade/game-spec";
import { staticClock, type SoloAgent } from "./agents";

export interface SoloRunResult {
  seed: string;
  finalScore: number;
  decisions: number;
  capHit: boolean;
  terminal: "won" | "lost" | "scored" | "cap-hit";
  moveLog: Json[];
}

export interface SoloRunSummary {
  name: string;
  runs: SoloRunResult[];
  scores: number[];
  decisionsList: number[];
  capHitRate: number;
}

export interface PlaySoloRunOptions {
  /** Default 2,000 — platform §3's default score-chase moveCap; a manifest's
   *  `solo.moveCap` (or a puzzle's structural bound) should be passed explicitly. */
  moveCap?: number;
  /** Default `{ kind: "rollouts", n: 1000 }` — a `deadlineMs` budget here would make harness
   *  reports non-reproducible across machines (platform §5.2), so callers wanting a different
   *  budget must still choose a `rollouts` one. */
  budget?: SearchBudget;
}

const DEFAULT_MOVE_CAP = 2000;
const DEFAULT_BUDGET: SearchBudget = { kind: "rollouts", n: 1000 };

/** Plays one full solo run of `agent` against `engine` from `seed`, to a terminal or the move
 *  cap. Setup uses `rngForSetup(seed)` and step k's `apply` uses `rngFor(seed, k)` — the same
 *  wire-format convention `engineContract`'s own random playouts and `replay()` use, so a
 *  harness run's move log is a genuine, independently-replayable `ReplayRecord` in spirit
 *  (the harness does not itself persist one; `certify.ts` does, for the puzzle pipeline). */
export function playSoloRun<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  agent: SoloAgent<S, M>,
  seed: string,
  opts: PlaySoloRunOptions = {}
): SoloRunResult {
  const moveCap = opts.moveCap ?? DEFAULT_MOVE_CAP;
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const clock = staticClock();

  let state = engine.setup(1, rngForSetup(seed));
  const decisionRng = rngFromSeed(`${seed}:decision`);
  const moveLog: Json[] = [];

  let ply = 0;
  for (; ply < moveCap; ply++) {
    if (engine.status(state).kind !== "ongoing") break;
    const { move } = agent.chooseMove({ engine, state, player: 0, rng: decisionRng, budget, clock });
    moveLog.push(move as unknown as Json);
    state = engine.apply(state, new Map([[0, move]]), rngFor(seed, ply));
  }

  const finalStatus = engine.status(state);
  const capHit = ply >= moveCap && finalStatus.kind === "ongoing";

  let finalScore = 0;
  let terminal: SoloRunResult["terminal"];
  if (capHit) {
    terminal = "cap-hit";
    if (engine.score) finalScore = engine.score(state, 0);
  } else if (finalStatus.kind === "scored") {
    terminal = "scored";
    finalScore = finalStatus.scores[0] ?? 0;
  } else if (finalStatus.kind === "won") {
    terminal = "won";
    if (engine.score) finalScore = engine.score(state, 0);
  } else if (finalStatus.kind === "lost") {
    terminal = "lost";
    if (engine.score) finalScore = engine.score(state, 0);
  } else {
    // status() is still "ongoing" but ply hit moveCap without capHit being computed true —
    // structurally unreachable (capHit's condition is exactly this), kept only so `terminal`
    // is total rather than possibly-undefined.
    terminal = "cap-hit";
  }

  return { seed, finalScore, decisions: ply, capHit, terminal, moveLog };
}

/** Runs one agent over every seed in `seeds`, returning the per-seed results plus the raw
 *  arrays solo-metrics.ts consumes. */
export function runSoloAgentOverSeeds<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  agent: SoloAgent<S, M>,
  seeds: readonly string[],
  opts: PlaySoloRunOptions = {}
): SoloRunSummary {
  const runs = seeds.map((seed) => playSoloRun(engine, agent, seed, opts));
  const capHits = runs.filter((r) => r.capHit).length;
  return {
    name: agent.name,
    runs,
    scores: runs.map((r) => r.finalScore),
    decisionsList: runs.map((r) => r.decisions),
    capHitRate: runs.length === 0 ? 0 : capHits / runs.length,
  };
}

/** The paired seed set (solo-games-lens §3.1's "the solo analogue of mirrored seats"): every
 *  named policy in a suite run gets the IDENTICAL `n` seeds, in the same order, so per-seed
 *  comparisons (and the harness's fixed-seed ⇒ byte-identical-report DoD item) hold. */
export function pairedSeeds(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

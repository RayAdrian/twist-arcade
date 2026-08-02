// packages/engine/src/replay.ts — replay utilities (plan §3.3).
//
// `replay` is the future leaderboard verifier (solo scores included: claimed score
// discarded, recomputed from the replay), the certificate re-verifier, and the bug-repro
// tool. It validates every move with `isLegal` before applying and refuses illegal logs
// loudly (throws) rather than silently producing a wrong trajectory.

import { rngFor, rngFromSeed } from "./rng";
import type { GameEngine, Json, PlayerId, WithEffects } from "./types";
import { stableStringify } from "./encode";

/** One step's moves: 1 entry for a sequential step, n entries for a simultaneous step. */
export interface StepRecord {
  moves: [PlayerId, Json][];
}

export interface ReplayRecord {
  gameId: string;
  gameVersion: number; // GameMeta.version at record time
  engineVersion: string; // @twist-arcade/engine package version (see §10 freeze policy)
  numPlayers: number; // 1 for solo
  seed: string; // matchSeed; rng for step k = rngFor(seed, k)
  steps: StepRecord[];
}

export class IllegalReplayMoveError extends Error {
  constructor(step: number, player: PlayerId, move: Json) {
    super(
      `replay: illegal move at step ${step} for player ${player}: ${stableStringify(move)}. ` +
        "The move log does not match a legal trajectory under this engine — refusing to replay."
    );
    this.name = "IllegalReplayMoveError";
  }
}

/**
 * Replays every step of `record` through `engine`, validating each move with `isLegal`
 * before applying it. Throws IllegalReplayMoveError on the first illegal move it finds.
 * Returns every intermediate state (including the initial setup state at index 0) plus the
 * final state and its terminal status.
 */
export function replay<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  record: ReplayRecord
): { states: S[]; final: S; status: ReturnType<GameEngine<S, M, V>["status"]> } {
  const states: S[] = [];
  // setup() is not one of the "steps" — it draws from the base seed stream directly, via
  // rngFromSeed, not rngFor. rngFor's per-step forking (§3.4) applies to apply() calls only:
  // step k's move (0-indexed into `record.steps`) always draws from rngFor(seed, k),
  // independent of how many draws setup() or earlier steps made.
  const setupRng = rngFromSeed(record.seed);
  let state = engine.setup(record.numPlayers, setupRng);
  states.push(state);

  for (let stepIndex = 0; stepIndex < record.steps.length; stepIndex++) {
    const step = record.steps[stepIndex]!;
    const movesMap = new Map<PlayerId, M>();
    for (const [player, move] of step.moves) {
      const typedMove = move as M;
      if (!engine.isLegal(state, player, typedMove)) {
        throw new IllegalReplayMoveError(stepIndex, player, move);
      }
      movesMap.set(player, typedMove);
    }
    const stepRng = rngFor(record.seed, stepIndex);
    state = engine.apply(state, movesMap, stepRng);
    states.push(state);
  }

  return { states, final: state, status: engine.status(state) };
}

/** Returns the state after exactly `k` steps (k === 0 ⇒ the initial setup state). */
export function replayTo<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  record: ReplayRecord,
  k: number
): S {
  if (k < 0 || k > record.steps.length) {
    throw new RangeError(`replayTo: k=${k} out of range for a record with ${record.steps.length} steps`);
  }
  const truncated: ReplayRecord = { ...record, steps: record.steps.slice(0, k) };
  return replay(engine, truncated).final;
}

/** Returns a new record with `moves` appended as the next step. Never mutates `record`. */
export function appendStep(record: ReplayRecord, moves: ReadonlyMap<PlayerId, Json>): ReplayRecord {
  return {
    ...record,
    steps: [...record.steps, { moves: Array.from(moves.entries()) }],
  };
}

// packages/harness/src/solver/types.ts — shared types for the two-player exact solver
// (reach.ts + retrograde.ts + solve.ts). Plan §7.6, correction C3.
//
// C3, restated precisely (this is the caveat `solve.ts`'s module doc and the CLI print):
// this solver is NOT generic over every game under the state-space ceiling. It hashes on
// `encode(S)` as the position key, deduplicating the reachability graph on that hash. That is
// sound ONLY when `encode(S)` is a valid position key — i.e. when two states with the same
// `encode()` output are always legally interchangeable going forward. Under superko (or any
// repetition rule whose legality depends on the PATH taken to reach a position, not just the
// position itself), that assumption is false: `history` (or an equivalent) legitimately lives
// in state, so `encode(S)` is NOT a position key, and deduplicating on it would silently
// conflate genuinely different game states.
//
// THE GENERAL TEST FOR A FUTURE AUTHOR: if legality or outcome depends on the path taken
// rather than the position reached, `encode` is not a position key for this solver. Fadeout
// (superko) is that pattern; Crackstep (positions can never repeat at all) is the opposite —
// its `encode` is sound and the generic dedup works directly. A history-dependent game must
// compose `reach`/`retrograde` locally over its OWN sound position key (see solve.ts's doc for
// how) rather than call `solveTwoPlayerGame`/`harness solve` directly.

export type PositionValue = "win" | "loss" | "draw";

/** Flip a mover-relative WIN/LOSS value across an actual change of perspective. There is no
 *  "flip" of a draw — draws are absolute, not perspective-relative (an unresolved/drawn
 *  position is a draw for every player). Never called with "draw" — callers only flip values
 *  that came from `RetrogradeResult.valueAt`, which never returns "draw" (see retrograde.ts's
 *  module doc: draws are pure residue, never explicitly labeled). */
export function flipValue(v: "win" | "loss"): "win" | "loss" {
  return v === "win" ? "loss" : "win";
}

export class UnsupportedGameError extends Error {
  constructor(reason: string) {
    super(`reach/retrograde: ${reason}`);
    this.name = "UnsupportedGameError";
  }
}

export class ReachLimitExceededError extends Error {
  constructor(maxStates: number) {
    super(
      `reach(): exceeded --max-states=${maxStates} while enumerating the reachable-state graph. ` +
        "Either raise the limit or this game is not solvable by exhaustive reachability at all " +
        "(consider a per-game heuristic solver instead — see @twist-arcade/game-spec's SoloSolver " +
        "shape for the puzzle-solver convention this could mirror)."
    );
    this.name = "ReachLimitExceededError";
  }
}

/** Asserts the platform plan §7.6 preconditions this solver requires: perfect-info,
 *  deterministic, sequential, exactly 2 players. Shared by reach() and any game-local solver
 *  composing over these building blocks (solve.ts calls this too). */
export function assertSolvablePreconditions(meta: {
  readonly hiddenInformation: boolean;
  readonly simultaneous: boolean;
  readonly stochastic: boolean;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly id: string;
}): void {
  if (meta.hiddenInformation) {
    throw new UnsupportedGameError(
      `engine "${meta.id}" has hiddenInformation===true — the exact solver fits perfect-information games only.`
    );
  }
  if (meta.simultaneous) {
    throw new UnsupportedGameError(
      `engine "${meta.id}" is simultaneous — the exact solver fits sequential games only.`
    );
  }
  if (meta.stochastic) {
    throw new UnsupportedGameError(
      `engine "${meta.id}" is stochastic — the exact solver fits deterministic games only.`
    );
  }
  if (meta.minPlayers !== 2 || meta.maxPlayers !== 2) {
    throw new UnsupportedGameError(
      `engine "${meta.id}" is not a fixed 2-player game (minPlayers=${meta.minPlayers}, ` +
        `maxPlayers=${meta.maxPlayers}) — the exact solver fits exactly 2 players.`
    );
  }
}

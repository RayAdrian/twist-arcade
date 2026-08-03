// packages/harness/test/fixtures/doors.ts — a minimal 2-PLAYER, hiddenInformation:true fixture
// ("doors": a prize sits behind one of two doors, seat 0 guesses) built specifically to
// reproduce the stage-6 review's live demonstration of runner.ts's MUST-FIX C1 gap: nothing in
// runMatchup() refused to hand a policy the canonical (secret-bearing) state, so a policy that
// simply reads `state.secret` off the top wins 10/10 against any opponent — a passing gate on a
// game that is unplayable blind. This fixture exists purely to plant that cheater against the
// runner and prove the guard now refuses BEFORE a single game is played; it is not a shipped
// game and is deliberately as small as corridor.ts/tiny-fog.ts (the sibling fixtures this
// mirrors in style).
//
// THE GAME: `secret` (which door hides the prize) is drawn once at setup(). Seat 0 makes the
// only move of the game — guess door 0 or door 1 — and wins iff the guess matches `secret`;
// otherwise seat 1 wins. `stochastic: false`: `setup()` legitimately consumes the injected Rng
// (every engine's setup does, per the contract), but nothing about subsequent play is
// outcome-relevant-random — the whole game is exactly one deterministic decision once the
// (hidden) secret is fixed, the same convention corridor.ts documents for its own setup().

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

export interface DoorsState extends WithEffects {
  readonly secret: 0 | 1;
  readonly resolved: boolean;
  readonly correct: boolean;
}

/** The view NEVER carries `secret` — omitted, not masked (same C1 discipline tiny-fog.ts's own
 *  view documents). Pre-resolution it reveals nothing beyond that the game is ongoing;
 *  post-resolution it reveals the outcome only. */
export type DoorsView =
  | ({ readonly resolved: false } & WithEffects)
  | ({ readonly resolved: true; readonly correct: boolean } & WithEffects);

export interface DoorsMove {
  readonly open: 0 | 1;
  readonly [key: string]: Json;
}

export const doors: GameEngine<DoorsState, DoorsMove, DoorsView> = {
  meta: {
    id: "doors-fixture",
    name: "Doors (harness runner test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: true,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, rng: Rng): DoorsState {
    return { secret: rng.int(2) as 0 | 1, resolved: false, correct: false, lastEffects: [] };
  },

  legalMoves(state: DoorsState, player: PlayerId): DoorsMove[] {
    if (player !== 0 || state.resolved) return [];
    return [{ open: 0 }, { open: 1 }];
  },

  isLegal(state: DoorsState, player: PlayerId, move: DoorsMove): boolean {
    return doors.legalMoves(state, player).some((m) => m.open === move.open);
  },

  active(_state: DoorsState): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state: DoorsState, moves: ReadonlyMap<PlayerId, DoorsMove>, _rng: Rng): DoorsState {
    const move = moves.get(0);
    if (!move) throw new Error("doors: apply() called without a move for seat 0");
    const correct = move.open === state.secret;
    return {
      secret: state.secret,
      resolved: true,
      correct,
      lastEffects: [{ type: "opened", open: move.open, correct }],
    };
  },

  status(state: DoorsState): Status {
    if (!state.resolved) return { kind: "ongoing" };
    return { kind: "won", winner: state.correct ? 0 : 1 };
  },

  playerView(state: DoorsState, _player: PlayerId | null): DoorsView {
    if (!state.resolved) return { resolved: false, lastEffects: [] };
    return { resolved: true, correct: state.correct, lastEffects: state.lastEffects };
  },

  encode(state: DoorsState): string {
    return JSON.stringify({ secret: state.secret, resolved: state.resolved, correct: state.correct });
  },

  decode(encoded: string): DoorsState {
    const parsed = JSON.parse(encoded) as { secret: 0 | 1; resolved: boolean; correct: boolean };
    return { secret: parsed.secret, resolved: parsed.resolved, correct: parsed.correct, lastEffects: [] };
  },
};

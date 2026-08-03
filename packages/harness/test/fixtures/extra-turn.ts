// packages/harness/test/fixtures/extra-turn.ts — a tiny hand-built 2-player fixture built to
// exercise retrograde.ts's SAME-MOVER (extra-turn) branch (review Note 7): `outcomeForMover`
// passes a child's value through UNFLIPPED when the child's mover is the SAME player as the
// parent's (an extra-turn rule), and flips only across an actual change of perspective. Neither
// corridor.ts nor twin-track.ts ever gives one player two plies in a row, so that branch has no
// test pinning it directly — a solver that always flipped regardless of mover identity would
// report LOSS for what is genuinely a WIN, and nothing currently would notice.
//
// THE GAME: player 0 gets exactly two plies in a row (an "extra turn"), then wins. `setup()`
// starts at `phase: 0` with player 0 to move; player 0's only move advances to `phase: 1`,
// STILL player 0's turn (the extra-turn rule — active() names player 0 again); player 0's move
// from `phase: 1` resolves the game as a win for player 0. Player 1 never gets to move at all —
// deliberately, since the whole point is a single mover crossing two plies, not an alternation.
//
// HAND-COMPUTED VALUE: the `phase: 1` node's only edge points straight at a `won` terminal for
// its own mover (player 0) — resolved WIN in retrograde's seed pass, no flip involved at all.
// The ROOT (`phase: 0`)'s only edge points at that now-resolved `phase: 1` node, whose mover
// (player 0) is the SAME as the root's own mover (player 0) — so the correct propagated outcome
// is the child's value taken AS-IS ("win"), never flipped to "loss". A buggy always-flip
// implementation computes flipValue("win") = "loss" for that edge instead, which (being the
// root's only edge) resolves the root itself to LOSS by the countdown — the exact silent wrong
// answer this fixture exists to catch.

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

export interface ExtraTurnState extends WithEffects {
  readonly phase: 0 | 1;
  readonly resolved: boolean;
}

export interface ExtraTurnMove {
  readonly advance: true;
  readonly [key: string]: Json;
}

export const extraTurn: GameEngine<ExtraTurnState, ExtraTurnMove, ExtraTurnState> = {
  meta: {
    id: "extra-turn-fixture",
    name: "Extra Turn (harness solver test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): ExtraTurnState {
    return { phase: 0, resolved: false, lastEffects: [] };
  },

  legalMoves(state: ExtraTurnState, player: PlayerId): ExtraTurnMove[] {
    if (player !== 0 || state.resolved) return [];
    return [{ advance: true }];
  },

  isLegal(state: ExtraTurnState, player: PlayerId, move: ExtraTurnMove): boolean {
    return extraTurn.legalMoves(state, player).some((m) => m.advance === move.advance);
  },

  // Player 0 is active at BOTH phase 0 and phase 1 — the extra-turn rule, expressed simply as
  // "always name player 0" while the game is ongoing (player 1 is never active in this fixture).
  active(_state: ExtraTurnState): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state: ExtraTurnState, moves: ReadonlyMap<PlayerId, ExtraTurnMove>, _rng: Rng): ExtraTurnState {
    const move = moves.get(0);
    if (!move) throw new Error("extra-turn: apply() called without a move for player 0");
    if (state.phase === 0) {
      return { phase: 1, resolved: false, lastEffects: [{ type: "advanced", to: 1 }] };
    }
    return { phase: 1, resolved: true, lastEffects: [{ type: "resolved", winner: 0 }] };
  },

  status(state: ExtraTurnState): Status {
    if (!state.resolved) return { kind: "ongoing" };
    return { kind: "won", winner: 0 };
  },

  playerView(state: ExtraTurnState, _player: PlayerId | null): ExtraTurnState {
    return state; // perfect information
  },

  encode(state: ExtraTurnState): string {
    return JSON.stringify({ phase: state.phase, resolved: state.resolved });
  },

  decode(encoded: string): ExtraTurnState {
    const parsed = JSON.parse(encoded) as { phase: 0 | 1; resolved: boolean };
    return { phase: parsed.phase, resolved: parsed.resolved, lastEffects: [] };
  },
};

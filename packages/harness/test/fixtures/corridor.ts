// packages/harness/test/fixtures/corridor.ts — a tiny hand-built CYCLIC 2-player fixture
// (plan §9's TDD anchor: "a tiny hand-built cyclic fixture converges under value iteration
// where plain minimax would loop"). Solver-test scaffolding only — never a shipped game, and
// deliberately NOT run through engineContract() (it is not trying to be a real game; its whole
// point is a state graph with an actual cycle in it, hand-verifiable by backward induction).
//
// THE GAME: a single shared token sits on a 5-cell track, positions 0..4. Players alternate
// strictly turn by turn (the specific player identity never matters — only whose turn it is).
// On your turn you may step the token left (-1, if pos > 0) or right (+1). Moving the token
// onto cell 4 wins IMMEDIATELY for whoever just moved. Nothing else ends the game.
//
// WHY THIS GRAPH IS CYCLIC: from pos=2 it is legal to step left to pos=1, and from pos=1 it is
// legal to step right back to pos=2 — the exact same (pos, turn) state recurs two plies later.
// A naive recursive minimax/negamax with no cycle detection, given no depth cap, would recurse
// along that loop forever (stack overflow) rather than terminate; if depth-capped it would
// return a heuristic guess at the cutoff instead of the correct value — this fixture has no
// heuristic() at all, specifically so nothing can paper over that failure mode.
//
// HAND-COMPUTED VALUES (mover-to-move perspective; verified by backward induction, see the
// handoff report for the full derivation):
//   pos=3 (either turn): WIN — the mover can step right onto pos=4 and win immediately.
//   pos=0, pos=1, pos=2 (either turn): DRAW — nobody is ever FORCED to walk into pos=3 (pos=2's
//     other option, stepping to pos=1, is always available and never hands the opponent an
//     immediate win), so both players can shuffle within {0,1,2} forever. The fixed point never
//     labels these three positions win or loss; they are the "residue = draw" case (plan §7.6).

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

const TRACK_LENGTH = 5; // positions 0..4; reaching 4 wins immediately for the mover.

export interface CorridorState extends WithEffects {
  readonly pos: number; // 0..3 while ongoing (4 is terminal — never stored as a state)
  readonly turn: PlayerId; // 0 or 1
}

export interface CorridorMove {
  readonly dir: "left" | "right";
  readonly [key: string]: Json;
}

function computeStatus(state: CorridorState, justMoved: PlayerId | null): Status {
  if (state.pos === TRACK_LENGTH - 1) {
    // Should never actually be stored (apply() below resolves the win before returning a
    // pos=4 state), but kept defensively consistent.
    return { kind: "won", winner: justMoved ?? state.turn };
  }
  return { kind: "ongoing" };
}

export const corridor: GameEngine<CorridorState, CorridorMove, CorridorState> = {
  meta: {
    id: "corridor-fixture",
    name: "Corridor (harness solver test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): CorridorState {
    return { pos: 2, turn: 0, lastEffects: [] };
  },

  legalMoves(state: CorridorState, player: PlayerId): CorridorMove[] {
    if (player !== state.turn) return [];
    if (state.pos === TRACK_LENGTH - 1) return [];
    const moves: CorridorMove[] = [{ dir: "right" }];
    if (state.pos > 0) moves.push({ dir: "left" });
    return moves;
  },

  isLegal(state: CorridorState, player: PlayerId, move: CorridorMove): boolean {
    return corridor.legalMoves(state, player).some((m) => m.dir === move.dir);
  },

  active(state: CorridorState): ActiveSpec {
    return { mode: "sequential", player: state.turn };
  },

  apply(state: CorridorState, moves: ReadonlyMap<PlayerId, CorridorMove>, _rng: Rng): CorridorState {
    const move = moves.get(state.turn);
    if (!move || !corridor.isLegal(state, state.turn, move)) {
      throw new Error(`corridor: illegal move ${JSON.stringify(move ?? null)}`);
    }
    const nextPos = move.dir === "right" ? state.pos + 1 : state.pos - 1;
    const nextTurn: PlayerId = state.turn === 0 ? 1 : 0;
    return {
      pos: nextPos,
      turn: nextTurn,
      lastEffects: [{ type: "moved", dir: move.dir, from: state.pos, to: nextPos }],
    };
  },

  status(state: CorridorState): Status {
    // A "won" terminal is produced the instant pos reaches TRACK_LENGTH-1 by apply() itself
    // never being called again on it — status() reports won for whichever player is NOT to
    // move (the mover who just placed it there is state.turn's opponent, since turn already
    // flipped in apply()).
    if (state.pos === TRACK_LENGTH - 1) {
      const justMoved: PlayerId = state.turn === 0 ? 1 : 0;
      return computeStatus(state, justMoved);
    }
    return { kind: "ongoing" };
  },

  playerView(state: CorridorState, _player: PlayerId | null): CorridorState {
    return state; // perfect information
  },

  encode(state: CorridorState): string {
    return JSON.stringify({ pos: state.pos, turn: state.turn });
  },

  decode(encoded: string): CorridorState {
    const parsed = JSON.parse(encoded) as { pos: number; turn: PlayerId };
    return { pos: parsed.pos, turn: parsed.turn, lastEffects: [] };
  },
};

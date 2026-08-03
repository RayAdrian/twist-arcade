// packages/harness/test/fixtures/twin-track.ts — a tiny hand-built ACYCLIC 2-player fixture
// built to exercise retrograde.ts's LOSS-by-countdown machinery (review Note 7), which corridor
// alone never exercises: corridor's only labeled values are WIN (pos=3) and draw-residue
// (pos=0/1/2) — nothing in it is ever proven LOSS, so the "every child must be proven a loss
// before the parent is" countdown path (retrograde.ts:143-145) has no test pinning it directly.
//
// THE GAME: a 5-cell track, positions 0..4, BOTH ends win immediately for whoever just moved
// onto them (unlike corridor, which has exactly one winning end) — hence "twin track". Turns
// alternate strictly; on your turn you step the shared token left or right by one (bounded).
//
// HAND-COMPUTED VALUES (mover-to-move perspective):
//   pos=1: WIN — the mover can step left onto pos=0 and win immediately.
//   pos=3: WIN — the mover can step right onto pos=4 and win immediately (symmetric).
//   pos=2 (the start): LOSS — the mover's only two options are left (to pos=1) and right (to
//     pos=3); pos=1 and pos=3 are both WIN *for whoever is then to move*, i.e. the OPPONENT — so
//     every option pos=2's mover has hands the opponent an immediate win next turn. Proving this
//     requires retrograde() to resolve BOTH of pos=2's outgoing edges as "loss for pos=2's
//     mover" before it can conclude LOSS (the countdown: remaining starts at 2, each edge that
//     resolves to a loss-for-mover decrements it, and only reaching 0 proves LOSS) — exactly the
//     path corridor's own draw-only graph never touches.

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

const TRACK_LENGTH = 5; // positions 0..4; reaching either end (0 or 4) wins for the mover.

export interface TwinTrackState extends WithEffects {
  readonly pos: number; // 1..3 while ongoing (0 and 4 are terminal — never stored as a state)
  readonly turn: PlayerId;
}

export interface TwinTrackMove {
  readonly dir: "left" | "right";
  readonly [key: string]: Json;
}

export const twinTrack: GameEngine<TwinTrackState, TwinTrackMove, TwinTrackState> = {
  meta: {
    id: "twin-track-fixture",
    name: "Twin Track (harness solver test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): TwinTrackState {
    return { pos: 2, turn: 0, lastEffects: [] };
  },

  legalMoves(state: TwinTrackState, player: PlayerId): TwinTrackMove[] {
    if (player !== state.turn) return [];
    return [{ dir: "left" }, { dir: "right" }];
  },

  isLegal(state: TwinTrackState, player: PlayerId, move: TwinTrackMove): boolean {
    return twinTrack.legalMoves(state, player).some((m) => m.dir === move.dir);
  },

  active(state: TwinTrackState): ActiveSpec {
    return { mode: "sequential", player: state.turn };
  },

  apply(state: TwinTrackState, moves: ReadonlyMap<PlayerId, TwinTrackMove>, _rng: Rng): TwinTrackState {
    const move = moves.get(state.turn);
    if (!move || !twinTrack.isLegal(state, state.turn, move)) {
      throw new Error(`twin-track: illegal move ${JSON.stringify(move ?? null)}`);
    }
    const nextPos = move.dir === "right" ? state.pos + 1 : state.pos - 1;
    const nextTurn: PlayerId = state.turn === 0 ? 1 : 0;
    return {
      pos: nextPos,
      turn: nextTurn,
      lastEffects: [{ type: "moved", dir: move.dir, from: state.pos, to: nextPos }],
    };
  },

  status(state: TwinTrackState): Status {
    if (state.pos === 0 || state.pos === TRACK_LENGTH - 1) {
      // The mover who just moved is turn's OPPONENT — turn already flipped in apply().
      const justMoved: PlayerId = state.turn === 0 ? 1 : 0;
      return { kind: "won", winner: justMoved };
    }
    return { kind: "ongoing" };
  },

  playerView(state: TwinTrackState, _player: PlayerId | null): TwinTrackState {
    return state; // perfect information
  },

  encode(state: TwinTrackState): string {
    return JSON.stringify({ pos: state.pos, turn: state.turn });
  },

  decode(encoded: string): TwinTrackState {
    const parsed = JSON.parse(encoded) as { pos: number; turn: PlayerId };
    return { pos: parsed.pos, turn: parsed.turn, lastEffects: [] };
  },
};

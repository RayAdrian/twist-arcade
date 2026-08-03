// packages/bots/test/fixtures/solo-trap.ts — a minimal 1-player (solo), sequential,
// deterministic, perfect-information fixture built to isolate one specific consequence of
// minimaxPolicy hardcoding 0/1 alternation (review finding 3's "maxPlayers <= 2 admits
// 1-player games negamax can't handle"): for a SOLO game there is no player 1 at all, so a
// hardcoded "next mover = the other player" assumption doesn't just mis-route search — it
// flips the SIGN of terminal values it shouldn't touch. Test scaffolding only.
//
// Layout: START(0) branches to TRAP(1, a dead end — no further moves, an immediate "lost")
// or SAFE(2, ongoing, heuristic 1) which then reaches GOAL(3, "won"). heuristic() is
// deliberately consulted only at SAFE, so a 1-ply-deep evaluation of the trap must go through
// `terminalValue({kind:"lost"}, mover)`, which returns -Infinity UNCONDITIONALLY (a "lost"
// status carries no `winner` field to check against `mover` — it means "the searching player
// has lost", full stop). Hardcoded alternation assumes the child's mover differs from the
// parent's, so it NEGATES that already-fixed -Infinity into +Infinity — a certain loss reads
// as a certain win, and minimax walks straight into the trap. Reading the real
// engine.active() for a solo game reports the SAME player again (sameMover === true), so the
// value is correctly left un-negated.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

export interface SoloTrapState extends WithEffects {
  readonly pos: 0 | 1 | 2 | 3;
}

export interface SoloTrapMove {
  readonly to: 1 | 2 | 3;
  readonly [key: string]: Json;
}

export const soloTrap: GameEngine<SoloTrapState, SoloTrapMove, SoloTrapState> = {
  meta: {
    id: "solo-trap-fixture",
    name: "Solo Trap (bots test fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): SoloTrapState {
    return { pos: 0, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): SoloTrapMove[] {
    if (player !== 0) return [];
    if (state.pos === 0) return [{ to: 1 }, { to: 2 }];
    if (state.pos === 2) return [{ to: 3 }];
    return []; // pos 1 (trap) and pos 3 (goal) are both terminal — no further moves
  },

  isLegal(state, player, move): boolean {
    return this.legalMoves(state, player).some((m) => m.to === move.to);
  },

  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state, moves, _rng): SoloTrapState {
    const move = moves.get(0);
    if (!move) throw new Error("solo-trap: apply() called without a move for player 0");
    const effects: Effect[] = [{ type: "moved", from: state.pos, to: move.to }];
    return { pos: move.to, lastEffects: effects };
  },

  status(state): Status {
    if (state.pos === 3) return { kind: "won", winner: 0 };
    if (state.pos === 1) return { kind: "lost" };
    return { kind: "ongoing" };
  },

  playerView(state, _player): SoloTrapState {
    return state;
  },

  encode(state): string {
    return JSON.stringify({ pos: state.pos });
  },

  decode(encoded): SoloTrapState {
    const parsed = JSON.parse(encoded) as { pos: 0 | 1 | 2 | 3 };
    return { pos: parsed.pos, lastEffects: [] };
  },

  heuristic(state, _player): number {
    // Only ever consulted at SAFE (pos 2) in this fixture's tests — TRAP and GOAL are both
    // terminal (handled by terminalValue, never heuristic), and the root itself is never
    // passed to evaluate()/heuristic() directly.
    return state.pos === 2 ? 1 : 0;
  },
};

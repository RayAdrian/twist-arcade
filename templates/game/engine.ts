// games/__GAME_ID__/engine.ts — TODO-marked engine skeleton, stamped by `pnpm new-game`.
//
// This file COMPILES and is a real, honest implementation of a trivial placeholder game
// (two players alternately increment a shared counter) — every property except ONE is
// genuinely satisfied: purity, determinism, encode/decode round-tripping, legality
// coherence, and the perfect-information playerView identity all hold for real, right now.
//
// THE ONE THING LEFT FOR YOU: `status()` always returns `{ kind: "ongoing" }` — there is no
// real win/draw condition yet. This is deliberate: it is what makes
// `engineContract(__PASCAL_ID__)` in engine.test.ts fail RED (a random legal playout never
// terminates, so it hits the ply cap — the "termination" property) without any other property
// failing alongside it. Replace `status()` with your real rules, and that failure — and only
// that failure — should turn green.
//
// See CHECKLIST.md for the traps every new engine hits (index signatures, encode/lastEffects,
// history-dependent legality, decode's throw-not-partial contract).

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { heuristic } from "./heuristic";

export interface __PASCAL_ID__State extends WithEffects {
  readonly counter: number;
  /** Whose turn it is next (0 or 1). TODO: replace/extend with your real board state. */
  readonly mover: PlayerId;
}

// The explicit `[key: string]: Json` index signature is NOT optional boilerplate — TypeScript
// will not synthesize one for a plain interface/type-literal used as the engine's `M` generic,
// and without it `__PASCAL_ID__Move` fails to satisfy `Json` (see CHECKLIST.md's first trap).
export interface __PASCAL_ID__Move {
  readonly kind: "increment";
  readonly [key: string]: Json;
}

const NUM_PLAYERS = 2;

// A standalone function, not `engine.status(state)` called via `this` — every method below is
// called as a bare reference in places (bots, the harness, the shell), never guaranteed to be
// invoked with `engine` as its receiver, so `this` inside an object-literal method would be
// unreliable. This is the same reason every shipped fixture (classic-ttt, bank-run,
// mini-crackstep) and every real game (mine-run, fadeout) uses a free-standing
// `computeStatus`/`status`-shaped helper instead.
function computeStatus(_state: __PASCAL_ID__State): Status {
  // TODO(you): implement real win/draw rules. Left as always-"ongoing" on purpose — see this
  // file's own module doc for why that is the scaffold's single intentional contract failure.
  return { kind: "ongoing" };
}

export const __CAMEL_ID__: GameEngine<__PASCAL_ID__State, __PASCAL_ID__Move, __PASCAL_ID__State> = {
  meta: {
    id: "__GAME_ID__",
    name: "__TITLE__",
    minPlayers: NUM_PLAYERS,
    maxPlayers: NUM_PLAYERS,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): __PASCAL_ID__State {
    return { counter: 0, mover: 0, lastEffects: [] };
  },

  legalMoves(state: __PASCAL_ID__State, player: PlayerId): __PASCAL_ID__Move[] {
    if (player !== state.mover) return [];
    if (computeStatus(state).kind !== "ongoing") return [];
    return [{ kind: "increment" }];
  },

  isLegal(state: __PASCAL_ID__State, player: PlayerId, move: __PASCAL_ID__Move): boolean {
    return player === state.mover && computeStatus(state).kind === "ongoing" && move.kind === "increment";
  },

  active(state: __PASCAL_ID__State): ActiveSpec {
    return { mode: "sequential", player: state.mover };
  },

  apply(
    state: __PASCAL_ID__State,
    moves: ReadonlyMap<PlayerId, __PASCAL_ID__Move>,
    _rng: Rng
  ): __PASCAL_ID__State {
    const move = moves.get(state.mover);
    if (!move) {
      throw new Error("__GAME_ID__: apply() called without a move for the mover seat");
    }
    const effects: Effect[] = [{ type: "moved", player: state.mover }];
    return {
      counter: state.counter + 1,
      mover: state.mover === 0 ? 1 : 0,
      lastEffects: effects,
    };
  },

  status: computeStatus,

  playerView(state: __PASCAL_ID__State, _player: PlayerId | null): __PASCAL_ID__State {
    // Perfect-information game: playerView is the identity (plan §3's contract rule). If your
    // real game hides information from a player, this must change to a real redaction — see
    // CHECKLIST.md.
    return state;
  },

  encode(state: __PASCAL_ID__State): string {
    // EXCLUDES lastEffects — see CHECKLIST.md's second trap. Two states identical except for
    // effects must hash identically, or solvers/repetition-detection silently break.
    return stableStringify({ counter: state.counter, mover: state.mover });
  },

  decode(encoded: string): __PASCAL_ID__State {
    // Throws on malformed input (via JSON.parse and the shape check below) rather than ever
    // returning a partial/defaulted state — see CHECKLIST.md's fourth trap (C4).
    const parsed = JSON.parse(encoded) as { counter?: unknown; mover?: unknown };
    if (typeof parsed.counter !== "number" || (parsed.mover !== 0 && parsed.mover !== 1)) {
      throw new Error(`__GAME_ID__: decode() received a malformed encoding: ${encoded}`);
    }
    return { counter: parsed.counter, mover: parsed.mover, lastEffects: [] };
  },

  heuristic,
};

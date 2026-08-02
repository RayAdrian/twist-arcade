// packages/bots/test/fixtures/tiny-fog.ts — a minimal SOLO, hidden-information, stochastic
// fixture ("hidden-coin": guess a secretly-flipped coin in one move) used only to exercise
// determinize()/probeViewHonesty against a real (if trivial) sampleConsistentState
// implementation. Not a shipped game; test scaffolding only.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export interface TinyFogState extends WithEffects {
  readonly secret: 0 | 1;
  readonly resolved: boolean;
  readonly won: boolean;
}

/** The view NEVER carries `secret` — structurally, not just semantically (omit, don't mask,
 *  per correction C1 / the M1 review's "omit vs mask" finding). Pre-resolution it carries
 *  nothing at all beyond `lastEffects`; post-resolution it reveals the outcome (but still
 *  never the raw secret value, which is irrelevant once resolved anyway — this fixture keeps
 *  it that way deliberately so nothing outside `sampleConsistentState` can ever recover it). */
export type TinyFogView =
  | ({ readonly resolved: false } & WithEffects)
  | ({ readonly resolved: true; readonly won: boolean } & WithEffects);

export interface TinyFogMove {
  readonly guess: 0 | 1;
  readonly [key: string]: Json;
}

export const tinyFog: GameEngine<TinyFogState, TinyFogMove, TinyFogView> = {
  meta: {
    id: "tiny-fog-fixture",
    name: "Tiny Fog (bots test fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: true,
    simultaneous: false,
    stochastic: true,
    version: 1,
  },

  setup(_numPlayers, rng: Rng): TinyFogState {
    return { secret: rng.int(2) as 0 | 1, resolved: false, won: false, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): TinyFogMove[] {
    if (player !== 0 || state.resolved) return [];
    return [{ guess: 0 }, { guess: 1 }];
  },

  isLegal(state, player, move): boolean {
    if (player !== 0 || state.resolved) return false;
    return move.guess === 0 || move.guess === 1;
  },

  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state, moves, _rng): TinyFogState {
    const move = moves.get(0);
    if (!move) throw new Error("tiny-fog: apply() called without a move for player 0");
    const won = move.guess === state.secret;
    const effects: Effect[] = [{ type: "revealed", won }];
    return { secret: state.secret, resolved: true, won, lastEffects: effects };
  },

  status(state): Status {
    if (!state.resolved) return { kind: "ongoing" };
    return state.won ? { kind: "won", winner: 0 } : { kind: "lost" };
  },

  playerView(state, _player): TinyFogView {
    if (!state.resolved) return { resolved: false, lastEffects: [] };
    return { resolved: true, won: state.won, lastEffects: state.lastEffects };
  },

  encode(state): string {
    return stableStringify({ secret: state.secret, resolved: state.resolved, won: state.won });
  },

  decode(encoded): TinyFogState {
    const parsed = JSON.parse(encoded) as { secret: 0 | 1; resolved: boolean; won: boolean };
    if (
      (parsed.secret !== 0 && parsed.secret !== 1) ||
      typeof parsed.resolved !== "boolean" ||
      typeof parsed.won !== "boolean"
    ) {
      throw new TypeError(`tiny-fog: decode() received a shape-invalid payload: ${encoded}`);
    }
    return { secret: parsed.secret, resolved: parsed.resolved, won: parsed.won, lastEffects: [] };
  },

  /** Any secret is consistent with a pre-resolution view (it carries no information at all
   *  distinguishing 0 from 1) — this is the honest, minimal sampleConsistentState. */
  sampleConsistentState(view: TinyFogView, rng: Rng): TinyFogState {
    if (view.resolved) {
      // Post-resolution, `won` pins the secret uniquely only in combination with the guess
      // that was made — which this trivial view does not carry either. Since nothing
      // downstream of this fixture's tests needs a post-resolution sample, pick arbitrarily
      // among secrets still consistent with "the game is over".
      return { secret: rng.int(2) as 0 | 1, resolved: true, won: view.won, lastEffects: [] };
    }
    return { secret: rng.int(2) as 0 | 1, resolved: false, won: false, lastEffects: [] };
  },
};

/** Extracts the pre-resolution secret as a sensitive string, for reuse with the engine
 *  testkit's checkRedaction if this fixture is ever run through it directly. */
export function tinyFogSecretExtractor(state: unknown, _player: PlayerId): string[] {
  const s = state as TinyFogState;
  return s.resolved ? [] : [String(s.secret)];
}

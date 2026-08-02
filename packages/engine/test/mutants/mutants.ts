// packages/engine/test/mutants/mutants.ts
//
// Deliberately-broken engines, each planting exactly ONE bug, used only by
// test/testkit-self-test.test.ts to prove `engineContract()`'s property checks actually
// catch what they claim to catch (plan §4: "A testkit that cannot catch planted bugs is
// theater"). NEVER imported by anything outside this test suite.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "../../src/types";
import { stableStringify } from "../../src/encode";
import type { TTTMove, TTTState } from "../../testkit/fixtures/classic-ttt";
import { classicTicTacToe } from "../../testkit/fixtures/classic-ttt";
import type { BankRunMove, BankRunState } from "../../testkit/fixtures/bank-run";
import { bankRun, createBankRun } from "../../testkit/fixtures/bank-run";
import type { CrackstepMove, CrackstepState } from "../../testkit/fixtures/mini-crackstep";
import { miniCrackstep } from "../../testkit/fixtures/mini-crackstep";

// -----------------------------------------------------------------------------------------
// 1. Mutates input — apply() writes directly into the input board array instead of copying.
// -----------------------------------------------------------------------------------------
export const mutantMutatesInput: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  apply(state, moves, _rng) {
    const move = moves.get(state.turn);
    if (!move || !classicTicTacToe.isLegal(state, state.turn, move)) {
      throw new Error("illegal move");
    }
    // BUG: mutates the input state's board array in place instead of copying it, then
    // builds the "next" state by reading back from the (now-corrupted) input. Inlines the
    // real transition logic rather than delegating to classicTicTacToe.apply(), which would
    // re-validate isLegal() against the already-mutated board and (correctly) reject it.
    const board = state.board as (PlayerId | null)[];
    board[move.cell] = state.turn;
    return {
      board,
      turn: state.turn === 0 ? 1 : 0,
      lastEffects: [{ type: "placed", cell: move.cell, player: state.turn }],
    };
  },
};

// -----------------------------------------------------------------------------------------
// 2. Leaks Math.random() — bank-run's push outcome ignores the injected rng entirely.
// -----------------------------------------------------------------------------------------
const cleanBankRun = createBankRun({ successProb: 0.6 });
export const mutantMathRandomLeak: GameEngine<BankRunState, BankRunMove, BankRunState> = {
  ...cleanBankRun,
  apply(state, moves, rng) {
    const move = moves.get(0);
    if (!move) throw new Error("no move");
    if (move.kind === "bank") return cleanBankRun.apply(state, moves, rng);
    // BUG: uses Math.random() instead of rng.next() — breaks the determinism property.
    // (no-restricted-properties is disabled repo-wide for this directory; see eslint.config.mjs)
    const success = Math.random() < 0.6;
    const effects: Effect[] = success
      ? [{ type: "revealed", result: "success" }]
      : [{ type: "revealed", result: "bust", lostStreak: state.streak }];
    return {
      banked: state.banked,
      streak: success ? state.streak + 1 : 0,
      round: state.round + 1,
      lastEffects: effects,
    };
  },
};

// -----------------------------------------------------------------------------------------
// 3. encode() includes lastEffects — breaks the canonical-form / solver-hash-pollution rule.
// -----------------------------------------------------------------------------------------
export const mutantEncodeIncludesEffects: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  encode(state) {
    // BUG: includes lastEffects in the canonical form.
    return stableStringify({
      board: state.board as unknown as (number | null)[],
      turn: state.turn,
      lastEffects: state.lastEffects as unknown as import("../../src/types").Json,
    });
  },
};

// -----------------------------------------------------------------------------------------
// 4. Non-terminating — status() always reports "ongoing", so random playouts never stop
//    short of the ply cap.
// -----------------------------------------------------------------------------------------
export interface CounterState extends WithEffects {
  readonly n: number;
}
export type CounterMove = Record<string, never>;

export const mutantNonTerminating: GameEngine<CounterState, CounterMove, CounterState> = {
  meta: {
    id: "mutant-non-terminating",
    name: "Mutant: non-terminating",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },
  setup(_n: number, _rng: Rng): CounterState {
    return { n: 0, lastEffects: [] };
  },
  legalMoves(_state, player) {
    return player === 0 ? [{}] : [];
  },
  isLegal(_state, player, _move) {
    return player === 0;
  },
  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },
  apply(state, _moves, _rng) {
    return { n: state.n + 1, lastEffects: [{ type: "tick" }] };
  },
  status(_state): Status {
    // BUG: never reports a terminal status.
    return { kind: "ongoing" };
  },
  playerView(state, _player) {
    return state;
  },
  encode(state) {
    return stableStringify({ n: state.n });
  },
  decode(encoded) {
    const parsed = JSON.parse(encoded) as { n: number };
    return { n: parsed.n, lastEffects: [] };
  },
};

// -----------------------------------------------------------------------------------------
// 5. Solo engine emits `draw` — mini-crackstep variant that reports draw once a move cap is
//    hit instead of a legal solo terminal (won/lost/scored).
// -----------------------------------------------------------------------------------------
export const mutantSoloEmitsDraw: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
  ...miniCrackstep,
  status(state) {
    // BUG: after 2 moves without reaching the goal, claim a draw — solo engines must never
    // emit `draw`.
    if (state.pos !== 8 && state.visitOrder.length > 2) {
      return { kind: "draw" };
    }
    return miniCrackstep.status(state);
  },
};

// -----------------------------------------------------------------------------------------
// 6. score() disagrees with the scored terminal — bank-run variant whose score() reports
//    the at-risk streak too, so it no longer equals status().scores[0] once anything is
//    unbanked at the round cap.
// -----------------------------------------------------------------------------------------
const baseBankRunForScoreMutant = createBankRun({ successProb: 1 }); // always succeeds, so
// streak reliably accumulates and is reliably non-zero at the cap when the player only pushes.
export const mutantScoreDisagreesWithTerminal: GameEngine<BankRunState, BankRunMove, BankRunState> = {
  ...baseBankRunForScoreMutant,
  score(state, _player) {
    // BUG: includes the at-risk streak, which is forfeited (not counted) at the terminal.
    return state.banked + state.streak;
  },
};

// -----------------------------------------------------------------------------------------
// 7. Two-player engine emits `lost` — classic-ttt variant that reports `lost` for whichever
//    player is about to move once the board is full without a winner, instead of `draw`.
// -----------------------------------------------------------------------------------------
export const mutant2PEmitsLost: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  status(state) {
    const real = classicTicTacToe.status(state);
    // BUG: a 2-player (maxPlayers=2) engine must never emit `lost` — that variant is
    // solo-only.
    if (real.kind === "draw") return { kind: "lost" };
    return real;
  },
};

// -----------------------------------------------------------------------------------------
// 8. Effects accumulate — classic-ttt variant whose apply() appends onto the previous
//    state's lastEffects instead of fully overwriting it.
// -----------------------------------------------------------------------------------------
export const mutantEffectsAccumulate: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  apply(state, moves, rng) {
    const real = classicTicTacToe.apply(state, moves, rng);
    // BUG: folds the input's stale lastEffects into the output instead of overwriting.
    return { ...real, lastEffects: [...state.lastEffects, ...real.lastEffects] };
  },
};

// -----------------------------------------------------------------------------------------
// 8b. status unstable under encode/decode — classic-ttt variant whose status() at a `draw`
//     depends on whether lastEffects is populated. decode() always resets lastEffects to []
//     (plan §3.2), so status(decode(encode(s))) diverges from status(s) exactly at a draw:
//     the live state (real lastEffects) reports `draw`, the decoded/rehydrated state (empty
//     lastEffects) reports `ongoing`. This is the async-refetch failure class (M1 review
//     finding 8 / gap G-3): a client reloading mid-game from stored state would see a
//     different outcome than the live session did. Narrowly scoped to the draw branch only,
//     so it does not also trip termination (live playouts never call status() on a decoded
//     state, so this never fires during a normal playout — only inside the encode/decode
//     check, which explicitly compares status(state) vs status(decode(encode(state)))).
// -----------------------------------------------------------------------------------------
export const mutantStatusUnstableUnderEncodeDecode: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  status(state) {
    const real = classicTicTacToe.status(state);
    if (real.kind === "draw" && state.lastEffects.length === 0) {
      return { kind: "ongoing" };
    }
    return real;
  },
};

// -----------------------------------------------------------------------------------------
// 8c. scored.scores.length !== numPlayers — bank-run variant that pads an extra bogus entry
//     onto the scores array at the scored terminal. Plan §3's Status comment states
//     `scores.length === numPlayers` as an invariant, but nothing enforced it until M1 review
//     finding 8 / gap G-11.
// -----------------------------------------------------------------------------------------
export const mutantScoredWrongLength: GameEngine<BankRunState, BankRunMove, BankRunState> = {
  ...bankRun,
  status(state) {
    const real = bankRun.status(state);
    if (real.kind === "scored") {
      return { kind: "scored", scores: [...real.scores, 99] };
    }
    return real;
  },
};

// -----------------------------------------------------------------------------------------
// 9. isLegal too permissive — classic-ttt variant whose isLegal() accepts every move
//    regardless of legalMoves(). legalMoves() ⊆ isLegal-accepted still holds trivially (every
//    legal move IS accepted, since everything is), so the ORIGINAL one-directional
//    legalityCoherence check missed this entirely (M1 review finding 4 / gap G-10). replay()
//    and future server-side validation trust isLegal alone to refuse forged moves; this
//    mutant models an engine that would silently accept a fabricated/corrupt move log.
// -----------------------------------------------------------------------------------------
export const mutantIsLegalAlwaysTrue: GameEngine<TTTState, TTTMove, TTTState> = {
  ...classicTicTacToe,
  isLegal(_state, _player, _move) {
    // BUG: accepts everything, including foreign-seat moves and already-occupied cells.
    return true;
  },
};

// -----------------------------------------------------------------------------------------
// 10. Fog-leak pair — a minimal hidden-info toy engine (guess-the-number-adjacent) with a
//    correct redacting playerView and a leaky variant that forgets to redact an effect.
//    Needed because none of the three named testkit fixtures are hiddenInformation:true, but
//    the redaction property (and its DoD test) needs a real fog engine to exercise against.
// -----------------------------------------------------------------------------------------
export interface FogState extends WithEffects {
  readonly secret: number; // hidden content (e.g. an unrevealed mine position analogue)
  readonly revealed: boolean;
}
export type FogMove = { readonly kind: "reveal"; readonly [key: string]: Json };

/**
 * FogView (M1 review finding 3 / gap G-8 / defect D-1) — a REAL view type, V ≠ S. Before this
 * fix, fogFixtureCorrect reused `S` as `V` (`GameEngine<FogState, FogMove, FogState>`) and
 * "redacted" by masking `secret` with a sentinel (-1) instead of omitting the key. Masking is
 * exactly the anti-pattern plan §3 / correction C1 forbid ("omit, don't mask" — a masked
 * field is present-but-fake), and meant nothing in the ENTIRE M1 diff exercised `V ≠ S`,
 * despite `V` being a first-class type parameter on GameEngine. The pre-reveal variant below
 * has NO `secret` field at all — structurally, not just semantically, absent.
 */
export type FogView =
  | ({ readonly revealed: false } & WithEffects)
  | ({ readonly revealed: true; readonly secret: number } & WithEffects);

function makeFogEngine(leaky: boolean): GameEngine<FogState, FogMove, FogView> {
  return {
    meta: {
      id: leaky ? "mutant-fog-leak" : "fog-fixture-correct",
      name: "Fog toy engine",
      minPlayers: 1,
      maxPlayers: 1,
      hiddenInformation: true,
      simultaneous: false,
      stochastic: true,
      version: 1,
    },
    setup(_n, rng) {
      return { secret: rng.int(1000) + 1, revealed: false, lastEffects: [] };
    },
    legalMoves(state, player) {
      if (player !== 0 || state.revealed) return [];
      return [{ kind: "reveal" }];
    },
    isLegal(state, player, move) {
      return player === 0 && !state.revealed && move.kind === "reveal";
    },
    active(_state) {
      return { mode: "sequential", player: 0 };
    },
    apply(state, _moves, _rng) {
      // The effect always carries the secret value (as a real reveal would) — the BUG (in
      // the leaky variant) is that playerView fails to redact it before revealing.
      return {
        secret: state.secret,
        revealed: true,
        lastEffects: [{ type: "revealed", secretValue: state.secret }],
      };
    },
    status(state) {
      return state.revealed ? { kind: "won", winner: 0 } : { kind: "ongoing" };
    },
    playerView(state, _player): FogView {
      if (leaky) {
        // BUG: returns the raw state, including the secret and the unredacted effect — even
        // pre-reveal, the `secret` key is structurally present in the leaky variant's view.
        return state as unknown as FogView;
      }
      if (!state.revealed) {
        // Omit, don't mask: the `secret` key is simply absent from the object, not present
        // with a sentinel value.
        return { revealed: false, lastEffects: [] };
      }
      return { revealed: true, secret: state.secret, lastEffects: state.lastEffects };
    },
    encode(state) {
      return stableStringify({ secret: state.secret, revealed: state.revealed });
    },
    decode(encoded) {
      const parsed = JSON.parse(encoded) as { secret: number; revealed: boolean };
      return { secret: parsed.secret, revealed: parsed.revealed, lastEffects: [] };
    },
  };
}

/** Correct fog engine: playerView redacts `secret` until revealed. Note this fixture's
 *  design intentionally keeps `secret` visible in the view AFTER reveal (that's the whole
 *  point of the move) — the secretExtractor used against it must only treat the
 *  PRE-reveal secret as sensitive, matching real fog games (mines are secret only until
 *  swept). */
export const fogFixtureCorrect = makeFogEngine(false);

/** Leaky variant: playerView is the identity, so the secret (and the unredacted effect)
 *  leaks immediately, even before reveal. */
export const mutantFogLeak = makeFogEngine(true);

/** secretExtractor for the fog toy engine: the secret value is sensitive only until
 *  revealed — mirrors a real fog game (a mine position is secret only until swept). */
export function fogSecretExtractor(state: unknown, _player: PlayerId): string[] {
  const s = state as FogState;
  return s.revealed ? [] : [String(s.secret)];
}

// packages/engine/testkit/fixtures/bank-run.ts
//
// bank-run — a trivial press-your-luck SCORE-CHASE fixture (solo-games-lens §1.7): each
// round the player either pushes their luck (streak grows on success, resets to 0 on bust)
// or banks the current streak into their permanent score. The run ends after a fixed round
// cap; any unbanked streak at the end is forfeited (never counted) — this keeps `score()`
// (== banked, always) coherent with the terminal `scores[0]` (== banked) with no special
// casing. `plantFarmingLoop` is a build flag (not used by anything in M0/M1) that removes
// all bust risk — a future M3c Grind-probe test will exercise it to prove the harness
// catches zero-risk unbounded farming.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "../../src/types";
import { stableStringify } from "../../src/encode";

const ROUND_CAP = 6;
const DEFAULT_SUCCESS_PROB = 0.6;

export interface BankRunState extends WithEffects {
  readonly banked: number;
  readonly streak: number;
  readonly round: number;
}

// Explicit index signatures: see TTTMove's comment in classic-ttt.ts for why a plain
// interface/type-literal needs one to satisfy `extends Json`.
export type BankRunMove =
  | { readonly kind: "push"; readonly [key: string]: Json }
  | { readonly kind: "bank"; readonly [key: string]: Json };

function computeStatus(state: BankRunState): Status {
  if (state.round >= ROUND_CAP) return { kind: "scored", scores: [state.banked] };
  return { kind: "ongoing" };
}

export interface CreateBankRunOptions {
  /** Success probability per push in [0,1]. Ignored (forced to 1) when plantFarmingLoop. */
  successProb?: number;
  /**
   * DELIBERATE BUG FLAG, off by default. When true, push never busts — a zero-risk
   * unbounded-farming shape (within the round cap) for the harness's future Grind probe
   * (M3c) to catch. Not consumed by anything in M0/M1; exists so the fixture is ready.
   */
  plantFarmingLoop?: boolean;
}

export function createBankRun(
  opts: CreateBankRunOptions = {}
): GameEngine<BankRunState, BankRunMove, BankRunState> {
  const successProb = opts.plantFarmingLoop ? 1 : (opts.successProb ?? DEFAULT_SUCCESS_PROB);

  return {
    meta: {
      id: "bank-run-fixture",
      name: "Bank Run (internal fixture)",
      minPlayers: 1,
      maxPlayers: 1,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: true,
      version: 1,
    },

    setup(_numPlayers: number, _rng: Rng): BankRunState {
      return { banked: 0, streak: 0, round: 0, lastEffects: [] };
    },

    legalMoves(state: BankRunState, player: PlayerId): BankRunMove[] {
      if (player !== 0) return [];
      if (computeStatus(state).kind !== "ongoing") return [];
      return [{ kind: "push" }, { kind: "bank" }];
    },

    isLegal(state: BankRunState, player: PlayerId, move: BankRunMove): boolean {
      if (player !== 0) return false;
      if (computeStatus(state).kind !== "ongoing") return false;
      return move.kind === "push" || move.kind === "bank";
    },

    active(_state: BankRunState): ActiveSpec {
      return { mode: "sequential", player: 0 };
    },

    apply(
      state: BankRunState,
      moves: ReadonlyMap<PlayerId, BankRunMove>,
      rng: Rng
    ): BankRunState {
      const move = moves.get(0);
      if (!move) {
        throw new Error("bank-run: apply() called without a move for player 0");
      }
      if (move.kind === "bank") {
        const effects: Effect[] = [{ type: "banked", amount: state.streak }];
        return {
          banked: state.banked + state.streak,
          streak: 0,
          round: state.round + 1,
          lastEffects: effects,
        };
      }
      // push
      const success = rng.next() < successProb;
      if (success) {
        return {
          banked: state.banked,
          streak: state.streak + 1,
          round: state.round + 1,
          lastEffects: [{ type: "revealed", result: "success" }],
        };
      }
      return {
        banked: state.banked,
        streak: 0,
        round: state.round + 1,
        lastEffects: [{ type: "revealed", result: "bust", lostStreak: state.streak }],
      };
    },

    status(state: BankRunState): Status {
      return computeStatus(state);
    },

    playerView(state: BankRunState, _player: PlayerId | null): BankRunState {
      return state; // perfect information — nothing hidden about your own run
    },

    encode(state: BankRunState): string {
      return stableStringify({ banked: state.banked, streak: state.streak, round: state.round });
    },

    decode(encoded: string): BankRunState {
      const parsed = JSON.parse(encoded) as { banked: number; streak: number; round: number };
      return { banked: parsed.banked, streak: parsed.streak, round: parsed.round, lastEffects: [] };
    },

    score(state: BankRunState, _player: PlayerId): number {
      // Deliberately EXCLUDES the at-risk streak: score() must equal the scored terminal's
      // scores[0] (== banked, unbanked streak forfeited), so it reports only realized value.
      return state.banked;
    },
  };
}

export const bankRun: GameEngine<BankRunState, BankRunMove, BankRunState> = createBankRun();

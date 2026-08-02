// packages/bots/test/fixtures/rps.ts — a tiny SIMULTANEOUS, perfect-information, 2-player
// fixture (best-of-N rock/paper/scissors) used only to exercise mctsPolicy's joint-move-space
// handling for simultaneous games. Not a shipped game; test scaffolding only.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

const ROUND_CAP = 5;

export type RPSChoice = "rock" | "paper" | "scissors";

export interface RPSState extends WithEffects {
  readonly p0Wins: number;
  readonly p1Wins: number;
  readonly round: number;
}

export interface RPSMove {
  readonly choice: RPSChoice;
  readonly [key: string]: Json;
}

const CHOICES: readonly RPSChoice[] = ["rock", "paper", "scissors"];

/** Returns 0 if a beats b, 1 if b beats a, null if a tie. */
function beats(a: RPSChoice, b: RPSChoice): 0 | 1 | null {
  if (a === b) return null;
  const winsAgainst: Record<RPSChoice, RPSChoice> = { rock: "scissors", paper: "rock", scissors: "paper" };
  return winsAgainst[a] === b ? 0 : 1;
}

function computeStatus(state: RPSState): Status {
  if (state.round >= ROUND_CAP) return { kind: "scored", scores: [state.p0Wins, state.p1Wins] };
  return { kind: "ongoing" };
}

export const rps: GameEngine<RPSState, RPSMove, RPSState> = {
  meta: {
    id: "rps-fixture",
    name: "Rock Paper Scissors (bots test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers, _rng: Rng): RPSState {
    return { p0Wins: 0, p1Wins: 0, round: 0, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): RPSMove[] {
    if (player !== 0 && player !== 1) return [];
    if (computeStatus(state).kind !== "ongoing") return [];
    return CHOICES.map((choice) => ({ choice }));
  },

  isLegal(state, player, move): boolean {
    if (player !== 0 && player !== 1) return false;
    if (computeStatus(state).kind !== "ongoing") return false;
    return CHOICES.includes(move.choice);
  },

  active(_state): ActiveSpec {
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(state, moves, _rng): RPSState {
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) throw new Error("rps: apply() requires both players' moves");
    const winner = beats(m0.choice, m1.choice);
    const effects: Effect[] = [
      { type: "revealed", p0: m0.choice, p1: m1.choice, winner: winner === null ? "tie" : winner },
    ];
    return {
      p0Wins: state.p0Wins + (winner === 0 ? 1 : 0),
      p1Wins: state.p1Wins + (winner === 1 ? 1 : 0),
      round: state.round + 1,
      lastEffects: effects,
    };
  },

  status(state): Status {
    return computeStatus(state);
  },

  playerView(state, _player): RPSState {
    return state; // perfect information — both moves resolve in one shared step, nothing
    // pending is ever stored as persistent state, so there is nothing to redact.
  },

  encode(state): string {
    return stableStringify({ p0Wins: state.p0Wins, p1Wins: state.p1Wins, round: state.round });
  },

  decode(encoded): RPSState {
    const parsed = JSON.parse(encoded) as { p0Wins: number; p1Wins: number; round: number };
    if (
      typeof parsed.p0Wins !== "number" ||
      typeof parsed.p1Wins !== "number" ||
      typeof parsed.round !== "number"
    ) {
      throw new TypeError(`rps: decode() received a shape-invalid payload: ${encoded}`);
    }
    return { p0Wins: parsed.p0Wins, p1Wins: parsed.p1Wins, round: parsed.round, lastEffects: [] };
  },
};

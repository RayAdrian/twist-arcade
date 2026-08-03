// packages/harness/test/fixtures/simul-duel.ts — a minimal 2-player, `simultaneous: true`,
// perfect-information fixture built to reproduce the stage-6 review's MUST-FIX finding: nothing
// in runner.ts's `GameOutcome.moves` recorded a ply BOUNDARY, so a simultaneous game's log — one
// ply, n actors, both drawn from the SAME `active()` call — flattened into indistinguishable
// `{ seat, move }` entries with no marker saying which entries belonged to the same ply.
// Reconstructing a trajectory from that flat log required re-simulating `active()` against the
// live engine; it was not a lossless `ReplayRecord` on its own. This fixture exists to prove the
// fix (`moves: readonly StepRecord[]`, one record per ply, `n` `[seat, move]` pairs inside it for
// a simultaneous ply) actually restores losslessness for the class of game runMatchup accepts but
// corridor/twin-track/doors (all sequential) never exercise.
//
// THE GAME ("duel"): each round both seats simultaneously choose to `"strike"` or `"guard"`.
// strike vs guard: striker scores a point. strike vs strike or guard vs guard: no one scores.
// First to 2 points wins; capped at ROUND_CAP rounds (a draw if nobody reaches 2 by then) so a
// random-vs-random run always terminates well under any sane maxPlies.

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

const ROUND_CAP = 6;
const WIN_SCORE = 2;

export type DuelChoice = "strike" | "guard";

export interface SimulDuelState extends WithEffects {
  readonly p0Score: number;
  readonly p1Score: number;
  readonly round: number;
}

export interface SimulDuelMove {
  readonly choice: DuelChoice;
  readonly [key: string]: Json;
}

function roundOutcome(a: DuelChoice, b: DuelChoice): [number, number] {
  if (a === b) return [0, 0];
  if (a === "strike") return [1, 0];
  return [0, 1];
}

function computeStatus(state: SimulDuelState): Status {
  if (state.p0Score >= WIN_SCORE && state.p0Score > state.p1Score) return { kind: "won", winner: 0 };
  if (state.p1Score >= WIN_SCORE && state.p1Score > state.p0Score) return { kind: "won", winner: 1 };
  if (state.round >= ROUND_CAP) return { kind: "draw" };
  return { kind: "ongoing" };
}

export const simulDuel: GameEngine<SimulDuelState, SimulDuelMove, SimulDuelState> = {
  meta: {
    id: "simul-duel-fixture",
    name: "Simul Duel (harness runner test fixture — simultaneous)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): SimulDuelState {
    return { p0Score: 0, p1Score: 0, round: 0, lastEffects: [] };
  },

  legalMoves(state: SimulDuelState, player: PlayerId): SimulDuelMove[] {
    if ((player !== 0 && player !== 1) || computeStatus(state).kind !== "ongoing") return [];
    return [{ choice: "strike" }, { choice: "guard" }];
  },

  isLegal(state: SimulDuelState, player: PlayerId, move: SimulDuelMove): boolean {
    return simulDuel.legalMoves(state, player).some((m) => m.choice === move.choice);
  },

  active(_state: SimulDuelState): ActiveSpec {
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(state: SimulDuelState, moves: ReadonlyMap<PlayerId, SimulDuelMove>, _rng: Rng): SimulDuelState {
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) throw new Error("simul-duel: apply() requires both players' moves");
    const [d0, d1] = roundOutcome(m0.choice, m1.choice);
    return {
      p0Score: state.p0Score + d0,
      p1Score: state.p1Score + d1,
      round: state.round + 1,
      lastEffects: [{ type: "resolved", p0: m0.choice, p1: m1.choice, d0, d1 }],
    };
  },

  status(state: SimulDuelState): Status {
    return computeStatus(state);
  },

  playerView(state: SimulDuelState, _player: PlayerId | null): SimulDuelState {
    return state; // perfect information — both choices resolve together, nothing pending.
  },

  encode(state: SimulDuelState): string {
    return stableStringify({ p0Score: state.p0Score, p1Score: state.p1Score, round: state.round });
  },

  decode(encoded: string): SimulDuelState {
    const parsed = JSON.parse(encoded) as { p0Score: number; p1Score: number; round: number };
    return { p0Score: parsed.p0Score, p1Score: parsed.p1Score, round: parsed.round, lastEffects: [] };
  },
};

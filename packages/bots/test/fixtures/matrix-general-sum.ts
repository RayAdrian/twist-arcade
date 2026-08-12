// packages/bots/test/fixtures/matrix-general-sum.ts — a tiny SIMULTANEOUS, perfect-information,
// ONE-SHOT, GENERAL-SUM (deliberately NOT zero-sum) 2-player fixture with a unique pure
// equilibrium reachable by strict dominance — the DUCT remedy's general-sum smoke test
// (docs/plans/sim-search-remedy.md §6.2). Not a shipped game; test scaffolding only.
//
// Player 0 picks {A, B}; player 1 picks {X, Y}. Payoffs are (player 0's score, player 1's
// score) — read off directly, no negation:
//
//              X        Y
//     A     (3, 5)   (3, 1)
//     B     (1, 5)   (0, 1)
//
// Player 0: A weakly... in fact STRICTLY dominates B against both of player 1's choices
// (3 > 1 at X, 3 > 0 at Y) — A is player 0's dominant strategy regardless of player 1.
// Player 1: X strictly dominates Y against both of player 0's choices (5 > 1 at A, 5 > 1 at B)
// — X is player 1's dominant strategy regardless of player 0.
// Unique pure equilibrium: (A, X), payoffs (3, 5) — NOT zero-sum (3 + 5 = 8, not 0), and the
// two seats' payoffs at the equilibrium are different numbers, which is exactly what this
// fixture is for: proving DUCT tracks each seat's OWN value independently (valueOfStatus is
// already called once per active seat with that seat's own `player` argument — this fixture
// is what makes a coupled/negated implementation visibly wrong instead of accidentally right).
import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export type GSRow = "A" | "B";
export type GSCol = "X" | "Y";

const ROWS: readonly GSRow[] = ["A", "B"];
const COLS: readonly GSCol[] = ["X", "Y"];

const PAYOFF: Record<GSRow, Record<GSCol, readonly [number, number]>> = {
  A: { X: [3, 5], Y: [3, 1] },
  B: { X: [1, 5], Y: [0, 1] },
};

export const EQUILIBRIUM_ROW: GSRow = "A";
export const EQUILIBRIUM_COL: GSCol = "X";
export const EQUILIBRIUM_P0_VALUE = 3;
export const EQUILIBRIUM_P1_VALUE = 5;

export interface MatrixGeneralSumState extends WithEffects {
  readonly resolved: boolean;
  readonly scores: readonly [number, number] | null; // null only pre-resolution
}

export interface MatrixGeneralSumMove {
  readonly choice: GSRow | GSCol;
  readonly [key: string]: Json;
}

function legalMovesFor(state: MatrixGeneralSumState, player: PlayerId): MatrixGeneralSumMove[] {
  if (state.resolved) return [];
  if (player === 0) return ROWS.map((choice) => ({ choice }));
  if (player === 1) return COLS.map((choice) => ({ choice }));
  return [];
}

export const matrixGeneralSum: GameEngine<MatrixGeneralSumState, MatrixGeneralSumMove, MatrixGeneralSumState> = {
  meta: {
    id: "matrix-general-sum-fixture",
    name: "General-sum matrix game with a unique dominant-strategy equilibrium (bots test fixture, C57/C58)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers, _rng: Rng): MatrixGeneralSumState {
    return { resolved: false, scores: null, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): MatrixGeneralSumMove[] {
    return legalMovesFor(state, player);
  },

  isLegal(state, player, move): boolean {
    return legalMovesFor(state, player).some((m) => m.choice === move.choice);
  },

  active(_state): ActiveSpec {
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(state, moves, _rng): MatrixGeneralSumState {
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) throw new Error("matrix-general-sum: apply() requires both players' moves");
    const scores = PAYOFF[m0.choice as GSRow][m1.choice as GSCol];
    const effects: Effect[] = [{ type: "revealed", row: m0.choice, col: m1.choice, scores: [...scores] }];
    return { resolved: true, scores, lastEffects: effects };
  },

  status(state): Status {
    if (!state.resolved) return { kind: "ongoing" };
    return { kind: "scored", scores: [...state.scores!] };
  },

  playerView(state, _player): MatrixGeneralSumState {
    return state; // perfect information
  },

  encode(state): string {
    return stableStringify({ resolved: state.resolved, scores: state.scores ? [...state.scores] : null });
  },

  decode(encoded): MatrixGeneralSumState {
    const parsed = JSON.parse(encoded) as { resolved: boolean; scores: readonly [number, number] | null };
    if (typeof parsed.resolved !== "boolean") {
      throw new TypeError(`matrix-general-sum: decode() received a shape-invalid payload: ${encoded}`);
    }
    return { resolved: parsed.resolved, scores: parsed.scores, lastEffects: [] };
  },
};

// packages/bots/test/fixtures/matrix-saddle.ts — a tiny SIMULTANEOUS, perfect-information,
// ONE-SHOT, ZERO-SUM 2-player fixture whose payoff matrix has a KNOWN PURE SADDLE POINT — the
// "oracle-in-miniature" for the C57/C58 DUCT remedy (docs/plans/sim-search-remedy.md §6.2).
// Not a shipped game; test scaffolding only, modeled directly on lucky-cell-rps.ts's
// one-shot-resolution shape.
//
// Player 0 (row) picks one of {a, b, c}; player 1 (col) picks one of {x, y, z}. Payoff below is
// player 0's raw score (zero-sum: player 1's score is always its negation):
//
//          x     y     z
//     a    3     3     6
//     b    9     1     1
//     c    0    -2    -5
//
// SADDLE POINT, verified by direct computation: row minima are a=3, b=1, c=-5, so maximin = 3
// at row "a". Column maxima are x=9, y=3, z=6, so minimax = 3 at column "y". maximin ===
// minimax === 3, so (a, y) is a pure saddle point with GAME VALUE 3 (player 0's perspective) /
// -3 (player 1's perspective) — an exact, closed-form answer no measurement or solver run is
// needed to trust.
//
// TWO DELIBERATE DECOYS make this matrix actually discriminate the C57/C58 max-max defect
// (a matrix where the saddle row/column also happened to be a dominant strategy would let the
// OLD, buggy "assume the opponent cooperates" selection rule pick the right move for the wrong
// reason — see mcts.test.ts's own comment on this fixture for the measured pre-fix failure):
//   - (b, x) = 9 is the single highest cell in the WHOLE matrix, well above row a's own best
//     cell (6, at z). A search that models the opponent as a co-operator sees row "b" as the
//     tempting long-shot ("if only column x gets played") and over-explores it; row "a"'s
//     actual guarantee (never below 3, whatever column is played) is invisible to that model.
//   - (c, z) = -5 is a very bad cell for player 0, i.e. very GOOD for player 1 (payoff +5).
//     A co-operator-modeling search run FOR player 1 sees column "z" as its own tempting long
//     shot ("if only row c gets played") — its naive best case is +5, higher than column "y"'s
//     own best case of +2 — even though column "y" is what actually caps player 0's payoff at
//     3 regardless of the row played.
//
// WHY THE UNDECOYED SHAPE IS THE ORACLE-IN-MINIATURE: decoupled best-response dynamics (DUCT's
// own selection rule) have their fixed point EXACTLY at a pure saddle point, by definition of
// what a saddle point is (row player 0's best response to column "y" is row "a"; column player
// 1's best response to row "a" is column "y" — neither wants to deviate). This is the same
// structural property the remedy plan cites for Bid-Tac-Toe's bid nodes (solve report:
// 2,521,056 bid nodes, zero impure) at a scale a human can verify by hand instead of trusting a
// solver.
import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export type MatrixRow = "a" | "b" | "c";
export type MatrixCol = "x" | "y" | "z";

const ROWS: readonly MatrixRow[] = ["a", "b", "c"];
const COLS: readonly MatrixCol[] = ["x", "y", "z"];

/** Player 0's raw payoff (player 1's is always its negation — zero-sum). */
const PAYOFF: Record<MatrixRow, Record<MatrixCol, number>> = {
  a: { x: 3, y: 3, z: 6 },
  b: { x: 9, y: 1, z: 1 },
  c: { x: 0, y: -2, z: -5 },
};

/** The saddle point this fixture is built around — exported so tests assert against a named
 *  constant rather than a magic literal repeated at every call site. */
export const SADDLE_ROW: MatrixRow = "a";
export const SADDLE_COL: MatrixCol = "y";
export const SADDLE_VALUE = 3; // player 0's perspective; player 1's is -3

export interface MatrixSaddleState extends WithEffects {
  readonly resolved: boolean;
  readonly p0Payoff: number | null; // null only pre-resolution
}

export interface MatrixSaddleMove {
  readonly choice: MatrixRow | MatrixCol;
  readonly [key: string]: Json;
}

function legalMovesFor(state: MatrixSaddleState, player: PlayerId): MatrixSaddleMove[] {
  if (state.resolved) return [];
  if (player === 0) return ROWS.map((choice) => ({ choice }));
  if (player === 1) return COLS.map((choice) => ({ choice }));
  return [];
}

export const matrixSaddle: GameEngine<MatrixSaddleState, MatrixSaddleMove, MatrixSaddleState> = {
  meta: {
    id: "matrix-saddle-fixture",
    name: "Matrix game with a pure saddle (bots test fixture, C57/C58)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers, _rng: Rng): MatrixSaddleState {
    return { resolved: false, p0Payoff: null, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): MatrixSaddleMove[] {
    return legalMovesFor(state, player);
  },

  isLegal(state, player, move): boolean {
    return legalMovesFor(state, player).some((m) => m.choice === move.choice);
  },

  active(_state): ActiveSpec {
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(state, moves, _rng): MatrixSaddleState {
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) throw new Error("matrix-saddle: apply() requires both players' moves");
    const p0Payoff = PAYOFF[m0.choice as MatrixRow][m1.choice as MatrixCol];
    const effects: Effect[] = [{ type: "revealed", row: m0.choice, col: m1.choice, p0Payoff }];
    return { resolved: true, p0Payoff, lastEffects: effects };
  },

  status(state): Status {
    if (!state.resolved) return { kind: "ongoing" };
    const p0 = state.p0Payoff!;
    return { kind: "scored", scores: [p0, -p0] };
  },

  playerView(state, _player): MatrixSaddleState {
    return state; // perfect information
  },

  encode(state): string {
    return stableStringify({ resolved: state.resolved, p0Payoff: state.p0Payoff });
  },

  decode(encoded): MatrixSaddleState {
    const parsed = JSON.parse(encoded) as { resolved: boolean; p0Payoff: number | null };
    if (typeof parsed.resolved !== "boolean") {
      throw new TypeError(`matrix-saddle: decode() received a shape-invalid payload: ${encoded}`);
    }
    return { resolved: parsed.resolved, p0Payoff: parsed.p0Payoff, lastEffects: [] };
  },
};

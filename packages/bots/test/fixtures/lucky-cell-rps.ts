// packages/bots/test/fixtures/lucky-cell-rps.ts — a tiny SIMULTANEOUS, perfect-information,
// ONE-SHOT 2-player fixture built specifically to reproduce the C56 pathology
// (docs/plans/platform-corrections.md C56) under REAL UCT search, not just as a hand-fed
// synthetic input to `aggregateByOwnMove`. Not a shipped game; test scaffolding only.
//
// Player 0 ("the acting player" in every C56 test that uses this) chooses A or B.
// Player 1 chooses X, Y, or Z. The game resolves in a single simultaneous ply:
//
//        X       Y       Z
//   A   p0 wins  p0 wins  p0 wins     <- A is uniformly good, whatever player 1 does
//   B   p0 wins  p0 LOSES p0 LOSES    <- B is a trap outside the one lucky (B,X) cell
//
// Marginalized over player 1's response, A strictly dominates B (mean +1 vs mean -1/3) — a
// flat-rollout baseline separates them cleanly. But (B,X) is, cell for cell, exactly as good
// as any single A-cell (both score +1), and it is the ONLY cell of the six that carries B's
// entire positive mass. A search that reads off "the single most-visited joint cell" (the
// pre-C56 defect) can end up recommending B on the strength of that one lucky cell even
// though B is the worse action once you account for what player 1 actually does the other
// two-thirds of the time.
import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export type LuckyCellRow = "A" | "B";
export type LuckyCellCol = "X" | "Y" | "Z";

export interface LuckyCellRPSState extends WithEffects {
  readonly resolved: boolean;
  readonly winner: PlayerId | null; // null only pre-resolution
}

export interface LuckyCellRPSMove {
  readonly choice: LuckyCellRow | LuckyCellCol;
  readonly [key: string]: Json;
}

function winnerFor(row: LuckyCellRow, col: LuckyCellCol): PlayerId {
  if (row === "A") return 0; // A always wins for player 0
  return col === "X" ? 0 : 1; // B only wins against X
}

export const luckyCellRps: GameEngine<LuckyCellRPSState, LuckyCellRPSMove, LuckyCellRPSState> = {
  meta: {
    id: "lucky-cell-rps-fixture",
    name: "Lucky-Cell RPS (bots test fixture, C56)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers, _rng: Rng): LuckyCellRPSState {
    return { resolved: false, winner: null, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): LuckyCellRPSMove[] {
    if (state.resolved) return [];
    if (player === 0) return [{ choice: "A" }, { choice: "B" }];
    if (player === 1) return [{ choice: "X" }, { choice: "Y" }, { choice: "Z" }];
    return [];
  },

  isLegal(state, player, move): boolean {
    return legalMovesFor(state, player).some((m) => m.choice === move.choice);
  },

  active(_state): ActiveSpec {
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(state, moves, _rng): LuckyCellRPSState {
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) throw new Error("lucky-cell-rps: apply() requires both players' moves");
    const winner = winnerFor(m0.choice as LuckyCellRow, m1.choice as LuckyCellCol);
    const effects: Effect[] = [{ type: "revealed", p0: m0.choice, p1: m1.choice, winner }];
    return { resolved: true, winner, lastEffects: effects };
  },

  status(state): Status {
    if (!state.resolved) return { kind: "ongoing" };
    return state.winner === 0 ? { kind: "won", winner: 0 } : { kind: "won", winner: 1 };
  },

  playerView(state, _player): LuckyCellRPSState {
    return state; // perfect information
  },

  encode(state): string {
    return stableStringify({ resolved: state.resolved, winner: state.winner });
  },

  decode(encoded): LuckyCellRPSState {
    const parsed = JSON.parse(encoded) as { resolved: boolean; winner: PlayerId | null };
    if (typeof parsed.resolved !== "boolean") {
      throw new TypeError(`lucky-cell-rps: decode() received a shape-invalid payload: ${encoded}`);
    }
    return { resolved: parsed.resolved, winner: parsed.winner, lastEffects: [] };
  },
};

function legalMovesFor(state: LuckyCellRPSState, player: PlayerId): LuckyCellRPSMove[] {
  return luckyCellRps.legalMoves(state, player);
}

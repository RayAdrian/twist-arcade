// packages/engine/testkit/fixtures/mini-crackstep.ts
//
// mini-crackstep — a tiny solo PUZZLE fixture: a 3x3 crumbling-floor board (the house decay
// mechanic in solo form). The player walks a path from cell 0 to cell 8; any cell you are
// NOT currently on or didn't just come from crumbles and can never be revisited. Reach the
// goal ⇒ won (winner: 0); run out of legal moves before the goal ⇒ lost. Deterministic —
// no procedural generation, so setup()/apply() do not consume the injected rng (accepted
// for interface uniformity only). Used by the testkit's solo-puzzle branch and by
// `verifyCertificate` tests.

import type { ActiveSpec, Effect, GameEngine, PlayerId, Rng, Status, WithEffects } from "../../src/types";
import { stableStringify } from "../../src/encode";

const GRID_SIZE = 3;
const GOAL = GRID_SIZE * GRID_SIZE - 1; // 8
const START = 0;

export interface CrackstepState extends WithEffects {
  readonly pos: number;
  readonly visitOrder: readonly number[]; // history, most recent last; current === last entry
}

export interface CrackstepMove {
  readonly to: number;
}

function rowCol(cell: number): [number, number] {
  return [Math.floor(cell / GRID_SIZE), cell % GRID_SIZE];
}

function neighbors(cell: number): number[] {
  const [r, c] = rowCol(cell);
  const out: number[] = [];
  if (r > 0) out.push(cell - GRID_SIZE);
  if (r < GRID_SIZE - 1) out.push(cell + GRID_SIZE);
  if (c > 0) out.push(cell - 1);
  if (c < GRID_SIZE - 1) out.push(cell + 1);
  return out;
}

/** A cell is solid iff it is the current position, the immediately-previous position, or
 *  has never been visited. Anything visited earlier than that has crumbled. */
function isCrumbled(visitOrder: readonly number[], cell: number): boolean {
  const safe = new Set(visitOrder.slice(-2));
  if (safe.has(cell)) return false;
  return visitOrder.includes(cell);
}

function legalDestinations(state: CrackstepState): number[] {
  if (state.pos === GOAL) return []; // already won — no further moves
  return neighbors(state.pos).filter((n) => !isCrumbled(state.visitOrder, n));
}

function computeStatus(state: CrackstepState): Status {
  if (state.pos === GOAL) return { kind: "won", winner: 0 };
  if (legalDestinations(state).length === 0) return { kind: "lost" };
  return { kind: "ongoing" };
}

export const miniCrackstep: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
  meta: {
    id: "mini-crackstep-fixture",
    name: "Mini Crackstep (internal fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): CrackstepState {
    return { pos: START, visitOrder: [START], lastEffects: [] };
  },

  legalMoves(state: CrackstepState, player: PlayerId): CrackstepMove[] {
    if (player !== 0) return [];
    return legalDestinations(state).map((to) => ({ to }));
  },

  isLegal(state: CrackstepState, player: PlayerId, move: CrackstepMove): boolean {
    if (player !== 0) return false;
    return legalDestinations(state).includes(move.to);
  },

  active(_state: CrackstepState): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state: CrackstepState, moves: ReadonlyMap<PlayerId, CrackstepMove>, _rng: Rng): CrackstepState {
    const move = moves.get(0);
    if (!move || !miniCrackstep.isLegal(state, 0, move)) {
      throw new Error(`mini-crackstep: illegal move ${stableStringify(move ?? null)}`);
    }
    const newVisitOrder = [...state.visitOrder, move.to];
    const effects: Effect[] = [{ type: "moved", from: state.pos, to: move.to }];
    // The cell that becomes newly crumbled this turn (if any) is the one now 3rd-from-last.
    if (newVisitOrder.length >= 3) {
      const justCrumbled = newVisitOrder[newVisitOrder.length - 3]!;
      effects.push({ type: "crumbled", cell: justCrumbled });
    }
    return { pos: move.to, visitOrder: newVisitOrder, lastEffects: effects };
  },

  status(state: CrackstepState): Status {
    return computeStatus(state);
  },

  playerView(state: CrackstepState, _player: PlayerId | null): CrackstepState {
    return state; // perfect information
  },

  encode(state: CrackstepState): string {
    return stableStringify({ pos: state.pos, visitOrder: state.visitOrder as unknown as number[] });
  },

  decode(encoded: string): CrackstepState {
    const parsed = JSON.parse(encoded) as { pos: number; visitOrder: number[] };
    return { pos: parsed.pos, visitOrder: parsed.visitOrder, lastEffects: [] };
  },
};

/** A known solution for verifyCertificate/solver tests: 0 -> 1 -> 2 -> 5 -> 8. */
export const MINI_CRACKSTEP_KNOWN_SOLUTION: readonly CrackstepMove[] = [
  { to: 1 },
  { to: 2 },
  { to: 5 },
  { to: 8 },
];

// packages/harness/test/fixtures/hole-walk.ts — a tiny, REAL, seed-generated puzzle fixture
// for certify.test.ts. Same "walk from corner to corner, zero-delay decay, no backtracking"
// mechanic as the engine testkit's mini-crackstep fixture, but with a `setup()` that actually
// draws from `rng` — a random subset of interior cells become impassable "holes", the way
// Crackstep's real generator (docs/plans/crackstep.md §3.1) samples hole placement. This is
// what makes it useful for certify.ts's tests specifically: different seeds (nonces) produce
// genuinely different boards, some unsolvable (holes disconnect start from goal), some
// solvable — exactly the variety `certifyDay`'s reject-and-redraw loop needs to exercise
// against a real engine rather than a scripted mock.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export const HOLE_WALK_WIDTH = 4;
export const HOLE_WALK_HEIGHT = 3;
const TOTAL_CELLS = HOLE_WALK_WIDTH * HOLE_WALK_HEIGHT;
const START = 0;
const GOAL = TOTAL_CELLS - 1;
const MAX_HOLES = 5;

export interface HoleWalkState extends WithEffects {
  readonly pos: number;
  readonly visitOrder: readonly number[];
  readonly holes: readonly number[]; // sorted, fixed for the whole run (set at setup)
}

export interface HoleWalkMove {
  readonly to: number;
  readonly [key: string]: Json;
}

function neighbors(cell: number): number[] {
  const row = Math.floor(cell / HOLE_WALK_WIDTH);
  const col = cell % HOLE_WALK_WIDTH;
  const out: number[] = [];
  if (row > 0) out.push(cell - HOLE_WALK_WIDTH);
  if (row < HOLE_WALK_HEIGHT - 1) out.push(cell + HOLE_WALK_WIDTH);
  if (col > 0) out.push(cell - 1);
  if (col < HOLE_WALK_WIDTH - 1) out.push(cell + 1);
  return out;
}

function legalDestinations(state: HoleWalkState): number[] {
  if (state.pos === GOAL) return [];
  const holes = new Set(state.holes);
  return neighbors(state.pos).filter((n) => !holes.has(n) && !state.visitOrder.includes(n));
}

function computeStatus(state: HoleWalkState): Status {
  if (state.pos === GOAL) return { kind: "won", winner: 0 };
  if (legalDestinations(state).length === 0) return { kind: "lost" };
  return { kind: "ongoing" };
}

export const holeWalk: GameEngine<HoleWalkState, HoleWalkMove, HoleWalkState> = {
  meta: {
    id: "hole-walk-fixture",
    name: "Hole Walk (certify test fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, rng: Rng): HoleWalkState {
    const interior = Array.from({ length: TOTAL_CELLS }, (_, i) => i).filter((c) => c !== START && c !== GOAL);
    const holeCount = rng.int(MAX_HOLES + 1); // 0..MAX_HOLES
    const shuffled = rng.shuffle(interior);
    const holes = shuffled.slice(0, holeCount).sort((a, b) => a - b);
    return { pos: START, visitOrder: [START], holes, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId) {
    if (player !== 0) return [];
    return legalDestinations(state).map((to) => ({ to }));
  },

  isLegal(state, player, move) {
    if (player !== 0) return false;
    return legalDestinations(state).includes(move.to);
  },

  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },

  apply(state, moves, _rng) {
    const move = moves.get(0);
    if (!move || !legalDestinations(state).includes(move.to)) {
      throw new Error(`hole-walk: illegal move ${stableStringify(move ?? null)}`);
    }
    const effects: Effect[] = [
      { type: "moved", from: state.pos, to: move.to },
      { type: "crumbled", cell: state.pos },
    ];
    return { pos: move.to, visitOrder: [...state.visitOrder, move.to], holes: state.holes, lastEffects: effects };
  },

  status(state): Status {
    return computeStatus(state);
  },

  playerView(state, _player) {
    return state;
  },

  encode(state) {
    return stableStringify({
      pos: state.pos,
      visitOrder: state.visitOrder as unknown as number[],
      holes: state.holes as unknown as number[],
    });
  },

  decode(encoded) {
    const parsed = JSON.parse(encoded) as { pos: number; visitOrder: number[]; holes: number[] };
    return { pos: parsed.pos, visitOrder: parsed.visitOrder, holes: parsed.holes, lastEffects: [] };
  },
};

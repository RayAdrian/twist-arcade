// games/mine-run/engine.ts — Mine Run: press-your-luck minesweeper (docs/plans/mine-run.md).
//
// State/view split (plan §3.1, platform-corrections C1): `MineRunState` carries the FULL mine
// layout (the secret); `MineRunView` OMITS unrevealed cells structurally — `cells` is keyed
// only by revealed indices, and its value union (`{n}` | `{exploded:true}`, plus a
// spectator-terminal-only `{mine:true}`) has no field that could carry an unrevealed mine's
// identity. There is no masking anywhere in this file: playerView() builds V by iterating the
// revealed set, never by copying S and deleting a key.
//
// All procedural generation (mine placement, opening-region selection) happens in setup()
// via the injected Rng — apply() never draws (meta.stochastic: false; the uncertainty here is
// hidden information, not chance after setup, per plan R1).

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { countAdjacentMines, floodFrom, neighbors } from "./board";

export const DEFAULT_WIDTH = 10;
export const DEFAULT_HEIGHT = 10;
export const DEFAULT_MINES = 20;
export const DEFAULT_BUDGET = 60;

/** Bounded retry for R2's zero-cell opening-region search (plan R2, §10's "deterministic
 *  retry path" anchor). Drawing continues from the SAME rng stream across attempts, so the
 *  whole search is itself deterministic given the seed — no attempt resets the stream. */
const MAX_GENERATION_ATTEMPTS = 20;

export interface MineRunState extends WithEffects {
  /** Sorted, canonical. THE secret — never reaches MineRunView. */
  readonly mines: readonly number[];
  /** Sorted; includes exploded cells (a mine hit reveals that cell permanently, R7). */
  readonly revealed: readonly number[];
  /** Sorted subset of `revealed` — mines that have been hit. */
  readonly exploded: readonly number[];
  readonly streakLen: number;
  /** Triangular running total: n(n+1)/2 for a streak of length n. Stored, not recomputed. */
  readonly streakValue: number;
  /** Permanent — mines can never touch this (R7). */
  readonly banked: number;
  readonly revealsLeft: number;
}

export type MineRunMove =
  | { readonly t: "reveal"; readonly cell: number; readonly [key: string]: Json }
  | { readonly t: "bank"; readonly [key: string]: Json };

export type MineRunCellView = { readonly n: number } | { readonly exploded: true } | { readonly mine: true };

/**
 * Structurally distinct from MineRunState (requirement #1 of the assignment): `cells` is a
 * sparse map keyed by revealed index only. An unrevealed cell has NO ENTRY — there is no
 * field anywhere in this type that could hold an unrevealed mine's position or identity. The
 * `mine: true` variant exists ONLY for the terminal spectator view (playerView(state, null)
 * after the run has ended, per plan §3.2's "post-game show me the mines" carve-out) and never
 * appears in the player's own view or in any ongoing spectator view.
 */
export interface MineRunView extends WithEffects {
  readonly width: number;
  readonly height: number;
  readonly cells: Readonly<Record<number, MineRunCellView>>;
  readonly minesTotal: number;
  readonly minesExploded: number;
  readonly streakLen: number;
  readonly streakValue: number;
  /** streakLen + 1 — the HUD's "+k" chip (R5's escalation telegraph). */
  readonly nextGain: number;
  readonly banked: number;
  readonly revealsLeft: number;
}

export interface CreateMineRunOptions {
  width?: number;
  height?: number;
  mines?: number;
  budget?: number;
}

export class MineRunDecodeError extends Error {
  constructor(detail: string) {
    super(`MineRunDecodeError: ${detail}`);
    this.name = "MineRunDecodeError";
  }
}

// Known-vocabulary effects a real Mine Run apply() may ever emit. playerView's redaction path
// (plan §3.2) allowlists exactly these — anything else (a future debug/telemetry effect that
// might carry layout data) is DROPPED, not passed through. This is what the planted `nearMiss`
// mutant test (test/redaction-mutant.test.ts) proves matters: the real engine never emits
// anything outside this list, and if it ever did, this filter — not vigilance — is the wall.
const PUBLIC_EFFECT_TYPES = new Set(["revealed", "exploded", "banked"]);

function redactEffects(effects: readonly Effect[]): Effect[] {
  return effects.filter((e) => PUBLIC_EFFECT_TYPES.has(e.type));
}

interface Dims {
  width: number;
  height: number;
  mines: number;
  budget: number;
  totalCells: number;
}

function computeStatus(state: MineRunState, dims: Dims): Status {
  const safeTotal = dims.totalCells - state.mines.length;
  const safeRevealed = state.revealed.length - state.exploded.length;
  if (state.revealsLeft <= 0 || safeRevealed >= safeTotal) {
    return { kind: "scored", scores: [state.banked] };
  }
  return { kind: "ongoing" };
}

function isRevealed(state: MineRunState, cell: number): boolean {
  // state.revealed is kept sorted but is generally small relative to a linear scan cost at
  // these board sizes (<=100 cells); a Set is built ad hoc where call sites need many checks.
  return state.revealed.includes(cell);
}

function isLegalMove(state: MineRunState, move: MineRunMove, dims: Dims): boolean {
  if (computeStatus(state, dims).kind !== "ongoing") return false;
  if (move.t === "bank") return state.streakLen >= 1;
  if (move.t === "reveal") {
    if (state.revealsLeft <= 0) return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= dims.totalCells) return false;
    return !isRevealed(state, move.cell);
  }
  return false;
}

function legalMovesFor(state: MineRunState, dims: Dims): MineRunMove[] {
  if (computeStatus(state, dims).kind !== "ongoing") return [];
  const moves: MineRunMove[] = [];
  if (state.streakLen >= 1) moves.push({ t: "bank" });
  if (state.revealsLeft > 0) {
    const revealedSet = new Set(state.revealed);
    for (let c = 0; c < dims.totalCells; c++) {
      if (!revealedSet.has(c)) moves.push({ t: "reveal", cell: c });
    }
  }
  return moves;
}

/** R2: select the opening region. Draws from `rng` until a zero-count cell is found (or the
 *  attempt bound is hit, at which point it falls back to the minimum-count cell). Returns the
 *  chosen mine layout (a fresh draw each attempt) and the opening region (sorted). */
function generateLayoutAndOpening(
  rng: Rng,
  dims: Dims
): { mines: number[]; opening: number[] } {
  const allCells = Array.from({ length: dims.totalCells }, (_, i) => i);
  let lastMines: number[] = [];

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const shuffled = rng.shuffle(allCells);
    const mines = shuffled.slice(0, dims.mines);
    lastMines = mines;
    const minesSet = new Set(mines);

    const zeroCells: number[] = [];
    for (const c of allCells) {
      if (minesSet.has(c)) continue;
      if (countAdjacentMines(c, minesSet, dims.width, dims.height) === 0) zeroCells.push(c);
    }
    if (zeroCells.length > 0) {
      const chosen = zeroCells[rng.int(zeroCells.length)]!;
      const opening = floodFrom(chosen, minesSet, dims.width, dims.height).sort((a, b) => a - b);
      return { mines: [...minesSet].sort((a, b) => a - b), opening };
    }
  }

  // Fallback (R2): no zero cell found within the attempt bound — open the minimum-count
  // safe cell instead (a size-1 opening region; floodFrom naturally returns just that cell
  // since its count is > 0 by construction of this branch).
  const minesSet = new Set(lastMines);
  let bestCount = Infinity;
  let candidates: number[] = [];
  for (const c of allCells) {
    if (minesSet.has(c)) continue;
    const n = countAdjacentMines(c, minesSet, dims.width, dims.height);
    if (n < bestCount) {
      bestCount = n;
      candidates = [c];
    } else if (n === bestCount) {
      candidates.push(c);
    }
  }
  const chosen = candidates[rng.int(candidates.length)]!;
  const opening = floodFrom(chosen, minesSet, dims.width, dims.height).sort((a, b) => a - b);
  return { mines: [...minesSet].sort((a, b) => a - b), opening };
}

function assertInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MineRunDecodeError(`field "${field}" must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertIndexArray(value: unknown, field: string, totalCells: number): number[] {
  if (!Array.isArray(value)) {
    throw new MineRunDecodeError(`field "${field}" must be an array, got ${JSON.stringify(value)}`);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= totalCells) {
      throw new MineRunDecodeError(`field "${field}" contains an invalid cell index: ${JSON.stringify(v)}`);
    }
    if (seen.has(v)) {
      throw new MineRunDecodeError(`field "${field}" contains a duplicate cell index: ${v}`);
    }
    seen.add(v);
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Builds the Mine Run engine for a given board configuration. The default export `mineRun`
 * (below) is the launch configuration (10x10, 20 mines, budget 60, R1/R10); tests and the
 * harness's future tuning sweeps use this factory for smaller/alternate boards — mirroring
 * the existing bank-run/createBankRun fixture convention in packages/engine/testkit.
 */
export function createMineRun(opts: CreateMineRunOptions = {}): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const mines = opts.mines ?? DEFAULT_MINES;
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const totalCells = width * height;
  const dims: Dims = { width, height, mines, budget, totalCells };

  if (mines <= 0 || mines >= totalCells) {
    throw new RangeError(`createMineRun: mines (${mines}) must be in (0, ${totalCells})`);
  }

  const engine: GameEngine<MineRunState, MineRunMove, MineRunView> = {
    meta: {
      id: "mine-run",
      name: "Mine Run",
      minPlayers: 1,
      maxPlayers: 1,
      hiddenInformation: true,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },

    setup(_numPlayers: number, rng: Rng): MineRunState {
      const { mines: mineList, opening } = generateLayoutAndOpening(rng, dims);
      return {
        mines: mineList,
        revealed: opening,
        exploded: [],
        streakLen: 0,
        streakValue: 0,
        banked: 0,
        revealsLeft: budget,
        lastEffects: [],
      };
    },

    legalMoves(state: MineRunState, player: PlayerId): MineRunMove[] {
      if (player !== 0) return [];
      return legalMovesFor(state, dims);
    },

    isLegal(state: MineRunState, player: PlayerId, move: MineRunMove): boolean {
      if (player !== 0) return false;
      return isLegalMove(state, move, dims);
    },

    active(_state: MineRunState): ActiveSpec {
      return { mode: "sequential", player: 0 };
    },

    apply(state: MineRunState, moves: ReadonlyMap<PlayerId, MineRunMove>, _rng: Rng): MineRunState {
      const move = moves.get(0);
      if (!move) {
        throw new Error("mine-run: apply() called without a move for player 0");
      }
      if (!isLegalMove(state, move, dims)) {
        throw new Error(`mine-run: illegal move ${stableStringify(move)}`);
      }

      const minesSet = new Set(state.mines);
      const revealedSet = new Set(state.revealed);
      const explodedSet = new Set(state.exploded);

      let streakLen = state.streakLen;
      let streakValue = state.streakValue;
      let banked = state.banked;
      let revealsLeft = state.revealsLeft;
      const effects: Effect[] = [];

      if (move.t === "bank") {
        effects.push({ type: "banked", points: streakValue });
        banked += streakValue;
        streakLen = 0;
        streakValue = 0;
      } else {
        revealsLeft -= 1;
        if (minesSet.has(move.cell)) {
          revealedSet.add(move.cell);
          explodedSet.add(move.cell);
          effects.push({ type: "exploded", cell: move.cell, streakLost: streakValue });
          streakLen = 0;
          streakValue = 0;
        } else {
          const region = floodFrom(move.cell, minesSet, width, height);
          for (const c of region) {
            if (revealedSet.has(c)) continue; // already revealed via an earlier move
            revealedSet.add(c);
            streakLen += 1;
            streakValue += streakLen;
            effects.push({ type: "revealed", cell: c, n: countAdjacentMines(c, minesSet, width, height) });
          }
        }
      }

      const nextMines = [...minesSet].sort((a, b) => a - b);
      const nextRevealed = [...revealedSet].sort((a, b) => a - b);
      const nextExploded = [...explodedSet].sort((a, b) => a - b);

      const safeTotal = totalCells - nextMines.length;
      const safeRevealed = nextRevealed.length - nextExploded.length;
      const terminal = revealsLeft <= 0 || safeRevealed >= safeTotal;
      if (terminal && streakValue > 0) {
        effects.push({ type: "banked", points: streakValue });
        banked += streakValue;
        streakLen = 0;
        streakValue = 0;
      }

      return {
        mines: nextMines,
        revealed: nextRevealed,
        exploded: nextExploded,
        streakLen,
        streakValue,
        banked,
        revealsLeft,
        lastEffects: effects,
      };
    },

    status(state: MineRunState): Status {
      return computeStatus(state, dims);
    },

    playerView(state: MineRunState, player: PlayerId | null): MineRunView {
      const minesSet = new Set(state.mines);
      const revealedSet = new Set(state.revealed);
      const explodedSet = new Set(state.exploded);
      const status = computeStatus(state, dims);
      const spectatorTerminal = player === null && status.kind !== "ongoing";

      const cells: Record<number, MineRunCellView> = {};
      if (spectatorTerminal) {
        // Post-game "show me the mines" (plan §3.2) — the ONLY branch that ever exposes an
        // unrevealed mine, and only once the run can no longer be played.
        for (let c = 0; c < totalCells; c++) {
          if (minesSet.has(c)) {
            cells[c] = explodedSet.has(c) ? { exploded: true } : { mine: true };
          } else {
            cells[c] = { n: countAdjacentMines(c, minesSet, width, height) };
          }
        }
      } else {
        for (const c of revealedSet) {
          cells[c] = explodedSet.has(c) ? { exploded: true } : { n: countAdjacentMines(c, minesSet, width, height) };
        }
      }

      return {
        width,
        height,
        cells,
        minesTotal: minesSet.size,
        minesExploded: explodedSet.size,
        streakLen: state.streakLen,
        streakValue: state.streakValue,
        nextGain: state.streakLen + 1,
        banked: state.banked,
        revealsLeft: state.revealsLeft,
        lastEffects: redactEffects(state.lastEffects),
      };
    },

    encode(state: MineRunState): string {
      return stableStringify({
        mines: state.mines as unknown as number[],
        revealed: state.revealed as unknown as number[],
        exploded: state.exploded as unknown as number[],
        streakLen: state.streakLen,
        streakValue: state.streakValue,
        banked: state.banked,
        revealsLeft: state.revealsLeft,
      });
    },

    decode(encoded: string): MineRunState {
      let parsed: unknown;
      try {
        parsed = JSON.parse(encoded);
      } catch (err) {
        throw new MineRunDecodeError(`not valid JSON: ${(err as Error).message}`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new MineRunDecodeError("encoded value must be a JSON object");
      }
      const obj = parsed as Record<string, unknown>;

      const minesArr = assertIndexArray(obj.mines, "mines", totalCells);
      if (minesArr.length !== mines) {
        throw new MineRunDecodeError(
          `field "mines" must have exactly ${mines} entries for this board configuration, got ${minesArr.length}`
        );
      }
      const revealedArr = assertIndexArray(obj.revealed, "revealed", totalCells);
      const explodedArr = assertIndexArray(obj.exploded, "exploded", totalCells);

      const minesSet = new Set(minesArr);
      const revealedSet = new Set(revealedArr);
      for (const e of explodedArr) {
        if (!revealedSet.has(e)) {
          throw new MineRunDecodeError(`field "exploded" contains ${e}, which is not in "revealed"`);
        }
        if (!minesSet.has(e)) {
          throw new MineRunDecodeError(`field "exploded" contains ${e}, which is not a mine`);
        }
      }
      const safeTotal = totalCells - minesArr.length;
      const safeRevealedCount = revealedArr.length - explodedArr.length;
      if (safeRevealedCount < 0 || safeRevealedCount > safeTotal) {
        throw new MineRunDecodeError("revealed/exploded counts are inconsistent with the safe-cell total");
      }

      const streakLen = assertInt(obj.streakLen, "streakLen");
      if (streakLen < 0) throw new MineRunDecodeError("field \"streakLen\" must be >= 0");
      const streakValue = assertInt(obj.streakValue, "streakValue");
      const expectedStreakValue = (streakLen * (streakLen + 1)) / 2;
      if (streakValue !== expectedStreakValue) {
        throw new MineRunDecodeError(
          `field "streakValue" (${streakValue}) is inconsistent with "streakLen" (${streakLen}); ` +
            `expected ${expectedStreakValue}`
        );
      }
      const banked = assertInt(obj.banked, "banked");
      if (banked < 0) throw new MineRunDecodeError('field "banked" must be >= 0');
      const revealsLeft = assertInt(obj.revealsLeft, "revealsLeft");
      if (revealsLeft < 0 || revealsLeft > budget) {
        throw new MineRunDecodeError(`field "revealsLeft" (${revealsLeft}) must be within [0, ${budget}]`);
      }

      return {
        mines: minesArr,
        revealed: revealedArr,
        exploded: explodedArr,
        streakLen,
        streakValue,
        banked,
        revealsLeft,
        lastEffects: [],
      };
    },

    score(state: MineRunState, _player: PlayerId): number {
      return state.banked;
    },
  };

  return engine;
}

export const mineRun: GameEngine<MineRunState, MineRunMove, MineRunView> = createMineRun();

/** Re-exported for csp.ts / probes.ts, which need the same adjacency math without importing
 *  board.ts a second time under a different relative path. */
export { neighbors, countAdjacentMines, floodFrom };

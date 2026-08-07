// games/tilt/engine.ts — Tilt (docs/plans/tilt.md's acceptance criteria, §9, are the spec this
// file is TDD'd against, not the other way round).
//
// Rule sentence (canonical, plan header, 59 chars): "Every 4th turn the board rotates and every
// piece falls again."
//
// THE CORRECTION THIS PLAN MADE TO ITS OWN COMMISSIONING BRIEF MATTERS HERE (plan header, C31):
// Tilt is a SCHEDULED rotation every 4th ply with a full re-fall — not a per-move tilt, and not
// a player-chosen one. "Scheduled rotation = predictable chaos players can plan into" is the
// design point: the tilt is a clock both players see coming, never a weapon one player aims.
//
// STATE IS THE GRID ALONE (plan §2.1/§3): `{ grid, lastEffects }` — no stored `toMove`, no
// stored ply counter, no stored tilt-phase field. All three are derived from the grid's disc
// count via engine-internal.ts's exported helpers. This is what makes `encode(grid)` a SOUND
// position key (plan §2.1, the opposite of Fadeout's C3 situation): two move orders reaching
// the same grid reach the same game in every respect (same mover, same tilt phase, same
// futures). THE BINDING CONDITION: no path-dependent field may ever be added to this state —
// share-artifact statistics (tilts survived, discs displaced, ...) are path-dependent and
// belong in the presentation layer, computed from the ReplayRecord, never stored here.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import {
  columnHasSpace,
  compactColumns,
  discCount,
  hasFloatingDisc,
  hasRun,
  lastMoverOf,
  lowestEmptyRow,
  rotate,
  toMoveOf,
  windowsFor,
  type Disc,
  type Geometry,
  type Grid,
  type PlayerSeat,
} from "./engine-internal";
import { heuristic as computeHeuristic } from "./heuristic";

export interface TiltState extends WithEffects {
  /** length size*size, row-major, index = row*size + col; row 0 = top, row size-1 = bottom.
   *  null = empty. THE ONLY state — see module doc's binding condition. */
  readonly grid: Grid;
  readonly lastEffects: WithEffects["lastEffects"];
}

// The explicit `[key: string]: Json` index signature is required — TypeScript does not
// synthesize one for a plain interface used as the engine's `M` generic (CHECKLIST.md's first
// trap; same pattern as every fixture and shipped game in this repo).
export interface TiltMove {
  readonly column: number;
  readonly [key: string]: Json;
}

export class TiltDecodeError extends Error {
  constructor(detail: string) {
    super(`tilt engine: decode() received a malformed encoding: ${detail}`);
    this.name = "TiltDecodeError";
  }
}

/**
 * Shipped config (plan §1): `{ size: 7, winLength: 4, tiltPeriod: 4, tiltDirection: "cw",
 * doubleLine: "draw" }`. Every other field is a §4 REMEDY LEVER — measured only if the shipped
 * config fails a gate (C19/C25: not speculatively), never shipped without a measurement. The
 * engine is genuinely parameterized (not a throw-for-unimplemented stub like Order vs Chaos's
 * board-size lever) because §5.1's kill-test sweep may itself need to re-run the
 * `doubleLine: "mover-wins"` variant if double-line frequency exceeds ~2% — that decision has to
 * be made from THIS milestone's own data, not deferred to a later rewrite.
 */
export interface TiltConfig {
  readonly size?: 6 | 7;
  readonly winLength?: 4;
  readonly tiltPeriod?: 3 | 4 | 5;
  readonly tiltDirection?: "cw" | "alternating";
  readonly doubleLine?: "draw" | "mover-wins";
}

interface ResolvedTiltConfig {
  readonly size: number;
  readonly winLength: number;
  readonly tiltPeriod: number;
  readonly tiltDirection: "cw" | "alternating";
  readonly doubleLine: "draw" | "mover-wins";
  readonly configId: string;
}

const SHIPPED_SIZE = 7;
const SHIPPED_WIN_LENGTH = 4;
const SHIPPED_TILT_PERIOD = 4;

function resolveConfig(config: TiltConfig): ResolvedTiltConfig {
  const size = config.size ?? SHIPPED_SIZE;
  const winLength = config.winLength ?? SHIPPED_WIN_LENGTH;
  const tiltPeriod = config.tiltPeriod ?? SHIPPED_TILT_PERIOD;
  const tiltDirection = config.tiltDirection ?? "cw";
  const doubleLine = config.doubleLine ?? "draw";

  if (size !== 6 && size !== 7) {
    throw new RangeError(`createTiltEngine: size must be 6 or 7, got ${size}`);
  }
  if (winLength !== 4) {
    throw new RangeError(`createTiltEngine: winLength is fixed at 4 (plan §1's TiltConfig comment), got ${winLength}`);
  }
  if (tiltPeriod !== 3 && tiltPeriod !== 4 && tiltPeriod !== 5) {
    throw new RangeError(`createTiltEngine: tiltPeriod must be 3, 4, or 5, got ${tiltPeriod}`);
  }
  if (tiltDirection !== "cw" && tiltDirection !== "alternating") {
    throw new RangeError(`createTiltEngine: tiltDirection must be "cw" or "alternating", got ${String(tiltDirection)}`);
  }
  if (doubleLine !== "draw" && doubleLine !== "mover-wins") {
    throw new RangeError(`createTiltEngine: doubleLine must be "draw" or "mover-wins", got ${String(doubleLine)}`);
  }

  return {
    size,
    winLength,
    tiltPeriod,
    tiltDirection,
    doubleLine,
    configId: `${size}x${size}-win${winLength}-period${tiltPeriod}-${tiltDirection}-${doubleLine}`,
  };
}

/** Direction of the NEXT tilt under `tiltDirection: "alternating"` — derivable purely from disc
 *  count (how many tilts have already fired), never stored: the same §2.1 discipline as every
 *  other derived quantity in this file. Tilt #0 (the first one) is "cw"; tilt #1 is "ccw"; etc.
 *  Irrelevant (never consulted) when `tiltDirection === "cw"`. */
function nextTiltDirection(resolved: ResolvedTiltConfig, discCountAfterDrop: number): "cw" | "ccw" {
  if (resolved.tiltDirection === "cw") return "cw";
  const tiltIndex = Math.floor(discCountAfterDrop / resolved.tiltPeriod) - 1;
  return tiltIndex % 2 === 0 ? "cw" : "ccw";
}

export function createTiltEngine(config: TiltConfig = {}): GameEngine<TiltState, TiltMove, TiltState> {
  const resolved = resolveConfig(config);
  const geo: Geometry = { size: resolved.size, winLength: resolved.winLength };
  const totalCells = resolved.size * resolved.size;

  function computeStatus(grid: Grid): Status {
    const p0 = hasRun(grid, geo, 0);
    const p1 = hasRun(grid, geo, 1);
    if (p0 && p1) {
      // Double line (plan §1.4): a re-fall completed a run for BOTH players simultaneously.
      // Shipped `doubleLine: "draw"`; the `mover-wins` variant (§4 remedy lever, measured only
      // if §5.1's sweep flags this as material) awards it to whoever placed the disc that
      // triggered the tilt — derivable from disc count alone (see lastMoverOf's own doc), never
      // a stored field.
      if (resolved.doubleLine === "mover-wins") {
        return { kind: "won", winner: lastMoverOf(grid) };
      }
      return { kind: "draw" };
    }
    if (p0) return { kind: "won", winner: 0 };
    if (p1) return { kind: "won", winner: 1 };
    if (discCount(grid) === totalCells) return { kind: "draw" };
    return { kind: "ongoing" };
  }

  function isColumnLegal(grid: Grid, col: number): boolean {
    return Number.isInteger(col) && col >= 0 && col < resolved.size && columnHasSpace(grid, geo, col);
  }

  const engine: GameEngine<TiltState, TiltMove, TiltState> = {
    meta: {
      id: "tilt",
      name: "Tilt",
      minPlayers: 2,
      maxPlayers: 2,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },

    setup(_numPlayers: number, _rng: Rng): TiltState {
      return {
        grid: new Array<Disc>(totalCells).fill(null),
        lastEffects: [],
      };
    },

    legalMoves(state: TiltState, player: PlayerId): TiltMove[] {
      if (player !== toMoveOf(state.grid)) return [];
      if (computeStatus(state.grid).kind !== "ongoing") return [];
      const moves: TiltMove[] = [];
      for (let col = 0; col < resolved.size; col++) {
        if (columnHasSpace(state.grid, geo, col)) moves.push({ column: col });
      }
      return moves;
    },

    isLegal(state: TiltState, player: PlayerId, move: TiltMove): boolean {
      if (player !== toMoveOf(state.grid)) return false;
      if (computeStatus(state.grid).kind !== "ongoing") return false;
      return isColumnLegal(state.grid, move.column);
    },

    active(state: TiltState): ActiveSpec {
      return { mode: "sequential", player: toMoveOf(state.grid) };
    },

    apply(state: TiltState, moves: ReadonlyMap<PlayerId, TiltMove>, _rng: Rng): TiltState {
      const mover = toMoveOf(state.grid);
      const move = moves.get(mover);
      if (!move) {
        throw new Error("tilt engine: apply() called without a move for the active player");
      }
      if (!engine.isLegal(state, mover, move)) {
        throw new Error(`tilt engine: illegal move ${stableStringify(move as unknown as Json)} for player ${mover}`);
      }

      const row = lowestEmptyRow(state.grid, geo, move.column);
      const dropped = state.grid.slice() as Disc[];
      const droppedCell = row * resolved.size + move.column;
      dropped[droppedCell] = mover;

      const effects: Effect[] = [{ type: "placed", player: mover, column: move.column, cell: droppedCell }];

      // Win-check ordering (plan §1.3): checked FIRST. If the drop itself ends the game, the
      // game ends here — no rotation, regardless of ply parity. "No tilt on a decided game."
      const afterDropStatus = computeStatus(dropped);
      if (afterDropStatus.kind !== "ongoing") {
        return { grid: dropped, lastEffects: effects };
      }

      const newDiscCount = discCount(dropped);
      if (newDiscCount % resolved.tiltPeriod !== 0) {
        return { grid: dropped, lastEffects: effects };
      }

      // Tilt ply: rotate the disc PATTERN (rigid relabel), then compact every column to
      // quiescence (plan §1.2). One pass suffices — see compactColumns's own doc.
      const direction = nextTiltDirection(resolved, newDiscCount);
      const rotated = rotate(dropped, geo, direction);
      const { grid: settled, moved } = compactColumns(rotated, geo);

      effects.push({ type: "tilted", direction });
      for (const m of moved) {
        effects.push({ type: "moved", player: m.player, from: m.from, to: m.to });
      }

      // Re-check at quiescence (plan §1.3/§1.4): the re-fall may have completed a line for one
      // or both players, or filled the board. `status()` (below) derives the right answer from
      // `settled` alone; nothing further to compute here.
      return { grid: settled, lastEffects: effects };
    },

    status(state: TiltState): Status {
      return computeStatus(state.grid);
    },

    playerView(state: TiltState, _player: PlayerId | null): TiltState {
      // Perfect information: identity (meta.hiddenInformation === false).
      return state;
    },

    /**
     * Canonical encoding (plan §3/§2.1): the grid alone. Deliberately EXCLUDES `lastEffects`
     * and any derived quantity (toMove, ply count, tilt phase) — all are recomputable from the
     * grid, and §2.1's binding condition is that nothing path-dependent may live in state at
     * all, so there is nothing else to encode. No config discriminator either: unlike Order vs
     * Chaos's board-size lever (which changes fixed precomputed geometry a wrong-config decode
     * could silently misinterpret), a Tilt grid's shape alone already reveals its `size`
     * (`grid.length === size*size`), and `winLength`/`tiltPeriod`/`tiltDirection`/`doubleLine`
     * do not change what a valid GRID looks like — only how the engine plays from it. A
     * cross-config decode is therefore never structurally ambiguous the way Order vs Chaos's
     * would have been; config correctness there is the CALLER's responsibility (which engine
     * instance you decode through), matching this file's own factory-per-config shape.
     */
    encode(state: TiltState): string {
      return stableStringify({ grid: state.grid as unknown as Json[] });
    },

    /**
     * Throws a typed TiltDecodeError on any malformed or structurally impossible input, per
     * platform-corrections.md C4 — never returns a partial or silently-defaulted state.
     *
     * Checked, in order: JSON shape; grid length; per-cell value validity; NO FLOATING DISCS
     * (plan §3's explicit C4 checklist item — a column with an empty cell below an occupied one
     * can never arise from any legal sequence of drops+re-falls); and COUNT-PARITY (plan §3:
     * count(P0) - count(P1) must be in {0, 1}, derived and never independently trusted).
     *
     * DELIBERATELY DOES NOT reject a both-players-lined grid (the mirror image of Order vs
     * Chaos's C28/A3 ruling, and the plan calls this out explicitly, plan §3): a re-fall can
     * create winning lines for BOTH players simultaneously (the §1.4 draw terminal), so that
     * shape is REACHABLE here, unlike Order vs Chaos where win-check-after-every-placement makes
     * it structurally impossible. `decode` must accept it as a legitimate terminal snapshot;
     * `status()` on the result correctly reports the right outcome per the configured
     * `doubleLine` rule.
     */
    decode(encoded: string): TiltState {
      let parsed: unknown;
      try {
        parsed = JSON.parse(encoded);
      } catch (err) {
        throw new TiltDecodeError(`not valid JSON (${(err as Error).message})`);
      }
      if (typeof parsed !== "object" || parsed === null) {
        throw new TiltDecodeError("top-level value is not an object");
      }
      const obj = parsed as Record<string, unknown>;

      const gridRaw = obj.grid;
      if (!Array.isArray(gridRaw) || gridRaw.length !== totalCells) {
        throw new TiltDecodeError(`\`grid\` must be an array of length ${totalCells}, got ${JSON.stringify(gridRaw)}`);
      }
      for (const cell of gridRaw) {
        if (cell !== null && cell !== 0 && cell !== 1) {
          throw new TiltDecodeError(`\`grid\` entries must be null, 0, or 1 — got ${JSON.stringify(cell)}`);
        }
      }
      const grid = gridRaw as Grid;

      if (hasFloatingDisc(grid, geo)) {
        throw new TiltDecodeError(
          "grid contains a floating disc — an occupied cell with an empty cell below it in the " +
            "same column, which can never arise from any legal sequence of drops and re-falls"
        );
      }

      const p0Count = grid.filter((c) => c === 0).length;
      const p1Count = grid.filter((c) => c === 1).length;
      const diff = p0Count - p1Count;
      if (diff !== 0 && diff !== 1) {
        throw new TiltDecodeError(
          `count-parity violation: count(P1=seat0) - count(P2=seat1) must be 0 or 1 (P1 moves ` +
            `first and plays odd plies) — got ${p0Count} - ${p1Count} = ${diff}`
        );
      }

      return { grid, lastEffects: [] };
    },

    /**
     * Optional (plan §3): classic open-line counting with a tilt discount. Feeds greedy/rush
     * probes only — MCTS tiers (and the T2 kill-test sweep's random/mcts100/mcts1k roster) need
     * nothing here. See heuristic.ts's own doc for the discount mechanism.
     */
    heuristic(state: TiltState, player: PlayerId): number {
      return computeHeuristic(state, player as PlayerSeat, resolved);
    },
  };

  return engine;
}

/** Exposed so tests (and any future tooling that hand-builds an encoding) can compute a
 *  config's discriminator without duplicating resolveConfig's validation. Unlike Order vs
 *  Chaos's `resolveConfigId`, this is NOT embedded in `encode()`'s output (see encode's own
 *  doc) — it exists purely for engine-selection bookkeeping in tests/tooling. */
export function resolveConfigId(config: TiltConfig = {}): string {
  return resolveConfig(config).configId;
}

/** The one ready-to-play engine instance for the shipped config (size 7, win 4, period 4, cw,
 *  draw) — constructed once here so every consumer (index.ts, tests, tooling) shares the exact
 *  same construction site, matching Fadeout's and Order vs Chaos's convention. */
export const tilt = createTiltEngine();

export const TOTAL_CELLS = SHIPPED_SIZE * SHIPPED_SIZE;
export const SIZE = SHIPPED_SIZE;
export const WIN_LENGTH = SHIPPED_WIN_LENGTH;
export const TILT_PERIOD = SHIPPED_TILT_PERIOD;

export { toMoveOf, discCount, lastMoverOf, windowsFor };
export type { Geometry, Grid, PlayerSeat };

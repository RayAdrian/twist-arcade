// games/order-vs-chaos/engine.ts — Order vs Chaos (docs/plans/order-vs-chaos.md §5's
// acceptance criteria are the spec this file is TDD'd against, not the other way round).
//
// Rule sentence (canonical, plan header, 87 chars): "Both players place X or O. Order wins
// with 5 in a row; Chaos wins if the board fills."
//
// Order is ALWAYS seat 0 and Chaos is ALWAYS seat 1 (plan §1.1: "seat and role are the same
// thing... seat 0 is Order in every game" — this is what lets the shipped
// `first-player-win-rate` gate double as the role-balance instrument). What the plan's §3
// config ladder varies across configs A/B/C is board size, win length, and WHICH SEAT MOVES
// FIRST — never which seat plays which role.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import {
  BOARD_SIZE,
  TOTAL_CELLS,
  WIN_LENGTH,
  computeOutcome,
  filledCount,
  hasFiveRun,
  winningCells,
  type Board,
  type Cell,
  type CellSymbol,
} from "./engine-internal";

export const ORDER_SEAT: PlayerId = 0;
export const CHAOS_SEAT: PlayerId = 1;

export interface OrderVsChaosState extends WithEffects {
  /** length TOTAL_CELLS (36), row-major, index = row * BOARD_SIZE + col. null = empty. */
  readonly board: Board;
  readonly toMove: PlayerId;
  readonly lastEffects: WithEffects["lastEffects"];
}

// The explicit `[key: string]: Json` index signature is required — TypeScript does not
// synthesize one for a plain interface used as the engine's `M` generic (CHECKLIST.md's first
// trap; same pattern as every fixture and shipped game in this repo).
export interface OrderVsChaosMove {
  readonly cell: number;
  readonly symbol: CellSymbol;
  readonly [key: string]: Json;
}

class OrderVsChaosDecodeError extends Error {
  constructor(detail: string) {
    super(`order-vs-chaos engine: decode() received a malformed encoding: ${detail}`);
    this.name = "OrderVsChaosDecodeError";
  }
}

/**
 * The config ladder (plan §3) is pre-registered but NOT built: only config A (6x6, win-5,
 * Order-first) ships in OV1. `firstMover` names which SEAT acts on the very first placement —
 * Order is always seat 0 regardless (see module doc), so this is the one axis that can vary
 * without touching that invariant. `boardSize`/`winLength` are accepted in the type now (config
 * C: 7x7/win-5) but rejected at construction — `engine-internal.ts`'s WINDOWS is computed once
 * for the fixed 6x6/win-5 geometry and would need rebuilding per board size before a second
 * geometry could run correctly; that is out of scope until config A's own gate result (§3's
 * kill rule) says a second board is needed at all.
 */
export interface RulesetConfig {
  readonly boardSize?: number;
  readonly winLength?: number;
  readonly firstMover?: PlayerId;
}

interface ResolvedRulesetConfig {
  readonly boardSize: number;
  readonly winLength: number;
  readonly firstMover: PlayerId;
  readonly configId: string;
}

const DEFAULT_FIRST_MOVER: PlayerId = ORDER_SEAT;

function resolveConfig(config: RulesetConfig): ResolvedRulesetConfig {
  const boardSize = config.boardSize ?? BOARD_SIZE;
  const winLength = config.winLength ?? WIN_LENGTH;
  const firstMover = config.firstMover ?? DEFAULT_FIRST_MOVER;
  if (boardSize !== BOARD_SIZE || winLength !== WIN_LENGTH) {
    throw new RangeError(
      `createOrderVsChaosEngine: boardSize=${boardSize}/winLength=${winLength} is reserved for ` +
        `the plan's §3 config-ladder escalation (config C) and is not implemented; only ` +
        `boardSize=${BOARD_SIZE}/winLength=${WIN_LENGTH} is supported today.`
    );
  }
  if (firstMover !== ORDER_SEAT && firstMover !== CHAOS_SEAT) {
    throw new RangeError(`createOrderVsChaosEngine: firstMover must be 0 or 1, got ${firstMover}`);
  }
  return { boardSize, winLength, firstMover, configId: `${boardSize}x${boardSize}-win${winLength}-first${firstMover}` };
}

function opponent(seat: PlayerId): PlayerId {
  return seat === 0 ? 1 : 0;
}

function isCellSymbol(value: unknown): value is CellSymbol {
  return value === "X" || value === "O";
}

export function createOrderVsChaosEngine(
  config: RulesetConfig = {}
): GameEngine<OrderVsChaosState, OrderVsChaosMove, OrderVsChaosState> {
  const resolved = resolveConfig(config);

  function toMoveAtFillCount(fillCount: number): PlayerId {
    return fillCount % 2 === 0 ? resolved.firstMover : opponent(resolved.firstMover);
  }

  function computeStatus(board: Board): Status {
    const outcome = computeOutcome(board);
    if (outcome === "order") return { kind: "won", winner: ORDER_SEAT };
    if (outcome === "chaos") return { kind: "won", winner: CHAOS_SEAT };
    return { kind: "ongoing" };
  }

  const engine: GameEngine<OrderVsChaosState, OrderVsChaosMove, OrderVsChaosState> = {
    meta: {
      id: "order-vs-chaos",
      name: "Order vs Chaos",
      minPlayers: 2,
      maxPlayers: 2,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },

    setup(_numPlayers: number, _rng: Rng): OrderVsChaosState {
      return {
        board: new Array<Cell>(TOTAL_CELLS).fill(null),
        toMove: resolved.firstMover,
        lastEffects: [],
      };
    },

    legalMoves(state: OrderVsChaosState, player: PlayerId): OrderVsChaosMove[] {
      if (player !== state.toMove) return [];
      if (computeStatus(state.board).kind !== "ongoing") return [];
      const moves: OrderVsChaosMove[] = [];
      for (let cell = 0; cell < TOTAL_CELLS; cell++) {
        if (state.board[cell] !== null) continue;
        moves.push({ cell, symbol: "X" });
        moves.push({ cell, symbol: "O" });
      }
      return moves;
    },

    isLegal(state: OrderVsChaosState, player: PlayerId, move: OrderVsChaosMove): boolean {
      if (player !== state.toMove) return false;
      if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= TOTAL_CELLS) return false;
      if (!isCellSymbol(move.symbol)) return false;
      if (computeStatus(state.board).kind !== "ongoing") return false;
      return state.board[move.cell] === null;
    },

    active(state: OrderVsChaosState): ActiveSpec {
      return { mode: "sequential", player: state.toMove };
    },

    apply(
      state: OrderVsChaosState,
      moves: ReadonlyMap<PlayerId, OrderVsChaosMove>,
      _rng: Rng
    ): OrderVsChaosState {
      const mover = state.toMove;
      const move = moves.get(mover);
      if (!move) {
        throw new Error("order-vs-chaos engine: apply() called without a move for the active player");
      }
      if (!engine.isLegal(state, mover, move)) {
        throw new Error(`order-vs-chaos engine: illegal move ${stableStringify(move)} for player ${mover}`);
      }

      const board = state.board.slice() as Cell[];
      board[move.cell] = move.symbol;

      const effects: Effect[] = [{ type: "placed", seat: mover, cell: move.cell, symbol: move.symbol }];
      if (computeOutcome(board) === "order") {
        effects.push({ type: "line", cells: winningCells(board) });
      }

      return {
        board,
        toMove: opponent(mover),
        lastEffects: effects,
      };
    },

    status(state: OrderVsChaosState): Status {
      return computeStatus(state.board);
    },

    playerView(state: OrderVsChaosState, _player: PlayerId | null): OrderVsChaosState {
      // Perfect information: identity (meta.hiddenInformation === false).
      return state;
    },

    /**
     * Canonical encoding (plan §5.7): cells + toMove + config id, EXCLUDES lastEffects. The
     * config id is included so a config-A encoding can never be silently decoded through a
     * config-B/C engine instance once the ladder (plan §3) is actually built — see decode()'s
     * first structural check below.
     */
    encode(state: OrderVsChaosState): string {
      return stableStringify({
        board: state.board as unknown as Json[],
        toMove: state.toMove,
        config: resolved.configId,
      });
    },

    /**
     * Throws a typed OrderVsChaosDecodeError on any malformed or structurally impossible
     * input, per platform-corrections.md C4 — never returns a partial or silently-defaulted
     * state. `decode` feeds `replay()` and certificate verification, the trust boundary
     * deciding whether a submitted move log is genuine.
     *
     * Checked, in order: JSON shape; array length; per-cell symbol validity; config id
     * (an encoding from a different config-ladder rung can never be accepted, matching
     * fadeout's resolveConfig discipline applied at decode time instead of construction time);
     * fill-count/toMove parity (derived, never independently trusted); and finally the one
     * genuinely STRUCTURALLY IMPOSSIBLE board shape decidable from cells alone with no move
     * history (platform-corrections.md C28/A3's "decode must reject the structurally
     * impossible board", C4's "not scoped to cheap invariants"): a board cannot show a
     * completed run for BOTH symbols. Win-check runs on every placement and a single placement
     * can only ever complete a run of the symbol it JUST placed — so if a run of the OTHER
     * symbol already existed, the game would have ended before this placement could ever have
     * been made. A board with two-symbol completed runs is therefore unreachable by any legal
     * sequence of moves, exactly the shape C4/A3 exists to reject.
     *
     * This is deliberately the ONLY status-shaped check decode() performs. `status` is never
     * stored (derived fresh by `status()`/`computeStatus` from the board every time, per this
     * engine's whole design), so a decoded board that already contains a single completed line,
     * or is full with no line, is a perfectly legitimate terminal snapshot — decode() succeeds
     * for those, and `status()` on the result correctly reports `won(ORDER_SEAT)` /
     * `won(CHAOS_SEAT)` rather than `ongoing` (covered by engine.test.ts's decode-positive
     * cases, not a throw here — there is no separate "declared status" field to lie about).
     */
    decode(encoded: string): OrderVsChaosState {
      let parsed: unknown;
      try {
        parsed = JSON.parse(encoded);
      } catch (err) {
        throw new OrderVsChaosDecodeError(`not valid JSON (${(err as Error).message})`);
      }
      if (typeof parsed !== "object" || parsed === null) {
        throw new OrderVsChaosDecodeError("top-level value is not an object");
      }
      const obj = parsed as Record<string, unknown>;

      const boardRaw = obj.board;
      if (!Array.isArray(boardRaw) || boardRaw.length !== TOTAL_CELLS) {
        throw new OrderVsChaosDecodeError(`\`board\` must be an array of length ${TOTAL_CELLS}`);
      }
      for (const cell of boardRaw) {
        if (cell !== null && !isCellSymbol(cell)) {
          throw new OrderVsChaosDecodeError(`\`board\` entries must be null, "X", or "O" — got ${JSON.stringify(cell)}`);
        }
      }
      const board = boardRaw as Cell[];

      if (obj.config !== resolved.configId) {
        throw new OrderVsChaosDecodeError(
          `\`config\` ${JSON.stringify(obj.config)} does not match this engine instance's config ` +
            `${JSON.stringify(resolved.configId)} — an encoding from a different config-ladder rung ` +
            "cannot be decoded through this engine."
        );
      }

      if (obj.toMove !== 0 && obj.toMove !== 1) {
        throw new OrderVsChaosDecodeError("`toMove` must be 0 or 1");
      }
      const expectedToMove = toMoveAtFillCount(filledCount(board));
      if (obj.toMove !== expectedToMove) {
        throw new OrderVsChaosDecodeError(
          `\`toMove\` (${obj.toMove}) does not match the fill-count parity — with ` +
            `${filledCount(board)} filled cell(s) and firstMover=${resolved.firstMover}, toMove ` +
            `must be ${expectedToMove}`
        );
      }

      if (hasFiveRun(board, "X") && hasFiveRun(board, "O")) {
        throw new OrderVsChaosDecodeError(
          "board shows a completed run for BOTH symbols, which is structurally unreachable — " +
            "win-check runs on every placement, so the first run to appear (of either symbol) " +
            "always ends the game before a run of the other symbol could ever form"
        );
      }

      return { board, toMove: obj.toMove, lastEffects: [] };
    },
  };

  return engine;
}

/** Exposed so tests (and any future tooling that hand-builds an encoding) never have to
 *  hardcode a config's discriminator string — computed through the exact same resolveConfig()
 *  the engine factory itself uses, so it can never drift from what encode()/decode() actually
 *  produce/expect. */
export function resolveConfigId(config: RulesetConfig = {}): string {
  return resolveConfig(config).configId;
}

/** The one ready-to-play engine instance for the shipped config (A: 6x6/win-5/Order-first) —
 *  constructed once here so every consumer (index.ts, tests, tooling) shares the exact same
 *  construction site, matching fadeout's convention. */
export const orderVsChaos = createOrderVsChaosEngine();

/** The shipped config's discriminator string (see `resolveConfigId`'s doc). */
export const DEFAULT_CONFIG_ID = resolveConfigId();

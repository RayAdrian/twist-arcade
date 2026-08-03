// games/fadeout/engine.ts — Fadeout (decay tic-tac-toe), parameterized over all 8 ruleset
// variants (plan §1, §3). One `GameEngine` factory shared by every variant so the exact solve
// (F2) and the harness can compare them without forking the implementation.
//
// Rule sentence (canonical, <=90 chars): "Your pieces vanish 3 turns after you place them."
//
// See engine-internal.ts's file header for why the game graph is cyclic and why that matters
// for F2's solver (retrograde analysis, never minimax) even though this module does no search.

import type {
  ActiveSpec,
  GameEngine,
  Json,
  PlayerId,
  Rng,
  Status,
  WithEffects,
} from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import {
  DEFAULT_BOARD_SIZE,
  DEFAULT_CAP,
  checkWinner,
  computeLegalCells,
  positionKeyOf,
  totalPliesPlayed,
  transition,
  type ResolvedRulesetConfig,
  type RulesetConfig,
} from "./engine-internal";
import { fadeoutHeuristic } from "./heuristic";

export type { RulesetConfig } from "./engine-internal";

export interface FadeoutState extends WithEffects {
  /** Per player, the cell indices of their on-board marks in placement order, oldest first.
   *  The queue IS the age-ordering; occupancy is derived from it — never stored separately,
   *  so there is nothing for a separate cells array to drift out of sync with (plan §3.1). */
  readonly queues: readonly [readonly number[], readonly number[]];
  readonly toMove: PlayerId;
  /** positionKeys of every position this game has BEEN AT and moved on from (the current
   *  position is not yet a member — it's appended once the game moves past it). Drives
   *  superko legality and threefold-repetition counting. NOT part of positionKey(); IS part
   *  of encode() (see the module-level comment on that split). */
  readonly history: readonly string[];
  readonly faded: readonly [number, number];
  /** Per player, the longest a REMOVED mark has ever survived, measured in plies on the board
   *  (orchestrator ruling R2 — NOT "own placements survived", which is provably confined to
   *  {0, cap, cap-1} and worthless as a share-artifact variance stat). Only updates when a mark
   *  is actually removed; see engine-internal.ts's transition() doc comment for the derivation,
   *  and totalPliesPlayed()/birthPlyOfQueueIndex() (exported there) for computing a still-alive
   *  mark's current lifespan, which this field does NOT include. */
  readonly longestLife: readonly [number, number];
  readonly lastEffects: WithEffects["lastEffects"];
}

export interface FadeoutMove {
  readonly cell: number;
  // Explicit index signature: see TTTMove's comment in the engine testkit's classic-ttt
  // fixture — a plain interface has no implicit index signature, and Json's object arm
  // requires one.
  readonly [key: string]: Json;
}

class FadeoutDecodeError extends Error {
  constructor(detail: string) {
    super(`fadeout engine: decode() received a malformed encoding: ${detail}`);
    this.name = "FadeoutDecodeError";
  }
}

function resolveConfig(config: RulesetConfig): ResolvedRulesetConfig {
  const boardSize = config.boardSize ?? DEFAULT_BOARD_SIZE;
  const cap = config.cap ?? DEFAULT_CAP;
  if (boardSize !== DEFAULT_BOARD_SIZE || cap !== DEFAULT_CAP) {
    // RulesetConfig reserves boardSize/cap for the 4x4/cap-4 escalation (plan §4, §14 Q2),
    // but this engine implements ONLY 3x3/cap-3 today (plan §3: "design the types for that
    // now, implement only 3x3/cap-3"). Throwing here — rather than silently running an
    // untested board — is the C4-style discipline the plan asks for elsewhere applied to a
    // config-time invariant instead of a decode-time one.
    throw new RangeError(
      `createFadeoutEngine: boardSize=${boardSize}/cap=${cap} is reserved for the future ` +
        `4x4/cap-4 escalation and is not implemented; only boardSize=3/cap=3 is supported today.`
    );
  }
  return {
    decayTiming: config.decayTiming,
    playThrough: config.playThrough,
    repetition: config.repetition,
    boardSize,
    cap,
  };
}

/** All 8 SYNTACTIC combinations of the three ruleset axes (plan §1) — used by engine.test.ts to
 *  run engineContract() against every variant, and reusable by F2's solve script and the
 *  harness so nobody hand-enumerates this list a second time and lets it drift out of sync
 *  with §1. Still 8 entries deliberately, even though only 6 are distinct GAMES once
 *  playThrough=true (see RulesetConfig's AXIS COLLAPSE doc comment in engine-internal.ts): this
 *  function enumerates the config SPACE, and F2's solve is exactly what's expected to notice
 *  and exploit the collapse (as a free cross-check), not something this enumeration should
 *  pre-collapse on its behalf. */
export function allRulesetConfigs(): RulesetConfig[] {
  const out: RulesetConfig[] = [];
  for (const decayTiming of ["remove-first", "place-first"] as const) {
    for (const playThrough of [false, true] as const) {
      for (const repetition of ["superko", "threefold"] as const) {
        out.push({ decayTiming, playThrough, repetition });
      }
    }
  }
  return out;
}

function isValidCellArray(value: unknown, totalCells: number): value is number[] {
  if (!Array.isArray(value)) return false;
  return value.every((v) => Number.isInteger(v) && v >= 0 && v < totalCells);
}

function isNonNegativeIntegerPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => Number.isInteger(v) && v >= 0)
  );
}

export function createFadeoutEngine(config: RulesetConfig): GameEngine<FadeoutState, FadeoutMove, FadeoutState> {
  const resolved = resolveConfig(config);
  const totalCells = resolved.boardSize * resolved.boardSize;

  // PERF NOTE, not a correctness issue at 3x3/141k reachable positions: legalMoves() below
  // calls computeStatus() (which, under superko, runs computeLegalCells()'s full transition()
  // simulation once to check the no-legal-moves corner) and THEN calls computeLegalCells()
  // again itself — two full simulations per legalMoves() call. apply() -> isLegal() ->
  // legalMoves() stacks a third on top just to check one move's legality before apply() re-runs
  // transition() a fourth time to actually perform it. F2's hot loops (solve, self-play sweeps)
  // should call transition()/positionKeyOf() directly rather than legalMoves()/apply()/
  // isLegal(), which pay for this redundancy on every call.
  function computeStatus(state: FadeoutState): Status {
    const winner = checkWinner(state.queues, resolved.boardSize);
    if (winner !== null) return { kind: "won", winner };

    if (resolved.repetition === "threefold") {
      const key = positionKeyOf(state.queues, state.toMove);
      const priorOccurrences = state.history.filter((k) => k === key).length;
      if (priorOccurrences + 1 >= 3) return { kind: "draw" };
    }

    // Structurally unreachable under "threefold": occupancy alone always leaves >=3 empty
    // cells (each side caps at 3 of 9), and threefold never filters a cell on repetition
    // grounds, so at least one legal target always exists. Only superko can exhaust every
    // remaining target — see engine.test.ts's "no legal moves" corner and plan §3.3.
    const legalCells = computeLegalCells(
      state.queues,
      state.toMove,
      state.history,
      state.faded,
      state.longestLife,
      state.toMove,
      resolved
    );
    if (legalCells.length === 0) {
      return { kind: "won", winner: state.toMove === 0 ? 1 : 0 };
    }
    return { kind: "ongoing" };
  }

  const engine: GameEngine<FadeoutState, FadeoutMove, FadeoutState> = {
    meta: {
      id: "fadeout",
      name: "Fadeout",
      minPlayers: 2,
      maxPlayers: 2,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },

    setup(_numPlayers: number, _rng: Rng): FadeoutState {
      return {
        queues: [[], []],
        toMove: 0,
        history: [],
        faded: [0, 0],
        longestLife: [0, 0],
        lastEffects: [],
      };
    },

    legalMoves(state: FadeoutState, player: PlayerId): FadeoutMove[] {
      if (player !== state.toMove) return [];
      if (computeStatus(state).kind !== "ongoing") return [];
      return computeLegalCells(
        state.queues,
        state.toMove,
        state.history,
        state.faded,
        state.longestLife,
        player,
        resolved
      ).map((cell) => ({ cell }));
    },

    isLegal(state: FadeoutState, player: PlayerId, move: FadeoutMove): boolean {
      if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= totalCells) return false;
      return engine.legalMoves(state, player).some((m) => m.cell === move.cell);
    },

    active(state: FadeoutState): ActiveSpec {
      return { mode: "sequential", player: state.toMove };
    },

    apply(state: FadeoutState, moves: ReadonlyMap<PlayerId, FadeoutMove>, _rng: Rng): FadeoutState {
      const mover = state.toMove;
      const move = moves.get(mover);
      if (!move) {
        throw new Error("fadeout engine: apply() called without a move for the active player");
      }
      if (!engine.isLegal(state, mover, move)) {
        throw new Error(`fadeout engine: illegal move ${stableStringify(move)} for player ${mover}`);
      }

      const result = transition(state.queues, mover, move.cell, state.faded, state.longestLife, resolved);
      const history = [...state.history, positionKeyOf(state.queues, state.toMove)];

      return {
        queues: result.queues,
        toMove: result.toMove,
        history,
        faded: result.faded,
        longestLife: result.longestLife,
        lastEffects: result.effects,
      };
    },

    status(state: FadeoutState): Status {
      return computeStatus(state);
    },

    playerView(state: FadeoutState, _player: PlayerId | null): FadeoutState {
      // Perfect information: identity (meta.hiddenInformation === false).
      return state;
    },

    /**
     * Canonical encoding — EXCLUDES lastEffects (standard contract). Includes `history`,
     * `faded`, and `longestLife`: they are legitimately part of state (superko/threefold
     * legality and the share-artifact counters both depend on them), so a byte-identical
     * encode() requires them. This is exactly why encode() is NOT usable as a solver/superko
     * key on this game (see positionKey()'s doc comment and platform-corrections.md C3) —
     * `encode` answers "is this the same persisted state" and `positionKey` answers "is this
     * the same game-theoretic position"; they are different questions with different answers
     * on a history-dependent game.
     */
    encode(state: FadeoutState): string {
      return stableStringify({
        queues: [state.queues[0] as unknown as Json[], state.queues[1] as unknown as Json[]],
        toMove: state.toMove,
        history: [...state.history].sort() as unknown as Json[],
        faded: [state.faded[0], state.faded[1]] as Json[],
        longestLife: [state.longestLife[0], state.longestLife[1]] as Json[],
      });
    },

    /**
     * Throws a typed FadeoutDecodeError on any malformed input, per platform-corrections.md
     * C4 — never returns a partial or silently-defaulted state. `decode` feeds `replay()` and
     * certificate verification (the trust boundary deciding whether a submitted move log is
     * genuine), so lenient parsing here would let a forged record validate silently.
     */
    decode(encoded: string): FadeoutState {
      let parsed: unknown;
      try {
        parsed = JSON.parse(encoded);
      } catch (err) {
        throw new FadeoutDecodeError(`not valid JSON (${(err as Error).message})`);
      }
      if (typeof parsed !== "object" || parsed === null) {
        throw new FadeoutDecodeError("top-level value is not an object");
      }
      const obj = parsed as Record<string, unknown>;

      const queuesRaw = obj.queues;
      if (!Array.isArray(queuesRaw) || queuesRaw.length !== 2) {
        throw new FadeoutDecodeError("`queues` must be a 2-tuple");
      }
      const [q0, q1] = queuesRaw as unknown[];
      if (!isValidCellArray(q0, totalCells) || !isValidCellArray(q1, totalCells)) {
        throw new FadeoutDecodeError(`\`queues\` entries must be arrays of cell indices in [0, ${totalCells})`);
      }
      if (q0.length > resolved.cap || q1.length > resolved.cap) {
        throw new FadeoutDecodeError(`\`queues\` entries must not exceed cap=${resolved.cap}`);
      }
      const seen = new Set<number>();
      for (const cell of [...q0, ...q1]) {
        if (seen.has(cell)) throw new FadeoutDecodeError(`cell ${cell} is claimed by more than one queue entry`);
        seen.add(cell);
      }

      if (obj.toMove !== 0 && obj.toMove !== 1) {
        throw new FadeoutDecodeError("`toMove` must be 0 or 1");
      }

      const historyRaw = obj.history;
      if (!Array.isArray(historyRaw) || !historyRaw.every((h) => typeof h === "string")) {
        throw new FadeoutDecodeError("`history` must be an array of strings");
      }

      if (!isNonNegativeIntegerPair(obj.faded)) {
        throw new FadeoutDecodeError("`faded` must be a pair of non-negative integers");
      }
      if (!isNonNegativeIntegerPair(obj.longestLife)) {
        throw new FadeoutDecodeError("`longestLife` must be a pair of non-negative integers");
      }
      // C4 (platform-corrections.md): reject STRUCTURALLY IMPOSSIBLE states, not just
      // malformed ones. Deliberately NOT attempting full turn-parity/reachability validation of
      // `queues` vs `faded`, or well-formedness of `history` entries — that's replay()'s job at
      // the real trust boundary, and shape checks buy nothing against a forger who can stuff
      // syntactically valid position keys. These two are cheap, general invariants that fall
      // straight out of longestLife's definition (engine-internal.ts's transition() doc
      // comment), not a reachability check:
      const faded = obj.faded as [number, number];
      const longestLife = obj.longestLife as [number, number];
      const totalPliesSoFar = totalPliesPlayed(faded, [q0, q1]);
      for (const p of [0, 1] as const) {
        // longestLife[p] is only ever written by transition()'s removeOldest, which always
        // increments faded[p] in the same step — it can never be nonzero while faded[p] is 0.
        if (faded[p] === 0 && longestLife[p] !== 0) {
          throw new FadeoutDecodeError(
            `\`longestLife[${p}]\` must be 0 when \`faded[${p}]\` is 0 (no mark has ever decayed)`
          );
        }
        // A lifespan recorded at some past removal is at most that removal's ply number, which
        // is at most the CURRENT total plies played — it can only be smaller, never larger.
        if (longestLife[p] > totalPliesSoFar) {
          throw new FadeoutDecodeError(
            `\`longestLife[${p}]\` (${longestLife[p]}) cannot exceed the total plies played so far (${totalPliesSoFar})`
          );
        }
      }

      return {
        queues: [q0, q1],
        toMove: obj.toMove,
        history: historyRaw as string[],
        faded,
        longestLife,
        lastEffects: [],
      };
    },

    heuristic(state: FadeoutState, player: PlayerId): number {
      return fadeoutHeuristic(state.queues, player, resolved);
    },
  };

  return engine;
}

/**
 * positionKey — the solver's hash key AND the superko history key (plan §2.1, §3.4).
 * Deliberately excludes `history`, `faded`, `longestLife`, and `lastEffects`: those are
 * legitimately part of `encode()`'s persistence key but NOT part of what makes two positions
 * "the same" for legality/value purposes. Per platform-corrections.md C3: `encode` is NOT a
 * valid position key for this game — export this separately so nobody reaches for encode()
 * when they mean this, or vice versa.
 */
export function positionKey(state: Pick<FadeoutState, "queues" | "toMove">): string {
  return positionKeyOf(state.queues, state.toMove);
}

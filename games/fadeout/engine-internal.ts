// games/fadeout/engine-internal.ts — shared pure helpers behind games/fadeout/engine.ts,
// heuristic.ts, and probes.ts. Split out so heuristic.ts (imported ONLY by an optional bot
// policy) never needs to import the full engine.ts module (which pulls in encode/decode and
// the GameEngine wiring) just to get board geometry.
//
// WHY THIS GAME'S GRAPH IS CYCLIC (context for anyone reading this before touching F2's
// solver): marks decay off the board, so positions RECUR — the same {queues, toMove} can be
// reached again after a place/decay/place cycle. Plain minimax/negamax recursion on a cyclic
// graph does not terminate, and depth-capping it produces WRONG values, not approximate ones
// (game-theory-lens §1.1, plan §2.2). The engine itself does no search — it is a pure
// transition function — but that's the reason F2's solver is retrograde analysis / value
// iteration, never minimax, and the reason `history`/`positionKey` exist at all: without them,
// a state hashed on occupancy alone would "prove" false repetitions (plan §2.1, §11).

import type { Effect, Json, PlayerId } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export type DecayTiming = "remove-first" | "place-first";
export type Repetition = "superko" | "threefold";

export interface RulesetConfig {
  /** A1 (remove-first): the mover's own oldest mark vanishes BEFORE the new mark lands, so the
   *  cell it occupied is a legal target for that same placement. A2 (place-first): the new
   *  mark lands first; the mover's own doomed cell is occupied at placement time and (absent
   *  playThrough) not a legal target. Win-checking always happens on the fully-quiescent
   *  post-apply state (there is no separate tick lifecycle — apply() runs placement AND decay
   *  to quiescence in one transition), so the plan's "win check runs after removal" sub-rule
   *  for A2 is satisfied by construction: a momentary win-then-unwin state is never
   *  materialized, let alone observed. */
  decayTiming: DecayTiming;
  /** B2 (true): a doomed mark (oldest, owner's queue at cap) is a legal target for EITHER
   *  player — placing there displaces it immediately. B1 (false): occupied cells, doomed or
   *  not, are solid; nobody may place there (only decayTiming can make a mover's OWN doomed
   *  cell targetable, and only for that mover). */
  playThrough: boolean;
  /** C1 superko: a move whose resulting position (queues + toMove) already appears in
   *  `history` is illegal. C2 threefold: repetition is never illegal; the THIRD occurrence of
   *  the same full position (with the same player to move) is a draw. */
  repetition: Repetition;
  /** Reserved for the 4x4/cap-4 escalation (plan §4, §14 Q2) — the type exists now so that
   *  escalation reuses this engine without a shape change, per the plan's instruction. THIS
   *  ENGINE IMPLEMENTS ONLY 3x3/cap-3 TODAY: passing any value other than 3 throws in
   *  createFadeoutEngine() (games/fadeout/engine.ts) rather than silently pretending to
   *  support an untested board. */
  boardSize?: number;
  cap?: number;
}

export interface ResolvedRulesetConfig {
  decayTiming: DecayTiming;
  playThrough: boolean;
  repetition: Repetition;
  boardSize: number;
  cap: number;
}

export const DEFAULT_BOARD_SIZE = 3;
export const DEFAULT_CAP = 3;

/** All 8 win-lines for the 3x3 board (row-major indices 0..8). Generalizing to NxN is
 *  future 4x4-escalation work (plan §4); not attempted here since only boardSize 3 is
 *  supported (see RulesetConfig.boardSize's comment). */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type Queues = readonly [readonly number[], readonly number[]];

export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function occupantOf(queues: Queues, cell: number): PlayerId | null {
  if (queues[0].includes(cell)) return 0;
  if (queues[1].includes(cell)) return 1;
  return null;
}

/**
 * Safe indexing into a per-player [P0, P1] pair by a `PlayerId` (plain `number`, not a 0|1
 * literal union): `noUncheckedIndexedAccess` cannot prove a general `number` index into a
 * 2-tuple is in bounds, so a bare `pair[player]` types as `T | undefined` everywhere. These two
 * helpers are the one place that ternary lives, so every call site gets a properly-typed `T`
 * (get2) or a real mutation (set2) instead of re-deriving the same branch repeatedly.
 */
export function get2<T>(pair: readonly [T, T], player: PlayerId): T {
  return player === 0 ? pair[0] : pair[1];
}

export function set2<T>(pair: [T, T], player: PlayerId, value: T): void {
  if (player === 0) pair[0] = value;
  else pair[1] = value;
}

/** Badge/heuristic/announce()'s shared counting formula (plan §5.1): for a mark at queue
 *  index `i` (0 = oldest) with the owner's current queue length `q`, the number of the
 *  owner's own remaining placements before this mark vanishes is `i + 1 + (cap - q)`. Pinned
 *  once here so the UI badge, `announce()`, and the heuristic never drift apart (F1 only
 *  consumes this for the heuristic; F3 imports it for the badge). */
export function remainingLife(index: number, queueLength: number, cap: number): number {
  return index + 1 + (cap - queueLength);
}

function boardFromQueues(queues: Queues, boardSize: number): (PlayerId | null)[] {
  const board: (PlayerId | null)[] = new Array(boardSize * boardSize).fill(null);
  for (const cell of queues[0]) board[cell] = 0;
  for (const cell of queues[1]) board[cell] = 1;
  return board;
}

export function checkWinner(queues: Queues, boardSize: number): PlayerId | null {
  const board = boardFromQueues(queues, boardSize);
  for (const [a, b, c] of LINES) {
    const va = board[a];
    if (va !== null && va !== undefined && va === board[b] && va === board[c]) return va;
  }
  return null;
}

/** Occupancy-only legality of placing at `cell` for `mover` — does NOT consider superko
 *  (that requires simulating the resulting position; see computeLegalCells). Both
 *  decayTiming's A1 self-vacate rule and playThrough's B2 either-side rule can independently
 *  make an occupied cell targetable; they are combined with OR (a cell need only satisfy one
 *  to be legal), which is deliberate: under A1+B2 both conditions can hold for the mover's own
 *  doomed cell simultaneously and that's fine — it's still just "legal," not double-legal. */
export function cellIsTargetable(
  queues: Queues,
  cell: number,
  mover: PlayerId,
  config: ResolvedRulesetConfig
): boolean {
  const occOwner = occupantOf(queues, cell);
  if (occOwner === null) return true;

  if (config.decayTiming === "remove-first" && occOwner === mover) {
    const q = get2(queues, mover);
    if (q.length === config.cap && q[0] === cell) return true;
  }
  if (config.playThrough) {
    const q = get2(queues, occOwner);
    if (q.length === config.cap && q[0] === cell) return true;
  }
  return false;
}

export interface TransitionResult {
  queues: [number[], number[]];
  toMove: PlayerId;
  effects: Effect[];
  faded: [number, number];
  longestLife: [number, number];
}

/**
 * The ONE place placement + decay-to-quiescence is computed. Used by BOTH apply() (the real
 * transition) and computeLegalCells()'s superko lookahead (the resulting-position check) —
 * a single source of truth so legality-checking and the real transition can never diverge
 * (the likeliest bug class in a decay engine: two hand-written copies of "what happens when
 * you place here" drifting apart). Assumes `cell` already passed cellIsTargetable(); does not
 * re-validate.
 *
 * Effect/removal order:
 *  1. Displacement (playThrough only): if `cell` holds an OPPONENT's doomed mark, it is
 *     cleared first — you cannot place onto an occupied cell without first vacating it. This
 *     ordering isn't governed by decayTiming (that axis is defined purely in terms of the
 *     MOVER's own overflow); it is the plan's one genuine gap (see engine.test.ts comment
 *     and the handoff report) and this is the most defensible reading: the opponent's mark
 *     must be gone before the mover's own mark can occupy the same cell, always.
 *  2. The mover's own overflow (queue already at cap), ordered per decayTiming: remove-first
 *     pops the mover's oldest BEFORE pushing the new mark (so a mover targeting their OWN
 *     doomed cell simply ends up with their new mark there); place-first pushes first and
 *     pops after. Note a mover targeting their OWN doomed cell is never treated as a
 *     "displacement" (displacement only ever removes an OPPONENT's mark) — it's ordinary
 *     overflow, full-cap lifespan, regardless of which cell the new mark lands on.
 *
 * Lifespan bookkeeping (longestLife, "max own-placements a mark survived"): a mark evicted by
 * its OWN owner's overflow has always survived exactly `cap` of the owner's own placements
 * (FIFO of fixed size cap — provable, not measured: bornIndex = faded[owner] before removal,
 * see the derivation in the handoff report). A mark evicted early by an opponent's
 * displacement has survived exactly `cap - 1` (it dies one placement before its natural
 * cap-th). Both cases fall out of a plain queue.shift() with no per-mark birth-tick field
 * needed, matching the plan's queues: number[] shape exactly (no separate age array to drift).
 */
export function transition(
  queues: Queues,
  mover: PlayerId,
  cell: number,
  faded: readonly [number, number],
  longestLife: readonly [number, number],
  config: ResolvedRulesetConfig
): TransitionResult {
  const opponent = opponentOf(mover);
  const nextQueues: [number[], number[]] = [queues[0].slice(), queues[1].slice()];
  const nextFaded: [number, number] = [faded[0], faded[1]];
  const nextLongestLife: [number, number] = [longestLife[0], longestLife[1]];
  const effects: Effect[] = [];

  function removeOldest(owner: PlayerId, lifespan: number): void {
    const removedCell = get2(nextQueues, owner).shift();
    if (removedCell === undefined) {
      throw new Error(`fadeout engine: transition() tried to evict from player ${owner}'s empty queue`);
    }
    set2(nextFaded, owner, get2(nextFaded, owner) + 1);
    if (lifespan > get2(nextLongestLife, owner)) set2(nextLongestLife, owner, lifespan);
    effects.push({ type: "decayed", player: owner, cell: removedCell });
  }

  if (config.playThrough) {
    const oppQ = get2(nextQueues, opponent);
    if (oppQ.length === config.cap && oppQ[0] === cell) {
      removeOldest(opponent, config.cap - 1);
    }
  }

  const willOverflow = get2(nextQueues, mover).length === config.cap;
  const place = (): void => {
    get2(nextQueues, mover).push(cell);
    effects.push({ type: "placed", player: mover, cell });
  };
  const overflow = (): void => {
    if (willOverflow) removeOldest(mover, config.cap);
  };

  if (config.decayTiming === "remove-first") {
    overflow();
    place();
  } else {
    place();
    overflow();
  }

  return { queues: nextQueues, toMove: opponent, effects, faded: nextFaded, longestLife: nextLongestLife };
}

/**
 * positionKey — occupancy + age-ordering + side to move, and NOTHING else. This is deliberately
 * NOT the same thing as encode(): superko legality is path-dependent (which moves are legal
 * depends on which positions this game has visited), so `history` legitimately lives in state,
 * and `encode` (which includes history, faded, longestLife) is NOT a valid deduplication key —
 * two states with identical queues/toMove but different histories are the SAME position for
 * game-theoretic purposes (same legal moves, same winner) but hash differently under encode().
 * `positionKey` is the solver's hash key and the superko history key; `encode` is the
 * persistence/replay key. Conflating them is exactly the bug platform-corrections.md's C3
 * documents. See games/fadeout/engine.ts's encode()/positionKey() pair for the enforced split.
 */
export function positionKeyOf(queues: Queues, toMove: PlayerId): string {
  return stableStringify({
    queues: [queues[0] as unknown as Json[], queues[1] as unknown as Json[]],
    toMove,
  });
}

/** Occupancy-legal AND (under superko) not-a-repeat cells for `player`. Pure; does not itself
 *  consult status() — status() calls THIS, never the other way around, so the two never
 *  mutually recurse (a real risk in a game where "is there a legal move" is itself part of
 *  the win condition, per §3.3). */
export function computeLegalCells(
  queues: Queues,
  toMove: PlayerId,
  history: readonly string[],
  faded: readonly [number, number],
  longestLife: readonly [number, number],
  player: PlayerId,
  config: ResolvedRulesetConfig
): number[] {
  const totalCells = config.boardSize * config.boardSize;
  const out: number[] = [];
  for (let cell = 0; cell < totalCells; cell++) {
    if (!cellIsTargetable(queues, cell, player, config)) continue;
    if (config.repetition === "superko") {
      const result = transition(queues, player, cell, faded, longestLife, config);
      const keyAfter = positionKeyOf(result.queues, result.toMove);
      if (history.includes(keyAfter)) continue;
    }
    out.push(cell);
  }
  return out;
}

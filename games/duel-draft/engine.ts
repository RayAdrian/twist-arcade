// games/duel-draft/engine.ts — Duel Draft engine (docs/plans/duel-draft.md §1, §2.1, §3).
//
// Rule sentence (canonical, plan header, 77 chars): "Pick cells at the same time — pick the
// same one and it's destroyed for good."
//
// THE GAME: no turns at all. Every round both players secretly pick an empty cell; picks
// resolve together in one apply(). Distinct picks -> both marks placed. The SAME pick ->
// nothing placed, the cell is destroyed, permanently unusable by anyone. First 4-in-a-row of
// one's own marks wins; a line containing a destroyed cell can never be completed by anyone
// (plan §1.2: this falls out of "4 of YOUR OWN marks" — never coded as a separate rule). 4x4
// board, 16 cells, 10 win-windows (4 rows + 4 cols + 2 main diagonals).
//
// SIMPLER THAN BID-TAC-TOE: there is no phase field and no alternating bid/place structure at
// all. `active()` is unconditionally `{ mode: "simultaneous", players: [0, 1] }` — every
// non-terminal state is a joint-pick round, full stop (plan §1.1).
//
// ADJUDICATION ORDER (plan §1.3): exactly one player completes a line -> that player wins,
// EVEN THOUGH the opponent's simultaneous placement also stands elsewhere on the board. BOTH
// complete a line in the same round -> draw (the Tilt C45 precedent: neither player caused it
// more than the resolution did — orchestrator ruling, plan §15.3). No empty cell and no line
// -> draw (exhausted).
//
// TERMINATION IS STRUCTURAL (plan §1.5): every round either places 2 marks or destroys 1 cell
// — either way strictly >=1 of the 16 cells leaves the empty pool, and nothing ever restores
// one. So every game is <=16 rounds and the state graph is a DAG; the 200-ply cap this
// package's contract suite uses is unreachable by construction. Any cap hit is an ENGINE BUG,
// never a game outcome — engine.test.ts asserts zero.
//
// PENDING PICKS NEVER LIVE IN ENGINE STATE (plan §4, the same ruling shape as Bid-Tac-Toe's
// sealed bids): sealed-pick collection is a TRANSPORT concern owned by whoever assembles the
// `moves` map handed to `apply()` — this engine only ever sees a round once BOTH seats'
// picks already exist. `S` structurally has no field a pending pick could occupy, which is
// what makes T-SIM-4 (engine.test.ts) true by construction rather than by discipline.
//
// WIN_LENGTH is a plain module constant (not engine config — GameEngine#setup takes no config
// parameter), exactly matching bid-tac-toe's STARTING_BUDGET convention. Shipped at 4 per D0
// (docs/research/games/duel-draft-d0-report.md): neither kill-rule tail fired at winLength=4,
// so the plan's single remedy lever (winLength: 3) was never spent. Changing this later is a
// one-line edit here plus a version bump (GameMeta.version: "bump on ANY rules change").
export const SIZE = 4;
export const WIN_LENGTH = 4;

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { heuristic } from "./heuristic";

/** 0 or 1 — every seat-typed field in this engine's state is one of these two values. */
export type Seat = 0 | 1;

/** A cell is empty, held by a seat's mark, or permanently destroyed by a collision. */
export type Cell = "empty" | Seat | "destroyed";

export interface DuelDraftState extends WithEffects {
  /** length 16, row-major (idx = row*SIZE + col). */
  readonly board: readonly Cell[];
  readonly lastEffects: readonly Effect[];
}

// Explicit `[key: string]: Json` index signature — CHECKLIST.md's first trap: a plain
// interface used as the engine's `M` generic needs one written by hand, TypeScript will not
// synthesize it.
export interface DuelDraftMove {
  /** 0..15, must be an empty cell on the PRE-resolution board (plan §1.1). */
  readonly cell: number;
  readonly [key: string]: Json;
}

const NUM_PLAYERS = 2;

// The 10 win-windows at WIN_LENGTH=4 on a 4x4 board: 4 rows, 4 columns, 2 main diagonals.
// Every other diagonal is shorter than 4 cells and so can never hold a win at this board size
// (D0's self-test pencil-check pinned this exact count: scripts/research/duel-draft-d0.ts's
// `buildWindows` measured 10 at winLength=4 and 24 at winLength=3 — both asserted, not
// eyeballed). Hardcoded here rather than re-deriving the general line-builder: this engine
// never needs any window shorter than WIN_LENGTH, so the general "maximal line, then slide a
// window across it" machinery D0 used to ALSO cheaply support the winLength=3 remedy lever
// buys nothing here that a literal array doesn't already give more legibly.
export const WINDOWS: readonly (readonly number[])[] = [
  // rows
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [8, 9, 10, 11],
  [12, 13, 14, 15],
  // columns
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  // diagonals
  [0, 5, 10, 15],
  [3, 6, 9, 12],
];

if (WINDOWS.length !== 10) {
  // Defensive, cheap, runs once at module load — the same pencil-check D0's self-test pinned
  // as a real assertion rather than an eyeballed comment (docs/research/games/
  // duel-draft-d0-report.md's "Self-test discipline"). A future edit that silently drops or
  // duplicates a window is caught immediately, not by a downstream gate number quietly moving.
  throw new Error(`duel-draft: WINDOWS must have exactly 10 entries at WIN_LENGTH=4, got ${WINDOWS.length}`);
}

/** True iff `window` holds no opposing mark and no destroyed cell for `player` — plan §7.3's
 *  own definition, verbatim: "a window is live for a player if it holds no opposing mark and
 *  no destroyed cell". A destroyed cell kills a line for BOTH players (this function returns
 *  false for either `player` value once a `window` contains one), which is exactly the
 *  emergent "line through a destroyed cell never scores" rule — never a separate check. */
export function isLiveFor(board: readonly Cell[], window: readonly number[], player: Seat): boolean {
  const opponent: Seat = player === 0 ? 1 : 0;
  return !window.some((i) => board[i] === opponent || board[i] === "destroyed");
}

/** Count of `player`'s own marks already on `window`. */
export function progressFor(board: readonly Cell[], window: readonly number[], player: Seat): number {
  return window.filter((i) => board[i] === player).length;
}

/** Every seat with a completed WIN_LENGTH-in-a-row on `board`. Can legitimately hold BOTH
 *  seats at once — the double-win draw terminal (plan §1.3) is reachable, unlike Bid-Tac-Toe's
 *  analogous helper (which treats size>1 as a forged/impossible input, because that engine's
 *  own apply() can only ever complete one line per step). Duel Draft's apply() places TWO
 *  marks in the same step on a distinct-picks round, so both players completing a line in the
 *  SAME round is a real, reachable terminal — decode() below deliberately does NOT reject it
 *  (the opposite ruling from Nine Grids' C28-A3, and the SAME shape as Tilt's, per the plan's
 *  own §1's "note this is the same shape as Tilt's ruling and the opposite of Nine Grids'"). */
function winningSeats(board: readonly Cell[]): Set<Seat> {
  const winners = new Set<Seat>();
  for (const w of WINDOWS) {
    if (w.every((i) => board[i] === 0)) winners.add(0);
    if (w.every((i) => board[i] === 1)) winners.add(1);
  }
  return winners;
}

// A standalone function, not called via `this` — every method below is called as a bare
// reference in places (bots, the harness, the shell), never guaranteed to be invoked with
// `duelDraft` as its receiver.
function computeStatus(state: DuelDraftState): Status {
  const winners = winningSeats(state.board);
  // Adjudication order (plan §1.3): exactly one winner -> that seat wins, even though the
  // opponent's simultaneous placement also stands. BOTH -> draw (the double-win terminal).
  if (winners.size === 2) return { kind: "draw" };
  if (winners.size === 1) {
    const winner = Array.from(winners)[0]!;
    return { kind: "won", winner };
  }
  if (state.board.every((c) => c !== "empty")) return { kind: "draw" }; // exhausted, no line
  return { kind: "ongoing" };
}

export class DuelDraftApplyError extends Error {
  constructor(detail: string) {
    super(`duel-draft engine: apply() contract violation: ${detail}`);
    this.name = "DuelDraftApplyError";
  }
}

export class DuelDraftDecodeError extends Error {
  constructor(detail: string) {
    super(`duel-draft engine: decode() received a malformed encoding: ${detail}`);
    this.name = "DuelDraftDecodeError";
  }
}

function isCell(x: unknown): x is Cell {
  return x === "empty" || x === 0 || x === 1 || x === "destroyed";
}

export const duelDraft: GameEngine<DuelDraftState, DuelDraftMove, DuelDraftState> = {
  meta: {
    id: "duel-draft",
    name: "Duel Draft",
    minPlayers: NUM_PLAYERS,
    maxPlayers: NUM_PLAYERS,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): DuelDraftState {
    return {
      board: Array.from({ length: SIZE * SIZE }, () => "empty" as Cell),
      lastEffects: [],
    };
  },

  legalMoves(state: DuelDraftState, _player: PlayerId): DuelDraftMove[] {
    if (computeStatus(state).kind !== "ongoing") return [];
    const moves: DuelDraftMove[] = [];
    state.board.forEach((cell, i) => {
      if (cell === "empty") moves.push({ cell: i });
    });
    return moves;
  },

  isLegal(state: DuelDraftState, _player: PlayerId, move: DuelDraftMove): boolean {
    if (computeStatus(state).kind !== "ongoing") return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= SIZE * SIZE) return false;
    return state.board[move.cell] === "empty";
  },

  active(_state: DuelDraftState): ActiveSpec {
    // Unconditional (plan §1.1): every non-terminal state is a joint-pick round, no phase
    // field, no exception — the simplest simultaneous engine possible.
    return { mode: "simultaneous", players: [0, 1] };
  },

  apply(
    state: DuelDraftState,
    moves: ReadonlyMap<PlayerId, DuelDraftMove>,
    _rng: Rng
  ): DuelDraftState {
    if (computeStatus(state).kind !== "ongoing") {
      throw new DuelDraftApplyError("apply() called on a terminal state");
    }
    // A round requires EXACTLY both seats' moves — a missing seat, extra actor, or illegal
    // cell throws a typed error, never a silent default (plan §3).
    if (moves.size !== 2) {
      throw new DuelDraftApplyError(`round requires exactly 2 moves (one per seat), got ${moves.size}`);
    }
    const m0 = moves.get(0);
    const m1 = moves.get(1);
    if (!m0 || !m1) {
      throw new DuelDraftApplyError("round missing a move for seat 0 or seat 1");
    }
    // Both picks are validated against the SAME pre-resolution `state` — legality is "this
    // cell was empty before this round," not "empty after the other seat's pick", which is
    // exactly what makes a shared pick a collision rather than a race.
    if (!duelDraft.isLegal(state, 0, m0)) {
      throw new DuelDraftApplyError(`illegal pick from seat 0: ${stableStringify(m0)}`);
    }
    if (!duelDraft.isLegal(state, 1, m1)) {
      throw new DuelDraftApplyError(`illegal pick from seat 1: ${stableStringify(m1)}`);
    }

    const board = state.board.slice();
    let effects: Effect[];
    if (m0.cell === m1.cell) {
      // Same pick: nothing placed, the cell is destroyed for good (plan §1.2).
      board[m0.cell] = "destroyed";
      effects = [{ type: "collided", cell: m0.cell }];
    } else {
      // Distinct picks: both marks placed in this one apply(). Effect order is the animation
      // spec and is pinned: seat 0 first (plan §3), regardless of numeric cell order.
      board[m0.cell] = 0;
      board[m1.cell] = 1;
      effects = [
        { type: "placed", player: 0, cell: m0.cell },
        { type: "placed", player: 1, cell: m1.cell },
      ];
    }
    return { board, lastEffects: effects };
  },

  status: computeStatus,

  playerView(state: DuelDraftState, _player: PlayerId | null): DuelDraftState {
    // No persistent hidden information (plan §4): the only secret is a committed-but-
    // unresolved pick, and that is a transport concern that never enters `S` in the first
    // place (see this file's module doc). Identity for every seat AND the spectator.
    return state;
  },

  encode(state: DuelDraftState): string {
    // EXCLUDES lastEffects (plan §3 / CHECKLIST.md's second trap). Canonical board only —
    // rounds played, mover, and every other candidate field are all derivable from the board
    // itself (plan §2.1: count(p0)===count(p1) is invariant, there is no mover to track, and
    // legality depends only on occupancy), so `encode` is a sound position key, CONDITIONAL on
    // no path-dependent field ever being added to state (plan §2.1's own binding condition —
    // collision counts / share statistics belong in the presentation layer, derived from the
    // ReplayRecord, never in S).
    return stableStringify({ board: state.board as unknown as (number | string)[] });
  },

  decode(encoded: string): DuelDraftState {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      throw new DuelDraftDecodeError(`invalid JSON: ${encoded}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new DuelDraftDecodeError(`top-level value is not an object: ${encoded}`);
    }
    const obj = parsed as Record<string, unknown>;

    const rawBoard = obj.board;
    if (!Array.isArray(rawBoard) || rawBoard.length !== SIZE * SIZE || !rawBoard.every(isCell)) {
      throw new DuelDraftDecodeError(
        `board must be a length-${SIZE * SIZE} array of "empty"|0|1|"destroyed", got ${JSON.stringify(rawBoard)}`
      );
    }
    const board = rawBoard as Cell[];

    // Equal-counts invariant (plan §2.1 / §12 acceptance criterion 8): every round either
    // places exactly one mark for EACH seat, or places none at all — count(p0) and count(p1)
    // can therefore never diverge on any state this engine's own apply() could have produced.
    // A decode() that accepted an unequal-count board would validate a forged replay/leaderboard
    // submission (C4's whole reason for existing).
    const p0Count = board.filter((c) => c === 0).length;
    const p1Count = board.filter((c) => c === 1).length;
    if (p0Count !== p1Count) {
      throw new DuelDraftDecodeError(
        `mark-count invariant violated: count(p0)=${p0Count} !== count(p1)=${p1Count} — every ` +
          "round places one mark for each seat, or destroys one cell; counts must stay equal"
      );
    }

    // Deliberately NOT rejected: a board with completed WIN_LENGTH-in-a-row lines for BOTH
    // seats. Unlike Bid-Tac-Toe's decode() (which correctly rejects that shape as structurally
    // impossible — its apply() can complete at most one line per step), this engine's apply()
    // places TWO marks in a single distinct-picks step, so both seats completing a line in the
    // SAME round is a real, reachable terminal: the double-win draw (plan §1.3). Rejecting it
    // here would make decode() refuse a genuinely reachable state — precisely the failure mode
    // C4 exists to prevent, just pointed the other direction from Nine Grids' C28-A3 ruling.

    return { board, lastEffects: [] };
  },

  heuristic,
};

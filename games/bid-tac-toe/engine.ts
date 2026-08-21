// games/bid-tac-toe/engine.ts — Bid-Tac-Toe engine (docs/plans/bid-tac-toe.md §1/§3, ruled
// Variant R by the orchestrator — platform-corrections.md C31 / plan §14.1).
//
// Rule sentence (canonical, plan header, 63 chars): "No turns — bid chips each round; the
// higher bid pays and plays."
//
// THE GAME: no fixed turns. Each round both players submit a sealed integer chip bid
// (optionally including the tie-break "star", legal only for its current holder). The higher
// bid wins the auction, pays its own amount to the OTHER player (classic Richman: winner pays
// loser, never the bank), and enters the place phase to mark one empty cell. First 3-in-a-row
// wins; a full board with no line is a draw.
//
// VARIANT R, not the brief's original hidden-information framing (plan §0 / §14.1 ruling):
// under winner-pays-loser every chip transfer equals a bid both players already know, so
// budgets are always public/derivable — `hiddenInformation: false`. The ONLY concealment is
// the sealed bid WITHIN the current round, which is simultaneity (`simultaneous: true`), not
// hidden state. Consequently `playerView` is the identity for every seat AND the spectator
// (plan §4.1) — there is nothing to redact — and pending bids never enter `S` at all (see
// below).
//
// PENDING BIDS NEVER LIVE IN ENGINE STATE (plan §3.1's core simultaneous-turn mapping). Sealed-
// bid collection is a TRANSPORT concern owned by whoever assembles the `moves` map handed to
// `apply()` — this engine only ever sees a bid step once BOTH seats' moves already exist. That
// is what makes T-SIM-4 (the bot host's request for a bid step carries no data derived from
// the human's pending bid) true by construction rather than by discipline: `encodedState` is
// built from `S`, and `S` structurally has no field a pending bid could occupy.
//
// STARTING_BUDGET is a plain module constant, not engine config (GameEngine#setup takes no
// config parameter). Plan §1: "Budget size is decided by the solve, not by taste" — B2's exact
// solve (docs/research/games/bid-tac-toe-solve-report.md) swept {8, 12, 16, 20}: every one is a
// PURE, PROVEN, EXACT draw with ZERO star-holder advantage, so the exact-solve axes alone don't
// prefer one. B=8's bid branching (9-18) sits inside the plan's own 4-30 design-gate band more
// comfortably than 16's (17-34, which touches the edge) and costs ~3.6x less to gate — the
// orchestrator ruled B=8 the working candidate into B3 (platform-corrections.md C51). Changing
// this later is a one-line edit here (and a version bump per the engine contract's own rule:
// "version: number; bump on ANY rules change").
export const STARTING_BUDGET = 8;

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { heuristic } from "./heuristic";

/** 0 or 1 — every seat-typed field in this engine's state is one of these two values. */
export type Seat = 0 | 1;

export interface BidTacToeState extends WithEffects {
  /** length 9, row-major. Seat 0/1 own a cell once placed; null = empty. */
  readonly board: readonly (Seat | null)[];
  /** PUBLIC under Variant R — see this file's module doc. budgets[0]+budgets[1] is a Richman
   *  conservation invariant: always exactly 2 * STARTING_BUDGET (property-tested). */
  readonly budgets: readonly [number, number];
  /** Current star holder. Setup: seat 1 (plan §2 — "seat 1 holds the star initially"; H1
   *  measures seat 0, the NON-holder, against a predicted 48%). */
  readonly star: Seat;
  /** "bid": both seats submit a sealed bid next (active() -> simultaneous). "place": the most
   *  recent auction's winner places next (active() -> sequential). Never any other phase. */
  readonly phase: { readonly kind: "bid" } | { readonly kind: "place"; readonly winner: Seat };
  readonly lastEffects: readonly Effect[];
}

// Explicit `[key: string]: Json` index signatures — CHECKLIST.md's first trap: a plain
// interface used as the engine's `M` generic needs one written by hand, TypeScript will not
// synthesize it.
export interface BidTacToeBidMove {
  readonly kind: "bid";
  /** Integer, 0 <= amount <= the bidder's own current budget. 0 is always legal (plan §1:
   *  "zero budget is not elimination"). */
  readonly amount: number;
  /** The tie-break star. Legal ONLY when `kind === "bid"` and the bidder currently holds
   *  `state.star` — never present otherwise. Omitted (not `false`) when not played. */
  readonly star?: true;
  readonly [key: string]: Json;
}

export interface BidTacToePlaceMove {
  readonly kind: "place";
  /** 0..8, must be an empty cell. Legal only for `state.phase.winner` while `phase.kind ===
   *  "place"`. */
  readonly cell: number;
  readonly [key: string]: Json;
}

export type BidTacToeMove = BidTacToeBidMove | BidTacToePlaceMove;

const NUM_PLAYERS = 2;

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6], // diagonals
];

/** Every seat with a completed 3-in-a-row on `board`. A reachable state can only ever have 0
 *  or 1 members here — decode() uses this to reject a forged "two winning lines for different
 *  players" encoding (C4 / plan §3.2), a position no legal sequence of plies can reach. */
function winningSeats(board: readonly (Seat | null)[]): Set<Seat> {
  const seats = new Set<Seat>();
  for (const [a, b, c] of LINES) {
    const va = board[a];
    if (va !== null && va !== undefined && va === board[b] && va === board[c]) seats.add(va);
  }
  return seats;
}

export interface ResolvedBid {
  readonly winner: Seat;
  readonly loser: Seat;
  /** The winning bid's plain integer amount — what actually changes hands. Never the star's
   *  tie-break bump, which carries no monetary value. */
  readonly payment: number;
  /** True iff the star's holder played it AND it broke a tie that would otherwise have gone
   *  the other way — the ONLY condition under which the star transfers (plan §3.2). */
  readonly starDecisive: boolean;
}

/**
 * Pure bid-resolution arithmetic (plan §1 / §3.2), factored out of apply() so B2's solve script
 * can reuse this exact, already-tested logic for its own successor precompute rather than
 * risking an independently reimplemented copy drifting from it. Does NOT validate legality —
 * callers (apply(), the solver) are responsible for only ever calling this with legal bids.
 *
 * Ties are the common case, not an edge case: the star rule resolves EVERY tie
 * deterministically — star included by its holder wins (decisive); star withheld hands the tie
 * to the NON-holder (never decisive, holder keeps the star). No coin flips, no rng.
 */
export function resolveBid(
  star: Seat,
  m0: Pick<BidTacToeBidMove, "amount" | "star">,
  m1: Pick<BidTacToeBidMove, "amount" | "star">
): ResolvedBid {
  let winner: Seat;
  let starDecisive = false;
  if (m0.amount !== m1.amount) {
    winner = m0.amount > m1.amount ? 0 : 1;
  } else {
    const holder = star;
    const holderMove = holder === 0 ? m0 : m1;
    if (holderMove.star === true) {
      winner = holder;
      starDecisive = true;
    } else {
      winner = holder === 0 ? 1 : 0;
    }
  }
  const loser: Seat = winner === 0 ? 1 : 0;
  const payment = winner === 0 ? m0.amount : m1.amount;
  return { winner, loser, payment, starDecisive };
}

// A standalone function, not called via `this` (see every other fixture/game in this repo —
// engine methods are called as bare references by bots/harness/shell, never guaranteed to be
// invoked with `bidTacToe` as the receiver).
function computeStatus(state: BidTacToeState): Status {
  const winners = winningSeats(state.board);
  if (winners.size === 1) {
    const winner = Array.from(winners)[0]!;
    return { kind: "won", winner };
  }
  // winners.size > 1 cannot happen on any state this engine itself produced (apply() only
  // ever adds ONE mark per step, so at most one line completes per transition) — decode()
  // is what rejects a FORGED encoding claiming otherwise; computeStatus itself doesn't need
  // to re-guard it here (the two-winning-lines invariant is a decode()-time input-trust
  // concern, not a status() concern over an already-valid S).
  if (state.board.every((c) => c !== null)) return { kind: "draw" };
  return { kind: "ongoing" };
}

export class BidTacToeApplyError extends Error {
  constructor(detail: string) {
    super(`bid-tac-toe engine: apply() contract violation: ${detail}`);
    this.name = "BidTacToeApplyError";
  }
}

export class BidTacToeDecodeError extends Error {
  constructor(detail: string) {
    super(`bid-tac-toe engine: decode() received a malformed encoding: ${detail}`);
    this.name = "BidTacToeDecodeError";
  }
}

function isSeat(x: unknown): x is Seat {
  return x === 0 || x === 1;
}

export const bidTacToe: GameEngine<BidTacToeState, BidTacToeMove, BidTacToeState> = {
  meta: {
    id: "bid-tac-toe",
    name: "Bid-Tac-Toe",
    minPlayers: NUM_PLAYERS,
    maxPlayers: NUM_PLAYERS,
    hiddenInformation: false,
    simultaneous: true,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): BidTacToeState {
    return {
      board: Array.from({ length: 9 }, () => null),
      budgets: [STARTING_BUDGET, STARTING_BUDGET],
      star: 1, // plan §2: "seat 1 holds the star initially"
      phase: { kind: "bid" },
      lastEffects: [],
    };
  },

  legalMoves(state: BidTacToeState, player: PlayerId): BidTacToeMove[] {
    if (computeStatus(state).kind !== "ongoing") return [];
    if (state.phase.kind === "bid") {
      const budget = state.budgets[player as Seat];
      const moves: BidTacToeMove[] = [];
      for (let amount = 0; amount <= budget; amount++) {
        moves.push({ kind: "bid", amount });
        if (player === state.star) moves.push({ kind: "bid", amount, star: true });
      }
      return moves;
    }
    if (player !== state.phase.winner) return [];
    const moves: BidTacToeMove[] = [];
    state.board.forEach((cell, i) => {
      if (cell === null) moves.push({ kind: "place", cell: i });
    });
    return moves;
  },

  isLegal(state: BidTacToeState, player: PlayerId, move: BidTacToeMove): boolean {
    if (computeStatus(state).kind !== "ongoing") return false;
    if (state.phase.kind === "bid") {
      if (move.kind !== "bid") return false;
      if (!Number.isInteger(move.amount) || move.amount < 0) return false;
      if (move.amount > state.budgets[player as Seat]) return false;
      if ("star" in move) {
        if (move.star !== true) return false;
        if (player !== state.star) return false;
      }
      return true;
    }
    if (move.kind !== "place") return false;
    if (player !== state.phase.winner) return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) return false;
    return state.board[move.cell] === null;
  },

  active(state: BidTacToeState): ActiveSpec {
    if (state.phase.kind === "bid") return { mode: "simultaneous", players: [0, 1] };
    return { mode: "sequential", player: state.phase.winner };
  },

  apply(
    state: BidTacToeState,
    moves: ReadonlyMap<PlayerId, BidTacToeMove>,
    _rng: Rng
  ): BidTacToeState {
    if (computeStatus(state).kind !== "ongoing") {
      throw new BidTacToeApplyError("apply() called on a terminal state");
    }

    if (state.phase.kind === "bid") {
      // Plan §3.1: "A bid-step map missing either seat's move, or carrying a place move,
      // throws a typed error — never a silent default."
      if (moves.size !== 2) {
        throw new BidTacToeApplyError(
          `bid step requires exactly 2 moves (one per seat), got ${moves.size}`
        );
      }
      const m0 = moves.get(0);
      const m1 = moves.get(1);
      if (!m0 || !m1) {
        throw new BidTacToeApplyError("bid step missing a move for seat 0 or seat 1");
      }
      if (m0.kind !== "bid" || m1.kind !== "bid") {
        throw new BidTacToeApplyError(
          `bid step received a non-bid move: seat 0 kind=${m0.kind}, seat 1 kind=${m1.kind}`
        );
      }
      if (!bidTacToe.isLegal(state, 0, m0)) {
        throw new BidTacToeApplyError(`illegal bid from seat 0: ${stableStringify(m0)}`);
      }
      if (!bidTacToe.isLegal(state, 1, m1)) {
        throw new BidTacToeApplyError(`illegal bid from seat 1: ${stableStringify(m1)}`);
      }

      // Resolution (plan §1 / §3.2) — see resolveBid()'s own doc for the full tie-table
      // reasoning. Factored out to a standalone exported function (rather than left inline, as
      // it was through B1) so B2's solve script reuses this EXACT trusted arithmetic for its
      // O(budget) distinct-successor precompute, instead of an independently reimplemented
      // (and therefore divergence-prone) copy — the same DRY reasoning C3/Fadeout's raw-engine
      // split follows, just at a smaller grain.
      const resolved = resolveBid(state.star, m0, m1);
      const budgets: [number, number] = [state.budgets[0], state.budgets[1]];
      budgets[resolved.winner] -= resolved.payment;
      budgets[resolved.loser] += resolved.payment;
      const star: Seat = resolved.starDecisive ? resolved.loser : state.star;

      const effects: Effect[] = [
        {
          type: "bid-resolved",
          winner: resolved.winner,
          amount0: m0.amount,
          amount1: m1.amount,
          starPlayed: holderStarPlayed(state, m0, m1),
          starDecisive: resolved.starDecisive,
          paymentAmount: resolved.payment,
        },
      ];
      return {
        board: state.board,
        budgets,
        star,
        phase: { kind: "place", winner: resolved.winner },
        lastEffects: effects,
      };
    }

    // Place phase.
    const winner = state.phase.winner;
    if (moves.size !== 1) {
      throw new BidTacToeApplyError(`place step requires exactly 1 move, got ${moves.size}`);
    }
    const move = moves.get(winner);
    if (!move) {
      throw new BidTacToeApplyError(`place step missing the move for seat ${winner}`);
    }
    if (move.kind !== "place") {
      throw new BidTacToeApplyError(`place step received a non-place move: kind=${move.kind}`);
    }
    if (!bidTacToe.isLegal(state, winner, move)) {
      throw new BidTacToeApplyError(`illegal placement: ${stableStringify(move)}`);
    }
    const board = state.board.slice();
    board[move.cell] = winner;
    const effects: Effect[] = [{ type: "placed", cell: move.cell, player: winner }];
    return {
      board,
      budgets: state.budgets,
      star: state.star,
      phase: { kind: "bid" },
      lastEffects: effects,
    };
  },

  status: computeStatus,

  playerView(state: BidTacToeState, _player: PlayerId | null): BidTacToeState {
    // Variant R: identity for every seat AND the spectator (module doc above / plan §4.1).
    // Nothing to hide — the sealed bid never enters `state` in the first place.
    return state;
  },

  encode(state: BidTacToeState): string {
    // EXCLUDES lastEffects (plan §3.2 / CHECKLIST.md's second trap).
    return stableStringify({
      board: state.board as unknown as (number | null)[],
      budgets: state.budgets as unknown as number[],
      star: state.star,
      phase: state.phase as unknown as Json,
    });
  },

  decode(encoded: string): BidTacToeState {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      throw new BidTacToeDecodeError(`invalid JSON: ${encoded}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new BidTacToeDecodeError(`top-level value is not an object: ${encoded}`);
    }
    const obj = parsed as Record<string, unknown>;

    const rawBoard = obj.board;
    if (
      !Array.isArray(rawBoard) ||
      rawBoard.length !== 9 ||
      !rawBoard.every((c) => c === null || c === 0 || c === 1)
    ) {
      throw new BidTacToeDecodeError(
        `board must be a length-9 array of 0|1|null, got ${JSON.stringify(rawBoard)}`
      );
    }
    const board = rawBoard as (Seat | null)[];

    const rawBudgets = obj.budgets;
    if (
      !Array.isArray(rawBudgets) ||
      rawBudgets.length !== 2 ||
      !rawBudgets.every((b) => Number.isInteger(b) && (b as number) >= 0)
    ) {
      throw new BidTacToeDecodeError(
        `budgets must be a length-2 array of non-negative integers, got ${JSON.stringify(rawBudgets)}`
      );
    }
    const [b0, b1] = rawBudgets as [number, number];
    // Richman conservation (plan §3.2's decode contract; the same invariant the property test
    // asserts after every live apply()).
    if (b0 + b1 !== 2 * STARTING_BUDGET) {
      throw new BidTacToeDecodeError(
        `chip-total invariant violated: budgets[0]+budgets[1] = ${b0}+${b1} = ${b0 + b1}, ` +
          `expected 2*STARTING_BUDGET = ${2 * STARTING_BUDGET} (Richman conservation)`
      );
    }

    if (!isSeat(obj.star)) {
      throw new BidTacToeDecodeError(`star must be 0 or 1, got ${JSON.stringify(obj.star)}`);
    }
    const star = obj.star;

    const rawPhase = obj.phase;
    if (typeof rawPhase !== "object" || rawPhase === null || Array.isArray(rawPhase)) {
      throw new BidTacToeDecodeError(`phase must be an object, got ${JSON.stringify(rawPhase)}`);
    }
    const phaseObj = rawPhase as Record<string, unknown>;
    let phase: BidTacToeState["phase"];
    if (phaseObj.kind === "bid") {
      phase = { kind: "bid" };
    } else if (phaseObj.kind === "place") {
      if (!isSeat(phaseObj.winner)) {
        throw new BidTacToeDecodeError(
          `place-phase winner inconsistent: winner must be 0 or 1, got ${JSON.stringify(phaseObj.winner)}`
        );
      }
      // A full board can never have a pending placement — the placement that filled the last
      // cell always resets phase back to "bid" (apply()'s own place-phase branch, above). A
      // "place" phase over a full board is therefore structurally impossible, not merely
      // unlikely (C4: "a position no legal sequence can reach fails [the invariant] test").
      if (!board.some((c) => c === null)) {
        throw new BidTacToeDecodeError(
          "place-phase winner inconsistent: board is full — a full board can never have a pending placement"
        );
      }
      phase = { kind: "place", winner: phaseObj.winner };
    } else {
      throw new BidTacToeDecodeError(
        `phase.kind must be "bid" or "place", got ${JSON.stringify(phaseObj.kind)}`
      );
    }

    // Structurally impossible board: two winning lines for different players (C4 / plan
    // §3.2 / the C28-A3 precedent — apply() only ever completes at most one line per step, so
    // no legal trajectory can ever reach this).
    const winners = winningSeats(board);
    if (winners.size > 1) {
      throw new BidTacToeDecodeError(
        `board has winning lines for both players — impossible position: ${JSON.stringify(board)}`
      );
    }

    return { board, budgets: [b0, b1], star, phase, lastEffects: [] };
  },

  heuristic,
};

/** Effect-payload helper: which seat(s), if any, actually played the star this bid step —
 *  purely descriptive (shell/replay diagnostics), never consulted by apply()'s own resolution
 *  logic above (which reads `holderMove.star` directly). Kept as a small pure function rather
 *  than inlined so the `lastEffects` payload construction above stays readable. */
function holderStarPlayed(state: BidTacToeState, m0: BidTacToeBidMove, m1: BidTacToeBidMove): boolean {
  const holderMove = state.star === 0 ? m0 : m1;
  return holderMove.star === true;
}

// games/fadeout/solver/oracle.ts — an independent, brute-force, NO-memoization exact solver
// used purely as ground truth to cross-check the composed pass-1/pass-2 solver (raw-engine.ts,
// pass2.ts) on small, hand-built positions (plan §2.4's TDD anchors; CLAUDE.md's standing
// warning to cross-check every solver result rather than trust a single code path).
//
// Deliberately dumb: it calls ONLY the real public engine contract (active/legalMoves/apply/
// status via createFadeoutEngine) — the exact same surface the shell/harness/replayer use —
// never engine-internal.ts's pure helpers, which raw-engine.ts and pass2.ts both import. A bug
// shared between engine-internal.ts and those two files would therefore NOT be silently
// mirrored here.
//
// Why no history-set bookkeeping is needed here (unlike pass2.ts): the real engine's `state`
// ALREADY includes `history`, and legalMoves()/status() already fully enforce superko/threefold
// from it. Plain recursive three-valued minimax over the real engine therefore terminates
// correctly with zero extra machinery: under superko, each recursive step's legal-move set can
// only shrink (positions can never repeat), so the recursion is well-founded; under threefold,
// the 3rd repeat is itself a real terminal (`status.kind === "draw"`). Memoization is
// intentionally omitted — this file trades performance for maximum auditability, and is used
// only on small, hand-built or near-endgame positions, never the full ~1.4x10^5-state root
// (that scale is what raw-engine.ts + pass2.ts are for).

import type { GameEngine, PlayerId, Rng } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import type { FadeoutMove, FadeoutState } from "../engine";

export type OracleValue = "win" | "loss" | "draw";

export interface OracleOptions {
  /** Safety valve against a runaway/mis-constructed fixture — NOT a correctness mechanism (the
   *  anchors this file is used on all terminate in well under this many plies). Exceeding it
   *  throws rather than silently truncating the search into a wrong answer. */
  maxPlies?: number;
}

export class OracleDepthExceededError extends Error {
  constructor(maxPlies: number) {
    super(
      `oracle: exceeded maxPlies=${maxPlies} without reaching a terminal — fixture is not as ` +
        "small as assumed, or a real non-termination bug exists."
    );
    this.name = "OracleDepthExceededError";
  }
}

function inertRng(): Rng {
  return rngFromSeed("fadeout:solver:oracle:inert");
}

function flip(v: OracleValue): OracleValue {
  return v === "win" ? "loss" : v === "loss" ? "win" : "draw";
}

/**
 * Mover-relative exact value of `state` (for whichever player is `active()` there), by plain
 * recursive three-valued minimax over the REAL engine. `state` must be ongoing — evaluating an
 * already-terminal state is a caller bug (there is no mover to be relative to), so this throws
 * rather than guessing what the caller meant.
 */
export function oracleValue(
  engine: GameEngine<FadeoutState, FadeoutMove, FadeoutState>,
  state: FadeoutState,
  opts: OracleOptions = {}
): OracleValue {
  const maxPlies = opts.maxPlies ?? 60;

  if (engine.status(state).kind !== "ongoing") {
    throw new Error("oracle: oracleValue() requires an ongoing (non-terminal) state");
  }

  function go(s: FadeoutState, pliesUsed: number): OracleValue {
    if (pliesUsed > maxPlies) throw new OracleDepthExceededError(maxPlies);

    const active = engine.active(s);
    if (active.mode !== "sequential") {
      throw new Error("oracle: fadeout is always sequential — active() returned otherwise");
    }
    const mover: PlayerId = active.player;
    const legal = engine.legalMoves(s, mover);
    if (legal.length === 0) {
      // Engine contract (plan §3.3): a 2P engine with zero legal moves while ongoing is a
      // contract violation — it must have already resolved to {kind:"won", winner: opponent}.
      throw new Error("oracle: ongoing state with zero legal moves violates the engine contract");
    }

    // MOVE ORDERING, deliberately added after this exact fixture demonstrated why it's needed
    // (see this file's git history / the raw-engine.test.ts fork anchor): this game's graph is
    // cyclic (engine-internal.ts's module doc), and once either side is at cap, a same-cell
    // "self-rotation" move is ALWAYS additionally legal and NEVER an immediate terminal — so
    // plain ascending-cell-order recursion can dive into an unbounded rotation/superko-escape
    // subtree before ever trying a cell that wins outright THIS ply, exactly the
    // "plain minimax loops/over-recurses on a cyclic graph" trap the plan warns about (§2.2).
    // Ordering does NOT change correctness (every branch is still visited when needed to prove
    // a LOSS) — it only changes how fast a WIN is found, which is exactly the cost that matters
    // here. Immediate terminals (win, loss, draw one ply away) are resolved with zero recursion
    // and checked first; only non-terminal replies require descending further, and only if no
    // immediate win was already found.
    const evaluated = legal.map((move) => {
      const next = engine.apply(s, new Map([[mover, move]]), inertRng());
      return { next, status: engine.status(next) };
    });
    const immediate = evaluated.filter((e) => e.status.kind !== "ongoing");
    const pending = evaluated.filter((e) => e.status.kind === "ongoing");

    let sawDraw = false;
    for (const { status } of immediate) {
      if (status.kind === "won") {
        if (status.winner === mover) return "win"; // early exit
        sawDraw = false; // a loss doesn't set sawDraw; explicit no-op for clarity
      } else if (status.kind === "draw") {
        sawDraw = true;
      }
    }
    for (const { next } of pending) {
      const childActive = engine.active(next);
      if (childActive.mode !== "sequential") {
        throw new Error("oracle: fadeout is always sequential — active() returned otherwise");
      }
      const childValue = go(next, pliesUsed + 1);
      const value = childActive.player === mover ? childValue : flip(childValue);
      if (value === "win") return "win"; // early exit: one winning reply is enough to prove WIN
      if (value === "draw") sawDraw = true;
    }
    return sawDraw ? "draw" : "loss";
  }

  return go(state, 0);
}

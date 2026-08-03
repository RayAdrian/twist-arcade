// games/fadeout/solver/raw-engine.ts — pass 1 of the exact solve (plan §2.3): a game-local
// "raw" GameEngine, parameterized ONLY over the two non-repetition axes (decayTiming,
// playThrough), that ignores repetition entirely — no history is ever consulted, no move is
// ever filtered as a repeat, and status() only ever resolves via checkWinner(). Reachable
// states are deduplicated on `positionKey` (queues + toMove), imported from ../engine — the
// SAME exported symbol the real engine and superko enforcement use, so the raw solver can never
// silently drift onto a different notion of "same position" (platform-corrections.md C3;
// docs/plans/fadeout.md §3.4/§14).
//
// Per §3.4/§14: "pass 1 runs with the repetition rule off, where positionKey fully determines
// the game" — this file IS that raw graph. Composed from @twist-arcade/harness's reach()/
// retrograde() building blocks via ReachOptions.keyOf, exactly the seam that option exists for
// (reach.ts's own doc comment).
//
// Why this raw graph's retrograde residue equals the C2 (threefold) value, and why WIN values
// here are safe to reuse under C1 (superko) too, is recorded in solve.ts's module doc (the
// monotonicity/repeat-free-witness argument) — this file only builds the graph and exposes
// per-position lookups; it does not itself decide what the values mean for either repetition
// rule.
//
// PERF NOTE: unlike engine.ts's legalMoves()/apply(), which pay for superko's lookahead
// simulation on every call (see that file's comment), this raw engine's legalMoves() is pure
// occupancy-only cellIsTargetable() — cheap, and exactly right for a ~1.4x10^5-node BFS.

import type { GameEngine, PlayerId, WithEffects } from "@twist-arcade/engine";
import { reach, retrograde, type ReachGraph, type RetrogradeResult } from "@twist-arcade/harness";
import type { PositionValue } from "@twist-arcade/harness";
import {
  DEFAULT_BOARD_SIZE,
  DEFAULT_CAP,
  cellIsTargetable,
  checkWinner,
  transition,
  type Queues,
  type ResolvedRulesetConfig,
} from "../engine-internal";
import { positionKey } from "../engine";

export interface RawConfig {
  decayTiming: "remove-first" | "place-first";
  playThrough: boolean;
}

export interface RawState extends WithEffects {
  readonly queues: readonly [readonly number[], readonly number[]];
  readonly toMove: PlayerId;
}

export interface RawMove {
  readonly cell: number;
  readonly [key: string]: number;
}

class RawDecodeUnsupportedError extends Error {
  constructor() {
    super("fadeout raw solver engine: decode() is not supported — this engine exists only for reach()/retrograde().");
    this.name = "RawDecodeUnsupportedError";
  }
}

function resolvedOf(config: RawConfig): ResolvedRulesetConfig {
  return {
    decayTiming: config.decayTiming,
    playThrough: config.playThrough,
    // Irrelevant: this engine's legality/status never consult repetition at all (that's the
    // entire point of "raw" — see the module doc). Fixed to a concrete value only because
    // ResolvedRulesetConfig's type requires one.
    repetition: "threefold",
    boardSize: DEFAULT_BOARD_SIZE,
    cap: DEFAULT_CAP,
  };
}

/** Occupancy-only legal cells for `mover` — no repetition/superko/threefold check at all. On a
 *  3x3/cap-3 board this is NEVER empty (each side caps at 3 marks, so >=3 cells are always
 *  plain-empty and therefore always targetable) — asserted, not just assumed, in apply() below
 *  via the same contract reach() itself enforces (UnsupportedGameError on a legalMoves() empty
 *  while ongoing). */
function legalRawCells(queues: Queues, mover: PlayerId, resolved: ResolvedRulesetConfig): number[] {
  const totalCells = resolved.boardSize * resolved.boardSize;
  const out: number[] = [];
  for (let cell = 0; cell < totalCells; cell++) {
    if (cellIsTargetable(queues, cell, mover, resolved)) out.push(cell);
  }
  return out;
}

export function createRawEngine(config: RawConfig): GameEngine<RawState, RawMove, RawState> {
  const resolved = resolvedOf(config);

  const engine: GameEngine<RawState, RawMove, RawState> = {
    meta: {
      id: `fadeout-raw:${config.decayTiming}:${config.playThrough}`,
      name: "Fadeout (raw, repetition-free pass-1 solver engine)",
      minPlayers: 2,
      maxPlayers: 2,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },

    setup(): RawState {
      return { queues: [[], []], toMove: 0, lastEffects: [] };
    },

    legalMoves(state, player) {
      if (player !== state.toMove) return [];
      if (checkWinner(state.queues, resolved.boardSize) !== null) return [];
      return legalRawCells(state.queues, player, resolved).map((cell) => ({ cell }));
    },

    isLegal(state, player, move) {
      return engine.legalMoves(state, player).some((m) => m.cell === move.cell);
    },

    active(state) {
      return { mode: "sequential", player: state.toMove };
    },

    apply(state, moves, _rng) {
      const mover = state.toMove;
      const move = moves.get(mover);
      if (!move) {
        throw new Error("fadeout raw solver engine: apply() called without a move for the active player");
      }
      if (!engine.isLegal(state, mover, move)) {
        throw new Error(`fadeout raw solver engine: illegal move cell=${move.cell} for player ${mover}`);
      }
      const result = transition(state.queues, mover, move.cell, [0, 0], [0, 0], resolved);
      return { queues: result.queues, toMove: result.toMove, lastEffects: result.effects };
    },

    status(state) {
      const winner = checkWinner(state.queues, resolved.boardSize);
      if (winner !== null) return { kind: "won", winner };
      return { kind: "ongoing" };
    },

    playerView(state) {
      return state; // perfect information
    },

    encode(state) {
      return positionKey(state); // sound here ONLY because RawState carries no history/faded
    },

    decode(): RawState {
      throw new RawDecodeUnsupportedError();
    },
  };

  return engine;
}

export interface RawOpeningValue {
  cell: number;
  value: PositionValue;
}

export interface RawSolveResult {
  reachableStates: number;
  rootValue: PositionValue;
  openings: RawOpeningValue[];
  /** Mover-relative value at an arbitrary reachable {queues,toMove}, keyed by `positionKey()`.
   *  Throws (never silently defaults to "draw") when the key was never reached by the BFS from
   *  setup() — a lookup miss usually means the caller's fixture isn't actually reachable under
   *  this config, which is exactly the kind of mistake this should surface loudly rather than
   *  mask as an innocuous-looking draw. */
  valueAt(key: string): PositionValue;
  graph: ReachGraph<RawState>;
  result: RetrogradeResult;
}

function outcomeForMover(
  mover: PlayerId,
  child: { status: { kind: string; winner?: PlayerId }; mover?: PlayerId; hash: string },
  result: RetrogradeResult
): PositionValue {
  if (child.status.kind === "won") {
    return child.status.winner === mover ? "win" : "loss";
  }
  if (child.status.kind !== "ongoing" || child.mover === undefined) {
    return "draw";
  }
  const value = result.valueAt(child.hash);
  if (value === "draw") return "draw";
  return child.mover === mover ? value : value === "win" ? "loss" : "win";
}

/**
 * One step of the canonical forced-win witness walk from a raw-WIN-labeled position, starting
 * at `startKey`. At each ONGOING node reached:
 *
 *   - if the node's OWN mover-relative value is "win" (i.e. this is the side who is actually
 *     winning here), follow "the move retrograde's own proof used" — the first outgoing edge
 *     whose child is a proven win for this mover;
 *   - otherwise (the node's mover is the LOSING side — always true immediately after the
 *     winner's move, per the module doc's flip argument: outcomeForMover(winner, child)==="win"
 *     forces child's OWN value to be exactly "loss", never "draw", so this branch is never
 *     reached in a "draw" state in practice) ANY legal reply is fine to demonstrate with: by
 *     definition of LOSS, every one of the loser's replies still hands the win back to the
 *     original mover, so the FIRST legal edge is picked arbitrarily.
 *
 * Getting this branch right matters: a first version of this walk assumed EVERY node along a
 * win witness must itself be "win" for whoever's mover there, which is wrong — the opponent's
 * forced replies are LOSS nodes for the opponent, and searching them for a (non-existent)
 * winning edge threw. Caught by actually running strategy extraction against a real solved
 * config, not by inspection.
 *
 * WHY THE WALK IS ALWAYS REPEAT-FREE (load-bearing for pass2-superko.ts's WIN shortcut — see
 * that module's doc): on the winner's own turns, `retrograde()` resolves each node's label
 * exactly once, the instant it is PROVEN, and a WIN proof at node N can only cite a child
 * already resolved STRICTLY earlier — a strictly decreasing potential, so the winner's own
 * steps can never revisit a position. On the loser's turns, the module doc above shows the
 * chosen reply can never itself be an immediate win for the loser (that would contradict the
 * node being LOSS-labeled) and always lands back on an ongoing, WIN-for-the-original-mover
 * node — so the walk as a whole terminates at the same terminal the winner's forcing line
 * always reaches. The `seen` check is a defensive assertion of this, not a correctness
 * dependency.
 */
function stepWitness(
  raw: RawSolveResult,
  currentKey: string
): { cell: number; childKey: string; childIsTerminal: boolean } {
  const node = raw.graph.nodes.get(currentKey);
  if (!node || node.status.kind !== "ongoing" || node.mover === undefined) {
    throw new Error(`fadeout raw solver: witness walk reached a non-ongoing node at ${currentKey}`);
  }
  const mover = node.mover;
  const nodeValue = raw.result.valueAt(currentKey);

  const edge =
    nodeValue === "win"
      ? node.moves.find((e) => {
          const child = raw.graph.nodes.get(e.toHash);
          return !!child && outcomeForMover(mover, child, raw.result) === "win";
        })
      : node.moves[0]; // loser's (or, defensively, drawing side's) arbitrary legal reply

  if (!edge) {
    throw new Error(`fadeout raw solver: witness walk found no eligible move at ${currentKey} (value=${nodeValue})`);
  }
  const child = raw.graph.nodes.get(edge.toHash)!;
  return {
    cell: (edge.move as { cell: number }).cell,
    childKey: edge.toHash,
    childIsTerminal: child.status.kind !== "ongoing",
  };
}

/** The canonical forced-win witness line from a raw-WIN-labeled position: the sequence of
 *  ONGOING position keys visited (both sides' moves — see `stepWitness`'s doc), starting at
 *  `startKey` and ending just before the move that reaches an actual terminal win. */
export function winWitnessPositionKeys(raw: RawSolveResult, startKey: string): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let currentKey = startKey;

  for (;;) {
    if (seen.has(currentKey)) {
      throw new Error(
        "fadeout raw solver: winWitnessPositionKeys found a repeated position while following a " +
          "WIN proof — structurally impossible; this indicates a real bug, not an expected case."
      );
    }
    seen.add(currentKey);
    keys.push(currentKey);

    const { childKey, childIsTerminal } = stepWitness(raw, currentKey);
    if (childIsTerminal) return keys;
    currentKey = childKey;
  }
}

/** Same walk as `winWitnessPositionKeys`, but returns the CELL played at each step (both
 *  sides') instead of the position keys — what strategy.ts needs to render a human-readable
 *  forced line. Kept separate so pass2-superko.ts's WIN shortcut (which only needs the keys)
 *  doesn't pay for building move lists. */
export function winWitnessMoves(raw: RawSolveResult, startKey: string): readonly number[] {
  const cells: number[] = [];
  const seen = new Set<string>();
  let currentKey = startKey;

  for (;;) {
    if (seen.has(currentKey)) {
      throw new Error("fadeout raw solver: winWitnessMoves found a repeated position — should be structurally impossible");
    }
    seen.add(currentKey);

    const { cell, childKey, childIsTerminal } = stepWitness(raw, currentKey);
    cells.push(cell);
    if (childIsTerminal) return cells;
    currentKey = childKey;
  }
}

/** Builds the pass-1 raw graph (reach() + retrograde() over `positionKey`) for one
 *  (decayTiming, playThrough) pair and exposes it as root value / opening table / arbitrary
 *  position lookup. This is the ENTIRE pass-1 pipeline — see the module doc for what its output
 *  means for each repetition rule. */
export function solveRaw(config: RawConfig): RawSolveResult {
  const engine = createRawEngine(config);
  const graph = reach(engine, { keyOf: (state) => positionKey(state) });
  const result = retrograde(engine, graph);

  const root = graph.nodes.get(graph.initialHash);
  if (!root || root.status.kind !== "ongoing" || root.mover === undefined) {
    throw new Error("fadeout raw solver: initial position is unexpectedly terminal");
  }
  const rootMover = root.mover;

  const openings: RawOpeningValue[] = root.moves.map((edge) => {
    const child = graph.nodes.get(edge.toHash);
    if (!child) throw new Error("fadeout raw solver: root edge target missing from graph (closure violated)");
    return {
      cell: (edge.move as { cell: number }).cell,
      value: outcomeForMover(rootMover, child, result),
    };
  });

  return {
    reachableStates: graph.nodes.size,
    rootValue: result.valueAt(graph.initialHash),
    openings,
    valueAt(key: string): PositionValue {
      const node = graph.nodes.get(key);
      if (!node) {
        throw new Error(
          `fadeout raw solver: positionKey ${key} was never reached from setup() under config ` +
            `${JSON.stringify(config)} — check the fixture is actually reachable under this config.`
        );
      }
      if (node.status.kind === "won") {
        // Caller asked for a mover-relative value at a TERMINAL node, which has no mover of its
        // own — undefined without more context (whose perspective?). Reject rather than guess.
        throw new Error("fadeout raw solver: valueAt() called on a terminal (won) position — no mover to be relative to");
      }
      if (node.mover === undefined) {
        throw new Error("fadeout raw solver: node has no mover (unexpected non-ongoing status)");
      }
      return result.valueAt(key);
    },
    graph,
    result,
  };
}

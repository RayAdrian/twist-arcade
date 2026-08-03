// games/crackstep/engine.ts — Crackstep, a crumbling-floor coverage puzzle (the house decay
// mechanic in solo, daily-puzzle form; docs/plans/crackstep.md).
//
// Rule sentence (canonical, <=90 chars, verified in manifest.test.ts):
// "Wooden tiles crumble as you leave them — cross the whole floor without stranding yourself."
//
// encode()/position-key note (plan §6.4 — the answer to Fadeout's superko seam question,
// platform-corrections.md C3): Crackstep is NOT history-dependent the way Fadeout is. Every
// move strictly grows `visited` or `crumbled` (never shrinks either), so no position can ever
// repeat — there is no repetition rule and no `history` field in this state at all. `encode()`
// is therefore a SOUND position key on its own: any two reachable states sharing the same
// (tiles, crumbled, visited, pos) are legally interchangeable going forward, full stop. This is
// the opposite of Fadeout's superko case: the generic harness solvers (dfsSolver/idaStarSolver)
// can hash-dedup directly on `encode(S)` with no bespoke positionKey() needed (see solver.ts).

import type {
  ActiveSpec,
  Effect,
  GameEngine,
  PlayerId,
  Rng,
  Status,
  WithEffects,
} from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { countUnvisited, generateBoard, isIntact, neighbors, reachableSet, type TileKind } from "./board";

export type { TileKind } from "./board";

export interface CrackstepState extends WithEffects {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileKind[]; // row-major; static after setup()
  readonly crumbled: readonly boolean[]; // per-cell; only ever true for a "crumble" cell
  readonly visited: readonly boolean[]; // per-cell; start is visited from setup()
  readonly pos: number; // current cell index
  readonly lastEffects: WithEffects["lastEffects"];
}

/**
 * A move IS the target cell index. A bare `number` satisfies `Json` directly (one of its own
 * union arms) — unlike an object-shaped move, there is no `[key: string]: Json` index-signature
 * trap to fall into here (CHECKLIST.md's first trap): there is nothing to add one to.
 */
export type CrackstepMove = number;

class CrackstepDecodeError extends Error {
  constructor(detail: string) {
    super(`crackstep engine: decode() received a malformed encoding: ${detail}`);
    this.name = "CrackstepDecodeError";
  }
}

function totalCells(state: Pick<CrackstepState, "width" | "height">): number {
  return state.width * state.height;
}

function legalDestinations(state: CrackstepState): number[] {
  return neighbors(state.pos, state.width, state.height).filter((n) => isIntact(state.tiles, state.crumbled, n));
}

/** Standalone (not `state.status()` via `this`) — called as a bare reference from bots, the
 *  harness, and the shell; never guaranteed to be invoked with `crackstep` as its receiver. */
function computeStatus(state: CrackstepState): Status {
  let allVisited = true;
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== "hole" && !state.visited[i]) {
      allVisited = false;
      break;
    }
  }
  if (allVisited) return { kind: "won", winner: 0 };
  if (legalDestinations(state).length === 0) return { kind: "lost" };
  return { kind: "ongoing" };
}

export const crackstep: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
  meta: {
    id: "crackstep",
    name: "Crackstep",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    // Correct despite the generated board (platform §5.2): the flag means chance events AFTER
    // setup — Crackstep draws no randomness in apply() at all; every draw is consumed in setup().
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, rng: Rng): CrackstepState {
    const board = generateBoard(rng);
    const total = board.width * board.height;
    const visited = new Array<boolean>(total).fill(false);
    visited[board.start] = true;
    return {
      width: board.width,
      height: board.height,
      tiles: board.tiles,
      crumbled: new Array<boolean>(total).fill(false),
      visited,
      pos: board.start,
      lastEffects: [],
    };
  },

  legalMoves(state: CrackstepState, player: PlayerId): CrackstepMove[] {
    if (player !== 0) return [];
    if (computeStatus(state).kind !== "ongoing") return [];
    return legalDestinations(state);
  },

  isLegal(state: CrackstepState, player: PlayerId, move: CrackstepMove): boolean {
    if (player !== 0) return false;
    if (!Number.isInteger(move) || move < 0 || move >= totalCells(state)) return false;
    return crackstep.legalMoves(state, player).includes(move);
  },

  active(_state: CrackstepState): ActiveSpec {
    // Solo engines keep active() (plan §3): one line here buys no forks in any consumer.
    return { mode: "sequential", player: 0 };
  },

  apply(state: CrackstepState, moves: ReadonlyMap<PlayerId, CrackstepMove>, _rng: Rng): CrackstepState {
    const move = moves.get(0);
    if (move === undefined) {
      throw new Error("crackstep engine: apply() called without a move for player 0");
    }
    if (!crackstep.isLegal(state, 0, move)) {
      throw new Error(`crackstep engine: illegal move ${stableStringify(move)}`);
    }

    const crumbled = state.crumbled.slice();
    // `width`/`height` ride along on the "moved" effect (Effect is an open `{type} & {[k]:
    // Json}` vocabulary, plan-sanctioned per-game payload — not a platform contract change):
    // unlike Fadeout's fixed 3x3 board, Crackstep's board geometry varies per generated
    // instance, and the platform's `GameEvent` "moved" case carries no `view` at all (only
    // "imminent"/"boardSummary" do) — so a presentation's announce()/firstOccurrence anchor
    // has no other way to turn a bare cell index into "row R, column C" from a "moved" event
    // alone. See presentation.ts's announceMoved() for the consumer.
    const effects: Effect[] = [{ type: "moved", from: state.pos, to: move, width: state.width, height: state.height }];
    // Crumble timing (plan §1.2): a crumbling tile falls the INSTANT you leave it — including
    // the start tile on move 1 (the start is always a crumbling tile). Stone never crumbles.
    if (state.tiles[state.pos] === "crumble") {
      crumbled[state.pos] = true;
      effects.push({ type: "crumbled", cell: state.pos });
    }
    const visited = state.visited.slice();
    visited[move] = true;

    return { ...state, crumbled, visited, pos: move, lastEffects: effects };
  },

  status(state: CrackstepState): Status {
    return computeStatus(state);
  },

  playerView(state: CrackstepState, _player: PlayerId | null): CrackstepState {
    return state; // perfect information: playerView is the identity (meta.hiddenInformation === false)
  },

  /**
   * Canonical encoding — EXCLUDES lastEffects (standard contract). Includes `tiles` (static,
   * but part of what makes two distinct boards' states hash differently — required for encode
   * injectivity across playouts from different seeds) plus `crumbled`/`visited`/`pos`, which
   * together are the entire mutable logical state. See this module's header for why this alone
   * (no `history`) is a sound solver/dedup position key on this game.
   */
  encode(state: CrackstepState): string {
    return stableStringify({
      width: state.width,
      height: state.height,
      tiles: state.tiles as unknown as string[],
      crumbled: state.crumbled as unknown as boolean[],
      visited: state.visited as unknown as boolean[],
      pos: state.pos,
    });
  },

  /**
   * Throws a typed CrackstepDecodeError on any malformed or structurally-impossible input
   * (platform-corrections.md C4) — never returns a partial or silently-defaulted state.
   * `decode` feeds `replay()` and certificate verification (the boundary deciding whether a
   * submitted move log or a shipped daily is genuine), so lenient parsing here would let a
   * forged record validate silently. Deliberately does NOT attempt full reachability-from-start
   * validation (that is replay()'s job) — only the cheap, general invariants that fall straight
   * out of the rules (Fadeout's decode() sets this same scope precedent).
   */
  decode(encoded: string): CrackstepState {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch (err) {
      throw new CrackstepDecodeError(`not valid JSON (${(err as Error).message})`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new CrackstepDecodeError("top-level value is not an object");
    }
    const obj = parsed as Record<string, unknown>;

    const width = obj.width;
    const height = obj.height;
    if (!Number.isInteger(width) || (width as number) <= 0) {
      throw new CrackstepDecodeError("`width` must be a positive integer");
    }
    if (!Number.isInteger(height) || (height as number) <= 0) {
      throw new CrackstepDecodeError("`height` must be a positive integer");
    }
    const w = width as number;
    const h = height as number;
    const total = w * h;

    const tiles = obj.tiles;
    if (
      !Array.isArray(tiles) ||
      tiles.length !== total ||
      !tiles.every((t) => t === "crumble" || t === "stone" || t === "hole")
    ) {
      throw new CrackstepDecodeError(`\`tiles\` must be a length-${total} array of "crumble"|"stone"|"hole"`);
    }
    const tilesArr = tiles as TileKind[];

    const crumbled = obj.crumbled;
    if (!Array.isArray(crumbled) || crumbled.length !== total || !crumbled.every((c) => typeof c === "boolean")) {
      throw new CrackstepDecodeError(`\`crumbled\` must be a length-${total} boolean array`);
    }
    const crumbledArr = crumbled as boolean[];

    const visited = obj.visited;
    if (!Array.isArray(visited) || visited.length !== total || !visited.every((v) => typeof v === "boolean")) {
      throw new CrackstepDecodeError(`\`visited\` must be a length-${total} boolean array`);
    }
    const visitedArr = visited as boolean[];

    const pos = obj.pos;
    if (!Number.isInteger(pos) || (pos as number) < 0 || (pos as number) >= total) {
      throw new CrackstepDecodeError(`\`pos\` must be an integer in [0, ${total})`);
    }
    const posNum = pos as number;

    // C4 structural invariants — cheap, general facts that fall straight out of the rules
    // (mirrors Fadeout engine.ts's decode() scope note verbatim).
    for (let i = 0; i < total; i++) {
      if (tilesArr[i] === "hole") {
        if (visitedArr[i] || crumbledArr[i]) {
          throw new CrackstepDecodeError(`cell ${i} is a hole but is marked visited/crumbled — holes are never entered`);
        }
      } else if (crumbledArr[i] && tilesArr[i] !== "crumble") {
        throw new CrackstepDecodeError(
          `cell ${i} is marked crumbled but is a "${tilesArr[i]}" tile — only "crumble" tiles ever crumble`
        );
      }
      if (crumbledArr[i] && !visitedArr[i]) {
        throw new CrackstepDecodeError(`cell ${i} is marked crumbled but was never marked visited`);
      }
    }
    if (tilesArr[posNum] === "hole") {
      throw new CrackstepDecodeError(`\`pos\` ${posNum} is a hole — cannot be standing there`);
    }
    if (crumbledArr[posNum]) {
      throw new CrackstepDecodeError(`\`pos\` ${posNum} is marked crumbled — cannot be standing on a fallen tile`);
    }
    if (!visitedArr[posNum]) {
      throw new CrackstepDecodeError(`\`pos\` ${posNum} must be marked visited — the player is standing there`);
    }

    return {
      width: w,
      height: h,
      tiles: tilesArr,
      crumbled: crumbledArr,
      visited: visitedArr,
      pos: posNum,
      lastEffects: [],
    };
  },

  /**
   * `-(unvisited count) - 100*(unreachable-unvisited count)` (plan §6.3): three consumers — the
   * Greedy 1-ply probe (becomes the greedy-gap feature), the Strong beam agent (M2 — which later
   * ships as the hint feature, so this is product code, not throwaway), and the design-gate
   * solve-rate separation (§5). Shares its core computation with solver.ts's admissible IDA*
   * heuristic via board.ts, so the two can never silently drift apart.
   */
  heuristic(state: CrackstepState, _player: PlayerId): number {
    const unvisited = countUnvisited(state.tiles, state.visited);
    if (unvisited === 0) return 0;
    const reachable = reachableSet(state.pos, state.width, state.height, (c) => isIntact(state.tiles, state.crumbled, c));
    let unreachable = 0;
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== "hole" && !state.visited[i] && !reachable.has(i)) unreachable += 1;
    }
    return -unvisited - 100 * unreachable;
  },
};

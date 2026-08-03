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
import { stableStringify } from "@twist-arcade/engine";
export const DEFAULT_BOARD_SIZE = 3;
export const DEFAULT_CAP = 3;
/** All 8 win-lines for the 3x3 board (row-major indices 0..8). Generalizing to NxN is
 *  future 4x4-escalation work (plan §4); not attempted here since only boardSize 3 is
 *  supported (see RulesetConfig.boardSize's comment). */
export const LINES = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];
export function opponentOf(player) {
    return player === 0 ? 1 : 0;
}
export function occupantOf(queues, cell) {
    if (queues[0].includes(cell))
        return 0;
    if (queues[1].includes(cell))
        return 1;
    return null;
}
/**
 * Safe indexing into a per-player [P0, P1] pair by a `PlayerId` (plain `number`, not a 0|1
 * literal union): `noUncheckedIndexedAccess` cannot prove a general `number` index into a
 * 2-tuple is in bounds, so a bare `pair[player]` types as `T | undefined` everywhere. These two
 * helpers are the one place that ternary lives, so every call site gets a properly-typed `T`
 * (get2) or a real mutation (set2) instead of re-deriving the same branch repeatedly.
 */
export function get2(pair, player) {
    return player === 0 ? pair[0] : pair[1];
}
export function set2(pair, player, value) {
    if (player === 0)
        pair[0] = value;
    else
        pair[1] = value;
}
/** Badge/heuristic/announce()'s shared counting formula (plan §5.1): for a mark at queue
 *  index `i` (0 = oldest) with the owner's current queue length `q`, the number of the
 *  owner's own remaining placements before this mark vanishes is `i + 1 + (cap - q)`. Pinned
 *  once here so the UI badge, `announce()`, and the heuristic never drift apart (F1 only
 *  consumes this for the heuristic; F3 imports it for the badge). */
export function remainingLife(index, queueLength, cap) {
    return index + 1 + (cap - queueLength);
}
function boardFromQueues(queues, boardSize) {
    const board = new Array(boardSize * boardSize).fill(null);
    for (const cell of queues[0])
        board[cell] = 0;
    for (const cell of queues[1])
        board[cell] = 1;
    return board;
}
export function checkWinner(queues, boardSize) {
    const board = boardFromQueues(queues, boardSize);
    for (const [a, b, c] of LINES) {
        const va = board[a];
        if (va !== null && va !== undefined && va === board[b] && va === board[c])
            return va;
    }
    return null;
}
/** Occupancy-only legality of placing at `cell` for `mover` — does NOT consider superko
 *  (that requires simulating the resulting position; see computeLegalCells). Both
 *  decayTiming's A1 self-vacate rule and playThrough's B2 either-side rule can independently
 *  make an occupied cell targetable; they are combined with OR (a cell need only satisfy one
 *  to be legal), which is deliberate: under A1+B2 both conditions can hold for the mover's own
 *  doomed cell simultaneously and that's fine — it's still just "legal," not double-legal. */
export function cellIsTargetable(queues, cell, mover, config) {
    const occOwner = occupantOf(queues, cell);
    if (occOwner === null)
        return true;
    if (config.decayTiming === "remove-first" && occOwner === mover) {
        const q = get2(queues, mover);
        if (q.length === config.cap && q[0] === cell)
            return true;
    }
    if (config.playThrough) {
        const q = get2(queues, occOwner);
        if (q.length === config.cap && q[0] === cell)
            return true;
    }
    return false;
}
/** Total placements made by both players so far — equivalently, the 0-indexed ply number of
 *  the placement about to happen. Invariant across a single transition() call (see that
 *  function's doc comment): every removal moves exactly one mark from "queued" to "faded", so
 *  the sum never changes mid-transition even though individual removals mutate faded/queues.
 *  Exported so F3's share-artifact layer can compute a still-on-the-board mark's CURRENT
 *  lifespan (plan §8, orchestrator ruling R2 — "also count marks still alive at game end")
 *  with the identical formula transition() uses for a removed one, instead of re-deriving it
 *  and risking drift. */
export function totalPliesPlayed(faded, queues) {
    return faded[0] + queues[0].length + faded[1] + queues[1].length;
}
/** The ply number (0-indexed; P0's placements are even, P1's odd, since placements strictly
 *  alternate P0, P1, P0, P1, ...) at which the mark currently at queue index `i` (0 = oldest)
 *  of player `p` was placed, given `p`'s faded count AT THE TIME (before any removal this call
 *  might be counting). Derivation: that mark is `p`'s `(fadedForOwner + i + 1)`-th placement
 *  ever, and player p's n-th placement (1-indexed) happens at overall ply `2*(n-1) + p`.
 *  Shared by transition()'s own removal bookkeeping and (via export) F3's survivor lifespan
 *  calculation. */
export function birthPlyOfQueueIndex(index, fadedForOwner, owner) {
    return 2 * (fadedForOwner + index) + owner;
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
 *     overflow regardless of which cell the new mark lands on. See RulesetConfig's
 *     AXIS COLLAPSE note: under playThrough=true this self-target case is reachable via EITHER
 *     decayTiming value, and both produce the identical resulting position.
 *
 * Lifespan bookkeeping (longestLife) — REDEFINED per orchestrator ruling R2 to "plies survived
 * on the board", replacing the original "own placements survived" metric (provably confined to
 * {0, cap, cap-1} under a fixed-cap FIFO — worthless variance-wise on a share artifact whose
 * entire purpose is per-game variance). No per-mark birth-tick field is needed; under strict
 * alternation a mark's birth ply is derivable from existing state via birthPlyOfQueueIndex()
 * above (index is always 0 here — removeOldest only ever evicts the queue head):
 *   lifespan = currentPly - birthPlyOfQueueIndex(0, faded-at-removal-time, owner)
 * `currentPly` is computed ONCE, up front, from the transition's ORIGINAL inputs (never from
 * the mutating nextQueues/nextFaded) via totalPliesPlayed() — see that function's doc comment
 * for why it's safe to reuse for both the displacement removal and the mover's own-overflow
 * removal within the same apply(), even though a removal in between mutates faded/queues.
 *
 * Marks still ON the board when the game ends are NOT reflected here (longestLife only updates
 * on removal) — per ruling R2, F3's share-artifact layer computes a survivor's contribution
 * itself from the final view using totalPliesPlayed()/birthPlyOfQueueIndex() rather than this
 * module tracking it, since "still alive" isn't a removal event.
 */
export function transition(queues, mover, cell, faded, longestLife, config) {
    const opponent = opponentOf(mover);
    const nextQueues = [queues[0].slice(), queues[1].slice()];
    const nextFaded = [faded[0], faded[1]];
    const nextLongestLife = [longestLife[0], longestLife[1]];
    const effects = [];
    const currentPly = totalPliesPlayed(faded, queues);
    function removeOldest(owner) {
        const removedCell = get2(nextQueues, owner).shift();
        if (removedCell === undefined) {
            throw new Error(`fadeout engine: transition() tried to evict from player ${owner}'s empty queue`);
        }
        const birthPly = birthPlyOfQueueIndex(0, get2(nextFaded, owner), owner);
        const lifespan = currentPly - birthPly;
        set2(nextFaded, owner, get2(nextFaded, owner) + 1);
        if (lifespan > get2(nextLongestLife, owner))
            set2(nextLongestLife, owner, lifespan);
        effects.push({ type: "decayed", player: owner, cell: removedCell });
    }
    if (config.playThrough) {
        const oppQ = get2(nextQueues, opponent);
        if (oppQ.length === config.cap && oppQ[0] === cell) {
            removeOldest(opponent);
        }
    }
    const willOverflow = get2(nextQueues, mover).length === config.cap;
    const place = () => {
        get2(nextQueues, mover).push(cell);
        effects.push({ type: "placed", player: mover, cell });
    };
    const overflow = () => {
        if (willOverflow)
            removeOldest(mover);
    };
    if (config.decayTiming === "remove-first") {
        overflow();
        place();
    }
    else {
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
export function positionKeyOf(queues, toMove) {
    return stableStringify({
        queues: [queues[0], queues[1]],
        toMove,
    });
}
/** Occupancy-legal AND (under superko) not-a-repeat cells for `player`. Pure; does not itself
 *  consult status() — status() calls THIS, never the other way around, so the two never
 *  mutually recurse (a real risk in a game where "is there a legal move" is itself part of
 *  the win condition, per §3.3). */
export function computeLegalCells(queues, toMove, history, faded, longestLife, player, config) {
    const totalCells = config.boardSize * config.boardSize;
    const out = [];
    for (let cell = 0; cell < totalCells; cell++) {
        if (!cellIsTargetable(queues, cell, player, config))
            continue;
        if (config.repetition === "superko") {
            const result = transition(queues, player, cell, faded, longestLife, config);
            const keyAfter = positionKeyOf(result.queues, result.toMove);
            if (history.includes(keyAfter))
                continue;
        }
        out.push(cell);
    }
    return out;
}

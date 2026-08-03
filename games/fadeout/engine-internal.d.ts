import type { Effect, PlayerId } from "@twist-arcade/engine";
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
    /**
     * AXIS COLLAPSE, PINNED (orchestrator ruling R1 — read before touching either axis).
     * Under playThrough=true, decayTiming governs ONLY the effect order of the mover's own
     * overflow when it lands on their OWN doomed cell (decayed-then-placed for remove-first,
     * placed-then-decayed for place-first) — cellIsTargetable's two branches (decayTiming's
     * self-vacate OR playThrough's either-side) are combined with OR, and once playThrough
     * already makes the mover's own doomed cell legal (B2's "either player" clause),
     * decayTiming's self-vacate branch never adds a legality/outcome case that playThrough
     * didn't already cover. Consequence: A1+B2 and A2+B2 produce byte-identical legal-move sets
     * and byte-identical successor positions for EVERY reachable state — verified by exhaustive
     * BFS (141,850 positions, identical graphs) and pinned by a bounded random-walk regression
     * test in engine.test.ts ("A1+B2 vs A2+B2 equivalence"). The only observable difference is
     * lastEffects ordering, which makes A2+B2's self-target path animation-hostile (placed(c)
     * then decayed(c) on the SAME cell — drawing a mark on top of a live one, then fading the
     * wrong glyph).
     *
     * This means the ruleset config space is 8 syntactic combinations but only 6 distinct GAMES
     * once playThrough=true collapses the decayTiming axis. Two consequences for F2, recorded
     * here so nobody re-derives them under time pressure:
     *   1. The solve MUST report identical values for {A1,B2,*} and {A2,B2,*} configs — a free
     *      solver cross-check; a divergence there means the solver is broken, not that these are
     *      different games.
     *   2. If a B2 (playThrough=true) variant is the one that ships, use A1's (remove-first)
     *      effect ordering for it — strictly better for animation, and free, since the two
     *      configs are worth exactly the same to the solve.
     *
     * The alternative reading — A2 overriding B2 for the mover's OWN mark specifically, so the
     * mover's own doomed cell stays a normal overflow rather than a playThrough-eligible target
     * — was considered and rejected: it requires a special case ("B2's either-player rule,
     * except not for your own mark") that is harder to state in one sentence than the rule this
     * engine implements. If a future rule change adopts that reading anyway, this collapse
     * un-happens and must be re-verified, not assumed.
     */
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
export declare const DEFAULT_BOARD_SIZE = 3;
export declare const DEFAULT_CAP = 3;
/** All 8 win-lines for the 3x3 board (row-major indices 0..8). Generalizing to NxN is
 *  future 4x4-escalation work (plan §4); not attempted here since only boardSize 3 is
 *  supported (see RulesetConfig.boardSize's comment). */
export declare const LINES: readonly (readonly [number, number, number])[];
export type Queues = readonly [readonly number[], readonly number[]];
export declare function opponentOf(player: PlayerId): PlayerId;
export declare function occupantOf(queues: Queues, cell: number): PlayerId | null;
/**
 * Safe indexing into a per-player [P0, P1] pair by a `PlayerId` (plain `number`, not a 0|1
 * literal union): `noUncheckedIndexedAccess` cannot prove a general `number` index into a
 * 2-tuple is in bounds, so a bare `pair[player]` types as `T | undefined` everywhere. These two
 * helpers are the one place that ternary lives, so every call site gets a properly-typed `T`
 * (get2) or a real mutation (set2) instead of re-deriving the same branch repeatedly.
 */
export declare function get2<T>(pair: readonly [T, T], player: PlayerId): T;
export declare function set2<T>(pair: [T, T], player: PlayerId, value: T): void;
/** Badge/heuristic/announce()'s shared counting formula (plan §5.1): for a mark at queue
 *  index `i` (0 = oldest) with the owner's current queue length `q`, the number of the
 *  owner's own remaining placements before this mark vanishes is `i + 1 + (cap - q)`. Pinned
 *  once here so the UI badge, `announce()`, and the heuristic never drift apart (F1 only
 *  consumes this for the heuristic; F3 imports it for the badge). */
export declare function remainingLife(index: number, queueLength: number, cap: number): number;
export declare function checkWinner(queues: Queues, boardSize: number): PlayerId | null;
/** Occupancy-only legality of placing at `cell` for `mover` — does NOT consider superko
 *  (that requires simulating the resulting position; see computeLegalCells). Both
 *  decayTiming's A1 self-vacate rule and playThrough's B2 either-side rule can independently
 *  make an occupied cell targetable; they are combined with OR (a cell need only satisfy one
 *  to be legal), which is deliberate: under A1+B2 both conditions can hold for the mover's own
 *  doomed cell simultaneously and that's fine — it's still just "legal," not double-legal. */
export declare function cellIsTargetable(queues: Queues, cell: number, mover: PlayerId, config: ResolvedRulesetConfig): boolean;
export interface TransitionResult {
    queues: [number[], number[]];
    toMove: PlayerId;
    effects: Effect[];
    faded: [number, number];
    longestLife: [number, number];
}
/** Total placements made by both players so far — equivalently, the 0-indexed ply number of
 *  the placement about to happen. Invariant across a single transition() call (see that
 *  function's doc comment): every removal moves exactly one mark from "queued" to "faded", so
 *  the sum never changes mid-transition even though individual removals mutate faded/queues.
 *  Exported so F3's share-artifact layer can compute a still-on-the-board mark's CURRENT
 *  lifespan (plan §8, orchestrator ruling R2 — "also count marks still alive at game end")
 *  with the identical formula transition() uses for a removed one, instead of re-deriving it
 *  and risking drift. */
export declare function totalPliesPlayed(faded: readonly [number, number], queues: Queues): number;
/** The ply number (0-indexed; P0's placements are even, P1's odd, since placements strictly
 *  alternate P0, P1, P0, P1, ...) at which the mark currently at queue index `i` (0 = oldest)
 *  of player `p` was placed, given `p`'s faded count AT THE TIME (before any removal this call
 *  might be counting). Derivation: that mark is `p`'s `(fadedForOwner + i + 1)`-th placement
 *  ever, and player p's n-th placement (1-indexed) happens at overall ply `2*(n-1) + p`.
 *  Shared by transition()'s own removal bookkeeping and (via export) F3's survivor lifespan
 *  calculation. */
export declare function birthPlyOfQueueIndex(index: number, fadedForOwner: number, owner: PlayerId): number;
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
export declare function transition(queues: Queues, mover: PlayerId, cell: number, faded: readonly [number, number], longestLife: readonly [number, number], config: ResolvedRulesetConfig): TransitionResult;
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
export declare function positionKeyOf(queues: Queues, toMove: PlayerId): string;
/** Occupancy-legal AND (under superko) not-a-repeat cells for `player`. Pure; does not itself
 *  consult status() — status() calls THIS, never the other way around, so the two never
 *  mutually recurse (a real risk in a game where "is there a legal move" is itself part of
 *  the win condition, per §3.3). */
export declare function computeLegalCells(queues: Queues, toMove: PlayerId, history: readonly string[], faded: readonly [number, number], longestLife: readonly [number, number], player: PlayerId, config: ResolvedRulesetConfig): number[];

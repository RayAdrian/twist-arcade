import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import { type RulesetConfig } from "./engine-internal";
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
    readonly [key: string]: Json;
}
/** All 8 SYNTACTIC combinations of the three ruleset axes (plan §1) — used by engine.test.ts to
 *  run engineContract() against every variant, and reusable by F2's solve script and the
 *  harness so nobody hand-enumerates this list a second time and lets it drift out of sync
 *  with §1. Still 8 entries deliberately, even though only 6 are distinct GAMES once
 *  playThrough=true (see RulesetConfig's AXIS COLLAPSE doc comment in engine-internal.ts): this
 *  function enumerates the config SPACE, and F2's solve is exactly what's expected to notice
 *  and exploit the collapse (as a free cross-check), not something this enumeration should
 *  pre-collapse on its behalf. */
export declare function allRulesetConfigs(): RulesetConfig[];
export declare function createFadeoutEngine(config: RulesetConfig): GameEngine<FadeoutState, FadeoutMove, FadeoutState>;
/**
 * positionKey — the solver's hash key AND the superko history key (plan §2.1, §3.4).
 * Deliberately excludes `history`, `faded`, `longestLife`, and `lastEffects`: those are
 * legitimately part of `encode()`'s persistence key but NOT part of what makes two positions
 * "the same" for legality/value purposes. Per platform-corrections.md C3: `encode` is NOT a
 * valid position key for this game — export this separately so nobody reaches for encode()
 * when they mean this, or vice versa.
 */
export declare function positionKey(state: Pick<FadeoutState, "queues" | "toMove">): string;

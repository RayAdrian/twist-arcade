import type { GameManifest } from "@twist-arcade/game-spec";
import type { RulesetConfig } from "./engine-internal";
export declare const RULE_SENTENCE = "Your pieces vanish 3 turns after you place them.";
/** The one shipping ruleset (see the freeze note above). `games/fadeout/index.ts` and
 *  `games/registry.ts` both construct their engine instance from this single constant so the
 *  shipped config can never drift between the two call sites. */
export declare const FADEOUT_RULESET_CONFIG: RulesetConfig;
export declare const fadeoutManifest: GameManifest;

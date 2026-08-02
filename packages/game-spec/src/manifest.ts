// packages/game-spec/src/manifest.ts — GameManifest (plan §5.2), pure data.

import type { HarnessThresholds, SoloThresholds } from "./thresholds";

export interface DifficultyTier {
  id: "casual" | "standard" | "ruthless";
  policy: PolicySpec;
  budget: SearchBudget;
  minReplyMs: number; // artificial floor (~250 on casual) — UX feature
  blunder?: { epsilon: number; temperature: number }; // ε-softmax over root visit counts
}

export type SearchBudget =
  | { kind: "deadlineMs"; ms: number } // interactive play — responsive on weak devices
  | { kind: "rollouts"; n: number }; // DETERMINISTIC — same move on every machine

export type PolicySpec =
  | { kind: "random" }
  | { kind: "minimax"; maxDepth?: number } // requires engine.heuristic
  | { kind: "mcts"; explorationC?: number }
  | { kind: "beam"; width?: number } // solo Strong (also the hint/ghost feature)
  | { kind: "flat-mc"; rolloutsPerAction?: number }
  | { kind: "mix"; components: { weight: number; policy: PolicySpec }[] };

export interface GameManifest {
  id: string; // === engine.meta.id (contract test asserts equality)
  title: string; // "Fadeout", "Crackstep", "Mine Run"
  classic: string; // "Tic-Tac-Toe", "Minesweeper" — drives shelves
  ruleSentence: string; // <=90 chars — hard constraint
  tags: string[]; // ["decay"], ["press-your-luck"] — facets, next-twist loop
  estMinutes: number;
  modes: { bot: boolean; hotseat: boolean; asyncLink: boolean }; // solo games: no opponent
  //   modes at all — daily/endless framing is shell scope
  players: { min: number; max: number };
  difficultyTiers: DifficultyTier[]; // DATA consumed by packages/bots (2P games)
  thresholds?: Partial<HarnessThresholds | SoloThresholds>; // overrides platform defaults
  exceptions?: { gate: string; justification: string }[]; // visible in review

  /** Present iff players.max === 1. Drives which harness model and gate table apply. */
  solo?: {
    format: "daily-puzzle" | "score-chase";
    moveCap?: number; // default 2000 (chases); structural termination is still
    //   mandatory — the cap is a tripwire, not a rule
    scoreMonotone?: boolean; // enables the testkit monotonicity property
    /** §3.2 scale caveat from the solo lens: ratios need a score linear in achievements.
     *  Exponential-score games (2048-family) declare a linear proxy the harness compares
     *  on instead. */
    comparisonMetric?: "score" | { proxy: string };
    /** chase games: per-game Always-Safe hook is REQUIRED (harness enforces, §7.4) */
  };
}

/** 90-char rule check, asserted by the contract test on any manifest passed to it (also
 *  usable standalone). Kept here (data-adjacent) rather than in testkit so game-spec stays
 *  the single owner of manifest-shape invariants. */
export function assertRuleSentenceLength(manifest: Pick<GameManifest, "ruleSentence">): void {
  if (manifest.ruleSentence.length > 90) {
    throw new Error(
      `manifest.ruleSentence must be <=90 chars, got ${manifest.ruleSentence.length}: "${manifest.ruleSentence}"`
    );
  }
}

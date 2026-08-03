// packages/daily/src/era.ts — DailyBotRecord (plan §2.2): the pinned two-player daily
// opponent, stored and versioned — never "whatever the Standard tier happens to be today".
// `data/daily/era.json` (one entry per two-player game) is the review point for any change;
// DY1's era-snapshot guard (test/guards/era-snapshot.test.ts) is what makes an edit without
// a bumped `era` a build break rather than a silent retune.

import type { PolicySpec, SearchBudget } from "@twist-arcade/game-spec";

/**
 * The daily bot's budget, narrowed to `rollouts` at the TYPE level — not merely runtime-
 * asserted. `SearchBudget` (game-spec) is a union that includes `deadlineMs` because
 * interactive casual play legitimately wants it; the daily bot never does (plan §2.2: "NEVER
 * deadlineMs — a wall-clock budget plays differently on a fast laptop than a slow phone").
 * Narrowing here means `{ kind: "deadlineMs", ... }` is a compile error wherever a
 * `DailyBotRecord` is constructed in TypeScript, not just a runtime rejection of JSON loaded
 * from disk — the type-level-preferred fix from platform-corrections.md C1's pattern, applied
 * to this record. `assertValidBotRecord`'s runtime check stays regardless (C1: "runtime probe
 * — keep regardless"), because `data/daily/era.json` is untyped JSON on disk; a hand-edited
 * file can still contain the forbidden shape and TypeScript cannot see it there.
 */
export type DailyRolloutsBudget = Extract<SearchBudget, { kind: "rollouts" }>;

export interface DailyBotRecord {
  era: number; // monotonically increasing per game; bumped on ANY change to this record.
  tier: "standard"; // fixed (fadeout §14 Q3: Standard, not Ruthless).
  policy: PolicySpec; // resolved copy — e.g. { kind: "mcts" }.
  budget: DailyRolloutsBudget; // NEVER deadlineMs — enforced by the type, re-checked below.
  blunder: { epsilon: number; temperature: number } | null;
  botsVersion: string; // @twist-arcade/bots package version — the search implementation is
  // part of the bot's behavior.
  humanSeat: 0; // D1: human always P1; series alternation is suspended in daily mode.
}

/** One entry per two-player game, keyed by gameId — the shape of `data/daily/era.json`. */
export type EraFile = Record<string, DailyBotRecord>;

/**
 * Throws with a specific, greppable message identifying exactly which pinned field is
 * invalid — a typed, loud failure at load time rather than a bot that silently plays
 * differently on a fast laptop than a slow phone (plan §2.2's `rollouts`-never-`deadlineMs`
 * rule) or a daily where half the players were secretly P2 (D1's `humanSeat === 0` rule).
 */
export function assertValidBotRecord(record: DailyBotRecord): void {
  if (!Number.isInteger(record.era) || record.era < 1) {
    throw new Error(`era.ts: DailyBotRecord.era must be a positive integer, got ${JSON.stringify(record.era)}`);
  }
  if (record.tier !== "standard") {
    throw new Error(`era.ts: DailyBotRecord.tier must be "standard", got ${JSON.stringify(record.tier)}`);
  }
  if (record.budget.kind !== "rollouts") {
    throw new Error(
      `era.ts: DailyBotRecord.budget.kind must be "rollouts" (never "deadlineMs" — a wall-clock ` +
        `budget plays differently on a fast laptop than a slow phone, destroying comparability), got "${record.budget.kind}"`
    );
  }
  if (!Number.isInteger(record.budget.n) || record.budget.n < 1) {
    throw new Error(`era.ts: DailyBotRecord.budget.n must be a positive integer, got ${JSON.stringify(record.budget.n)}`);
  }
  if (record.humanSeat !== 0) {
    throw new Error(
      `era.ts: DailyBotRecord.humanSeat must be 0 (D1: the human is always P1 in daily mode — ` +
        `series alternation is suspended so every player's result is comparable), got ${JSON.stringify(record.humanSeat)}`
    );
  }
  if (record.blunder !== null) {
    if (record.blunder.epsilon < 0 || record.blunder.epsilon > 1) {
      throw new Error(`era.ts: DailyBotRecord.blunder.epsilon must be in [0, 1], got ${record.blunder.epsilon}`);
    }
    if (record.blunder.temperature <= 0) {
      throw new Error(`era.ts: DailyBotRecord.blunder.temperature must be > 0, got ${record.blunder.temperature}`);
    }
  }
  if (typeof record.botsVersion !== "string" || record.botsVersion.length === 0) {
    throw new Error("era.ts: DailyBotRecord.botsVersion must be a non-empty string");
  }
}

/** Validates every entry of an era file at once — used by DY1's CI guards and by
 *  manifest-generation tooling before a bot record is embedded in a day's manifest. */
export function assertValidEraFile(era: EraFile): void {
  for (const [gameId, record] of Object.entries(era)) {
    try {
      assertValidBotRecord(record);
    } catch (err) {
      throw new Error(`era.ts: era.json["${gameId}"] is invalid: ${(err as Error).message}`);
    }
  }
}

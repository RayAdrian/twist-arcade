// packages/daily/src/manifest.ts — DailyManifest (plan §1.5): the one committed, self-
// contained file a client needs (plus the game bundle it already loads) to play a given
// day's Twist. `assertValidManifest` is both the runtime load-time guard AND the CI
// formula-re-derivation / immutability-adjacent check (plan §2.3.3, §3.3, §11.5) — the same
// function is used in both places so there is exactly one place "what makes a manifest
// valid" is defined.

import { dailyNumber, isValidDailyDay } from "./day";
import { dailySeed, isCertifiedSeedOf } from "./seed";
import { assertValidBotRecord, type DailyBotRecord } from "./era";

export interface DailyManifest {
  day: string; // "2026-09-14" (UTC) — must match the filename it's committed under.
  n: number; // Daily #N — CI asserts n === dailyNumber(day).
  gameId: string;
  kind: "vs-bot" | "solo-puzzle" | "solo-chase";
  seed: string; // vs-bot: dailySeed(gameId, engineVersion, day) exactly;
  // solo: the CERTIFIED seed (formula + ":" + nonce, §3.1).
  engineVersion: string; // pinned — also an input to the seed formula.
  gameVersion: number;

  bot?: DailyBotRecord; // vs-bot only — the pinned opponent.
  puzzle?: {
    // solo-puzzle only — PUBLIC certificate subset. The solution/moveLog/solver
    // diagnostics never reach this type — see game-spec's DailyCertificate for those.
    par: number;
    parKind: "optimal" | "best-in-budget";
    difficulty: "gentle" | "standard" | "mean";
    guessFree?: boolean;
  };
  chase?: { moveBudget: number }; // solo-chase only.
}

export interface AssertValidManifestOptions {
  /** The day encoded in the filename this manifest was read from (e.g. "2026-09-14.json" ->
   *  "2026-09-14") — CI passes this so a manifest whose `day` field disagrees with its own
   *  filename fails loudly rather than silently resolving to the wrong Daily #N at runtime. */
  filenameDay?: string;
}

/**
 * Throws on the first violation found, with a message naming the specific field — a typed,
 * loud failure, never a fallback (plan §2.2, §2.3). Async because the vs-bot / solo-chase
 * paths re-derive the public seed formula via Web Crypto to check it against the stored
 * `seed` (the "formula re-derivation" CI job, §2.3.3, done inline rather than as a separate
 * pass so runtime load-time validation and CI validation are provably the same check).
 */
export async function assertValidManifest(manifest: DailyManifest, opts: AssertValidManifestOptions = {}): Promise<void> {
  if (opts.filenameDay !== undefined && opts.filenameDay !== manifest.day) {
    throw new Error(
      `manifest.ts: manifest.day ("${manifest.day}") does not match its filename ("${opts.filenameDay}.json") — ` +
        "a manifest must resolve the same Daily #N whether read by day or by URL."
    );
  }
  if (!isValidDailyDay(manifest.day)) {
    throw new Error(`manifest.ts: manifest.day ("${manifest.day}") is not a valid day at or after DAILY_EPOCH`);
  }
  const expectedN = dailyNumber(manifest.day);
  if (manifest.n !== expectedN) {
    throw new Error(`manifest.ts: manifest.n (${manifest.n}) !== dailyNumber(manifest.day) (${expectedN})`);
  }

  switch (manifest.kind) {
    case "vs-bot": {
      if (!manifest.bot) {
        throw new Error(`manifest.ts: kind "vs-bot" requires a bot record, got none (gameId="${manifest.gameId}")`);
      }
      assertValidBotRecord(manifest.bot); // rollouts-only, humanSeat === 0, etc.
      const expectedSeed = await dailySeed(manifest.gameId, manifest.engineVersion, manifest.day);
      if (manifest.seed !== expectedSeed) {
        throw new Error(
          `manifest.ts: vs-bot manifest.seed does not match dailySeed(gameId, engineVersion, day) — ` +
            "the comparability contract requires the exact public formula output, never a substitute."
        );
      }
      break;
    }
    case "solo-puzzle": {
      if (!manifest.puzzle) {
        throw new Error(
          `manifest.ts: kind "solo-puzzle" requires a puzzle block (the certificate's public subset) — ` +
            `a solo daily is never shipped uncertified (gameId="${manifest.gameId}")`
        );
      }
      const formula = await dailySeed(manifest.gameId, manifest.engineVersion, manifest.day);
      if (!isCertifiedSeedOf(manifest.seed, formula)) {
        throw new Error(
          "manifest.ts: solo-puzzle manifest.seed is not a certified derivative " +
            '("formula:nonce") of dailySeed(gameId, engineVersion, day).'
        );
      }
      break;
    }
    case "solo-chase": {
      if (!manifest.chase) {
        throw new Error(`manifest.ts: kind "solo-chase" requires a chase block (moveBudget), got none (gameId="${manifest.gameId}")`);
      }
      if (!Number.isInteger(manifest.chase.moveBudget) || manifest.chase.moveBudget < 1) {
        throw new Error(`manifest.ts: chase.moveBudget must be a positive integer, got ${manifest.chase.moveBudget}`);
      }
      const expectedSeed = await dailySeed(manifest.gameId, manifest.engineVersion, manifest.day);
      if (manifest.seed !== expectedSeed) {
        throw new Error("manifest.ts: solo-chase manifest.seed does not match dailySeed(gameId, engineVersion, day).");
      }
      break;
    }
  }
}

// packages/daily/src/index.ts — @twist-arcade/daily's public surface. Consumers (the app, other
// packages) import ONLY from here — package.json's "main"/"types" point here, mirroring
// packages/shell/src/index.ts's own convention. CI/build-time tooling (the DY1 guards, the
// rotation generator, and the CLI scripts under src/bin/) is deliberately NOT re-exported here:
// it runs via `pnpm --filter @twist-arcade/daily run guard:*` / `daily:schedule`, never imported
// at runtime by the app, so it stays out of the app's bundle graph entirely. Import those
// modules directly by path (e.g. `@twist-arcade/daily/src/rotation`) if a future admin tool
// genuinely needs them as a library rather than a CLI.

// The daily day/number resolution (plan §1.1/§1.3/§1.4) — the one place production code should
// ever read the real clock for daily purposes.
export { DAILY_EPOCH, addUTCDays, dailyNumber, isValidDailyDay, msUntilNextUTCMidnight, todayUTC, toUTCDateString } from "./day";

// The public, offline-computable seed formula (plan §2.1).
export { dailySeed, isCertifiedSeedOf } from "./seed";

// The pinned daily bot record (plan §2.2) — the comparability contract's other half.
export { assertValidBotRecord, assertValidEraFile } from "./era";
export type { DailyBotRecord, DailyRolloutsBudget, EraFile } from "./era";

// The DailyManifest schema + its load-time/CI validator (plan §1.5, §2.3).
export { assertValidManifest } from "./manifest";
export type { AssertValidManifestOptions, DailyManifest } from "./manifest";

// The site-level streak reducer (plan §6) — pure; localStorage helpers included. Consolidated
// into @twist-arcade/shell per platform-corrections.md C8 (2026-08-03): this package no longer
// ships its own copy — shell's streak.ts is the one implementation (see that file's header for
// why the direction is daily-imports-shell, not the reverse).
export { applyDailyCompletion, INITIAL_STREAK, readStreak, recordDailyCompletion, writeStreak, type StreakRecord } from "@twist-arcade/shell";

// The share artifact composer + grammar validator (plan §4).
export { composeShareText, GLYPH_TABLE, ShareGrammarError, truncateTimeline } from "./share";
export type { ComposeShareTextOptions, ShareInput } from "./share";

// The provider-agnostic metrics facade (plan §10, orchestrator addendum §12 Q1).
export {
  configureMetricsProvider,
  noopProvider,
  shareOutcomeToPath,
  track,
  trackOnceForDaily,
  umamiProvider,
} from "./metrics";
export type { DailyKind, MetricsProvider, ShareMode, SharePath, TrackEventName, TrackEventPropsMap } from "./metrics";

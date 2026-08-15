// packages/shell/src/index.ts — @twist-arcade/shell's public surface. Games import ONLY from
// here (plan §2's package.json main/types point here) — internal wiring (board-context,
// lib/cn, the ui/* primitives) is deliberately NOT re-exported; it's shell-internal machinery,
// not part of the contract a game author builds against.

// The platform hook (plan §5) — the one thing every game screen is built around.
export { useGame } from "./useGame";
export type {
  DailyOptions,
  HandoffState,
  AnnouncementState,
  Mode,
  UseGameOptions,
  UseGameResult,
} from "./useGame";

// The bot seam (plan §5.4) + the S2 real worker driver.
export { BotCancelledError, ScriptExhaustedError, WorkerBotError, scriptedBotDriver, stubBotDriver, workerBotDriver } from "./bot-driver";
export type { BotDriver, BotMoveRequest, BotMoveResponse, SearchStats, TierId, WorkerLike } from "./bot-driver";

// Components (plan §4).
export { AriaAnnouncer } from "./components/AriaAnnouncer";
export { BoardShell } from "./components/BoardShell";
export type { BoardShellProps } from "./components/BoardShell";
export { CalloutLayer } from "./components/CalloutLayer";
export type { CalloutLayerProps } from "./components/CalloutLayer";
export { Cell } from "./components/Cell";
export type { CellProps } from "./components/Cell";
export { ControlsRow } from "./components/ControlsRow";
export type { ControlsRowProps } from "./components/ControlsRow";
export { CountdownBadge } from "./components/CountdownBadge";
export type { CountdownBadgeProps } from "./components/CountdownBadge";
export { GameCard } from "./components/GameCard";
export type { GameCardProps } from "./components/GameCard";
export { GameShell } from "./components/GameShell";
export type { GameShellProps } from "./components/GameShell";
export { HowSheet } from "./components/HowSheet";
export type { HowSheetProps } from "./components/HowSheet";
export { PassDeviceInterstitial } from "./components/PassDeviceInterstitial";
export type { PassDeviceInterstitialProps } from "./components/PassDeviceInterstitial";
export { ResultModal } from "./components/ResultModal";
export type { ResultModalProps } from "./components/ResultModal";
export { RuleCard } from "./components/RuleCard";
export type { RuleCardProps } from "./components/RuleCard";
export { ScoreHUD } from "./components/ScoreHUD";
export type { ScoreHUDProps } from "./components/ScoreHUD";
export { StatusLine } from "./components/StatusLine";
export type { StatusLineProps } from "./components/StatusLine";
export { TurnIndicator } from "./components/TurnIndicator";
export type { TurnIndicatorProps, TurnIndicatorSeat } from "./components/TurnIndicator";

// Pure modules a game/route may reasonably need directly (persistence keys, the cellId
// convention, share/next-twist/shelves helpers). design-tokens/tokens.css are consumed via the
// package's separate "./tokens.css" export + Tailwind config, not re-exported as JS here.
export { moveToCellId } from "./cell-id";
export {
  composeAnnouncement,
  isDecayClassEffects,
  shellTurnPhrase,
  type ComposeAnnouncementInput,
  type TurnPhase,
  type TurnPhraseInput,
} from "./announcer";
export { mapEffects, finalPulseAnimation, type AnimationPrefs, type CellAnimation, type EffectAnimationKind } from "./effects-map";
// UI direction §5.3, R1 — the ONE gate every Motion One call site (shell OR games) must use;
// eslint.config.mjs's raw-animate-import ban makes this the only legal way to reach Motion
// One's `animate()` anywhere outside this module itself.
export { animateSafe, prefersReducedMotion, type AnimateSafeHandle, type AnimateSafeOptions, type SafeKeyframes } from "./motion";
export {
  composeShareArtifact,
  composeShareText,
  GLYPH_TABLE,
  invokeShare,
  ShareFrameTooLongError,
  ShareGrammarError,
  timelineToBody,
  truncateTimeline,
  type ComposeShareTextOptions,
  type ShareFrameInput,
  type ShareInput,
  type ShareOutcome,
} from "./share-frame";
export { pickNextTwist } from "./next-twist";
export { buildShelves, type Shelf } from "./shelves";
export { cardTiltClass, pickFeaturedManifest, shouldShowStreakFlame } from "./home";
export { applyDailyCompletion, INITIAL_STREAK, readStreak, recordDailyCompletion, writeStreak, type StreakRecord } from "./streak";
export { vibrate, type HapticPattern } from "./haptics";
export { dailyKey, firstsKey, gameKey, readVersioned, removeVersioned, writeVersioned, SETTINGS_KEY } from "./persistence";
export { hasPlayedFirstGame, hasShownCallout, markCalloutShown, markFirstGamePlayed } from "./callouts";

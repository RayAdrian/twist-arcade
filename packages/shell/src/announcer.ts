// packages/shell/src/announcer.ts — the announce composition rule (ux-lens §8, plan §6.2,
// the critical spec). Pure: `useGame` calls these after every applied step and hands the
// result to `AriaAnnouncer`; the component itself does no composition.
//
// Fixed order, always: what happened -> what's imminent -> board summary (decay-class only)
// -> whose turn. The turn phrase is entirely SHELL-owned — games never write it, since a
// game's `announce()` has no idea what mode/seat is presenting.

import type { Effect } from "@twist-arcade/engine";

export type TurnPhase =
  | "your-turn"
  | "their-turn"
  | "bot-thinking"
  | "handoff"
  | "waiting" // reserved, Phase 2 async — no copy defined yet
  | "finished"
  | "pie-decision"; // reserved slot (§4.17) — not built; typed so adding it later isn't breaking

export interface TurnPhraseInput {
  phase: TurnPhase;
  actorLabel?: string;
}

/** StatusLine's copy table (plan §4.7) — the ONE place these strings are written. */
export function shellTurnPhrase({ phase, actorLabel }: TurnPhraseInput): string {
  switch (phase) {
    case "your-turn":
      return "Your move.";
    case "their-turn":
      return `${actorLabel ?? "Opponent"}'s move.`;
    case "bot-thinking":
      return "Bot is thinking…";
    case "handoff":
      return `Pass the device to ${actorLabel ?? "the next player"}.`;
    case "pie-decision":
      return `${actorLabel ?? "Player two"}: keep your side, or swap?`;
    case "waiting":
    case "finished":
      return "";
  }
}

/** Decay-class gate (plan §6.2): full-board readback fires ONLY when `lastEffects` contains
 *  a decay-class type — verbosity is its own accessibility failure (ux-lens §8), so every
 *  other move stays terse. */
export function isDecayClassEffects(effects: readonly Effect[]): boolean {
  return effects.some((e) => e.type === "decayed" || e.type === "crumbled" || e.type === "removed");
}

export interface ComposeAnnouncementInput {
  /** presentation.announce({ kind: "moved", ... }) — "what happened". */
  moved: string;
  /** presentation.announce({ kind: "imminent", ... }) — "" when nothing is imminent. */
  imminent?: string;
  /** presentation.announce({ kind: "boardSummary", ... }) — ONLY passed on decay-class
   *  events (isDecayClassEffects gate above); omitted otherwise. */
  boardSummary?: string;
  /** shellTurnPhrase(...) — "" for phases with no turn phrase (e.g. "finished"). */
  turnPhrase: string;
}

/** Joins non-empty fragments with a single space, in the fixed order the spec mandates.
 *  Never produces double spaces or stray leading/trailing whitespace regardless of which
 *  fragments are empty. */
export function composeAnnouncement(input: ComposeAnnouncementInput): string {
  return [input.moved, input.imminent, input.boardSummary, input.turnPhrase]
    .filter((fragment): fragment is string => Boolean(fragment && fragment.length > 0))
    .join(" ");
}

// packages/shell/src/components/StatusLine.tsx — plan §4.7. Whose turn / result, in WORDS
// (never color-alone). Deliberately NOT an aria-live region: the polite live region is owned
// exclusively by AriaAnnouncer via the announcer composition rule (§6.2) — StatusLine mirrors
// nothing itself, so the page never has two competing announcement sources.
//
// Material restyle only (UI direction §3): bumped to the plan's inline "text-base 500" call-out
// for this line. NOT yet built: the wireframe's glyph chip in the current player's accent — that
// needs an accent/seat prop threaded down from GameShell (a props-surface change, not a
// className one), deliberately left for whichever pass actually wires player-accent-aware
// chrome end to end, rather than bolted on here as an unused prop.

import { shellTurnPhrase, type TurnPhase } from "../announcer";

export interface StatusLineProps {
  phase: TurnPhase;
  actorLabel?: string;
  /** Shown instead of the turn phrase when phase === "finished". */
  resultText?: string;
}

export function StatusLine({ phase, actorLabel, resultText }: StatusLineProps) {
  const text =
    phase === "finished" && resultText
      ? resultText
      : shellTurnPhrase(actorLabel === undefined ? { phase } : { phase, actorLabel });
  return <p className="text-center font-display text-lg font-extrabold text-ink">{text}</p>;
}

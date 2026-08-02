// packages/shell/src/components/StatusLine.tsx — plan §4.7. Whose turn / result, in WORDS
// (never color-alone). Deliberately NOT an aria-live region: the polite live region is owned
// exclusively by AriaAnnouncer via the announcer composition rule (§6.2) — StatusLine mirrors
// nothing itself, so the page never has two competing announcement sources.

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
  return <p className="text-center text-sm font-medium text-ink">{text}</p>;
}

// packages/shell/src/components/RuleCard.tsx — plan §4.2. Shell owns card + trigger; the
// game owns the sentence. Single line, always visible above the board, the only paragraph on
// the screen. Dev-mode assertion: sentence <=90 chars (manifest contract) — warns loudly via
// console.error, never throws (a bad manifest string should never crash the page).
//
// "use client" — the "How?" trigger's onClick handler (see board-context.tsx's comment for why
// this is needed per-file even though RuleCard itself has no hooks).
"use client";

export interface RuleCardProps {
  sentence: string;
  onHow(): void;
}

export function RuleCard({ sentence, onHow }: RuleCardProps) {
  if (process.env.NODE_ENV !== "production" && sentence.length > 90) {
    console.error(
      `RuleCard: manifest.ruleSentence must be <=90 chars, got ${sentence.length}: "${sentence}"`
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-sm text-ink">{sentence}</p>
      <button
        type="button"
        onClick={onHow}
        className="shrink-0 text-sm text-ink-muted underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        How?
      </button>
    </div>
  );
}

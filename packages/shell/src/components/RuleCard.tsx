// packages/shell/src/components/RuleCard.tsx — plan §4.2, restyled per UI direction §3: a
// paper-lift card with a LEFT SPINE (the board frame's own --stroke-brush weight, ink) instead
// of a bare unstyled row — the "rule" type scale (§1.4: Instrument Sans 500, 17px) puts the
// most-read sentence in the product above the default body size. Shell still owns card +
// trigger; the game still owns the sentence. Dev-mode assertion (sentence <=90 chars) and the
// "warn loudly, never throw" contract are unchanged.
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
    <div className="flex items-baseline justify-between gap-3 rounded-r-xl border-l-brush border-ink bg-paper-lift px-4 py-3">
      <p className="text-[1.0625rem] font-medium leading-[1.4] text-ink">{sentence}</p>
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

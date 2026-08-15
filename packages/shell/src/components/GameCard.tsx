// packages/shell/src/components/GameCard.tsx — plan §4.13 / ux-lens §4, restyled per UI
// direction §2.2 ("GameCard v2"). Server component (no interactivity beyond navigation).
// Fixed anatomy, UNCHANGED: tiny abstract glyph, twist title, "a twist on {classic}", the
// CANONICAL rule sentence (byte-identical to the in-game RuleCard and the OG description — all
// three read the same manifest field), chips (mechanic tags + "~N min"), whole card is the
// play affordance. Only the material dressing changes here — paper-lift surface, the print-
// shop stroke/shadow scale, and the three type faces (§1.1) — nothing about what's rendered or
// its accessible structure moved.
//
// "a twist on {classic}" is derived via classicAttributionLine (../manifest-copy), not a raw
// template string: Crackstep's `classic` is an explanatory placeholder
// ("N/A — an original twist on a floor-coverage path puzzle"), and prefixing it directly
// produced a garbled line on its card — see manifest-copy.ts's own doc for the full story.

import type { ReactNode } from "react";
import Link from "next/link";
import type { GameManifest } from "@twist-arcade/game-spec";
import { classicAttributionLine } from "../manifest-copy";

export interface GameCardProps {
  manifest: GameManifest;
  glyph?: ReactNode;
  featured?: boolean;
}

export function GameCard({ manifest, glyph, featured }: GameCardProps) {
  const attribution = classicAttributionLine(manifest.classic);
  return (
    <Link
      href={`/play/${manifest.id}`}
      className={
        featured
          ? // featured variant (§2.2): brush border + the one hand-drawn moment this card is
            // rationed (Move 6) — `.edge-hand` supplies its own border-radius, so `rounded-xl`
            // is deliberately omitted here.
            "group block edge-hand border-brush border-ink bg-paper-lift p-4 shadow-print-3 no-underline transition-[transform,box-shadow] duration-place ease-arcade motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-print-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          : "group block rounded-xl border-ui border-ink bg-paper-lift p-4 shadow-print-3 no-underline transition-[transform,box-shadow] duration-place ease-arcade motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-print-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      }
    >
      <div aria-hidden="true" className="mb-2 text-2xl text-ink-muted">
        {glyph ?? "◇"}
      </div>
      <h3 className="font-display text-xl font-semibold text-ink">{manifest.title}</h3>
      {attribution && <p className="text-sm text-ink-muted">{attribution}</p>}
      <p className="mt-2 font-texture text-ink-muted line-clamp-3">{manifest.ruleSentence}</p>
      <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[0.7rem] uppercase tracking-wide text-ink-muted">
        {manifest.tags.map((tag) => (
          <li key={tag} className="rounded-full border-hairline border-ink-muted px-2 py-0.5">
            {tag}
          </li>
        ))}
        <li className="rounded-full border-hairline border-ink-muted px-2 py-0.5">~{manifest.estMinutes} min</li>
      </ul>
    </Link>
  );
}

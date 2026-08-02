// packages/shell/src/components/GameCard.tsx — plan §4.13 / ux-lens §4. Server component
// (no interactivity beyond navigation). Fixed anatomy: tiny abstract glyph, twist title,
// "a twist on {classic}", the CANONICAL rule sentence (byte-identical to the in-game
// RuleCard and the OG description — all three read the same manifest field), chips
// (mechanic tags + "~N min"), whole card is the play affordance.

import type { ReactNode } from "react";
import Link from "next/link";
import type { GameManifest } from "@twist-arcade/game-spec";

export interface GameCardProps {
  manifest: GameManifest;
  glyph?: ReactNode;
  featured?: boolean;
}

export function GameCard({ manifest, glyph, featured }: GameCardProps) {
  return (
    <Link
      href={`/play/${manifest.id}`}
      className={
        featured
          ? "block rounded-lg border-2 border-ink p-4 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          : "block rounded-lg border border-ink-muted p-4 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      }
    >
      <div aria-hidden="true" className="mb-2 text-2xl text-ink-muted">
        {glyph ?? "◇"}
      </div>
      <h3 className="font-bold text-ink">{manifest.title}</h3>
      <p className="text-xs text-ink-muted">a twist on {manifest.classic}</p>
      <p className="mt-2 text-sm text-ink">{manifest.ruleSentence}</p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs text-ink-muted">
        {manifest.tags.map((tag) => (
          <li key={tag} className="rounded-full border border-ink-muted px-2 py-0.5">
            {tag}
          </li>
        ))}
        <li className="rounded-full border border-ink-muted px-2 py-0.5">~{manifest.estMinutes} min</li>
      </ul>
    </Link>
  );
}

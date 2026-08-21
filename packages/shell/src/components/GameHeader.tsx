// packages/shell/src/components/GameHeader.tsx — design 2a ("Play, result, how-to, loading —
// same anatomy, zine material"): every game screen shares one header band — "◂ Library" back
// to the home shelf, the game title, and a trailing chip. Chrome-only (Riso Zine home
// direction, design 1b's own masthead/hero precedent for decorative `bg-accent-p1`/`p2` bands
// — see app/page.tsx's header and featured-hero panel, which already use these two hues purely
// decoratively, not as a "this names a player" signal); never renders canonical game state.
//
// `accent` is caller-computed (GameShell derives it from `mode`, never a new manifest field —
// see GameShell.tsx's own comment) so this component stays pure presentation.
//
// Server-safe: no hooks, no event handlers of its own (the Library link is a plain <a>, not
// next/link — this package doesn't depend on next/navigation; GameCard.tsx's existing
// `next/link` import establishes this package MAY use it, but a plain anchor is sufficient
// here and keeps this component framework-agnostic for any future non-Next host).

export interface GameHeaderProps {
  title: string;
  accent: "p1" | "p2";
  /** Trailing chip text — e.g. "daily 41" (a certified daily puzzle) or "◌ decay" (the
   *  manifest's first facet tag). Omitted entirely (no chip rendered) when there is nothing
   *  worth naming. */
  chip?: string;
}

export function GameHeader({ title, accent, chip }: GameHeaderProps) {
  const bg = accent === "p1" ? "bg-accent-p1" : "bg-accent-p2";
  return (
    <header className={`flex items-center justify-between gap-3 rounded-t-xl border-brush border-ink px-4 py-3 text-paper ${bg}`}>
      <a
        href="/"
        className="font-mono text-xs font-semibold tracking-wide no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        ◂ Library
      </a>
      <h1 className="truncate font-display text-xl font-black leading-none">{title}</h1>
      {chip ? (
        <span className="shrink-0 font-mono text-xs tracking-wide opacity-90">{chip}</span>
      ) : (
        // Keeps the title visually centered (three-column flex) even with no chip to show.
        <span aria-hidden="true" className="w-0" />
      )}
    </header>
  );
}

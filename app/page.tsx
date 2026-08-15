// app/page.tsx — the library home, Phase 1: "Riso Zine" (design direction 1b — overprint,
// tape, cut-out cards). Replaces the Phase 0 placeholder (a bare card grid) with the full
// masthead + featured-twist hero + classic-family shelves home, built from real registry data
// only. Server Component: the only interactive piece is the streak flame, isolated into its own
// client island (./StreakBadge.tsx) so the rest of this page ships zero client JS.
//
// Three content conflicts between the source design mock and this codebase's real state,
// resolved here (see the final report for the full reasoning):
//
//  1. The mock's "next twist" teaser named "Order vs Chaos" — that game was KILLED
//     (docs/plans/platform-corrections.md C44) and will never ship. This page never names it.
//     The hero instead shows a "Featured Twist" — a stable, deterministic pick
//     (pickFeaturedManifest, packages/shell/src/home.ts), not a fabricated "next drop" promise.
//  2. The mock's invented statistics ("2,141 solved · avg 4:12", "best run 27", "issue no. 41")
//     have no data source in this codebase — persistence.ts has no per-game "best score" schema
//     (see games/mine-run/manifest.ts's own solo-chase comments: banked score has no "solved"
//     concept, and no component anywhere writes a best-run number). None of those numbers are
//     rendered. The one real, persisted stat — the site-level daily streak (streak.ts) — renders
//     ONLY when it's genuinely nonzero (StreakBadge.tsx), never a hollow "🔥0".
//  3. Tilt's manifest sets `classic: "four-in-a-row"`, not the mock's "Tic-Tac-Toe, twisted"
//     grouping. `buildShelves` derives shelves from the real manifests, so Tilt lands in the
//     "All games" remainder shelf (alone in its own classic family) rather than being force-fit
//     under Tic-Tac-Toe — the real grouping wins over the mock's.
//
// Two further, deliberate simplifications versus ui-direction.md §2.3's full "hero
// playability" spec (a live, tappable board rendered from `engine.init(dailySeed)`):
//   - No live board renders on this page. §2.3 requires importing a game's actual engine into
//     app/**, which eslint.config.mjs's registrySplittingBoundary rule statically forbids
//     (engines/UI load ONLY through registry[id].loadEngine()/loadPresentation(), never a
//     static import from app/**) — and the daily-seed infrastructure §2.3 assumes doesn't exist
//     yet regardless (its own "Dependency flag" says so). The hero is content-only: title,
//     classic, the canonical rule sentence, and a Play CTA into the real game route.
//   - `pickFeaturedManifest` does not rotate by day (§2.3's "rotate by dayIndex % registry.
//     length" suggestion). This page is statically generated (no dynamic API reads, matching
//     Phase 0's own page); a wall-clock read here would bake in whatever day the page happened
//     to be BUILT on, not the day it's viewed — a staleness trap, not a real daily rotation. A
//     stable pick is the honest choice until real daily-seed infra lands.
//
// Relative import into the registry (not the "@/*" alias) — same documented reason Phase 0's
// page carried: `next build` resolves path aliases from the tsconfig it reads by default (this
// monorepo's root tsconfig.json, a references-only stub with no `paths` of its own), not
// tsconfig.app.json (where the alias is actually declared).
import Link from "next/link";
import {
  buildShelves,
  cardTiltClass,
  classicAttributionLine,
  GameCard,
  pickFeaturedManifest,
} from "@twist-arcade/shell";
import { registry } from "../games/registry";
import { StreakBadge } from "./StreakBadge";

// Riso Zine hero decoration (design 1b) — the floating tile-grid motif (ta-float keyframe,
// app/globals.css). Purely decorative (`aria-hidden`), never the sole carrier of information,
// and never depicts real board/piece state (there is no live board here — see this file's
// module doc) — so it needs no reduced-motion gate of its own beyond the global blanket
// globals.css already applies to every animation in the product.
//
// CONTAINED in its own grid column (rendered only at `lg+`, alongside the hero text column —
// see the JSX below), never absolutely positioned across the whole panel: a first pass scattered
// these with absolute `top`/`left` percentages over the ENTIRE hero, and at the width where the
// two-column layout collapses to one column, a tile ended up sitting on top of the rule
// sentence's word "without" (orchestrator review of design 1b). A dedicated flow-layout column
// cannot overlap the text column's content — there is no shared positioning context between them.
const HERO_TILES = [
  { size: 20, delay: "0s" },
  { size: 14, delay: "0.5s" },
  { size: 18, delay: "1s" },
  { size: 12, delay: "0.2s" },
  { size: 22, delay: "0.8s" },
  { size: 16, delay: "1.3s" },
  { size: 14, delay: "0.4s" },
  { size: 20, delay: "1.1s" },
] as const;

export default function HomePage() {
  const manifests = Object.values(registry).map((entry) => entry.manifest);
  const shelves = buildShelves(manifests);
  const featured = pickFeaturedManifest(manifests);

  return (
    <div className="min-h-svh bg-paper-zine">
      {/* `role="banner"` is load-bearing, not decorative: app/layout.tsx wraps every route's
       * children in a single shared `<main id="main">` (the skip-link target), so this
       * `<header>` is a DESCENDANT of `<main>` — per the HTML-AAM spec, a `<header>` only gets
       * the implicit `banner` landmark role when it is NOT nested inside main/article/aside/
       * nav/section. Explicit ARIA restores the landmark ui-direction.md §2.5 asks for without
       * restructuring the shared layout (which every other route also depends on). Same
       * reasoning applies to `role="contentinfo"` on the footer below. */}
      <header
        role="banner"
        className="border-b-brush border-ink bg-accent-p1 px-4 py-4 sm:px-6"
      >
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
          <div>
            {/* The page's ONE <h1> — the site wordmark, not the featured game below (which is
             * an <h2>, matching every shelf header's own level). e2e/a11y.spec.ts's home-page
             * gate asserts a heading named "Twist Arcade" is visible (a pre-existing
             * expectation from the Phase 0 page, which also used an <h1> here); a first pass
             * of this redesign made the wordmark a plain <p>, which both broke that gate AND
             * left two competing <h1>s in play (this one, and the hero's "Crackstep") once
             * fixed the wrong way. */}
            <h1 className="text-shadow-overprint font-display text-[clamp(1.75rem,7vw,3.375rem)] font-black leading-none text-paper">
              <span aria-hidden="true">◇</span> Twist Arcade
            </h1>
            <p className="font-texture mt-1 text-paper">classic games, one rule changed</p>
          </div>
          <StreakBadge />
        </div>
      </header>

      {manifests.length === 0 ? (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="rounded-xl border-ui border-ink bg-paper-lift p-6 text-ink-muted shadow-print-3">
            No games are live yet — check back soon.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-10 px-4 py-10 lg:space-y-14">
          {featured && (
            <section
              aria-labelledby="featured-heading"
              // No `.edge-hand` here (Move 6's wobble border is spec'd for a board-frame-sized
              // element — the result stamp, an aha-callout, a live board frame — not a large
              // full-width panel). A first pass applied it to this whole section and its
              // enormous asymmetric radius fought visibly with the hard offset `shadow-print-4`
              // at one corner (orchestrator review of design 1b: "the bottom edge is
              // doubled/warped"). Plain `rounded-xl` (the same combo GameCard's own
              // non-featured variant already uses successfully) has no such conflict.
              className="rotate-[-0.5deg] rounded-xl border-brush border-ink bg-accent-p2 p-6 shadow-print-4 lg:grid lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-10"
            >
              <div>
                <span className="inline-block -rotate-3 border-hairline border-ink bg-marker px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] text-ink shadow-print-2">
                  Featured Twist
                </span>
                <h2
                  id="featured-heading"
                  className="mt-3 font-display text-[clamp(2.25rem,8vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.01em] text-paper"
                >
                  {featured.title}
                </h2>
                {classicAttributionLine(featured.classic) && (
                  <p className="mt-1 text-sm text-paper">{classicAttributionLine(featured.classic)}</p>
                )}
                <p className="mt-3 font-texture text-paper">{featured.ruleSentence}</p>
                <Link
                  href={`/play/${featured.id}`}
                  className="mt-6 inline-block border-brush border-ink bg-paper-lift px-6 py-3 font-sans font-semibold text-ink no-underline shadow-print-3 transition-[transform,box-shadow] duration-place ease-arcade motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-print-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  ▶ Play {featured.title}
                </Link>
              </div>

              {/* The tile-grid motif — its OWN grid column, `lg+` only. Never absolutely
               * positioned over the text column (see HERO_TILES's own comment above for the
               * defect this replaced: a tile used to sit on top of the rule sentence). Hidden
               * below `lg` entirely rather than reflowed underneath the text, so it can never
               * become a mobile overlap risk either. */}
              <div
                aria-hidden="true"
                className="pointer-events-none hidden lg:grid lg:grid-cols-4 lg:place-items-center lg:gap-4"
              >
                {HERO_TILES.map((tile, i) => (
                  <span
                    key={i}
                    className="ta-float rounded-sm border-hairline border-paper-lift bg-marker"
                    style={{
                      width: tile.size,
                      height: tile.size,
                      animationDelay: tile.delay,
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {shelves.map((shelf, shelfIndex) => (
            <section key={shelf.title} aria-labelledby={`shelf-heading-${shelfIndex}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  id={`shelf-heading-${shelfIndex}`}
                  className="font-display text-xl font-semibold text-ink"
                >
                  {shelf.title}{" "}
                  <span className="font-mono text-sm font-normal tabular-nums text-ink-muted">
                    {/* buildShelves caps `shelf.games` at SHELF_CAP (8) and reports the overflow
                     * only as the boolean `hasMore` — it does not expose the family's real
                     * total count. `shelf.games.length` is therefore the CAPPED count, not the
                     * true one: at today's data (every family well under 8) they're identical,
                     * but a family that grew past 8 would render "(8)" here while actually
                     * holding more — a latent trap, not just a cosmetic nit. "8+" is the
                     * cheapest correct fix available from data already in hand; a real total
                     * would need buildShelves' Shelf type to carry one, which is out of scope
                     * for this pass. */}
                    ({shelf.games.length}
                    {shelf.hasMore ? "+" : ""})
                  </span>
                </h2>
                {/* No browse/filter route exists yet (deferred per ui-direction.md §2.1 until
                 * ~15 games) — `hasMore` is rendered as an inert label, never a dead link. */}
                {shelf.hasMore && (
                  <span className="shrink-0 font-mono text-xs uppercase tracking-[0.12em] text-ink-muted">
                    See all
                  </span>
                )}
              </div>
              <hr aria-hidden="true" className="divider-squiggle mb-4 mt-2 h-2 border-0" />
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {shelf.games.map((manifest, i) => (
                  <li
                    key={manifest.id}
                    // The tilt class (app/globals.css's `.tilt-a`..`.tilt-f`) carries its own
                    // `transition: transform` and `:hover { transform: rotate(0) }` — nothing
                    // extra needed here.
                    className={cardTiltClass(i)}
                  >
                    <GameCard manifest={manifest} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer
        role="contentinfo"
        className="border-t-hairline border-ink-muted bg-paper-shade px-4 py-6 text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-ink-muted">
          New twists weekly <span aria-hidden="true">· ◇</span>
        </p>
      </footer>
    </div>
  );
}

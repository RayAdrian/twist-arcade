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
import { buildShelves, cardTiltClass, GameCard, pickFeaturedManifest } from "@twist-arcade/shell";
import { registry } from "../games/registry";
import { StreakBadge } from "./StreakBadge";

// Riso Zine hero decoration (design 1b) — the floating tile-grid motif (ta-float keyframe,
// app/globals.css). Purely decorative (`aria-hidden`), never the sole carrier of information,
// and never depicts real board/piece state (there is no live board here — see this file's
// module doc) — so it needs no reduced-motion gate of its own beyond the global blanket
// globals.css already applies to every animation in the product.
const HERO_TILES = [
  { top: "8%", left: "6%", size: 22, delay: "0s" },
  { top: "62%", left: "10%", size: 16, delay: "0.6s" },
  { top: "20%", left: "88%", size: 18, delay: "0.3s" },
  { top: "72%", left: "82%", size: 24, delay: "0.9s" },
  { top: "42%", left: "94%", size: 14, delay: "1.2s" },
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
        className="flex h-14 items-center justify-between border-b-brush border-ink bg-accent-p1 px-4"
      >
        <span className="font-display text-lg font-semibold text-paper text-shadow-overprint">
          <span aria-hidden="true">◇</span> Twist Arcade
        </span>
        <StreakBadge />
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
              className="edge-hand relative overflow-hidden rotate-[-0.5deg] border-brush border-ink bg-accent-p2 p-6 shadow-print-4 lg:grid lg:grid-cols-2 lg:items-center lg:gap-8 lg:p-10"
            >
              {HERO_TILES.map((tile, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="ta-float pointer-events-none absolute rounded-sm border-hairline border-paper-lift bg-marker"
                  style={{
                    top: tile.top,
                    left: tile.left,
                    width: tile.size,
                    height: tile.size,
                    animationDelay: tile.delay,
                  }}
                />
              ))}

              <div className="relative">
                <span className="inline-block -rotate-[2deg] border-hairline border-ink bg-marker px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] text-ink shadow-print-2">
                  Featured Twist
                </span>
                <h1
                  id="featured-heading"
                  className="mt-3 font-display text-[clamp(2.25rem,8vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.01em] text-paper"
                >
                  {featured.title}
                </h1>
                <p className="mt-1 text-sm text-paper">a twist on {featured.classic}</p>
                <p className="mt-3 font-texture text-paper">{featured.ruleSentence}</p>
                <Link
                  href={`/play/${featured.id}`}
                  className="mt-6 inline-block border-brush border-ink bg-paper-lift px-6 py-3 font-sans font-semibold text-ink no-underline shadow-print-3 transition-[transform,box-shadow] duration-place ease-arcade motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-print-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  ▶ Play {featured.title}
                </Link>
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
                    ({shelf.games.length})
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
                    className={`transition-transform duration-place ease-arcade ${cardTiltClass(i)}`}
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

// packages/shell/src/home.ts — pure helpers for the library home (Riso Zine direction, design
// 1b). Extracted from app/page.tsx (rather than left inline) for two reasons: they're genuinely
// reusable logic, independent of any specific JSX, AND they're the one part of the home page
// this repo's vitest workspace can actually unit-test (app/** has its own, separate vitest
// project for the client-only pieces — see app/StreakBadge.test.tsx — but a Next.js Server
// Component page itself is verified by the C17 Playwright route-smoke spec and the manual
// screenshot pass instead, matching how app/page.tsx has been handled since Phase 0: it has
// never carried its own unit test).

import type { GameManifest } from "@twist-arcade/game-spec";
import type { StreakRecord } from "./streak";

/**
 * Picks the home page's "Featured Twist" hero game. Deterministic (registry order, first
 * entry) and pure — no `Math.random()`, no wall-clock read, no rotation. This is a DELIBERATE
 * simplification of ui-direction.md §2.3's "rotate by dayIndex % registry.length" suggestion:
 * that scheme assumes a live daily-seed infrastructure that does not exist yet (the same
 * "Dependency flag" §2.3 itself names), and a wall-clock read here would make this
 * statically-generated page's baked HTML depend on its build time rather than request time —
 * a staleness trap, not a real "today's pick." A stable, honest "Featured Twist" beats a
 * pretend-dynamic one. Revisit once real daily-seed infra lands (platform-corrections.md's
 * daily team owns that).
 *
 * Returns `null` for an empty registry — the caller renders the existing "no games yet" empty
 * state rather than a fabricated placeholder card.
 */
export function pickFeaturedManifest(manifests: readonly GameManifest[]): GameManifest | null {
  return manifests[0] ?? null;
}

/**
 * Whether the masthead's streak flame renders at all — plan §2.1's wireframe comment is
 * explicit: "streak flame (mono) only when >0". A streak of exactly 0 (never played, or a
 * broken streak) shows nothing rather than a hollow "🔥0", which would read as an invented
 * stat rather than an honest absence (this page's conflict-2 resolution: no fabricated
 * numbers — see app/page.tsx's own module doc).
 */
export function shouldShowStreakFlame(streak: StreakRecord): boolean {
  return streak.current > 0;
}

// Cut-out card material (design 1b): each shelf card is rotated a FRACTION of a degree,
// alternating direction, and straightens to 0deg on hover (app/page.tsx composes this with
// GameCard's own existing hover lift — see that file's module doc for why no extra JS is
// needed for the straighten-on-hover behavior).
//
// These are HAND-AUTHORED class names (`.tilt-a`..`.tilt-f`, defined in app/globals.css),
// deliberately NOT Tailwind arbitrary-value classes (`rotate-[-0.6deg]`) — a first pass used
// arbitrary-value strings assembled inside this array and Tailwind's JIT content scanner never
// picked them up in the real build (reported in orchestrator review of design 1b: "every card
// here is axis-aligned"), even though the scanned-file glob covers this module. Named classes
// sidestep that dependency entirely: they're written directly in app/globals.css, so there's
// nothing for a content-scanner to fail to detect.
const CARD_TILT_CLASSES: readonly string[] = ["tilt-a", "tilt-b", "tilt-c", "tilt-d", "tilt-e", "tilt-f"];

/** Deterministic per-card tilt class, cycling through `CARD_TILT_CLASSES` by shelf position. */
export function cardTiltClass(index: number): string {
  const i = ((index % CARD_TILT_CLASSES.length) + CARD_TILT_CLASSES.length) % CARD_TILT_CLASSES.length;
  return CARD_TILT_CLASSES[i]!;
}

// packages/shell/test/reduced-motion-blanket.test.ts — UI direction §5.3, R3. Motion One's own
// animations are gated by animateSafe() (see motion.test.ts), but plain-CSS animations
// (Tailwind's `animate-pulse` skeletons, hover transitions, etc.) have no such gate of their
// own — this global `@media (prefers-reduced-motion: reduce)` blanket in app/globals.css is
// their backstop. It is also the fix for the standing defect this build was told to find by
// READING rather than by any pre-existing test: app/play/[gameId]/loading.tsx's `animate-pulse`
// skeleton had no reduced-motion gate at all before this rule existed. jsdom does not evaluate
// real `@media` conditions, so — exactly like tokens.contrast.test.ts's own cross-check of
// tokens.css — this is a static parse of the real CSS source, not a rendered-DOM assertion.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Same "plain path math on the already-resolved current-file path" pattern eslint-config.test.ts
// uses (jsdom's global URL otherwise resolves relative-to-import.meta.url constructions against
// jsdom's own document location instead of the real file:// base).
const here = dirname(fileURLToPath(import.meta.url)); // .../packages/shell/test
const repoRoot = join(here, "..", "..", ".."); // -> repo root
const globalsCssPath = join(repoRoot, "app/globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf8");

describe("app/globals.css — the reduced-motion CSS blanket (R3)", () => {
  it("declares a prefers-reduced-motion: reduce media query", () => {
    expect(globalsCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("the blanket targets *, *::before, *::after (every element, not an opt-in list)", () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(globalsCss);
    expect(block, "could not find the reduced-motion media block").not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/\*\s*,\s*\n?\s*\*::before\s*,\s*\n?\s*\*::after/);
  });

  it("collapses animation-duration, animation-iteration-count, and transition-duration inside the blanket", () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(globalsCss);
    const body = block![1]!;
    // !important is load-bearing here: this must win over any component-authored duration,
    // including Tailwind's own `animate-pulse` utility (the loading.tsx gap this rule closes).
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});

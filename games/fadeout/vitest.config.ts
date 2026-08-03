// games/fadeout/vitest.config.ts — mirrors packages/engine's config so vitest.workspace.ts's
// "games/*/" glob has an explicit project to discover here (co-located *.test.ts files, no
// separate test/ directory — matches templates/game/'s flat layout per phase-0-platform-spine
// plan §2).
//
// `.tsx` added for ui/Board.test.tsx (F3): the default environment stays "node" (every existing
// *.test.ts file — engine/solver included, some of them multi-second sweeps — keeps running
// exactly as before, zero risk of a global env switch slowing or destabilizing them); Board's
// own test opts into jsdom per-file via the `// @vitest-environment jsdom` docblock instead, so
// only that one file pays jsdom's setup cost.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

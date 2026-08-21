// games/bid-tac-toe/vitest.config.ts — widened from the scaffold's `*.test.ts` +
// `test/**/*.test.ts` default to `**/*.test.ts` (matching games/fadeout/vitest.config.ts's
// precedent) so `games/bid-tac-toe/solver/*.test.ts` (B2's exact-solve test suite) is actually
// discovered — the scaffold default silently skips co-located subdirectory test files, which a
// `pnpm test` run would not have caught until someone opened a coverage report.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
  },
});

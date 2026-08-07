// games/tilt/vitest.config.ts — widened to match Nine Grids' own convention: flat co-located
// *.test.ts(x) files (including ui/**), default environment "node" (engine/board-view tests keep
// running exactly as before), with Board.test.tsx/Telegraph.test.tsx opting into jsdom per-file
// via a `// @vitest-environment jsdom` docblock so only those files pay jsdom's setup cost.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

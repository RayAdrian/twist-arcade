// games/nine-grids/vitest.config.ts — widened from the game-solo template's default
// (`["*.test.ts", "test/**/*.test.ts"]`, which never anticipated `ui/**` co-located test files
// or a `.tsx` component test) to mirror Crackstep's own convention: flat co-located
// *.test.ts(x) files, default environment "node" (engine/board-view tests keep running exactly
// as before), with Board.test.tsx opting into jsdom per-file via a `// @vitest-environment
// jsdom` docblock so only that file pays jsdom's setup cost.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

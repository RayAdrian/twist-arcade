// games/crackstep/vitest.config.ts — widened from the game-solo template's default
// (`["*.test.ts", "test/**/*.test.ts"]`, which never anticipated `ui/**` co-located test files
// or a `.tsx` component test) to mirror Fadeout's convention: flat co-located *.test.ts(x)
// files, default environment "node" (every non-UI test — engine/board/solver, some of them
// sweeping hundreds of seeds — keeps running exactly as before), with Board.test.tsx opting
// into jsdom per-file via a `// @vitest-environment jsdom` docblock so only that file pays
// jsdom's setup cost.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

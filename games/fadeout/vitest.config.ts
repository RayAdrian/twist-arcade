// games/fadeout/vitest.config.ts — mirrors packages/engine's config so vitest.workspace.ts's
// "games/*/" glob has an explicit project to discover here (co-located *.test.ts files, no
// separate test/ directory — matches templates/game/'s flat layout per phase-0-platform-spine
// plan §2).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
  },
});

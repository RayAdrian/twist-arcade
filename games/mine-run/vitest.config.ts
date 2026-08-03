// games/mine-run/vitest.config.ts — mirrors games/fadeout's config: default environment stays
// "node" (every engine/csp/probes test — some of them multi-seed sweeps — keeps running exactly
// as before), and `ui/**` component tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` docblock instead of a global env switch.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "ui/**/*.test.ts", "ui/**/*.test.tsx", "*.test.ts"],
    setupFiles: ["./ui/test-setup.ts"],
  },
});

import { defineConfig } from "vitest/config";

// app/vitest.config.ts — a vitest project for the home page's one client island
// (StreakBadge.tsx). app/** previously had no vitest project at all (vitest.workspace.ts only
// globbed packages/*/ and games/*/); the rest of app/page.tsx's own logic is deliberately kept
// OUT of app/** (see packages/shell/src/home.ts) specifically so it stays covered by
// packages/shell's existing project instead of requiring this one to grow.
export default defineConfig({
  // tsconfig.app.json sets `"jsx": "preserve"` (required for Next's own SWC compiler to own
  // the JSX transform at build time) — Vite/esbuild has no "preserve" JSX mode of its own and
  // falls back to the classic transform (requiring `React` in scope) unless told otherwise
  // here. packages/shell's tsconfig sets `"jsx": "react-jsx"` directly, which is why its own
  // vitest.config.ts never needed this override.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});

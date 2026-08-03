import type { NextConfig } from "next";

// Placeholder config — the shell team owns the real app configuration (bundle budgets via
// size-limit land in M4). This exists so `pnpm build` has something to build.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // This repo's root tsconfig.json is a bare TS project-references stub (packages/engine,
    // packages/game-spec, packages/shell, tsconfig.app.json) — the real app-facing config,
    // with the "next" plugin and the "@/*" path alias, is tsconfig.app.json. Without this,
    // `next build` doesn't recognize the root file as "its" config and DESTRUCTIVELY rewrites
    // it in place with a generated one (discovered the hard way — it clobbered the
    // project-references list). Pointing Next at the real config directly stops that.
    tsconfigPath: "./tsconfig.app.json",
  },
};

export default nextConfig;

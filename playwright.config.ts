import { defineConfig, devices } from "@playwright/test";

// Real-browser E2E + the plan's own a11y gate (§11.2/§11.3: "a11y gate (axe via Playwright —
// platform CI hook)"), plus e2e/route-smoke.spec.ts (platform-corrections.md C17): a loop over
// games/registry.ts asserting every registered game's /play/<id> route returns 200 and renders
// a real board. Two games are registered as of this pass (crackstep, fadeout) and both are
// covered automatically — route-smoke.spec.ts reads the registry itself, so a new game needs no
// edit here. The full §11.2 suite this config is built to eventually carry — cold-load-to-
// first-move timing, keyboard-only play, the 320px cell floor, reduced-motion parity, the input
// lockout, persistence resume — remains scoped per e2e/a11y.spec.ts's own comment; e2e/ is
// structured so those specs slot in without reshaping this config.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Production build + `next start`, not `next dev`: dev mode's HMR/refresh overlay and
    // unoptimized output would both skew both the a11y snapshot and any later bundle-size-
    // adjacent timing work. `pnpm build` must be run before `pnpm test:e2e` (see package.json).
    command: "next start -p 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

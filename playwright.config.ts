import { defineConfig, devices } from "@playwright/test";

// Real-browser E2E + the plan's own a11y gate (§11.2/§11.3: "a11y gate (axe via Playwright —
// platform CI hook)"). Scope note for this pass: with the registry still empty (no game has a
// presentation yet — see the shell team's final report), the only routes that actually render
// today are "/" (empty-state library home) and the 404 (an unknown gameId). The full §11.2
// suite this config is built to eventually carry — cold-load-to-first-move timing, keyboard-
// only play, the 320px cell floor, reduced-motion parity, the input lockout, persistence resume
// — all need a real registered game's Board and are deferred until one lands; e2e/ is
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

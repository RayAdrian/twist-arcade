import { expect, test } from "@playwright/test";
// Relative import into the app's own registry (not a package specifier) — this file runs
// under Playwright's Node-side test runner (not the browser), so importing the SAME module
// `app/play/[gameId]/page.tsx` reads for `generateStaticParams()` is exactly the right source
// of truth for "every registered game", with zero hardcoded id list to fall out of sync.
import { registry } from "../games/registry";

// e2e/route-smoke.spec.ts — platform-corrections.md C17: "nothing smoke-tests a registered
// game's actual route, and a game was 500ing." `/play/crackstep` returned a 500 in the live
// application while `pnpm typecheck`, `pnpm lint`, and 1,321 unit tests were all green — a
// solver import dragged `node:fs/promises` into a browser bundle, and the two files that
// caused it BOTH carried header comments asserting this could not happen. Nothing caught it
// but a person running `next dev` and opening the page.
//
// The gap this closes: every existing gate checks an ENGINE (unit tests, the harness contract
// suite, self-play gates) or the SHELL (component tests, one Playwright pass) — nothing
// exercises the seam where a game's module graph actually meets the browser, which is exactly
// where both C17 leaks lived. This is a loop over `games/registry.ts`, not new machinery: for
// EVERY registered game, build (already done by the `pnpm build` CI step this runs after) and
// request `/play/<id>`, asserting a real 200 PLUS a rendered board — never-crashing alone is
// not sufficient (a silent client-side exception can still leave a blank page under a 200).
//
// "A rendered board" is checked game-agnostically: every registered game's Board renders
// inside the shared `packages/shell/src/components/BoardShell.tsx`, which sets `role="grid"`
// on the wrapper and `role="gridcell"` (via `Cell.tsx`) on every playable cell — this is the
// one shell-level contract every game shares, so this spec needs no per-game knowledge and
// automatically covers the next registered game with no edit here.
for (const gameId of Object.keys(registry)) {
  test(`/play/${gameId} returns 200 and renders a real board`, async ({ page }) => {
    const response = await page.goto(`/play/${gameId}`);
    expect(response, `/play/${gameId}: goto() returned no response at all`).not.toBeNull();
    expect(response?.status(), `/play/${gameId} did not return 200`).toBe(200);

    await expect(page.getByRole("grid")).toBeVisible();
    const cellCount = await page.getByRole("gridcell").count();
    expect(cellCount, `/play/${gameId} rendered no gridcells — no board actually mounted (a C17-class silent failure)`).toBeGreaterThan(0);
  });
}

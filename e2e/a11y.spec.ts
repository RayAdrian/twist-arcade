import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// plan §11.3: zero critical violations, both themes, on every route this pass can actually
// exercise against a REAL browser (not jsdom) — the registry is still empty (no game has a
// presentation yet), so "/play/{realGame}" per §11.3's literal list isn't reachable yet; the
// 404 state (an unknown gameId) is the real substitute available today. See
// playwright.config.ts's header comment for what's deferred until a game lands.

test.describe("a11y gate — light theme (default, no emulation)", () => {
  test("home page ('/', empty-registry state) has no critical axe violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /twist arcade/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  test("an unknown gameId renders a real 'back to library' page, WITH a real 404 status, no critical axe violations", async ({ page }) => {
    // Orchestrator ruling (I5): the earlier "200 + streamed content vs. real 404" trade-off this
    // comment used to describe was a false dilemma — `app/play/[gameId]/page.tsx` now sets
    // `export const dynamicParams = false`, which 404s any gameId NOT in generateStaticParams()
    // at the Next.js routing layer itself, before the page function (and therefore
    // loading.tsx's Suspense boundary, which is tied to THAT function's own async work) is ever
    // invoked. Known ids are still statically prerendered from the registry and keep the
    // board-skeleton loading state exactly as before — only the truly-unknown-id path changed.
    const response = await page.goto("/play/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /game not found/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /back to library/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});

test.describe("a11y gate — dark theme (prefers-color-scheme: dark)", () => {
  test.use({ colorScheme: "dark" });

  test("theme bootstrap applies .dark before paint, home page has no critical axe violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});

test.describe("a11y gate — reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("home page still renders and has no critical axe violations under prefers-reduced-motion", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /twist arcade/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});

test("skip-to-content link is keyboard-reachable and focusable as the very first tab stop", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
});

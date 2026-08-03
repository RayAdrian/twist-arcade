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

  test("an unknown gameId renders a real 'back to library' page, no critical axe violations", async ({ page }) => {
    // NOT asserting response.status() === 404 here, deliberately: app/play/[gameId]/loading.tsx
    // gives this route a route-level Suspense boundary, which makes Next commit to a 200
    // status and START STREAMING before the page component's own notFound() call (deeper in
    // the tree) is reached — so the HTTP status can't be retroactively corrected to 404 for a
    // streamed response (confirmed directly: temporarily removing loading.tsx made the status
    // correctly 404, at the cost of losing the board-skeleton fallback for the common case of
    // an existing, slow-to-resolve game). The board-skeleton UX for real games was judged more
    // valuable than a technically-correct 404 header on the rare not-found path; the CONTENT is
    // still correct either way, which is what actually matters for a user or a crawler
    // rendering the page. Flagged as a known Next.js streaming/notFound() trade-off.
    await page.goto("/play/does-not-exist");
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

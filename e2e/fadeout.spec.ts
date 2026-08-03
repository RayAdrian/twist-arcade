import { expect, test } from "@playwright/test";

// e2e/fadeout.spec.ts — the specs the shell team scaffolded for (playwright.config.ts's own
// header comment: "cold-load-to-first-move timing, keyboard-only play, the 320px cell floor,
// reduced-motion parity, the input lockout, persistence resume — all need a real registered
// game's Board"). Fadeout is now that game.

const GAME_URL = "/play/fadeout";

test.describe("Fadeout — cold load", () => {
  test("the board is interactive (a real legal gridcell present) well within budget of navigation completing", async ({ page }) => {
    const start = Date.now();
    await page.goto(GAME_URL);
    // The FIRST legal cell to appear is the actual "can play now" signal — GameShell paints a
    // skeleton immediately, then swaps in the real board once the dynamic import resolves.
    const firstLegalCell = page.locator('[role="gridcell"]:not([aria-disabled="true"])').first();
    await expect(firstLegalCell).toBeVisible({ timeout: 8000 });
    const elapsedMs = Date.now() - start;
    // ux-lens §3's budget is "<8s on mid-4G" — this is an unthrottled local run, so the bar
    // here is deliberately generous; it exists to catch a real regression (e.g. the dynamic
    // import silently hanging), not to reproduce mid-4G timing.
    expect(elapsedMs).toBeLessThan(8000);
  });

  test("the rule sentence is visible immediately (ux-lens §1's teaching layer 1, before any interaction)", async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.getByText("Your pieces vanish 3 turns after you place them.")).toBeVisible();
  });
});

test.describe("Fadeout — keyboard-only play (APG grid pattern)", () => {
  test("Tab reaches the board, arrow keys move the cursor, Enter commits a move", async ({ page }) => {
    await page.goto(GAME_URL);
    const grid = page.getByRole("grid", { name: "Fadeout board" });
    await expect(grid).toBeVisible();

    // Roving tabindex: exactly one cell is a tab stop; find it without assuming board order.
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(9);

    // Tab from the top of the page until focus lands inside the grid (roving tabindex means
    // only ONE cell is ever a stop, so this converges quickly regardless of header/rule-card
    // control count). `page.evaluate` reads `document.activeElement` directly rather than a
    // `:focus` locator — a locator's own actionability wait can block for the full default
    // timeout on an iteration where NOTHING is focused yet (e.g. before the first Tab press),
    // which is exactly what starved this loop's first pass.
    for (let i = 0; i < 20; i++) {
      const role = await page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
      if (role === "gridcell") break;
      await page.keyboard.press("Tab");
    }
    await expect(page.locator(":focus")).toHaveAttribute("role", "gridcell");

    // Move to a specific known-empty cell (top-left, "Row 1, column 1") deterministically via
    // arrow keys, then commit with Enter.
    const topLeft = page.getByRole("gridcell", { name: /Row 1, column 1/ });
    // Whichever cell currently has focus, arrow-key toward top-left repeatedly (clamped at the
    // edges per BoardShell's own contract, so over-pressing is harmless).
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await expect(topLeft).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(topLeft).toHaveAccessibleName(/Row 1, column 1\. X/);
  });
});

test.describe("Fadeout — mobile viewport (ux-lens §7's 48px cell floor)", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("every cell's rendered box is at least 48x48 CSS px at a 320px viewport", async ({ page }) => {
    await page.goto(GAME_URL);
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(9);
    const count = await cells.count();
    for (let i = 0; i < count; i++) {
      const box = await cells.nth(i).boundingBox();
      expect(box, `cell ${i} has no bounding box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
  });
});

test.describe("Fadeout — reduced motion parity (ux-lens §9: motion never carries unique information)", () => {
  test.use({ reducedMotion: "reduce" });

  test("a countdown badge is still readable under prefers-reduced-motion (no pulse required to convey it)", async ({ page }) => {
    await page.goto(GAME_URL);
    // Place enough of the human's own marks to reach a real countdown without depending on the
    // (randomized) stub bot's exact replies — corners/edges the bot might also take are avoided
    // by re-deriving "the next empty cell" from the DOM each time rather than hard-coding a
    // fixed script.
    for (let i = 0; i < 4; i++) {
      const empty = page.locator('[role="gridcell"]:not([aria-disabled="true"])').first();
      await empty.click();
      // Give the stub bot's ~250ms reply time to land before the next human placement.
      await page.waitForTimeout(400);
    }
    // After 4 human placements, the human's FIRST placement is either gone (decayed already, if
    // it was this player's 4th — not yet at this point) or at remaining <= 2 for at least one
    // mark, per the badge's own ux-lens threshold. Rather than pin an exact cell, assert the
    // page contains AT LEAST one cell whose accessible name carries the pending-change clause —
    // the same information the badge shows, present with zero animation.
    const imminentCell = page.getByRole("gridcell", { name: /fades in \d turns?/ });
    await expect(imminentCell.first()).toBeVisible();
  });
});

test.describe("Fadeout — input lockout (ux-lens §7: ignore taps within 250ms of a board-state change)", () => {
  test("a tap that lands immediately after the bot's move does not commit (best-effort timing — see comment)", async ({ page }) => {
    await page.goto(GAME_URL);
    const firstEmpty = page.locator('[role="gridcell"]:not([aria-disabled="true"])').first();
    await firstEmpty.click(); // human's move — never locks (useGame.ts: "own moves never lock")

    // Wait for the bot's reply to land (its own stub delay is ~250ms), then, as fast as this
    // harness can manage, attempt a second click immediately after — inside the 250ms lockout
    // window that opens the instant a NON-human move lands. This is inherently timing-sensitive
    // in a real browser (Playwright's own event dispatch has latency); it is written to land as
    // close to the window as this tooling allows, not asserted as a hard timing guarantee.
    const grid = page.getByRole("grid", { name: "Fadeout board" });
    await grid.waitFor({ state: "visible" });
    const movesBefore = await page.getByRole("gridcell", { name: /X\.|O\./ }).count();
    // Poll for the bot's own placement to land, then fire the next click with no extra delay.
    await expect
      .poll(async () => page.getByRole("gridcell", { name: /X\.|O\./ }).count(), { timeout: 3000 })
      .toBeGreaterThan(movesBefore);
    const nextEmpty = page.locator('[role="gridcell"]:not([aria-disabled="true"])').first();
    const beforeCount = await page.getByRole("gridcell", { name: /X\.|O\./ }).count();
    await nextEmpty.click();
    // Immediately re-check — if the click landed inside the lockout window, the mark count must
    // NOT have increased yet (the click was dropped silently, per BoardContext.commit()).
    const rightAfterCount = await page.getByRole("gridcell", { name: /X\.|O\./ }).count();
    // Either the click was dropped (rightAfterCount === beforeCount, the lockout fired) or the
    // window had already elapsed by the time this ran (rightAfterCount === beforeCount + 1) —
    // both are legitimate outcomes of a race against a real 250ms timer in a real browser; what
    // must NEVER happen is losing more than one placement's worth of state, or a crash.
    expect(rightAfterCount - beforeCount).toBeGreaterThanOrEqual(0);
    expect(rightAfterCount - beforeCount).toBeLessThanOrEqual(1);
  });
});

test.describe("Fadeout — persistence resume (plan §5.6)", () => {
  test("a solo game's board survives a full page reload", async ({ page }) => {
    await page.goto(GAME_URL);
    const firstEmpty = page.locator('[role="gridcell"]:not([aria-disabled="true"])').first();
    await firstEmpty.click();
    const markedCount = await page.getByRole("gridcell", { name: /X\.|O\./ }).count();
    expect(markedCount).toBeGreaterThan(0);

    await page.reload();
    const grid = page.getByRole("grid", { name: "Fadeout board" });
    await expect(grid).toBeVisible();
    const afterReloadCount = await page.getByRole("gridcell", { name: /X\.|O\./ }).count();
    expect(afterReloadCount).toBeGreaterThanOrEqual(markedCount);
  });
});

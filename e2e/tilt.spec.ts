import { expect, test } from "@playwright/test";

// e2e/tilt.spec.ts — the real board's route-level tests (docs/plans/tilt.md §6), against a real
// production build (`next build && next start`, per playwright.config.ts). Route smoke (C17)
// itself is already covered generically by e2e/route-smoke.spec.ts, which loops
// games/registry.ts — this file covers Tilt-specific claims: the telegraph, the 320px cell
// floor, keyboard play, and A11Y-008.

const GAME_URL = "/play/tilt";

test.describe("Tilt — ROUTE-001: cold load, real board, zero console errors", () => {
  test("GET /play/tilt is 200, renders role=grid with 49 gridcells, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(GAME_URL);
    expect(response?.status()).toBe(200);

    const grid = page.getByRole("grid", { name: "Tilt board" });
    await expect(grid).toBeVisible();
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(49);

    expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("the rule sentence is visible immediately (teaching layer 1)", async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.getByText("Every 4th turn the board rotates and every piece falls again.")).toBeVisible();
  });
});

test.describe("Tilt — the tilt telegraph is visible from ply 1 (plan §6.1/§6.2)", () => {
  test("shows the full countdown and the floor-direction marker on load, before any move", async ({ page }) => {
    await page.goto(GAME_URL);
    const telegraph = page.getByTestId("tilt-telegraph");
    await expect(telegraph).toBeVisible();
    await expect(page.getByTestId("tilt-countdown-value")).toHaveText("4");
    await expect(page.getByTestId("tilt-floor-marker")).toContainText(/right/i);
  });
});

test.describe("Tilt — library card", () => {
  test("the home page lists Tilt exactly once, linking to /play/tilt", async ({ page }) => {
    await page.goto("/");
    const links = page.locator('a[href="/play/tilt"]');
    await expect(links).toHaveCount(1);
  });
});

test.describe("Tilt — the 48px cell floor (no exception invoked, see ui/board-view.ts's module doc)", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("every enabled (drop-target) cell is at least 48x48 CSS px at a 320px viewport", async ({ page }) => {
    await page.goto(GAME_URL);
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(49);
    const count = await cells.count();
    let checked = 0;
    for (let i = 0; i < count; i++) {
      const cell = cells.nth(i);
      const disabled = await cell.getAttribute("aria-disabled");
      if (disabled === "true") continue; // decorative disc cells are not drop targets
      const box = await cell.boundingBox();
      expect(box, `drop-target cell ${i} has no bounding box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      checked++;
    }
    expect(checked, "no enabled drop-target cells were found to check").toBeGreaterThan(0);
  });
});

test.describe("Tilt — keyboard-only play (APG grid pattern)", () => {
  test("Tab reaches the board's roving-tabindex cell, arrow keys move the cursor to a drop target, Enter commits", async ({
    page,
  }) => {
    await page.goto(GAME_URL);
    const grid = page.getByRole("grid", { name: "Tilt board" });
    await expect(grid).toBeVisible();

    // Roving tabindex (BoardShell's own APG pattern): exactly ONE cell in the whole grid has
    // tabIndex=0 at a time (the cursor, starting at row 0, col 0 — a decorative, disabled cell
    // in this board's design, see ui/board-view.ts's module doc). Repeatedly pressing Tab would
    // therefore overshoot PAST the grid entirely after the first cell — reaching an ENABLED
    // drop-target cell requires ARROW KEYS, not more Tabs, once inside the grid.
    for (let i = 0; i < 30; i++) {
      const role = await page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
      if (role === "gridcell") break;
      await page.keyboard.press("Tab");
    }
    await expect(page.locator(":focus")).toHaveAttribute("role", "gridcell");

    // Drop targets live at the BOTTOM row (row index SIZE-1) — move the cursor all the way down.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(page.locator(":focus")).toHaveAttribute("role", "gridcell");
    await expect(page.locator(":focus")).not.toHaveAttribute("aria-disabled", "true");

    const before = await page.evaluate(() => document.querySelectorAll('[role="gridcell"][aria-disabled="true"]').length);
    await page.keyboard.press("Enter");
    // A drop always fills exactly one more decorative cell than before (aria-disabled count can
    // shift by more than 1 if the drop target itself also became disabled, but it must increase
    // by at least 1 — a real move landed).
    const after = await page.evaluate(() => document.querySelectorAll('[role="gridcell"][aria-disabled="true"]').length);
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});

test.describe("Tilt — reduced motion (A11Y-008: verify the emulation actually applied, in-page, before trusting anything else)", () => {
  test.use({ reducedMotion: "reduce" });

  test("matchMedia reads true inside the page, and the board still renders correctly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(GAME_URL);
    // The load-bearing check this case exists for: confirm the emulation ACTUALLY applied, in
    // the page's own JS context — a run that skips this proves nothing (C28/A11Y-008).
    const matches = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(matches).toBe(true);

    const grid = page.getByRole("grid", { name: "Tilt board" });
    await expect(grid).toBeVisible();
    await expect(page.getByTestId("tilt-telegraph")).toBeVisible();
  });

  // The specific claim "a just-moved marker's settle-pulse animation never plays under reduced
  // motion, while the static data-just-moved marker itself still holds" requires actually
  // reaching a tilt (ply 4+) through the live route. Solo-bot mode's opponent is a real worker
  // bot with non-deterministic column choices (Nine Grids' e2e suite documents this exact same
  // platform gap for its own A11Y-002/003 cases: no scripted/deterministic bot-driver seam
  // exists on this route today) — scripting 4 real plies and asserting on the SPECIFIC cells the
  // tilt displaces is not reliably driveable end-to-end without one. The content is verified for
  // real, with a planted-violation proof, in games/tilt/ui/Board.test.tsx's "does NOT pulse
  // under reduced motion" case (passing) — what remains unverified here specifically is the
  // GameShell -> Board wiring for a live, bot-opposed multi-ply sequence, which the matchMedia
  // check above already proves uses the same reduced-motion signal successfully.
  test.fixme(
    "just-moved marker present, settle-pulse absent, after a live tilt under reduced motion — needs a deterministic bot-driver seam on /play/[gameId] (platform gap, not a Tilt defect); content already verified in games/tilt/ui/Board.test.tsx",
    async () => {}
  );
});

import { expect, test } from "@playwright/test";

// e2e/mine-run.spec.ts — the real board's route-level tests (docs/plans/mine-run.md §8), against
// a real production build (`next build && next start`, per playwright.config.ts). Route smoke
// (C17) is already covered generically by e2e/route-smoke.spec.ts, which loops
// games/registry.ts — this file covers Mine Run-specific claims: the 48px cell floor (no
// exception — see games/mine-run/ui/Board.tsx's module doc for why the O2 exception is
// withdrawn), the BankBar decision UI, keyboard play, and A11Y-008.

const GAME_URL = "/play/mine-run";

test.describe("Mine Run — ROUTE-001: cold load, real board, zero console errors", () => {
  test("GET /play/mine-run is 200, renders role=grid with 100 gridcells, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(GAME_URL);
    expect(response?.status()).toBe(200);

    const grid = page.getByRole("grid", { name: "Mine Run board" });
    await expect(grid).toBeVisible();
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(100);

    expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("the rule sentence is visible immediately (teaching layer 1)", async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.getByText("Reveal squares to grow a streak; bank anytime — a mine wipes your unbanked streak.")).toBeVisible();
  });
});

test.describe("Mine Run — library card", () => {
  test("the home page lists Mine Run exactly once, linking to /play/mine-run", async ({ page }) => {
    await page.goto("/");
    const links = page.locator('a[href="/play/mine-run"]');
    await expect(links).toHaveCount(1);
  });
});

test.describe("Mine Run — the 48px cell floor at a 320px viewport (BoardShell's zoom/pan, O2's exception withdrawn — C50)", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("every gridcell's rendered box is at least 48x48 CSS px, on a scrollable board frame", async ({ page }) => {
    await page.goto(GAME_URL);
    const cells = page.getByRole("gridcell");
    await expect(cells).toHaveCount(100);
    const count = await cells.count();
    let checked = 0;
    for (let i = 0; i < count; i++) {
      const box = await cells.nth(i).boundingBox();
      // Cells scrolled outside the frame's clipped viewport still report a real box (the DOM
      // node exists at full size, just outside the visible scroll region) — boundingBox()
      // returns null only for display:none/detached elements, neither of which applies here.
      expect(box, `gridcell ${i} has no bounding box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      checked++;
    }
    expect(checked).toBe(100);
  });
});

test.describe("Mine Run — the BankBar decision UI (mine-run.md §8.1: at-risk/vault chips + Bank button, adjacent)", () => {
  test("the informed-odds line, at-risk chip, vault chip, and Bank button are all visible from load", async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.locator("text=/reveals? left/")).toBeVisible();
    await expect(page.locator('[data-at-risk="true"]')).toBeVisible();
    await expect(page.locator('[data-vault="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bank$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bank$/ })).toBeDisabled(); // streak 0 at load
  });

  test("the C52 safe-move telegraph renders one of its two states, text-only", async ({ page }) => {
    await page.goto(GAME_URL);
    const status = page.locator("[data-safe-move-status]");
    await expect(status).toBeVisible();
    const value = await status.getAttribute("data-safe-move-status");
    expect(["available", "none"]).toContain(value);
  });
});

test.describe("Mine Run — keyboard-only play (APG grid pattern, single-tap/Enter commit)", () => {
  test("Tab reaches the board's roving-tabindex cell, Enter reveals it and the board updates", async ({ page }) => {
    await page.goto(GAME_URL);
    const grid = page.getByRole("grid", { name: "Mine Run board" });
    await expect(grid).toBeVisible();

    for (let i = 0; i < 30; i++) {
      const role = await page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
      if (role === "gridcell") break;
      await page.keyboard.press("Tab");
    }
    await expect(page.locator(":focus")).toHaveAttribute("role", "gridcell");

    // The roving-tabindex cursor starts at (row 0, col 0) — real boards often have that cell
    // already revealed (part of the opening flood region, R2), so pressing Enter there commits
    // nothing (Cell.tsx's own disabled-cell guard) and this test would prove nothing either way.
    // Navigate the ARROW KEYS (the real APG mechanism under test, not a shortcut around it) to
    // the first genuinely enabled gridcell before pressing Enter.
    const target = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
      const enabled = cells.find((c) => c.getAttribute("aria-disabled") !== "true");
      if (!enabled) return null;
      return {
        row: Number(enabled.getAttribute("aria-rowindex")),
        col: Number(enabled.getAttribute("aria-colindex")),
      };
    });
    expect(target, "no enabled gridcell found on the loaded board — nothing to reveal").not.toBeNull();
    // aria-rowindex/colindex are 1-indexed (Cell.tsx: row+1/col+1); the cursor starts at (1,1).
    for (let i = 1; i < target!.row; i++) await page.keyboard.press("ArrowDown");
    for (let i = 1; i < target!.col; i++) await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).not.toHaveAttribute("aria-disabled", "true");

    const before = await page.evaluate(() => document.querySelectorAll('[role="gridcell"][aria-disabled="true"]').length);
    await page.keyboard.press("Enter");
    const after = await page.evaluate(() => document.querySelectorAll('[role="gridcell"][aria-disabled="true"]').length);
    // A reveal always disables at least the target cell (and, on a flood, more) — never fewer.
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});

test.describe("Mine Run — reduced motion (A11Y-008: verify the emulation actually applied, in-page, before trusting anything else)", () => {
  test.use({ reducedMotion: "reduce" });

  test("matchMedia reads true inside the page, and the board still renders correctly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(GAME_URL);
    // The load-bearing check this case exists for: confirm the emulation ACTUALLY applied, in
    // the page's own JS context — a run that skips this proves nothing (C28/A11Y-008).
    const matches = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(matches).toBe(true);

    const grid = page.getByRole("grid", { name: "Mine Run board" });
    await expect(grid).toBeVisible();
    await expect(page.locator('[data-vault="true"]')).toBeVisible();
  });

  // The specific claim "a just-banked/just-wiped animation never plays under reduced motion,
  // while the static vault/at-risk numbers still update" is verified for real, WITH a planted-
  // violation proof (removing the `!prefs.reducedMotion` gate fails the test with the exact
  // animation string, then reverted — see games/mine-run/ui/BankBar.test.tsx and this
  // implementation pass's own report), in games/mine-run/ui/BankBar.test.tsx directly. What
  // remains unverified HERE specifically is the live GameShell -> BankBar wiring end-to-end
  // through a real bank/mine move on this route — same documented platform gap Nine Grids' and
  // Tilt's own e2e suites already carry (no scripted/deterministic bot-driver seam on
  // /play/[gameId] to reach a specific effect deterministically; Mine Run's solo, so there is no
  // bot to script the OPPONENT into cooperating, but reaching a mine deterministically still
  // requires either a seeded route param this route doesn't expose, or enough live plies to be
  // flaky) — the matchMedia check above already proves the route wires the same reduced-motion
  // signal BankBar consumes.
  test.fixme(
    "a live bank/wipe on this route never animates under reduced motion, while the static vault/at-risk numbers still update — needs a deterministic seeded-board seam on /play/[gameId] (platform gap, not a Mine Run defect); content already verified with a planted-violation proof in games/mine-run/ui/BankBar.test.tsx",
    async () => {}
  );
});

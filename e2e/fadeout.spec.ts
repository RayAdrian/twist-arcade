import { expect, test, type Page } from "@playwright/test";

// e2e/fadeout.spec.ts — the specs the shell team scaffolded for (playwright.config.ts's own
// header comment: "cold-load-to-first-move timing, keyboard-only play, the 320px cell floor,
// reduced-motion parity, the input lockout, persistence resume — all need a real registered
// game's Board"). Fadeout is now that game.

const GAME_URL = "/play/fadeout";

// Standard 3x3 tic-tac-toe lines, 0-indexed row-major (cell = row*3 + col) — self-contained here
// rather than imported from the game's own engine-internal.ts: this file runs against a real
// browser/served build, not the source tree, and duplicating 8 fixed triples is cheaper and more
// robust than wiring a cross-package import into the Playwright config for it.
const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function completesLine(owned: ReadonlySet<number>, cell: number): boolean {
  const next = new Set(owned);
  next.add(cell);
  return LINES.some((line) => line.every((c) => next.has(c)));
}

/** Board's accessible name is always "Row {row+1}, column {col+1}. ..." (board-view.ts's
 *  `boardPositionName`/cell presentation) — parses it back to a 0-indexed cell number so this
 *  script can reason about which cells the human already owns. */
function cellFromAccessibleName(name: string): number {
  const match = /Row (\d+), column (\d+)/.exec(name);
  if (!match) throw new Error(`could not parse cell coordinates from accessible name: "${name}"`);
  const row = Number(match[1]) - 1;
  const col = Number(match[2]) - 1;
  return row * 3 + col;
}

/**
 * Clicks a legal (non-disabled) empty cell that does NOT complete a three-in-a-row for the
 * human — must-fix 2 part B (stage-6 F3 review). The previous script always clicked "the first
 * non-disabled cell": with the human as X, that walks cells 0, 1, 2 in order whenever the bot
 * doesn't happen to occupy one of them first — the tic-tac-toe top ROW. 2 of 8 local runs ended
 * the game early purely from the human's OWN scripted clicks completing that line: the
 * ResultModal then replaces the board, gridcells leave the accessibility tree, and every
 * subsequent locator in the test finds nothing.
 *
 * This closes the SELF-inflicted half of that flake (the human's own moves can never now
 * complete a line). It does not fully close the residual, much rarer case of the random stub
 * bot completing ITS OWN line first — Fadeout's default opponent here is `stubBotDriver`
 * (uniform random; see its own "NOT SHIPPABLE" doc comment), and no deterministic bot-driver
 * seam is wired into `/play/[gameId]` today (see `app/play/[gameId]/page.tsx`'s own comment on
 * why searchParams-driven mode selection was deliberately not built). That residual risk is
 * stated here rather than silently assumed away.
 */
async function clickNonWinningCell(page: Page, ownedByHuman: Set<number>): Promise<void> {
  const emptyCells = page.locator('[role="gridcell"]:not([aria-disabled="true"])');
  // Root cause of a real (not residual/bot) flake found while verifying this fix: on the very
  // FIRST call, GameShell may still be showing its loading skeleton (no real gridcells yet — see
  // the cold-load describe block above), so `count()` reads 0 and every iteration below is
  // skipped entirely, falling straight to the "fallback" branch. Wait for the board to have
  // actually rendered before reasoning about candidates.
  await expect(emptyCells.first()).toBeVisible();
  const count = await emptyCells.count();
  for (let i = 0; i < count; i++) {
    const locator = emptyCells.nth(i);
    const name = (await locator.getAttribute("aria-label")) ?? "";
    const cell = cellFromAccessibleName(name);
    if (!completesLine(ownedByHuman, cell)) {
      await locator.click();
      ownedByHuman.add(cell);
      return;
    }
  }
  // Every empty cell would complete a line — cannot happen this early on a 3x3 board with only
  // a handful of marks placed; fall back to the first legal cell. MUST still track it: an
  // earlier version of this function clicked here without adding the cell to `ownedByHuman`,
  // which silently blinded every LATER call's line-avoidance to that cell — the exact bug that
  // was making this describe block flaky before this fix (the untracked cell above, plus two
  // later correctly-tracked cells, could and did complete a real line undetected).
  const fallback = emptyCells.first();
  const name = (await fallback.getAttribute("aria-label")) ?? "";
  await fallback.click();
  ownedByHuman.add(cellFromAccessibleName(name));
}

/**
 * Waiting for the bot's reply to land AND for the post-landing 250ms lockout window to clear
 * matters here: before this fix, callers waited a blind `page.waitForTimeout(400)`, which is NOT
 * long enough — the stub bot's own ~250ms think delay plus the 250ms lockout its landing opens
 * (useGame.ts's `lockedUntil`) together exceed 400ms, so clicking again after only 400ms can land
 * INSIDE that lockout window and have the click silently dropped (exactly the mechanism this
 * file's input-lockout smoke test separately exercises). Counting occupied cells is not a
 * reliable "landed" signal either: once either side reaches its 4th placement, that same move
 * both places AND decays one of the mover's own marks, netting zero change in total occupied-cell
 * count — precisely the round these tests care about (reaching remaining=1). The visible turn
 * phrase (StatusLine) is decay-proof: it reads "Your move." again once the bot's reply lands,
 * regardless of what decayed.
 *
 * "continue": the bot's reply landed and it is the human's turn again. "over": the ResultModal
 *  appeared instead — the bot completed its OWN line (the residual risk `clickNonWinningCell`'s
 *  own comment documents; verified live while building this fix — happened in roughly 1 of every
 *  3 attempts locally). Polls both outcomes rather than assuming either, per the review's "at
 *  minimum stop clicking blind into a possibly-terminal board." */
async function waitForBotReplyOrGameOver(page: Page): Promise<"continue" | "over"> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await page.getByRole("dialog").isVisible().catch(() => false)) return "over";
    if (
      await page
        .locator("p", { hasText: "Your move." })
        .isVisible()
        .catch(() => false)
    ) {
      return "continue";
    }
    await page.waitForTimeout(50);
  }
  throw new Error("timed out waiting for either the bot's reply to land or the game to end");
}

/**
 * Drives exactly 4 human placements (reaching the human's own onset of a final-turn mark —
 * remaining=1, cap=3 — regardless of what the bot does), retrying from a fresh navigation if the
 * bot ends the game first. `clickNonWinningCell` only prevents the HUMAN from self-completing a
 * line (must-fix 2 part B's documented, self-inflicted flake); it cannot prevent the random
 * `stubBotDriver` from completing its OWN line, which happens often enough in practice (observed
 * locally at roughly 1 in 3 attempts) that simply documenting it and hoping was not good enough —
 * this detects it via `waitForBotReplyOrGameOver` and retries with a bounded budget instead of
 * letting a real, non-bug outcome intermittently fail the suite.
 */
async function reachFinalTurnMark(page: Page): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await page.goto(GAME_URL);
    const ownedByHuman = new Set<number>();
    let botWonFirst = false;
    for (let i = 0; i < 4; i++) {
      await clickNonWinningCell(page, ownedByHuman);
      const outcome = await waitForBotReplyOrGameOver(page);
      if (outcome === "over") {
        botWonFirst = true;
        break;
      }
      // The lockout window opens the instant the bot's move landed (which is what "Your move."
      // reappearing just confirmed) — wait past it (250ms + margin) before the next click.
      await page.waitForTimeout(320);
    }
    if (!botWonFirst) return;
  }
  throw new Error(
    `could not reach a final-turn mark without the bot ending the game first, after ${maxAttempts} attempts`
  );
}

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

  test("a countdown badge is readable AND the final-turn pulse animation is genuinely absent (not just the badge present) under prefers-reduced-motion", async ({
    page,
  }) => {
    // Verified locally: in this project's Playwright/Chromium combination, the context-level
    // `test.use({ reducedMotion: "reduce" })` option above does NOT actually flip
    // `matchMedia("(prefers-reduced-motion: reduce)").matches` before navigation (confirmed by
    // reading it back directly on the page — it read `false`). An explicit `page.emulateMedia()`
    // call DOES apply reliably, confirmed the same way, so this is what the app's own
    // `useMediaQuery` hook (GameShell.tsx) actually observes. `test.use()` is kept above for
    // documentation/intent; this call is the one this test actually depends on.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(GAME_URL);
    // Must-fix 2 part B (stage-6 F3 review): drive with cells that never complete a line for the
    // human (see clickNonWinningCell's own comment for why the old "first empty cell" script was
    // flaky) — after exactly 4 human placements (cap=3), the human's own 4th placement decays
    // its oldest mark and always leaves a NEW front-of-queue mark at remaining=1, regardless of
    // whatever the bot did in between. This is deterministic; it does not depend on badge
    // wording ("1" vs "2") the way the old regex (`/fades in \d turns?/`) did. `reachFinalTurnMark`
    // additionally retries if the random bot ends the game first (see its own comment).
    await reachFinalTurnMark(page);
    const imminentCell = page.getByRole("gridcell", { name: /fades in 1 turn/ }).first();
    await expect(imminentCell).toBeVisible();

    // The old assertion stopped at "the badge/accessible-name is present" — real information,
    // but silent on whether the ANIMATION the reduced-motion preference is supposed to suppress
    // is actually suppressed. Assert the real, computed mechanism directly: under reduced
    // motion, Board.tsx never mounts the PulsingGlyph wrapper at all (see Board.tsx/board-view),
    // so the browser's own computed `animation-name` for this cell must be the CSS initial
    // value "none" — not merely "no pulse span happened to be checked for."
    const animationName = await imminentCell.evaluate((el) => {
      const span = el.querySelector("span.inline-block");
      return getComputedStyle(span ?? el).animationName;
    });
    expect(animationName).toBe("none");
  });
});

test.describe("Fadeout — full motion sanity (the OTHER half of the parity check above: the pulse IS present without reduced motion)", () => {
  test("a final-turn mark's pulse animation is present when reduced motion is NOT requested", async ({ page }) => {
    await page.goto(GAME_URL);
    await reachFinalTurnMark(page);
    const imminentCell = page.getByRole("gridcell", { name: /fades in 1 turn/ }).first();
    await expect(imminentCell).toBeVisible();
    const animationName = await imminentCell.evaluate((el) => {
      const span = el.querySelector("span.inline-block");
      return getComputedStyle(span ?? el).animationName;
    });
    expect(animationName).toBe("fadeout-final-pulse");
  });
});

// IMPORTANT 4 (stage-6 F3 review): this describe/test used to be named and framed as if it
// proved the 250ms lockout WINDOW itself — but its own assertion (`delta` in {0,1}) passes even
// if the lockout were deleted entirely (rightAfterCount === beforeCount + 1 is one of the two
// accepted outcomes), and the poll it drives off can equally be satisfied by the human's OWN
// mark rendering rather than the bot's, so it may not even be exercising the lockout window at
// all. Proving the real 250ms boundary deterministically in a real browser would need either a
// scripted bot driver wired into this route (no such seam exists on `/play/[gameId]` today — see
// `app/play/[gameId]/page.tsx`'s comment on why searchParams-driven mode selection was
// deliberately not built) or Playwright's `page.clock`, which would have to virtualize this
// app's `performance.now()`-based lockout without freezing every other timer the page needs to
// actually progress. Rather than ship a test wearing a name it cannot back, this is renamed to
// what it actually guards, and the REAL deterministic proof is pointed at:
// packages/shell/test/useGame.test.ts's "drops submitMove() called while `now < lockedUntil`"
// and "still applies submitMove() once `now >= lockedUntil` has passed" assert `delta === 0`
// exactly, under fake/controlled timers, at the unit level.
test.describe("Fadeout — input lockout smoke test (no double-commit, no crash — see packages/shell/test/useGame.test.ts for the deterministic 250ms-window proof)", () => {
  test("a tap that lands near the bot's move landing never double-commits and never crashes the board", async ({ page }) => {
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

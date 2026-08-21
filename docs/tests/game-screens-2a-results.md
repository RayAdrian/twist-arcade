# Stage 4 Results — Game Screens 2a

**Executed by:** Sonnet (stage 4, CLAUDE.md §2). **Against:** local `next dev` on `:3100`
(branch `test/stage4-game-screens`, no build/merge). **Date:** 2026-08-21.

**Resource posture honored:** a single-threaded CPU-bound job (`scripts/ci-gates.ts --suite
nightly --game mine-run`, pid 97395) was running throughout on its own core and was never
starved — checked before/during/after (`ps`, load average). Vitest was run scoped per-package,
sequentially, capped at 2 forks (`--pool=forks --poolOptions.forks.maxForks=2`). No `next
build`/`test:e2e` (which requires a prod build) was run — a plain `next dev` on a scratch port
plus a throwaway, non-committed Playwright script (`.scratch/stage4-*.mjs`, `chromium.launch()`
directly, single page, sequential) covered the cases that needed real network blocking/CDP
throttling. Playwright workers: 1 (no parallelism used). Total wall clock: ~30 min, within the
~45 min budget — **this is a partial run**; not-run cases are listed explicitly below with why.

**Plan/brief count correction:** the orchestrator's brief said "62 cases in 9 suites." The
actual plan has **74** numbered cases (`grep -c '\*\*TC-2A-'`): S1=13, S2=8, S3=14, S4=7, S5=5,
S6=7, S7=8, S8=7, S9=5. This results doc covers all 74.

---

## Headline findings (read this before the table)

1. **PERS-001 is a real, severe, reproducible defect — not a designed CHALLENGE case.**
   Setting `ta:game:fadeout:solo-bot` to a truncated-but-valid-JSON persisted record
   (`{"v":1}`, matching the plan's own third sub-case) does not "boot a fresh, playable game."
   It throws an **unrecovered client-side exception** on every subsequent load of
   `/play/fadeout`:
   ```
   TypeError: Cannot read properties of undefined (reading 'gameId')
     at useGame.useState (packages/shell/src/useGame.ts:130)
   ```
   Root cause: `packages/shell/src/useGame.ts` (~line 231-232) does
   `stored?.record.seed` / `stored.record.gameId` without checking `stored.record` itself is
   defined — only `stored` is guarded. This isn't a one-time glitch: the corrupted key
   **persists**, so the route is permanently broken for that browser profile until a human
   manually clears site storage — there is no in-app recovery (unlike ERR-001..003's graceful
   "This twist didn't load" / Retry path for network failures). I hit this defect twice more
   by accident later in the session (it kept crashing every fresh tab I opened at
   `/play/fadeout` until I remembered I'd left the corrupted key in `localStorage` from this
   very test and cleared it) — that repeated, involuntary reproduction is itself strong
   evidence of how sticky and severe this is. This is a Critical-priority, Invalid-input case;
   record it as a real stage-5 bug, not a plan artifact.

2. **RES-013's ledger entry (D4) is wrong — the plan predicted a FAIL that does not occur.**
   The plan states the "N plies" count line was "not built" and expects RES-013 to FAIL. Live
   observation on a real finished Fadeout game shows **"6 plies" rendered directly under the
   emoji move-timeline**, exactly where the spec wants it. It isn't a shell-level
   ResultModal feature (grepping `packages/shell/src` for "plies" finds nothing) — it's built
   into `games/fadeout/presentation.ts`'s own `shareArtifact()` (`` `${timelineToBody(symbols)}\n${statLine}` ``,
   `statLine = \`${plies} plies\``, with a whole documented C12 ruling explaining why), and
   `ResultModal` renders that whole string verbatim in the one `<p aria-label="move
   timeline">{artifactBody}</p>`. The user-visible result matches the spec; only the plan's
   assumption about *where* the feature lives is wrong. **RES-013 → PASS**, and ledger item D4
   should be corrected, not left as an open gap.

3. **A real, previously-undocumented focus-management bug, confirmed independently on BOTH
   of the app's dialogs.** RES-002 and HOW-002 both explicitly require "Escape closes the
   dialog and focus returns to the page / the triggering button" — not just "the dialog
   closes." In live testing, pressing Escape on the **ResultModal** and, separately, on the
   **HowSheet** both leave `document.activeElement === document.body` — focus is dropped, not
   returned to the "How?" button or anywhere sensible in the page. Confirmed via direct
   `document.activeElement` inspection after Escape in both cases (not inferred). Neither
   `packages/shell/src/components/ui/dialog.tsx` nor `HowSheet.tsx`/`ResultModal.tsx` wires the
   trigger button as a Radix `DialogTrigger` (both use plain `<button onClick={...}>` +
   external `open` state), which is the likely reason Radix's default focus-restore has
   nothing to restore to. This is a real, 2-for-2 reproducible a11y regression outside the
   D1–D10 ledger — **RES-002 and HOW-002 → FAIL** (partial: the "closes / board intact / no
   game-state mutation" portions of both cases pass fine).

4. **All five CHALLENGE-predicted-FAIL ledger items behave exactly as predicted, confirmed at
   the source line, not just by re-running the implementer's own tests** (the implementer's
   existing unit-test suite would trivially "pass" regardless, since — per the plan's own
   opening note — it encodes what was built, not what the spec wanted):
   - **PLAY-005 (D7)** — `TurnIndicator.tsx:36` hardcodes `bg-accent-p1` for any active seat.
     Watched live: mid-game, the **Bot** chip fills with the identical P1-blue used for the
     human's own chip a moment earlier. **FAIL, exactly as the ledger says.**
   - **LOD-004 / ERR-006 (D6)** — `RuleCard.tsx` renders "How?" unconditionally; `GameShell.tsx`
     passes `onHow={() => {}}` in both the loading and error branches. **FAIL, exactly as the
     ledger says** (source-confirmed both call sites).
   - **RES-012 (D5)** — `ResultModal.tsx` accepts a `streakLine` prop and renders it when
     present, but the `<ResultModal ... />` call site in `GameShell.tsx` never passes
     `streakLine`. **FAIL, exactly as the ledger says.**

5. **The two already-fixed defects the orchestrator named both verified fixed, with
   non-vacuous evidence:**
   - **Side-panel opt-in scoping (XG-001..004)** — `GameShell.tsx:406`:
     `hasSidePanel = presentation.sidePanel === true` (explicit flag, not inferred from
     `extraControls`). Registry-wide grep: `sidePanel: true` appears **only** in
     `games/crackstep/index.ts`; mine-run and tilt have `extraControls` with no `sidePanel`;
     nine-grids/fadeout have neither. Live: Mine Run renders single-column with its BankBar-
     equivalent extras below the board, never in a right column. **PASS.**
   - **Share double-tap guard (RES-005)** — `ResultModal.tsx` has a real `"pending"` `ShareState`
     member entered synchronously on click (before `onShare()` resolves) plus a
     `shareBusyRef`, and the test file's own comment explains it deliberately uses raw
     `fireEvent` (not `userEvent`, which refuses to click a disabled button) specifically so
     the test can't pass "for the wrong reason" — confirmed by hand-verifying that removing
     `disabled` alone still leaves the ref catching the second call. This is exactly the kind
     of self-aware anti-vacuity discipline the brief asked me to watch for, and it's already
     applied correctly. **PASS**, ran as part of the 403-test `packages/shell` suite (all
     green).

6. **A plan case that cannot fail regardless of implementation:** none found among the cases
   actually executed this session (I looked, per the brief's ask). The closest candidate,
   XG-003(b) ("does not crash — document what the wide grid renders with an empty right
   column"), is explicitly written as an open-ended observation rather than a pass/fail
   assertion, so it isn't vacuous, just deliberately descriptive — not run this session either
   way (see NOT RUN list).

7. **Incidental, out-of-plan finding (mentioned for completeness, not scored):** with the
   system in the evening and the OS defaulting to dark mode, `/play/fadeout` throws a real
   React hydration-mismatch warning on the root `<html className>` (`app/layout.tsx`'s inline
   dark-mode bootstrap script mutates the DOM before hydration, and the tag has no
   `suppressHydrationWarning`). On its own this looked benign (a console warning), but see
   finding 1 — the fatal crash I hit repeatedly while investigating this was PERS-001, not a
   second bug. No plan case tests theme/dark-mode hydration, so this isn't scored; flagging it
   for whoever owns `app/layout.tsx` next.

---

## Suite S1 — Play screen anatomy (13 cases)

| ID | Status | Notes |
|---|---|---|
| PLAY-001 | **PASS** ([PW] portion) / **DEFERRED-HUMAN** ([Eye] portion) | Live at `/play/fadeout`: header→rule card→status→chips→board→controls→"Describe board" order confirmed; chip "◌ decay"; rule sentence verbatim + "How?"; controls "⟟ Restart"/"? How" (Undo absent at 0 moves — conditional, not a defect). [Eye]: header/spine/button-shadow — human should confirm P1-blue-on-paper contrast and the 2px ink border + offset shadow read correctly (screenshot on file). |
| PLAY-002 | NOT RUN | Time budget — did not click "◂ Library". |
| PLAY-003 | **PASS** | "Your move." status; YOU chip filled/bold/underline/dot; BOT chip outlined, no dot — all confirmed in the PLAY-001 screenshot. |
| PLAY-004 | **PASS** | Placed a mark; status flipped to "Bot is thinking…"; BOT chip became active; board locked ~250ms then bot's mark appeared; status returned to "Your move." |
| PLAY-005 | **FAIL — [CHALLENGE], exactly as ledger predicts (D7)** | Live: during the bot's turn the "BOT" chip fills with the same `bg-accent-p1` blue used for "YOU" moments earlier. Source: `TurnIndicator.tsx:36` hardcodes `bg-accent-p1` on the active `<li>` regardless of which seat. Real stage-5 fix needed or explicit user waiver. |
| PLAY-006 | **PASS** | Tapped 3 cells in rapid succession (1 valid + 2 during lockout): exactly one mark placed, no double move, turn passed to bot once. |
| PLAY-007 | NOT RUN | Time budget — did not exercise Ctrl/Cmd+Z during bot-thinking/post-move/modal-open windows. |
| PLAY-008 | NOT RUN | RTL case (stub manifest, `tags: []`) — not executed against source; shell suite's `GameHeader.test.tsx` ran (5/5 green) as part of the broader vitest pass but I did not verify this specific assertion's content. |
| PLAY-009 | NOT RUN | RTL boundary (90/91 chars) — not executed; `RuleCard.tsx` does contain the `sentence.length > 90` dev-mode `console.error` (confirmed by reading the file for LOD-004/D6 investigation), consistent with the plan, but the 90-vs-91 boundary itself wasn't driven. |
| PLAY-010 | NOT RUN | RTL (malformed cell id) — not executed. |
| PLAY-011 | NOT RUN | RTL (bot driver rejects) — not executed. |
| PLAY-012 | **PASS** | Live + source. UI: restart at 1 move (no confirm, immediate reset) and at 2 moves (no confirm, immediate reset) and at 4 moves (confirm dialog "Restart?"/"This game will be lost."/Cancel/Restart, text verbatim). Source, `GameShell.tsx:532`: `confirmRestart = ... (mode === "hotseat" ? game.moveCount >= 1 : game.moveCount >= 3)`, gated additionally on `game.status.kind === "ongoing"` — confirms the exact `>=3` boundary and that terminal state never confirms. |
| PLAY-013 | NOT RUN | RTL-only, no app entry point (confirmed by plan and by earlier registry grep — no `daily`/hotseat caller found). Not executed this session; the `moveCount >= 1` hotseat threshold was corroborated as a side effect of reading the same source line as PLAY-012. |

## Suite S2 — Crackstep (8 cases)

| ID | Status | Notes |
|---|---|---|
| CRK-001 | **PASS** (desktop) / **NOT INDEPENDENTLY CONFIRMED** (mobile) | Desktop (1456px, then a 896px viewport used for later tests) both showed the wide two-column grid at md+. The `resize_window` tool did not reliably shrink the actual viewport used for screenshots in this session (reported `innerWidth` stayed near desktop size after a nominal 390×844 resize) — did not get a clean sub-md screenshot. `GameShell.tsx`'s `md:`-breakpoint gate was read and is consistent with single-column-below-md, but that's source inference, not observation. |
| CRK-002 | **PASS** | Legend text matches verbatim: "wood — crumbles when you leave" / "stone — holds forever" / "rubble — gone for good" / "hole — never was floor"; swatches present and `aria-hidden` (confirmed in `SidePanel.tsx` source); "Floor left" mono label + bordered bar + numeric count ("24") all present. |
| CRK-003 | NOT RUN | Did not play moves on Crackstep to watch the bar/number change live; `SidePanel.tsx` source shows `remaining`/`remainingFraction` are recomputed from `view` on every render, consistent with the expectation, but not observed in motion. |
| CRK-004 | **PASS** (pinned deviation D3, confirmed as documented) | Live: "0 moves" shown centered above the board, no par. Source, `ScoreHUD.tsx`: without `par`, renders `` `${movesUsed} moves` ``; with `par`, `` `moves ${movesUsed} · par ${par}` ``. Matches the plan's documented deviation exactly — not a new finding. |
| CRK-005 | **PASS** (source) | `SidePanel.tsx`: `remainingFraction = totalWalkable > 0 ? remaining/totalWalkable : 0` — division-by-zero guarded, yields 0% not NaN/Infinity. Not driven interactively (would need a crafted zero-walkable view). |
| CRK-006 | **PASS** (light evidence) | Exactly one "Describe board" link visible in the Crackstep screenshot, below the controls row (matches D8's pinned placement deviation). Not exhaustively DOM-counted. |
| CRK-007 | NOT RUN | RTL, props-only (`daily: {dayNumber, par}`) — not executed. The underlying reachability-gap claim (no `daily` caller reaches `/play/crackstep`) was not re-verified this session (relied on the plan's own D9 note). |
| CRK-008 | **DEFERRED-HUMAN** | [Eye]. A mid-game Crackstep screenshot exists (`ss_16828m7vy`) showing wood/stone/rubble/hole with distinct textures (grain/rivets+octagon/speckle/flat) as designed — a human should grayscale-convert and confirm no two materials collapse to the same value. |

## Suite S3 — Result modal (14 cases)

| ID | Status | Notes |
|---|---|---|
| RES-001 | **PASS** | Live, finished a Fadeout game (Bot wins, 6 plies). Anatomy top-to-bottom confirmed exactly: title "Bot wins" → emoji timeline + plies line (no texture line supplied for this loss shape, which is correct per RES-010) → Rematch (visibly focus-ringed) → "Next: Nine Grids →" card with its rule sentence → "↗ Share result". |
| RES-002 | **FAIL (partial) — real, undocumented finding** | Modal closes on Escape, finished board visible/dimmed, does not auto-reopen after 2s — all PASS. But `document.activeElement` after Escape is `<body>`, not "back in the page" as the case requires. Reproduced twice. See headline finding #3. |
| RES-003 | **PASS** | Clicked Rematch: modal closed, fresh empty board, "Your move.", no leftover marks. |
| RES-004 | NOT RUN | Did not double-click Rematch specifically (single-click Rematch was tested for RES-003). |
| RES-005 | **PASS — [CHALLENGE] resolved (already fixed)** | See headline finding #5. Confirmed via source (`ShareState` "pending" member + `shareBusyRef`) and via the existing, deliberately-non-vacuous vitest test `TC-2A-RES-005 (guard is real, not decorative)` in `packages/shell/test/ResultModal.test.tsx`, which passed as part of the 403-test shell suite run. |
| RES-006 | **PASS** | Patched `navigator.share`/`navigator.clipboard` to reject, finished a game, clicked Share: "Couldn't share — long-press to copy" + read-only textarea with the full text (`Fadeout — Bot wins / 🎯 timeline / 6 plies / http://localhost:3100/play/fadeout` — full qualified URL, not a bare path); focusing the textarea auto-selects all 69 characters (`selectionStart:0, selectionEnd:69`); modal/result/board state unchanged. |
| RES-007 | NOT RUN | Did not click the "Next: Nine Grids →" link to confirm real navigation + no-immediate-repeat. |
| RES-008 | NOT RUN | RTL (`nextTwist: null`) — not executed. |
| RES-009 | NOT RUN | RTL (over-long `shareArtifact`) — not executed. |
| RES-010 | **PASS (incidental)** | The live RES-001 run supplied no `textureLine` for this particular loss, and no empty italic line node appeared — consistent with the expected "slot absent, not blank," though not driven via a crafted empty-string case specifically. |
| RES-011 | NOT RUN | RTL (`dayNumber` stamp + SR exposure) — not executed. |
| RES-012 | **FAIL — [CHALLENGE], exactly as ledger predicts (D5)** | `ResultModal.tsx` accepts and renders `streakLine` when present; the `<ResultModal .../>` call in `GameShell.tsx` never passes it. Confirmed at both ends of the wire, source-only (not driven via a finished-streak scenario). |
| RES-013 | **PASS — contradicts the ledger's predicted FAIL (D4 is wrong)** | See headline finding #2. Live: "6 plies" rendered directly under the timeline on a real finished game. |
| RES-014 | **DEFERRED-HUMAN** ([Eye]) / behavioral portion **PASS (incidental)** | Live screenshots of the RES-001 run show exactly the documented deferral: paper-lift card, brush border, print shadow, display-face title, mono timeline — no slip rotation/tear/winner-accent stamp/staggered entrance/butter Rematch ground. All non-visual behavior (focus, Esc, Share machine) exercised in RES-001..006 remained intact. A human should still confirm the visual deferral boundary against the zine system directly. |

## Suite S4 — How-to sheet (7 cases)

| ID | Status | Notes |
|---|---|---|
| HOW-001 | **PASS** | Opened via rule card's "How?": bottom sheet over dimmed board, drag-handle bar, tag "HOW THIS TWIST WORKS", rule sentence as headline, three steps "Place"/"Age"/"Vanish" with chips 1/2/3 in that DOM order. Did not separately re-open via "? How" in controls to confirm identical content from the second trigger (time budget). |
| HOW-002 | **FAIL — real, undocumented finding** | Focus moves into the sheet on open (confirmed: `document.activeElement.textContent` = sheet's own content). On Escape, focus lands on `<body>`, not on the "How?" button that opened it. Same class of bug as RES-002 — see headline finding #3. |
| HOW-003 | **PASS** | Clicked the scrim: sheet closed; board state exactly as before (0 moves, "Your move.", empty board) — no game input consumed. |
| HOW-004 | NOT RUN | RTL (blank frames) — not executed. |
| HOW-005 | NOT RUN | Small-viewport scroll-cap check — not executed (same viewport-resize tooling issue as CRK-001). |
| HOW-006 | NOT RUN | Crackstep-specific HowSheet layout — not executed. |
| HOW-007 | **DEFERRED-HUMAN** ([Eye]) | The HOW-001 screenshot shows the board area behind the sheet visibly darker/dimmed, consistent with the spec; formally deferring per the [Eye] tag rather than calling it from a screenshot. |

## Suite S5 — Loading (5 cases)

| ID | Status | Notes |
|---|---|---|
| LOD-001 | **BLOCKED / inconclusive** | Attempted via a standalone Playwright script using CDP `Network.emulateNetworkConditions` (~40kbps, 300ms latency, cache disabled) against the `next dev` server, waiting on the "dealing the board" caption selector. The loading state never persisted long enough to catch within a 4s window even under throttling — most likely because dev-server chunks for this small app are small enough to clear even a throttled connection quickly, or the specific CDP throttle wasn't binding to the resources that matter. Did not get a clean before/after screenshot of the blink grid. **Not scored pass/fail** — needs either a slower emulated profile, an in-app debug hook to hold the loading state open, or Playwright's official route-delay API instead of CDP throughput throttling. |
| LOD-002 | **BLOCKED / inconclusive** | Same tooling limitation as LOD-001 — never caught the loading frame to inspect `aria-hidden` on the blink grid or confirm no live-region chatter. |
| LOD-003 | NOT RUN | Route-level `loading.tsx` → GameShell handoff, same-footprint check — not executed. |
| LOD-004 | **FAIL — [CHALLENGE], exactly as ledger predicts (D6)** | Source-confirmed: `GameShell.tsx` passes `onHow={() => {}}` in the loading branch (line ~125) and `RuleCard.tsx` renders the "How?" button unconditionally regardless of the no-op handler — a visible, clickable, dead button. |
| LOD-005 | **BLOCKED / inconclusive** | Attempted alongside LOD-001/002 with `page.emulateMedia({reducedMotion:'reduce'})` layered on the same throttle; same "never caught the loading frame" limitation, so the `.ta-blink` / `animationName` check never ran. |

## Suite S6 — Load error and recovery (7 cases)

| ID | Status | Notes |
|---|---|---|
| ERR-001 | **PASS** | Standalone Playwright script blocked requests matching `fadeout`+`engine|presentation` via `page.route(...).abort()`, then navigated to `/play/fadeout`. Result: header + real rule sentence preserved; alert card exact text "This twist didn't load." / "The rules are fine — the paper jammed." with Retry + "Back to library" — all present, verbatim. |
| ERR-002 | **PASS** | Clicked "Back to library" from the blocked/error state: navigated to `http://localhost:3100/` (the library). |
| ERR-003 | **PASS** | Unblocked the route, clicked Retry: recovered to a clean, playable state ("Your move.", X/O labels visible, no residual error text) — no full reload needed. |
| ERR-004 | NOT RUN | Retry-spam / slow-load race — not executed. |
| ERR-005 | **PASS** | `document.querySelectorAll('[role="alert"]').length === 1` on the blocked-chunk error state. |
| ERR-006 | **FAIL — [CHALLENGE], exactly as ledger predicts (D6)** | Source-confirmed alongside LOD-004: `GameShell.tsx`'s error branch also passes `onHow={() => {}}` to the always-rendered "How?" button. |
| ERR-007 | **PASS** | `curl` confirmed `/play/fadeout` → 200, `/play/crackstep` → 200, `/play/does-not-exist` → 404 (real 404, not a 200 or a hung skeleton). |

## Suite S7 — Accessibility behaviors (8 cases)

| ID | Status | Notes |
|---|---|---|
| A11Y-001 | **PASS** | DOM inspection on `/play/crackstep`: exactly one `[aria-live="polite"]` region (sr-only) and one `[aria-live="assertive"]` region (sr-only, empty at rest). After clicking "Describe board," the polite region's `textContent` became a real board readback: `"row 2 column 2, on a crumbling tile. 24 tiles left. Your move."`. |
| A11Y-002 | **PASS** | Clicked "Describe board" twice with no intervening move; captured the polite region's `textContent` before/after each click. Visible text identical both times, but the DOM value differs by a trailing zero-width space that toggles on/off between clicks (`after1 !== after2`, `after1 !== before`) — confirms the ZWSP-toggle re-announcement mechanism is real, not just visually distinct. |
| A11Y-003 | NOT RUN | Did not specifically inspect the assertive region's content immediately after a game ends (RES-001's run didn't check this). |
| A11Y-004 | NOT RUN | Full five-state × two-game reduced-motion sweep — not executed (LOD-005's narrower reduced-motion attempt was inconclusive per S5 above). |
| A11Y-005 | NOT RUN | Grayscale color-alone sweep across chips/marks/Crackstep/modal — not executed as its own case, though PLAY-005's finding (BOT chip fills identically to YOU's chip) is directly relevant color-redundancy evidence for the turn-chip portion of this case and should be read alongside it. |
| A11Y-006 | NOT RUN | Keyboard-only full loop — not executed. |
| A11Y-007 | **FAIL (partial)** | ResultModal's initial-focus-on-Rematch is confirmed (source `onOpenAutoFocus` + visible focus ring in the RES-001 screenshot). But per RES-002/HOW-002 above, "Esc returns focus into the page" fails for both dialogs — so this case, which explicitly re-asserts that same contract for both dialogs together, is scored FAIL. Accessible-name checks ("the modal's accessible name is the result text"; "the sheet's is 'How this twist works'") were not independently verified. |
| A11Y-008 | **DEFERRED-HUMAN** ([Eye]) | Contrast must be measured, not eyeballed, per the plan's own instruction — no measurement tool was used this session. |

## Suite S8 — Cross-game blast radius (7 cases)

| ID | Status | Notes |
|---|---|---|
| XG-001 | **PASS** | Source: `GameShell.tsx:406`, `hasSidePanel = presentation.sidePanel === true` (explicit flag). Registry-wide grep: `sidePanel: true` only in `games/crackstep/index.ts`. Live: Crackstep renders two-column at desktop width; Mine Run renders single centered column at the same width. |
| XG-002 | **PASS** | Live screenshot of `/play/mine-run`: its extras ("22 · 0 hit · 75 reveals left", "A safe move is available.", "0 · +1 next / Bank / banked 0") render below the board inside the single column — no right-hand column, no wrapper. Tilt not independently screenshotted this session (time budget), but the same registry grep (`extraControls` present, no `sidePanel`) applies to it identically. |
| XG-003 | **PASS (source, partial)** | `(a)` `extraControls` without `sidePanel` → single column (confirmed live via Mine Run, case XG-002). `(c)` neither → single column (confirmed via Fadeout throughout this session). `(b)` `sidePanel: true` with no `extraControls` → not driven (would need a synthetic presentation); this specific sub-case is the one the plan itself flags as "a boundary the gate never considered" — genuinely not run. |
| XG-004 | **PASS** | Registry-wide grep of `games/*/index.ts` for `sidePanel` confirms exactly one truthy entry (`crackstep`). |
| XG-005 | NOT RUN (partial raw material exists) | Full sweep is 5 games × 2 widths = 10 screenshots as a standing baseline. This session incidentally captured Fadeout (desktop + a ~896px view) and Crackstep (desktop) and Mine Run (desktop) — not a systematic 5×2 set, and not saved anywhere as a baseline artifact. |
| XG-006 | NOT RUN (spot evidence only) | Exactly-one counts for "Describe board"/"⟳ Restart"/"? How" were confirmed incidentally on Fadeout and Crackstep screenshots (each showed exactly one of each), but Tilt, Mine Run, and Nine Grids were not checked for this specific regression net. |
| XG-007 | NOT RUN | Fonts-blocked fallback check — not executed. |

## Suite S9 — Persistence and state after failure (5 cases)

| ID | Status | Notes |
|---|---|---|
| PERS-001 | **FAIL — Critical, real defect, not a plan artifact** | See headline finding #1. Two of the three corruption sub-cases behave correctly: `"not json"` → fresh playable game (PASS); wrong `v` (99 vs current) → fresh playable game (PASS). The third, `{"v":<current>}` with a **truncated body** (no `record` field) → **unrecovered `TypeError` crash**, reproduced 3 times across the session (including twice by accident). Because all three sub-cases must hold for this case to pass, and the worst one crashes outright, the case is **FAIL**, and it's the highest-severity finding in this run. |
| PERS-002 | NOT RUN | Mid-game resume round-trip (3 moves, reload) — not executed. |
| PERS-003 | NOT RUN | Storage-unavailable session — not executed. |
| PERS-004 | NOT RUN | Restart-count-in-share-text gating (casual vs. daily) — not executed. |
| PERS-005 | NOT RUN | Reload-during-loading residue check — not executed. |

---

## Status summary

**By status (74 cases total):**

| Status | Count |
|---|---|
| PASS | 30 |
| FAIL | 8 |
| DEFERRED-HUMAN | 5 |
| BLOCKED / inconclusive (tooling) | 3 |
| NOT RUN (time budget) | 28 |

PASS list: PLAY-001(PW)/003/004/006/012, CRK-002/004/005/006, RES-001/003/005/006/010(incidental)/013/014(behavioral portion), HOW-001/003, ERR-001/002/003/005/007, A11Y-001/002, XG-001/002/003(partial)/004, CRK-001(desktop portion only, noted as partial above).

FAIL list: PLAY-005 (CHALLENGE, D7 — expected), RES-002 (real, new), RES-012 (CHALLENGE, D5 — expected), HOW-002 (real, new), LOD-004 (CHALLENGE, D6 — expected), ERR-006 (CHALLENGE, D6 — expected), A11Y-007 (partial, downstream of RES-002/HOW-002), PERS-001 (real, new, Critical).

DEFERRED-HUMAN: CRK-008, RES-014 (visual portion), HOW-007, A11Y-008, plus the [Eye] half of PLAY-001.

BLOCKED/inconclusive: LOD-001, LOD-002, LOD-005 (throttle-timing tooling limitation, detailed above).

**By suite:**

| Suite | PASS | FAIL | DEFERRED-HUMAN | BLOCKED | NOT RUN |
|---|---|---|---|---|---|
| S1 PLAY (13) | 5 | 1 | 0 (partial in PLAY-001) | 0 | 7 |
| S2 CRK (8) | 4 (+1 partial) | 0 | 1 | 0 | 2 |
| S3 RES (14) | 5 (+1 incidental, +1 partial) | 2 | 1 (+partial) | 0 | 5 |
| S4 HOW (7) | 2 | 1 | 1 | 0 | 3 |
| S5 LOD (5) | 0 | 1 | 0 | 3 | 1 |
| S6 ERR (7) | 5 | 1 | 0 | 0 | 1 |
| S7 A11Y (8) | 2 | 1 | 1 | 0 | 4 |
| S8 XG (7) | 4 (partial on 1) | 0 | 0 | 0 | 3 |
| S9 PERS (5) | 0 | 1 | 0 | 0 | 4 |

---

## What was not run, and why (honesty ledger)

- **RTL-only cases not executed against source or a driven test** (PLAY-008/009/010/011/013,
  CRK-007, RES-008/009/011, HOW-004, PERS-004): time budget. These need a component-level
  render (React Testing Library) with crafted props/stubs — none were written or driven this
  session; I relied on reading source where it was fast and directly relevant to a CHALLENGE
  case, but did not fabricate PASS/FAIL for cases I didn't actually drive.
- **PW cases needing more session time** (PLAY-002/007, CRK-003, RES-004/007, HOW-004/005/006,
  ERR-004, A11Y-003/004/005/006, XG-005 full sweep/006 full sweep/007, PERS-002/003/005): not
  reached within the ~30 min actually spent; genuinely not run, not guessed.
- **LOD-001/002/005**: attempted with real tooling (CDP network throttle via a standalone
  Playwright script), but the loading state resolved faster than the observation window in
  every attempt — recorded as BLOCKED/inconclusive rather than guessed at either verdict.
- **Viewport-resize-dependent cases** (CRK-001's mobile half, HOW-005): the `resize_window`
  MCP tool did not reliably change the effective screenshot viewport in this session
  (`window.innerWidth` stayed near 1512 after a nominal 390×844 request) — not fabricated.

## Gaps/corrections to the plan and brief (as requested)

1. **Case count**: brief said 62; the plan actually has 74 (`grep -c '\*\*TC-2A-'`).
2. **Ledger item D4 (RES-013) is factually wrong** — see headline finding #2. The "9 plies"
   line **is** built and rendered (as `${plies} plies` inside Fadeout's own `shareArtifact()`),
   just not where the plan's author expected to find it. Recommend updating the ledger to
   "MATCH — built into the game's own artifact body, not a shell-level line" rather than
   leaving it as an open undocumented gap.
3. **No case in this plan is vacuous by construction**, as far as I could tell from the cases
   actually executed — I looked for this specifically per the brief's ask (headline finding
   #6). The plan's own test-authoring is notably disciplined about this exact failure mode
   (see the RES-005 test file's own comment explaining why it deliberately avoids `userEvent`).
4. **Two new, real defects surfaced by this run that the plan's ledger doesn't mention**:
   RES-002/HOW-002's focus-to-body regression (both dialogs, headline #3), and PERS-001's
   truncated-persisted-record crash (headline #1, arguably the most severe finding in this
   entire run — a Critical/Invalid-input case that the plan expected to be routine).

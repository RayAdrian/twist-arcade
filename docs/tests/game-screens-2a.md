# Test Plan — Game Screens 2a (zine restyle of play / result / how-to / loading / error)

**Stage 3 (Fable, test design). Retroactive remedy** — this stage was skipped and the implementer
authored its own tests, which CLAUDE.md §1 forbids. Cases below are derived from the design's
acceptance criteria (`.scratch/design-turn2/2a-section.html`, artboard 2a) plus the standing
non-negotiables of `docs/plans/ui-direction.md` (§1.1 board-channel/contrast/reduced-motion
gates, §3 game-page anatomy, §4 end-of-game job order, §5.3 motion rules R1–R3), **not** from the
implementation. The implementation was read only afterward, to pin or challenge deviations.

**Feature under test:** the shared game-screen shell (`packages/shell/src/components/
{GameHeader,GameShell,TurnIndicator,StatusLine,RuleCard,ControlsRow,ResultModal,HowSheet,
ScoreHUD,AriaAnnouncer}.tsx`), Crackstep's side panel (`games/crackstep/ui/SidePanel.tsx`,
`materials.ts`), and `app/globals.css` / `app/play/[gameId]/*`.

**Execution notes for stage 4 (Sonnet):**
- Routes: `/play/fadeout` (solo-bot, 2P), `/play/crackstep` (solo-single), plus
  `/play/mine-run`, `/play/tilt`, `/play/nine-grids` for blast-radius cases. Unknown ids 404.
- Automation tags: **[RTL]** = unit/RTL (vitest, component props), **[PW]** = Playwright MCP /
  Claude in Chrome against the dev server, **[Eye]** = human visual conformance to the zine
  system (record with a screenshot either way).
- Cases tagged **[CHALLENGE]** are places the implementation deviates from the spec without a
  recorded waiver. Run them with the spec as the expected result; a mismatch is recorded as
  **FAIL** (a real finding for stage 5/6), never re-worded to match the code.
- Hotseat and daily states have **no app entry point yet** (no mode picker; `PlayClient` never
  passes `daily`). Cases needing them are [RTL]-only and say so.
- Expected-result strings are verbatim from the spec/plan; do not loosen them.

---

## Deviation ledger (spec → shipped), status per item

| # | Spec element | Shipped | Status | Covered by |
|---|---|---|---|---|
| D1 | Loading grid: staggered blink (`ta-blink`, 0–800 ms delays) | Staggered blink | **MATCH — the "scan shipped as blink" note in the brief is wrong; `ta-scan` is unused in artboard 2a** | LOD-001 |
| D2 | Result: torn score slip (rotation, tear edge, winner-accent stamp, staggered timeline) | Material pass only; documented deferral in `ResultModal.tsx` header comment | Pinned deferral — verify the documented subset only | RES-001, RES-014 |
| D3 | Crackstep "Moves used" block (mono 46px + italic "par 19", in side panel) | `ScoreHUD` single line above board ("moves N · par P" / "N moves") | Documented deviation — pin current copy + placement | CRK-004 |
| D4 | "9 plies" count line under result timeline | ~~Not built~~ **CORRECTED 2026-08-21 (stage 4): IS built** — in `games/fadeout/presentation.ts`'s `shareArtifact()`, not `ResultModal`, which is why an author reading only the shell components missed it. Renders live as "6 plies". | ~~[CHALLENGE]~~ **no deviation** | RES-013 → PASS |
| D5 | "streak 13 days · longest 21" on result slip | `streakLine` prop exists + `streak.ts` exists; GameShell never passes it | **[CHALLENGE] undocumented gap** | RES-012 |
| D6 | Loading/error states show the rule card **without** a "How?" button | RuleCard always renders "How?"; in loading/error `onHow={() => {}}` — a visible dead button | **[CHALLENGE]** | LOD-004, ERR-006 |
| D7 | Active seat chip filled in **that player's** accent (plan §0: "an accent hue always means a player") | `TurnIndicator` hard-codes `bg-accent-p1` on whichever seat is active — Bot/P2's chip fills P1-blue on its turn | **[CHALLENGE]** | PLAY-005 |
| D8 | Crackstep "Describe board" at the bottom of the side panel | In ControlsRow `extras`, below the board column | Placement deviation, functionally equivalent — pin (exactly ONE per screen) | CRK-006 |
| D9 | Crackstep header chip "daily 41"; result stamp "day 41" | Strings built (`daily ${n}` / `day ${n}`) but unreachable from any route (no `daily` caller) | Reachability gap — RTL-only until daily wiring lands | CRK-007, RES-011 |
| D10 | Result "Rematch" on butter (`#f6e7b0`) ground | `bg-paper-lift` | Minor visual deviation, part of D2's deferral | RES-014 [Eye] |

---

## §2 category coverage map (explicit, per CLAUDE.md — no silent omissions)

- **Happy path** — every screen state: PLAY-001, CRK-001, RES-001, HOW-001, LOD-001, ERR-001.
- **Boundary (empty/zero/one/max/off-by-one)** — rule sentence at 90/91 chars (PLAY-009);
  0/1/3 visible how-frames (HOW-004/005); no manifest tags → no chip (PLAY-008); registry-of-one
  → no next-twist card (RES-008); floor-left at 0 and full, walkable=0 guard (CRK-005);
  share artifact at the 7-line frame limit (RES-009); moves at 0 (CRK-004).
- **Invalid / malformed input** — malformed cell id must never crash the board (PLAY-010);
  corrupt/mis-versioned localStorage (PERS-001/002); game presentation returning an over-long
  share body (RES-009); empty `textureLine` return (RES-010).
- **Auth and permission failures** — **N/A, justified**: there is no authentication, no server
  session, no tenancy, and no per-user server data anywhere in this feature. The only identity
  is device-local storage (`ta:*` keys); the result screen's account slot is deliberately empty
  until Phase 3 (plan §4). I checked the three suggested angles before writing N/A: the daily
  "certificate" is a prop-passed day number with no credential semantics; share URLs are
  composed *outgoing* text (covered as data, RES-006/009, not as auth); `persistence.ts` is
  key/value plumbing with no cross-user surface. Revisit the moment accounts or a server land.
- **Concurrency / duplicate submission** — double-click Share with no in-flight guard
  (RES-005 [CHALLENGE]); double Rematch (RES-004); Retry-vs-slow-first-load race on the
  `attemptRef` guard (ERR-004); Ctrl/Cmd+Z firing while controls are nominally locked
  (PLAY-007); rapid cell taps inside the 250 ms lockout (PLAY-006).
- **Network / dependency failure** — engine chunk fetch failure → error card, Retry, recovery
  after network restored (ERR-001..005); bot driver failure → retryable alert, board inert,
  never a silent hang (PLAY-011); clipboard/native-share failure → fallback textarea (RES-006);
  storage disabled/quota (PERS-003); Google Fonts blocked → readable fallback stack (XG-007).
  There is no upstream HTTP API in this feature; "500 from upstream" maps to chunk-request
  failure and is covered there.
- **State after failure** — no partial writes: after a failed share the game state and modal
  survive intact (RES-006); after a failed load, Retry produces a clean ready state with no
  stale board (ERR-003); corrupt storage yields a fresh start, never a crash, and never a
  half-restored game (PERS-001/002); storage-write failure leaves the session fully playable
  (PERS-003).

---

## Suite S1 — Play screen anatomy (Fadeout, `/play/fadeout`, solo-bot)

**TC-2A-PLAY-001 — Anatomy and copy of the play screen** · Critical · Happy path · [PW]+[Eye]
- Pre: dev server running; fresh profile (no `ta:*` keys).
- Steps: navigate to `/play/fadeout`; wait for the board.
- Expected: top-to-bottom order is header → rule card → status line → turn chips → board →
  caption/callouts → controls → "Describe board". Header shows "◂ Library", title "Fadeout",
  chip "◌ decay" (manifest `tags[0]` with the `◌ ` prefix). Rule card reads the manifest
  sentence verbatim with a "How?" button. Controls read "↩ Undo", "⟳ Restart", "? How".
  [Eye]: header band is the P1 blue accent with paper text; rule card has the heavy left
  spine; buttons carry the 2 px ink border + offset print shadow.

**TC-2A-PLAY-002 — "◂ Library" returns to the shelf** · High · Happy path · [PW]
- Steps: from PLAY-001, activate "◂ Library".
- Expected: lands on `/` (the library). No console errors.

**TC-2A-PLAY-003 — Status words + chips, your turn** · Critical · Happy path · [PW]
- Expected on load: status line says "Your move." (words, not color); "You" chip has
  `aria-current="true"`, filled style, bold + underline, and the small blink dot; "Bot" chip is
  outlined/muted with no dot.

**TC-2A-PLAY-004 — Bot turn state** · High · Happy path · [PW]
- Steps: place a mark; observe during the bot's turn.
- Expected: status flips to the bot-thinking phrase; the "Bot" chip becomes the active one
  (`aria-current`), "You" chip returns to outlined. Board input is locked for the ~250 ms
  post-move window, then the bot's mark appears.

**TC-2A-PLAY-005 — [CHALLENGE] Active-seat fill honors accent=player** · High · Negative · [PW]+[RTL]
- Rationale: plan §0's governing rule — "an accent hue always means a player — everywhere it
  appears". The chips name players (glyph + label), so their fill is a player signal, not chrome.
- Steps: during the bot's turn (or [RTL]: `TurnIndicator` with seat 1 active), inspect the
  active chip's background.
- Expected **per spec**: the Bot/P2 chip, when active, must NOT fill with the P1 accent.
  Shipped code hard-codes `bg-accent-p1` for any active seat → record FAIL if observed; this is
  a stage-5 fix or an explicit user waiver.

**TC-2A-PLAY-006 — Input lockout swallows rapid taps, no double move** · High · Concurrency · [PW]
- Steps: tap an empty cell, then immediately tap another empty cell twice within ~200 ms.
- Expected: exactly one human mark is placed per turn; no second move registers during the
  lockout; no error; turn passes to the bot exactly once.

**TC-2A-PLAY-007 — Ctrl/Cmd+Z path respects undo legality** · High · Concurrency · [PW]
- Rationale: `ControlsRow`'s window-level keydown ignores its own `disabled` prop, and
  GameShell never passes `disabled` at all — the only guards are `canUndo` and `useGame`'s
  internals.
- Steps: (a) press Ctrl/Cmd+Z during the bot's thinking window; (b) press it twice rapidly
  after your own move; (c) press it with the ResultModal open after a finished game.
- Expected: undo only ever reverts to a legal prior state; never desyncs the board vs. status
  line; never fires "behind" the result modal in a way that mutates a finished game. Any state
  where board and status disagree = FAIL.

**TC-2A-PLAY-008 — No chip when manifest has no tags and no daily** · Medium · Boundary · [RTL]
- Steps: render `GameHeader` (or `GameShell` with a stub manifest) with `tags: []`, no daily.
- Expected: no chip node rendered; the placeholder keeps the three-column layout (title still
  visually centered [Eye] at low priority).

**TC-2A-PLAY-009 — Rule sentence boundary 90/91 chars** · Low · Boundary · [RTL]
- Steps: render `RuleCard` with a 90-char sentence, then 91.
- Expected: 90 → silent; 91 → dev-mode `console.error` naming the length; both render the full
  sentence (warn loudly, never throw, never truncate).

**TC-2A-PLAY-010 — Malformed cell id never crashes the board** · High · Invalid input · [RTL]
- Steps: invoke the shell's cell-action path with a non-JSON cell id (e.g. `"not-json"`).
- Expected: no throw, no state change, board remains interactive.

**TC-2A-PLAY-011 — Bot failure is a retryable alert, never a hang** · High · Dependency failure · [RTL]
- Steps: drive `GameShell` with a `BotDriver` stub that rejects; make one human move.
- Expected: a `role="alert"` block "The bot couldn't make a move." with a Retry button replaces
  the status line; board stays inert (still the bot's turn); Retry with a now-working driver
  resumes play. No silent infinite "thinking".

**TC-2A-PLAY-012 — Restart confirm thresholds (solo ≥3 moves; terminal never confirms)** · Medium · Edge · [PW]
- Steps: (a) restart at 0 and 2 moves — no confirm dialog; (b) at 3 moves — confirm dialog
  titled "Restart?" body "This game will be lost.", Cancel keeps the game; (c) finish a game,
  then Restart/Rematch — must be immediate, no confirm.
- Expected: exactly as above; off-by-one at the 2→3 boundary is checked explicitly.

**TC-2A-PLAY-013 — Hotseat mode contract** · Medium · Edge · [RTL] (no app entry point — flag stays open)
- Steps: render `GameShell` with `mode: "hotseat"`.
- Expected: chips read "Player 1"/"Player 2"; Undo button absent (hidden, not disabled);
  Restart confirms from `moveCount >= 1`; status names the acting player (never a bare "Your
  move." shown to both); handoff interstitial appears per `useGame`'s pending flag; result text
  reads "Player N won".

## Suite S2 — Crackstep solo + side panel (`/play/crackstep`)

**TC-2A-CRK-001 — Two-column desktop layout, single column mobile** · Critical · Happy path · [PW]
- Steps: open `/play/crackstep` at 1024×800, then at 390×844.
- Expected: at md+ the board+controls sit left, the game's panel right (~300 px column); below
  md everything stacks in one column with the panel below the board. No horizontal scroll at
  390 px.

**TC-2A-CRK-002 — Side panel content** · High · Happy path · [PW]
- Expected: panel shows "Floor left" (mono label), a bordered progress bar plus a numeric
  count, and the four-row legend exactly: "wood — crumbles when you leave", "stone — holds
  forever", "rubble — gone for good", "hole — never was floor", each with a swatch. Meaning is
  carried by the words; swatches are `aria-hidden`.

**TC-2A-CRK-003 — Floor-left updates with play** · High · Happy path · [PW]
- Steps: make two moves; watch bar and number.
- Expected: number decreases as wood crumbles; bar fraction shrinks; the numeric text (not the
  bar alone) carries the value.

**TC-2A-CRK-004 — Moves readout (pinned deviation D3)** · Medium · Edge · [PW]
- Expected as shipped (documented deviation): a single centered line above the board from
  `ScoreHUD` — with no daily wired it reads "0 moves" → "N moves" (no par). The mockup's
  three-line "Moves used / 14 / par 19" block is NOT present; its absence is expected here and
  tracked by D3, not a new finding. With `daily.par` [RTL]: reads "moves N · par P".

**TC-2A-CRK-005 — Floor-left boundaries** · Medium · Boundary · [RTL]
- Steps: render `SidePanel` with (a) all walkable tiles remaining, (b) zero remaining,
  (c) a pathological view with zero walkable tiles.
- Expected: (a) 100% bar; (b) 0% bar and "0"; (c) no NaN/Infinity — fraction guard yields 0%.

**TC-2A-CRK-006 — Exactly one "Describe board" per screen** · High · Edge · [PW]
- Expected: one and only one "Describe board" control on the Crackstep screen (below the
  controls row — placement deviates from the mockup's panel slot, pinned by D8). It announces
  (see A11Y-001).

**TC-2A-CRK-007 — Daily chrome via props (reachability gap D9)** · Medium · Edge · [RTL]
- Steps: render `GameShell` for Crackstep with `daily: { dayNumber: 41, par: 19 }`.
- Expected: header chip reads "daily 41" (takes priority over the "◌ decay" tag chip); header
  band uses the P2 accent for solo-single; on finish the modal carries the "day 41" stamp.
  Route-level: confirm `/play/crackstep` today shows "◌ decay" (no daily caller) — record this
  as the standing reachability gap, not a defect.

**TC-2A-CRK-008 — Tile material identity survives grayscale** · High · Security-adjacent a11y gate · [Eye]
- Steps: screenshot the mid-game board; convert to grayscale.
- Expected (plan §1.1 non-negotiable): wood/stone/rubble/hole remain distinguishable — board
  tiles carry texture (grain, rivets+octagon, speckle, flat) per `Board.tsx`, and the legend's
  words disambiguate the flat swatches. Any two materials distinguishable only by hue = FAIL.

## Suite S3 — Result modal

**TC-2A-RES-001 — Result anatomy and job order** · Critical · Happy path · [PW]
- Steps: win (or lose) a Fadeout game; wait.
- Expected: modal opens ~300 ms after the terminal state (a fast Rematch click before that must
  not be beaten by the modal); board behind is dimmed and stays inspectable. Top-to-bottom:
  result title ("You won" / "You lost" / "Draw" / "Bot wins") → italic texture line (when the
  game supplies one, e.g. Fadeout's) → emoji move timeline (labelled "move timeline") →
  "Rematch" (primary) → "Next: <title> →" card with its rule sentence → "↗ Share result".
  Initial focus is on Rematch.

**TC-2A-RES-002 — Escape closes to the finished board; dismissed stays dismissed** · Critical · Happy path · [PW]
- Steps: with the modal open, press Escape; inspect the board; wait 2 s.
- Expected: modal closes; finished board visible (dimmed); the modal does NOT re-open on its
  own. Focus lands back in the page, not lost to `<body>`.

**TC-2A-RES-003 — Rematch resets cleanly** · Critical · Happy path · [PW]
- Steps: click Rematch.
- Expected: modal closes, fresh board, status "Your move.", no leftover marks/badges; the
  share "Copied" pill (if any) is gone next time the modal opens (state resets on reopen).

**TC-2A-RES-004 — Double-click Rematch is idempotent** · High · Concurrency · [PW]
- Steps: double-click Rematch as fast as possible.
- Expected: exactly one fresh game; move count 0; no crash, no double-reset artifacts.

**TC-2A-RES-005 — [CHALLENGE] Share has no in-flight guard** · High · Concurrency · [PW]
- Rationale: `ShareState` has no "pending" member (the header comment claims idle/pending/…)
  and the button is never disabled while `onShare` is awaited.
- Steps: on a device/browser where share resolves slowly (or [RTL] with a deferred `onShare`),
  double-click "↗ Share result".
- Expected **per plan §4 (state machine incl. pending)**: the second click is a no-op while the
  first is in flight — one share sheet / one clipboard write. Two invocations = FAIL.

**TC-2A-RES-006 — Share failure → fallback textarea; state intact after failure** · Critical · Dependency failure · [PW]
- Steps: deny clipboard permission / run where `navigator.share` and clipboard both fail; click
  Share.
- Expected: "Couldn't share — long-press to copy" with a read-only textarea containing the FULL
  composed share text (title, result phrase, artifact body, URL — a full domain-qualified URL,
  never a bare path); focusing it selects all. The modal, result text, and board state are
  unchanged by the failure (no partial UI, no lost result). Share success elsewhere shows
  "Copied" as a `role="status"` pill that clears after ~2 s.

**TC-2A-RES-007 — Next-twist card navigates and never repeats immediately** · High · Happy path · [PW]
- Steps: finish a game; note the suggested twist; click it.
- Expected: a real link navigation to `/play/<suggested-id>`; the suggestion is drawn from the
  registry excluding the current game; after returning and finishing again, the just-shown
  suggestion is not repeated back-to-back.

**TC-2A-RES-008 — Registry-of-one hides the next-twist card entirely** · Medium · Boundary · [RTL]
- Steps: render `ResultModal` with `nextTwist: null`.
- Expected: no card, no empty bordered box, no dangling "Next:" label.

**TC-2A-RES-009 — Over-long share body degrades, never a dead button** · High · Invalid input · [RTL]
- Steps: drive GameShell with a presentation whose `shareArtifact` returns >7 lines; click Share.
- Expected: no unhandled rejection; the failed state renders with the raw artifact body as the
  fallback text; the button remains usable.

**TC-2A-RES-010 — Empty texture line renders nothing** · Medium · Boundary · [RTL]
- Steps: presentation whose `textureLine` returns `""`.
- Expected: no empty italic line node — the slot is absent, not blank.

**TC-2A-RES-011 — Day stamp (props-only, D9) and its SR exposure** · Medium · Edge/A11y · [RTL]
- Steps: render with `dayNumber: 41`.
- Expected: rotated "day 41" stamp; without `dayNumber`, no stamp. Note for stage 6: the stamp
  is `aria-hidden` and no other modal text carries the day — a screen-reader user gets day info
  only inside the share text. Record as an a11y observation (Low) with the result, not silently.

**TC-2A-RES-012 — [CHALLENGE] Streak line (spec: "streak 13 days · longest 21")** · High · Negative · [PW]
- Steps: finish games on consecutive logical days (or seed `ta:streak:v1`); open the result.
- Expected **per spec**: a mono streak line on the slip. Shipped GameShell never passes
  `streakLine` → expected FAIL; undocumented gap D5 (machinery exists: prop + `streak.ts`).
  Needs a fix or an explicit user waiver — not an agent waiver.

**TC-2A-RES-013 — [CHALLENGE] Ply-count line (spec: "9 plies")** · Medium · Negative · [PW]
- Expected **per spec**: a mono count line under the timeline. Not built → expected FAIL;
  undocumented gap D4.

**TC-2A-RES-014 — Torn-slip material pass (pinned deferral D2/D10)** · Medium · Edge · [Eye]
- Expected as shipped: paper-lift card, brush border, print shadow, display-face title, mono
  timeline. NOT expected yet (documented deferral): slip rotation, receipt-tear edge,
  winner-accent stamp color, staggered timeline entrance, butter Rematch ground. Verify the
  deferral is still confined to visuals — every behavior (focus, Esc, share machine) present.

## Suite S4 — How-to sheet

**TC-2A-HOW-001 — Opens from both triggers with correct content** · Critical · Happy path · [PW]
- Steps: open via the rule card's "How?"; close; open via "? How" in controls.
- Expected both times: bottom sheet over the dimmed board; drag-handle bar; tag
  "How this twist works"; the rule sentence as the headline; Fadeout's three steps titled
  "Place", "Age", "Vanish" with numbered chips 1/2/3, in that DOM order (an `<ol>` — order
  never carried by chip color alone).

**TC-2A-HOW-002 — Focus management** · Critical · A11y behavior · [PW]
- Steps: open via "How?" using the keyboard; Tab around; press Escape. Repeat via "? How".
- Expected: focus moves into the sheet and is trapped; Escape closes; focus returns to the
  exact button that opened it in each case (two distinct triggers — both must restore).

**TC-2A-HOW-003 — Scrim closes; game state untouched** · High · Happy path · [PW]
- Steps: mid-game, open the sheet, click the scrim.
- Expected: sheet closes; board position, status, and turn are exactly as before opening; the
  sheet never blocks or consumes a game input.

**TC-2A-HOW-004 — Blank frames degrade out of the strip** · Medium · Boundary · [RTL]
- Steps: render `HowSheet` with one frame whose title+body are whitespace; then with all three
  blank.
- Expected: one blank → a two-item list (numbers re-run 1..2, no gap); all blank → no list at
  all, sentence alone; never an empty-looking card.

**TC-2A-HOW-005 — Long content stays scrollable within the sheet** · Medium · Boundary · [PW]
- Steps: open on a short viewport (e.g. 390×600).
- Expected: sheet caps at ~85% of the small viewport height; content scrolls inside it; the
  drag handle and tag remain visible; nothing clipped irrecoverably.

**TC-2A-HOW-006 — Sheet on Crackstep (side-panel game)** · Medium · Edge · [PW]
- Expected: same sheet behavior on `/play/crackstep` desktop; the three steps may lay out
  three-across at sm+ (the artboard only defines the narrow layout — not a deviation); focus
  and Esc semantics identical.

**TC-2A-HOW-007 — Board dimmed behind the sheet** · Low · Happy path · [Eye]
- Expected: the board area reads as dimmed/inert behind the sheet (scrim), per "board, dimmed".

## Suite S5 — Loading

**TC-2A-LOD-001 — "Rule paints first" (spec-matching blink, D1)** · Critical · Happy path · [PW]
- Steps: throttle network (Slow 3G) or delay the engine chunk; navigate to `/play/fadeout`.
- Expected: header + real rule sentence render immediately (real content, no skeleton for the
  sentence); the board area is a 3×3 staggered-blink grid (per-cell ~100 ms delays), caption
  "dealing the board…" in mono uppercase. **The blink IS the spec** — do not report it as a
  deviation from a "scan".

**TC-2A-LOD-002 — Skeleton is decorative to AT** · High · A11y behavior · [PW]
- Expected: the blink grid subtree is `aria-hidden`; no live-region chatter during loading; the
  page's accessible content during load is header + rule + caption.

**TC-2A-LOD-003 — Route-level skeleton hands off without a jump** · Medium · Edge · [PW]+[Eye]
- Steps: hard-navigate (full load) to `/play/crackstep` throttled.
- Expected: Next's `loading.tsx` pulse skeleton (pre-gameId) → GameShell's rule-first loading →
  ready board, with the board placeholder and real board occupying the same footprint
  (`min(100vw − 32px, 52svh)`); no layout leap.

**TC-2A-LOD-004 — [CHALLENGE] Dead "How?" during loading** · Medium · Negative · [PW]
- Steps: while the loading state shows, click the rule card's "How?".
- Expected **per spec** (artboard's loading card has no How? button): either no button, or a
  functional one. Shipped: a visible button wired to a no-op → clicking it doing nothing =
  FAIL (D6).

**TC-2A-LOD-005 — Reduced motion stops the blink** · High · A11y behavior · [PW]
- Steps: emulate `prefers-reduced-motion: reduce`; load throttled.
- Expected: grid cells render static (the global blanket collapses the animation to one
  near-instant frame); all content still present — R2: nothing waits hidden for an entrance.

## Suite S6 — Load error and recovery

**TC-2A-ERR-001 — Engine load failure: never a blank board** · Critical · Dependency failure · [PW]
- Steps: with the page shell loaded, block the game's engine/presentation chunk requests
  (Playwright route interception → abort), navigate to `/play/fadeout`.
- Expected: header + rule sentence still shown; a filled, slightly rotated `role="alert"` card:
  "This twist didn't load." / "The rules are fine — the paper jammed." with a "Retry" button
  and a "Back to library" link. No blank board, no bare error string, no dead end.

**TC-2A-ERR-002 — "Back to library" works from the error state** · High · Happy path · [PW]
- Expected: navigates to `/`; library renders normally.

**TC-2A-ERR-003 — Retry recovers once the dependency is back** · Critical · State after failure · [PW]
- Steps: from ERR-001, unblock the chunk routes; click "Retry".
- Expected: loading state (blink grid) then a clean, playable board — fresh state, no residue
  of the failed attempt. **Watch for bundler-cached rejected dynamic imports**: if Retry can
  never succeed without a full reload, that is a FAIL of this card's whole reason to exist.

**TC-2A-ERR-004 — Retry spam / slow-load race** · High · Concurrency · [PW]
- Steps: make chunks slow (not failing); click Retry several times fast (after forcing one
  failure first).
- Expected: exactly one final state; a stale earlier attempt never overwrites a newer one
  (the attempt-token guard); no flicker between error/ready loops.

**TC-2A-ERR-005 — Error card announced** · High · A11y behavior · [PW]
- Expected: the alert's appearance is announced (role="alert"); Retry and Back to library are
  keyboard-reachable with visible focus rings on the dark card.

**TC-2A-ERR-006 — [CHALLENGE] Dead "How?" in the error state** · Medium · Negative · [PW]
- Same as LOD-004, in the error state. Spec's error card has no How? button; shipped renders a
  no-op one → FAIL if clicking does nothing (D6).

**TC-2A-ERR-007 — Unknown game id is a real 404** · High · Invalid input · [PW]
- Steps: navigate to `/play/does-not-exist`.
- Expected: HTTP 404 / the app's not-found page — never the loading skeleton followed by a
  hang, and never a 200.

## Suite S7 — Accessibility behaviors (the priority-1 block; behaviors, not opinions)

**TC-2A-A11Y-001 — "Describe board" announces via the live region** · Critical · Happy path · [PW]
- Steps: on `/play/fadeout` mid-game, inspect the DOM for exactly ONE `aria-live="polite"`
  region and one assertive region (both `sr-only`); click "Describe board"; read the polite
  region's text content.
- Expected: the polite region's content updates to a board readback (cells, marks, ages);
  the page never grows a second competing live region (StatusLine is deliberately not live).

**TC-2A-A11Y-002 — Repeated identical announcement still re-announces** · High · Edge · [PW]+[RTL]
- Steps: click "Describe board" twice in a row with no intervening move; observe the polite
  region's DOM between clicks.
- Expected: a real DOM mutation on the second click even though the text is byte-identical
  (the zero-width-space toggle) — AT re-announces. [RTL]: drive `AriaAnnouncer` with same text
  + fresh token; assert the rendered text alternates the ZWSP suffix.

**TC-2A-A11Y-003 — Result announced assertively, exactly once** · High · Happy path · [PW]
- Steps: finish a game; watch the assertive region.
- Expected: one result announcement; the polite region does not also spam the result; the
  modal's visible title matches the announced result text.

**TC-2A-A11Y-004 — Reduced motion, full-screen sweep** · Critical · A11y behavior · [PW]
- Steps: emulate reduced motion; walk all five states (play, result, how-to, loading, error)
  on `/play/fadeout` and `/play/crackstep`.
- Expected: no looping animation anywhere (blink dot, blink grid, pulse skeleton all static);
  every piece of content visible without any entrance animation having run (R2 — nothing stuck
  at opacity 0 / off-screen); board still fully playable; result modal renders in place.

**TC-2A-A11Y-005 — Nothing conveyed by color alone** · Critical · A11y behavior · [Eye]+[PW]
- Steps: grayscale screenshots of: active-vs-inactive turn chips; Fadeout aging marks
  (badges + opacity steps); Crackstep board+legend; the result modal.
- Expected: active seat = fill + bold + underline + dot + the status words + `aria-current`
  (four redundant channels — verify all present in DOM, not just visually); mark age = numeric
  badge at ≤2 turns left, not opacity alone; ghost = dashed outline; Crackstep materials =
  texture + legend words (CRK-008). Any signal whose only carrier is hue = FAIL.

**TC-2A-A11Y-006 — Keyboard-only full loop** · High · Happy path · [PW]
- Steps: with keyboard only: load `/play/fadeout` → play to a result → open/close HowSheet →
  Rematch from the modal.
- Expected: every interactive element reachable in a sensible order with a visible focus ring
  (including on the blue header band and the dark error card); no keyboard trap outside the
  intentional dialog traps.

**TC-2A-A11Y-007 — Dialog focus contracts (both dialogs)** · Critical · Happy path · [PW]
- Expected: ResultModal — initial focus Rematch, trap active, Esc returns focus into the page;
  HowSheet — trap + Esc + return-to-opening-trigger (HOW-002). Screen-reader name check: the
  modal's accessible name is the result text; the sheet's is "How this twist works".

**TC-2A-A11Y-008 — Header/copy contrast on accent bands** · Medium · A11y · [Eye]
- Expected: paper-on-P1-blue and paper-on-P2-rust text (header, error card, step chips) meets
  4.5:1 (3:1 for the large display title); the butter chip's ink text likewise. Measure, don't
  eyeball — plan §1.1 sets the floor.

## Suite S8 — Cross-game blast radius (priority-2; the two-column bug class)

The generalized pin, in three layers: (1) **behavioral** — the layout gate is the explicit
`presentation.sidePanel === true` flag, never inferred from `extraControls`; (2) **structural**
— non-opted games keep their exact pre-2a DOM shape; (3) **visual** — a screenshot sweep of
every registered game at two widths becomes the standing regression net so the *next* shared-
slot change cannot silently restyle bystanders again.

**TC-2A-XG-001 — Only Crackstep gets the two-column layout** · Critical · Regression · [PW]
- Steps: at 1024 px, open each of `/play/crackstep`, `/play/mine-run`, `/play/tilt`,
  `/play/nine-grids`, `/play/fadeout`.
- Expected: exactly one of the five (crackstep) renders the wide two-column grid; the other
  four are the single centered column at every viewport.

**TC-2A-XG-002 — Mine Run's BankBar and Tilt's Telegraph placement unchanged** · Critical · Regression · [PW]
- Steps: on `/play/mine-run` and `/play/tilt` (both widths), locate each game's extra control.
- Expected: rendered below/adjacent to the board inside the single column as before — never in
  a right-hand column, never wrapped in the grid container, no added spacing wrapper (the
  shipped comment claims "exactly the pre-design-2a DOM shape" — verify it against the DOM,
  not the comment).

**TC-2A-XG-003 — Flag-gate unit pins (both directions)** · High · Regression · [RTL]
- Steps: render GameShell with (a) a presentation having `extraControls` but no `sidePanel`;
  (b) `sidePanel: true` but NO `extraControls`; (c) neither.
- Expected: (a) single column, extras as plain sibling; (b) does not crash — document what the
  wide grid renders with an empty right column (boundary the gate never considered — record
  actual behavior for stage 6); (c) single column, no extras row.

**TC-2A-XG-004 — Registry audit: exactly one opt-in** · High · Regression · [RTL/static]
- Steps: for every registry entry, resolve `loadPresentation()` and read `sidePanel`.
- Expected: truthy only for crackstep. (Static grep is a cheap standing guard; the resolved-
  module check is the authoritative one.)

**TC-2A-XG-005 — Full-library screenshot sweep** · Critical · Regression · [PW]+[Eye]
- Steps: screenshot all five game routes at 390×844 and 1280×800, fresh state each.
- Expected: every game renders its intended layout with the shared zine header/rule-card/
  controls restyle applied (that part is *intended* to touch everyone); no clipped board, no
  overlap, no horizontal scroll. These become the baseline set for future shared-shell diffs.

**TC-2A-XG-006 — Shared-string regression net** · Medium · Regression · [PW]
- Expected on every game route: exactly one "Describe board", one "⟳ Restart", one "? How";
  "↩ Undo" present only where undo is available. A shared-slot change that duplicates or drops
  one of these anywhere fails here even if the targeted game looks right.

**TC-2A-XG-007 — Fonts blocked → readable fallbacks everywhere** · Low · Dependency failure · [PW]
- Steps: block font requests; load a play route and a result.
- Expected: all copy renders in fallback faces at sane sizes; no invisible text, no layout
  collapse (next/font fallback metrics).

## Suite S9 — Persistence and state after failure

**TC-2A-PERS-001 — Corrupt stored game → fresh start, never a crash** · Critical · Invalid input · [PW]
- Steps: set the game's `ta:game:fadeout:*` key to `"not json"`, then to valid JSON with a
  wrong `v`, then to `{"v":<current>}` with a truncated body; load `/play/fadeout` each time.
- Expected: every case boots a fresh, playable game — no exception, no half-restored board
  (no orphaned marks/ages), no stuck status.

**TC-2A-PERS-002 — Mid-game resume round-trip** · High · Happy path · [PW]
- Steps: play 3 moves; reload.
- Expected: exact position, ages/badges, move count, and turn restored; status line agrees with
  the board. Finished game + reload: document whether the result modal re-opens (expected from
  the code: yes, after ~300 ms) — either way board and modal must agree.

**TC-2A-PERS-003 — Storage unavailable degrades silently** · High · Dependency failure · [PW]
- Steps: run with storage blocked (private mode / site data blocked); play a full game
  including Share.
- Expected: everything works for the session; no thrown errors, no user-facing warnings;
  reload simply starts fresh. No partial writes: either a whole versioned record or nothing.

**TC-2A-PERS-004 — Restart count only decorates daily shares** · Medium · Edge · [RTL]
- Steps: casual game, Rematch twice, Share.
- Expected: the composed share text has NO restart line for casual play; with `daily` props and
  restarts > 0, it does. (Pins the stage-6 fix already recorded in GameShell.)

**TC-2A-PERS-005 — Reload during the loading state leaves no residue** · Low · State after failure · [PW]
- Steps: reload the page mid-loading (blink grid showing) three times fast.
- Expected: no corrupted storage, next load clean.

---

## Regression suite designation

- **Smoke (must pass before any merge touching the shell):** PLAY-001, PLAY-003, RES-001,
  RES-002, HOW-001, LOD-001, ERR-001, XG-001, A11Y-001.
- **Full regression:** every Critical + High case; XG-005's screenshot set is the standing
  baseline for any future shared-component change.
- **Critical path (deploy blockers):** PLAY-001/003/006, RES-001/002/003/006, ERR-001/003/007,
  XG-001/002, A11Y-001/004/005/007, PERS-001.

## Risk assessment

Highest-risk areas, in order: (1) the shared-slot blast radius (S8) — this exact defect class
shipped once already; (2) load-error recovery (ERR-003's cached-rejection trap) — the error
card's entire promise is that Retry works; (3) live-region and focus behavior (S7) — the shell
owns these for every current and future game, so a defect here multiplies by the library;
(4) the unguarded Share/undo concurrency seams (RES-005, PLAY-007).

## Gaps and ambiguities (for the orchestrator, not for silent resolution)

1. **Brief error:** the "loading scan → blink" deviation record is wrong (D1). Correct the
   record; do not "fix" the blink.
2. **Undocumented deviations found:** ~~ply-count line (D4 — withdrawn, see the ledger: it is built, in the game's own presentation layer)~~, streak line on the result slip (D5),
   dead "How?" in loading/error (D6), active-chip accent (D7), Describe-board placement (D8).
   Each has a [CHALLENGE] case; each needs a fix or a user waiver.
3. **Reachability:** daily chrome ("daily 41" chip, "day 41" stamp, par readout) and hotseat
   are prop-only — no route or mode picker reaches them. The mockup's headline Crackstep state
   is currently unreachable by a player. Presumably `daily-and-share` scope; confirm.
4. **Spec silence:** the artboard does not define (a) the how-sheet at sm+ widths (shipped:
   three-across), (b) the empty-chip header's exact centering, (c) `sidePanel: true` with no
   `extraControls` (XG-003b). Cases record actual behavior for a deliberate ruling rather than
   inventing an expectation.
5. **A11y observation:** the day stamp is `aria-hidden` with no textual equivalent in the modal
   (RES-011). Low severity today because daily is unreachable; becomes real when daily ships.

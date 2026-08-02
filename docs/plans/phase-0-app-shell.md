# Phase 0 + Phase 1 Plan — App Shell (Twist Arcade)

*Fable implementation plan, 2026-08-02. Team: `shell` (worktree `../claude-project-shell`,
branch `feature/shell`). Supabase: **not started — client-only feature** (synthesis §2.6);
port block registration per `docs/worktrees.md` still applies.*

*Sources: `docs/research/games/ux-lens.md` (primary — §1–§5, §7–§11), `docs/plans/
phase-0-platform-spine.md` §3, §5, §6 (the **fixed** engine/game-spec contract — nothing in
this plan may deviate from it; where ux-lens §10's older `GameDefinition` sketch and
game-spec disagree, game-spec wins), `docs/roadmap.md` (Phase 0 + Phase 1 scope),
`docs/research/games/synthesis.md` §2.3, §3, `docs/research/games/architecture-lens.md`
§5–§6, `docs/research/games/solo-games-lens.md` §2, §4, §6.*

**Contract facts this plan builds against, restated once:** a game is
`GameDefinition = { manifest, engine, presentation }` (game-spec §5). `Board` receives the
view **`V`, never `S`** (`BoardProps.view`), and `V extends WithEffects` — the redacted
`view.lastEffects` array is the *only* thing the UI animates from. Manifests are eagerly
imported; engines/presentations load only via the registry's dynamic `import()`. The bot
worker protocol (`BotRequest`/`BotResponse`) lands in platform **M2**; the engine/game-spec
types land in **M1** (merged to main immediately on green).

---

## 1. Goal, non-goals, phase split

**Goal.** The real Next.js 15 application (replacing the platform team's placeholder), the
`GameShell` + component inventory, the `useGame` platform hook, the teaching machinery, the
a11y infrastructure, the "ink on paper, arcade tempo" design system, the library home, and
solo accommodation — such that a game team's entire UI cost is: one `Board` component built
from shared `Cell`s, plus strings.

**Phase 0 slice (roadmap Phase 0):** app routes `/` (minimal) and `/play/[gameId]`,
GameShell complete for **solo-vs-bot + hotseat**, teaching layers, a11y baseline, design
system, `useGame` with the stubbed bot seam, ShareCard plumbing. Exit is Fadeout playable
start-to-finish on a phone, first move <8 s, axe clean, game route ≤75 kB gz.

**Phase 1 slice (roadmap Phase 1):** `/daily` + daily mode (pinned deterministic bot,
streak), full library home (playable hero, classic-family shelves, text-first cards),
solo accommodation (ScoreHUD, `lost` terminal, par-framed result modal, solo share
artifacts), OG metadata with the rule sentence as description, result-modal daily header.

**Non-goals (explicitly out):**

- Async link multiplayer, `InviteSheet`, seats/tokens/server sync — Phase 2. The mode enum
  and `StatusLine` phases are designed so `async` slots in without reshaping anything, but
  no async code ships now.
- Accounts and the save-your-streak offer line — roadmap Phase 1 says no accounts; the
  ResultModal reserves the slot (a single optional line) and renders nothing until Phase 3.
- Search, browse page, length filters — arrive at ~15 games (§8 below designs the IA so
  they bolt on without rework).
- Any engine, bot, harness, or game code. The shell consumes `@twist-arcade/engine`,
  `@twist-arcade/game-spec`, `@twist-arcade/bots` (M2) and `games/registry.ts`; it
  implements none of them. Fixture engines from `packages/engine/testkit` are used in
  tests only.
- Daily *rotation policy and seed authority* — daily team scope. The shell ships the
  `/daily` route and daily mode against a narrow `resolveDaily()` seam (§7.3); until the
  daily team lands theirs, the shell carries an interim implementation of the public
  formula from roadmap Phase 1 behind that seam.
- Ads (Phase 2), realtime, leaderboards.

---

## 2. Where shell code lives, and one structural decision

```
app/
  layout.tsx                     # server: fonts, theme bootstrap, skip link
  page.tsx                       # server: library home (Phase 0 minimal → Phase 1 full)
  play/[gameId]/page.tsx         # server: generateStaticParams + generateMetadata; mounts loader
  play/[gameId]/loading.tsx      # board-shaped skeleton
  daily/page.tsx                 # Phase 1
  not-found.tsx
packages/shell/                  # @twist-arcade/shell — see decision below
  src/components/                # GameShell, RuleCard, BoardShell, Cell, CountdownBadge,
                                 # StatusLine, TurnIndicator, ControlsRow, ResultModal,
                                 # ShareCard, PassDeviceInterstitial, GameCard, AriaAnnouncer,
                                 # ScoreHUD, HowSheet, CalloutLayer, DailyHero, Shelf
  src/useGame.ts                 # the platform hook (§5)
  src/bot-driver.ts              # BotDriver seam + stub + (M2) worker driver
  src/announcer.ts               # composition rule (§6.2) — pure
  src/effects-map.ts             # effects → animation mapper (§9.3) — pure data + fn
  src/share-frame.ts             # artifact frame composer — pure
  src/next-twist.ts              # adjacent-game selection — pure
  src/shelves.ts                 # manifest → shelf grouping — pure
  src/persistence.ts             # versioned localStorage envelope (§5.6)
  src/callouts.ts                # once-per-device flags
  src/haptics.ts                 # navigator.vibrate wrapper + mute
  src/tokens.css                 # design tokens (§9.1)
```

**Decision needing orchestrator sign-off (top open question, §12):** the shared kit must be
importable by `games/*/ui/Board.tsx` (games render "*using* shared `Cell`s" — ux-lens §10;
architecture-lens: Board "imports ONLY from engine.ts + platform kit"). That means a
workspace package `@twist-arcade/shell`, which conflicts with the platform DoD line "no
package imports react except game-spec (type-only) and app/". Recommended resolution:
amend that rule to *"…except game-spec (type-only), `@twist-arcade/shell`, and app/"* —
the rule's intent (keep engine/bots/harness framework-free) is untouched. Fallback if
refused: shell code lives under `app/` + `components/` with a tsconfig path alias games
import — workable but couples game packages to app-internal paths. The plan assumes the
package; only import paths change if the fallback is chosen.

---

## 3. Routes, code splitting, rendering model, metadata

### 3.1 Routes

| Route | Rendering | Contents |
|---|---|---|
| `/` | Server Component; static | Phase 0: title + GameCard list from eager manifests. Phase 1: DailyHero (client island) → Active-games strip placeholder (Phase 2) → shelves → footer with "Browse all N". |
| `/play/[gameId]` | Server page; `generateStaticParams` over `Object.keys(registry)`; unknown id → `notFound()` | Server-renders header + RuleCard shell + a board-shaped skeleton (from the manifest alone — title and rule sentence paint before any game JS), then mounts the `GameShell` client island which loads the game's chunks. This is how "load to interactive ≤2 s / total game-route JS <100 kB" is met: the LCP content is server HTML. |
| `/daily` | Server page, revalidated daily (`export const revalidate` tuned to UTC midnight; interim: `dynamic = "force-dynamic"` with cheap compute) | Resolves `{ gameId, seed, day, dayNumber, par? }` via `resolveDaily()` (§7.3) and renders the same GameShell in daily mode. |

### 3.2 Registry-driven code splitting (architecture-lens §6 — enforced, not hoped)

1. App code may **statically import only** `games/registry.ts` re-exported *manifests* and
   `@twist-arcade/{game-spec,shell}` types/components. Engines and presentations load
   exclusively through `registry[id].loadEngine()` / `loadPresentation()`.
2. `GameShell` uses `next/dynamic` on `loadPresentation()` and awaits `loadEngine()` inside
   `useGame` — Next splits each `games/*` module into its own chunk; game 40 adds zero
   bytes to game 1's route.
3. **Lint enforcement** (shell team adds the rule; platform's eslint flat config is the
   home): `no-restricted-imports` banning `games/*/engine`, `games/*/ui`, `games/*/index`
   from `app/**` and `packages/shell/**`. `loadSolver` is never referenced by app code
   (platform rule restated).
4. Platform CI's size-limit gate (≤75 kB gz per game chunk group) is the backstop; the
   shell adds its own budget entry for the **shared shell chunk** (target ≤45 kB gz — shell
   + shadcn primitives used; leaves headroom under the ux-lens <100 kB route total).

### 3.3 Server/client boundaries — the rule

Server by default. `"use client"` exactly at: `GameShell` (game loop, pointer/keyboard
state), `DailyHero` (playable board), the theme/settings menu, and nothing else. GameCard,
Shelf, RuleCard's static rendering, headers, and all of `/`'s chrome stay server. Any PR
adding `"use client"` elsewhere must justify it against this section in review.

### 3.4 Metadata / OG — the rule sentence is the ad (ux-lens §5)

- `generateMetadata` on `/play/[gameId]`: title `"{manifest.title} — Twist Arcade"`,
  `description = manifest.ruleSentence`, `og:description = ruleSentence`,
  `og:title = title`. One canonical sentence per game, everywhere — the same string as the
  rule card and library card, byte-identical (it comes from the same manifest field).
- `/daily`: title `"Daily Twist #{n} — {title}"`, description = that game's rule sentence.
- OG images: Phase 1 ships a `opengraph-image.tsx` per play route via `ImageResponse` —
  paper ground, game title, the rule sentence large, the ◇ mark. Text-first by design (the
  differentiator is verbal — ux-lens §4). If effort must be cut, plain-text OG is
  acceptable for launch; the description carries the ad. Flagged as a cuttable item.

---

## 4. GameShell and the component inventory

Ownership baseline (ux-lens §10, mapped onto game-spec): the shell owns everything a
player touches that isn't the board itself; the game supplies `manifest` strings,
`engine`, `presentation.Board` (rendered *inside* `BoardShell`, using shared `Cell`s),
`announce()`, `firstOccurrence?`, `shareArtifact()`, `howSheetFrames`, `textureLine?`.

Screen anatomy is ux-lens §10 verbatim: Header → RuleCard → StatusLine → Board slot →
ControlsRow → ResultModal. Thumb-zone placement per ux-lens §7: controls directly below
the board (easy zone), status above the board (eye zone), header at top (leave-the-game
zone). Portrait-first; landscape = board left, rule/status/controls stacked right; no
rotate nags.

Below, per component: **Props → Ownership → States.** Props are given TS-ish as
specification; Sonnet finalizes exact types against game-spec at implementation time.

### 4.1 `GameShell` (client)

```ts
{ gameId: string;
  mode: "solo-bot" | "hotseat" | "solo-single";   // solo-single ⇔ manifest.players.max === 1
  daily?: { seed: string; day: string; dayNumber: number; par?: number };
}
```
Loads manifest (sync), then engine + presentation (dynamic). Composes everything below and
owns the settings overflow (sound/haptics/motion-override/theme/difficulty — games never
present settings). **States:** `loading` (server-painted skeleton persists; no spinner
theater), `load-error` (inline Alert: "Couldn't load this game — Retry / Back to library";
never a blank board), `ready`, `finished` (ResultModal open over dimmed board).

### 4.2 `RuleCard` — shell owns card + trigger; game owns the sentence

`{ sentence: string; onHow(): void }`. Single line, always visible above the board, the
only paragraph on the screen. Dev-mode assertion: sentence ≤90 chars (manifest contract —
warn loudly, don't crash). States: default; `HowSheet` open.

### 4.3 `HowSheet` — bottom sheet (shadcn `Sheet`/`Drawer`, side=bottom)

`{ sentence: string; frames: [Frame, Frame, Frame] }`. Sentence + the game's 3-frame
illustrated strip, nothing else. Sized with `dvh` + `svh` fallback; focus-trapped; Esc and
scrim-tap close; focus returns to the "How?" trigger. States: closed / open / frame-asset
missing (renders sentence only — never blocks).

### 4.4 `BoardShell` — the machinery box (shell) around the game's `Board`

```ts
{ rows: number; cols: number;               // for role="grid" aria-rowcount/colcount + cursor math
  disabled: boolean;                        // not your seat's turn, terminal, spectator
  onCellAction(cellId: string): void;       // fires only after commit rules pass
  boardLabel: string;                       // aria-label, e.g. "Fadeout board"
  children: ReactNode;                      // the game's Board output
}
```
Owns, so no game reimplements them:
- **Sizing:** `width = min(100vw − 32px, 52svh)`, square, centered, 16 px min gutters —
  as the `--board-size` token consumed by BoardShell's container (§9.1). All vertical
  sizing in `svh`; the `dvh − svh` band is whitespace, never layout (ux-lens §7).
- **Cell-size floor as enforced code:** dev-mode `ResizeObserver` asserts every registered
  cell ≥48 px (console.error + visible dev overlay); Playwright test at 320 px viewport
  asserts it in CI (§11). Games failing it redesign their board, not their targets.
- **Roving-tabindex APG grid:** one tab stop for the whole board; arrow keys move the cell
  cursor (row/col math from registered cells); Enter/Space commits; `role="grid"` +
  `aria-rowcount/colcount`. Page tab order: rule card ("How?" link) → board → controls →
  header.
- **Pointer commit:** commit on `pointerup` within the same cell (pointer capture;
  drag-away cancels). **Lockout:** actions whose `pointerdown` began before
  `useGame.lockedUntil` (state-change + 250 ms) are dropped silently.
- Context (`BoardContext`) exposing `registerCell(cellId, {row, col, el})`, cursor
  position, commit dispatch — consumed by `Cell`.

States: interactive / locked (250 ms window — visually identical; the lockout must never
flash UI) / disabled / spectator (Phase 2).

### 4.5 `Cell` — shell owns target + focus + slots; game owns content

```ts
{ id: string; row: number; col: number;
  occupant?: ReactNode;                     // game's glyph (shape-first identity, §9.2)
  ageStep?: 0 | 1 | 2;                      // drives opacity tier: 100% / 65% / 40% floor
  countdown?: number;                       // renders CountdownBadge; games pass it only at ≤2
  ghost?: ReactNode;                        // dashed departed-symbol outline, one turn
  staged?: boolean;                         // 50% translucent (multiplayer confirm, Phase 2)
  accessibleName: string;                   // "Row 1, column 3. O, fades in 1 turn."
  disabled?: boolean;
}
```
Owns: ≥48 px floor (56 px target when board ≤5×5 — BoardShell passes density), visible
2 px offset focus ring (3:1, distinct from hover), `role="gridcell"`, badge slot position,
ghost rendering, final-turn single 600 ms pulse (dropped under reduced motion). The
opacity tiers are **discrete steps via `data-age`**, never continuous fades (ux-lens §2);
the 40% floor keeps 3:1 non-text contrast (token-guaranteed, §9.1). States: empty /
occupied / aging-1 / aging-2 / ghost / staged / focused / disabled.

### 4.6 `CountdownBadge`

`{ value: number }`. ≥16 px circle, bold numeral, 4.5:1 in both themes. The
*authoritative* imminence encoding — opacity suggests, the number states. Scoping to ≤2
turns is the game's responsibility (checklist item), not a shell clamp — thresholds vary
per game.

### 4.7 `StatusLine` — shell computes, words never color-alone

```ts
{ phase: "your-turn" | "their-turn" | "bot-thinking" | "handoff" | "waiting" | "finished";
  // + reserved phase "pie-decision" — see §4.17; typed into the union now so adding it
  // later is not a breaking change, rendered by no code path until the slot is filled
  actorLabel?: string;                      // "Sam", "Bot"
  resultText?: string; }
```
Copy per phase: "Your move" / "{actor}'s move" / "Bot is thinking…" / "Pass the device to
{actor}" / (Phase 2 waiting) / result line. Mirrors nothing itself — the turn phrase in
the live region comes from the announcer composition (§6.2) so the region gets exactly one
composed sentence, not two competing sources. States are the phases.

### 4.8 `TurnIndicator`

`{ seats: { glyph: ReactNode; label: string; active: boolean }[] }`. Player glyph + name
chips; active seat marked by weight + underline **and** the StatusLine words (never a
colored dot alone). Hidden in `solo-single` mode — replaced by `ScoreHUD` (§7.1).

### 4.9 `ControlsRow`

`{ canUndo: boolean; onUndo?: () => void; onRestart: () => void; onHow: () => void;
   extras?: ReactNode }`
Undo is **hidden, not greyed** where unavailable (hotseat, daily solo puzzle, Phase-2
multiplayer — ux-lens §1). `Ctrl/Cmd+Z` bonus binding when visible. Restart mid-game asks
an inline confirm (shadcn `AlertDialog`, "Restart? This game will be lost") — in solo only
when ≥3 moves are on the board; end-state restart never confirms (rematch loop speed).
`extras` is the game-specific slot. States: full / no-undo / disabled-during-lockout.

### 4.10 `ResultModal` — the most important screen (ux-lens §5)

```ts
{ status: Status; textureLine?: string;
  artifactBody: string;                     // game's shareArtifact() output — also displayed
  nextTwist: GameManifest;                  // exactly one, from pickNextTwist (§8.3)
  onRematch(): void; onNextTwist(): void; onShare(): Promise<ShareOutcome>;
  streak?: { gamesToday: number; dailyStreak?: number };
  daily?: { dayNumber: number; par?: number };
  solo?: { score?: number; moves?: number; restarts?: number };
}
```
shadcn `Dialog`, full-screen takeover, finished board visible dimmed beneath (winning line
drawn through — the win animation, §9.3, completes *before* the modal opens; ~300 ms
delay). Strict priority order top-to-bottom: result + texture line → move-timeline preview
→ **Rematch (primary, initial focus)** → Next twist (secondary, with its rule sentence) →
Share (tertiary) → streak line → (reserved account-offer slot, empty until Phase 3).
Focus trapped; Escape closes to the finished board (board stays inspectable; controls
show "Rematch" inline). Variants in §7.2 (solo). States: won / lost(2P) / draw / scored /
solo-lost / share-copied ("Copied" inline confirmation, 2 s) / share-failed (clipboard
fallback then error text "Couldn't share — long-press to copy" with the artifact text
selectable).

### 4.11 `ShareCard` / `share-frame.ts`

Pure composer + invoker. Frame (shell) wraps body (game):

```
{title} — {resultPhrase}            ← shell; daily mode prepends "Daily #{n}" / appends "(par {p})"
{artifactBody}                      ← game: emoji move timeline, 💨 = house vanish glyph
{statLine?}                         ← game, ≤40 chars (part of artifactBody contract)
{url}                               ← shell: canonical /play/{id} or /d/{id} path
```
Composer asserts ≤7 lines total (dev + unit test). Invocation: `navigator.share` where
available (mobile), else clipboard + confirmation. Never renders a board snapshot.

### 4.12 `PassDeviceInterstitial` (hotseat)

`{ nextLabel: string; variant: "blocking" | "banner"; onReady(): void }`. Variant chosen by
`engine.meta.hiddenInformation`: `true` → full-screen blocking interstitial (board hidden,
focus on the "I'm {label} — show board" button); `false` (Fadeout) → non-blocking turn
banner, board stays visible, input already enabled for the next player. States: hidden /
banner / blocking.

### 4.13 `GameCard` (server)

`{ manifest: GameManifest; glyph?: ReactNode }`. Fixed anatomy (ux-lens §4): tiny abstract
glyph · twist title · "a twist on {classic}" · **the rule sentence** (same canonical
string) · chips (`tags` + `~{estMinutes} min`) · play affordance (whole card is the link).
Text-first by design. States: default / featured (hero-adjacent styling) / "New" chip
(Phase 2 "New this week").

### 4.14 `AriaAnnouncer`

Singleton per page. One **polite** `aria-live` region for turn flow + one **assertive**
region used exactly once per game, for the result. API:
`announce(sentence: string)` (replaces content — no queue buildup; latest state wins) and
`announceResult(sentence: string)`. Visually hidden (`sr-only`), mounted inside GameShell.
The composition rule that feeds it is §6.2.

### 4.15 `CalloutLayer` (first-occurrence teaching — §6.3)

Anchored non-modal popover (shadcn `Popover` primitives, no focus trap, no scrim,
`role="status"`) positioned at the anchored cell via `BoardContext`'s cell registry.
Auto-dismisses on the next committed move. Never blocks input.

### 4.16 `ScoreHUD`, `DailyHero`, `Shelf` — specified in §7 and §8.

### 4.17 `PieRulePrompt` — **reserved slot, not built** (orchestrator directive)

Fadeout may need the pie rule (player one moves; player two may swap sides) as its
balancing device — decided by the Fadeout exact solve, which has not run. It ships **only
if** the solve puts first-player advantage in the 55–70% band **and** a near-balanced
opening exists; if every opening wins, the pie rule hands the game to player two and would
be actively harmful. This plan reserves the slot so it cannot arrive as a mid-build
surprise; **no implementation work is scheduled.**

Reserved shape, for the record: an inline, non-modal decision panel rendered in the
CalloutLayer position, appearing **after player one's first move and before player two's
reply**, offered to the player-two seat only ("Keep O, or take over X's opening?" — Keep /
Swap, keyboard-reachable, initial focus Keep). During it: `StatusLine` uses a reserved
`"pie-decision"` phase ("{P2}: keep your side, or swap?"); the board is `disabled`; the
live region receives one composed polite sentence ("X opened at center. {P2}, you may swap
sides — choose above the board.") and the eventual choice announces as a happened-sentence
("Sides swapped — you are now X." / "{P2} kept O.") followed by the normal turn phrase.
Hook side, if built: `useGame` would expose `pieDecision: { pending: boolean;
choose(swap: boolean): void } | null`, gated by a manifest flag the platform team would
add. If the solve says no pie rule, none of this is ever filled in.

---

## 5. `useGame` — the hook that makes a game cost a day

One hook, owned by the shell, that game authors **never reimplement any part of**. The
game's Board is a pure function of `BoardProps`; everything stateful below is here.

### 5.1 API

```ts
function useGame<S extends WithEffects, M extends Json, V extends WithEffects>(opts: {
  definition: GameDefinition<S, M, V>;      // loaded by GameShell via registry
  mode: "solo-bot" | "hotseat" | "solo-single";
  seed?: string;                            // daily/practice seed; default: crypto-random
  tierId?: "casual" | "standard" | "ruthless";   // default "standard" (ux-lens §3: preselected)
  humanSeat?: PlayerId;                     // default 0 — human is X and moves first, always
  persist?: boolean;                        // default: true for solo modes, false otherwise
  botDriver?: BotDriver;                    // injected; default per §5.4
  dailyBudgetKind?: "rollouts";             // daily mode MUST pass rollouts (asserted)
}): {
  // read
  view: V;                                  // playerView for the presenting seat — NEVER S
  legal: M[];                               // for the acting human seat; [] otherwise
  status: Status;
  activeSeat: PlayerId | null;
  presentingSeat: PlayerId;                 // hotseat: flips on handoff
  botThinking: boolean;
  lockedUntil: number;                      // performance.now() timestamp; BoardShell consumes
  canUndo: boolean;
  score?: number; moveCount: number; restartCount: number;
  history: ReplayRecord;                    // the always-current replay log
  firstOccurrence: { text: string; anchor: Json } | null;   // CalloutLayer consumes
  announcement: { polite?: string; assertive?: string };    // AriaAnnouncer consumes
  handoff: { pending: boolean; nextSeat: PlayerId } | null; // hotseat
  // act
  submitMove(m: M): void;
  undo(): void;
  restart(): void;                          // new seed unless daily (same seed, restartCount++)
  rematch(): void;                          // terminal-state restart, resets in place
  confirmHandoff(): void;
  setTier(t: TierId): void;                 // takes effect next game, per ux-lens §6
  describeBoard(): void;                    // pushes full-board readback to announcement
};
```

### 5.2 What it owns (the exhaustive list — the "new game costs a day" contract)

1. **Game loop.** Loops on `engine.active(state)` — never branches on player count
   (platform contract). Human seats gate on `submitMove`; bot seats dispatch to the
   driver. `apply` is called with the step rng from `rngFor(history.seed, step)`;
   `history` is extended via `appendStep`. Illegal `submitMove` is a no-op + dev warning —
   the shell guarantee "input arrives only when legal" is enforced here (`isLegal` check),
   not trusted to BoardShell.
2. **Optimistic apply.** Human moves apply synchronously to local state (the engine is
   local — "optimistic" costs nothing now and becomes the reconcile point for Phase-2
   async, where the same code path applies locally then confirms server-side; the seam is
   the reducer, so async slots in without reshaping the hook).
3. **Input lockout.** Every state change *not caused by the presenting seat's own move*
   (bot move landing, cascade effects) sets `lockedUntil = now + 250 ms`. Own moves do not
   lock (fast play must stay fast).
4. **Bot lifecycle.** On bot turn: request move via driver with
   `{ gameId, encodedState: engine.encode(state), player, tierId, seed, step }`; enforce
   the tier's `minReplyMs` floor **in the shell** (platform plan §6 assigns it here) —
   `botThinking` true for at least the floor; cancel in-flight requests on undo/restart/
   unmount (requestId correlation); surface driver failure as a retryable StatusLine error
   state ("Bot stumbled — tap to retry"), never a hang.
5. **Hotseat handoff.** After each human move in hotseat: set
   `handoff = { pending, nextSeat }`; for `hiddenInformation` games, `view` switches to
   the *next* seat's redacted view only after `confirmHandoff()` (blocking interstitial);
   open-info games auto-confirm (banner variant).
6. **Undo stack — replay-based.** No state snapshots: undo pops steps from
   `history.steps` back to the human's previous decision point (in solo-bot that's the
   human move *and* the bot reply) and recomputes via `replayTo`. Purity + per-step rng
   forking make this exact, including `lastEffects` for correct re-animation (platform
   §3.2 payoff). Unlimited in solo-bot; disabled (hidden) in hotseat; daily-solo policy
   in §7.2.
7. **Persistence of in-progress solo games** (§5.6): after every step, write
   `{ v, mode, tierId, record: ReplayRecord, restartCount }` to localStorage; on mount
   with a stored record for this gameId+mode, resume silently (board restored, StatusLine
   normal — no "resume?" modal; abandoning is `restart`). Cleared on terminal status.
8. **First-occurrence callout flag.** Watches events through
   `presentation.firstOccurrence.trigger(ev)`; on first trigger with `calloutShown`
   unset in `ta:firsts:{gameId}` (§5.6), exposes `firstOccurrence` and sets the flag
   (once per device, per game — ux-lens §1). Cleared from the return value on the next
   committed move.
9. **Announcement composition** (§6.2) — the hook emits composed strings; the component
   just renders them.
10. **First-game bot softening (orchestrator-decided design).** Softening is a **bot
    policy parameter, never engine state** — the engine stays pure and never knows how
    many games a device has played. The hook's side of the seam:
    - `useGame` owns the once-per-device-per-game flag, stored in the shared per-game
      firsts record (`ta:firsts:{gameId}`, §5.6 — same record as the first-occurrence
      callout flag; one storage read serves both).
    - While `firstGamePlayed` is unset, every bot request carries `soften: true`
      (§5.4); the flag is set at the first game's **terminal status** (an abandoned
      first game still gets a softened second attempt — ux-lens §6's intent is "the
      first *experienced* game").
    - What softening *does* is platform-owned (M2): a raised ε blunder rate on
      twist-exploiting moves specifically, not a blanket budget reduction — the bot
      still plays the base game well. The shell never interprets the flag.
    - **Never sent in daily mode** (comparability is sacred; the hook hard-asserts
      `soften === false` whenever `daily` is set).

### 5.3 What it never does

Render anything; know any game's rules (all twist logic is `engine.apply`); present
settings; talk to a server (Phase 0/1); import any `games/*` module statically.

### 5.4 The bot seam and the M2 stub

```ts
interface BotDriver {
  chooseMove(req: BotMoveRequest): Promise<{ move: Json; stats?: SearchStats }>;
  cancel(requestId: string): void;
  dispose(): void;
}
```
`BotMoveRequest` mirrors platform M2's `BotRequest` wire shape exactly (field names from
platform plan §6) **plus `soften?: boolean`** (§5.2.10), so the post-M2 `workerBotDriver`
is a thin postMessage adapter around `packages/bots/src/worker/host.ts` with zero changes
to `useGame`. **External dependency:** the `soften` field and its tier-modifier mapping
(raised ε on twist-exploiting moves) are platform-owned and must land in M2's
`BotRequest`; the stub driver accepts and ignores the flag so hook code and tests are
final before M2.

**Until M2 merges:** `stubBotDriver(engine)` — picks uniformly from
`legalMoves` using `rngFor(seed + ":bot", step)` (deterministic, replayable), with an
artificial 250 ms delay so pacing UI is real. Clearly named, `// NOT SHIPPABLE` banner,
and the Phase 0 exit criterion "Fadeout playable" is only met on the worker driver —
the stub exists so shell + Fadeout UI work proceeds through M2's 3–4 day window.
`scriptedBotDriver(moves[])` ships alongside for tests.

### 5.5 Daily mode specifics

`seed` fixed from `resolveDaily()`; `restart` reuses the same seed and increments
`restartCount` (feeds the solo artifact's "1 restart" line); tier/budget assertions:
refuse to start daily mode unless the resolved tier's budget kind is `rollouts`
(platform §5.2 — a `deadlineMs` daily bot silently destroys comparability; the hook
throws in dev, error-states in prod). On terminal status, record
`ta:daily:{day}` completion and bump the **site-level** streak (`ta:streak` — one streak,
"played today's Twist", localStorage only; never per-game — roadmap Phase 1).

### 5.6 localStorage schema (versioned envelope, all keys `ta:` prefixed)

| Key | Value | Written by |
|---|---|---|
| `ta:game:{gameId}:{mode}` | `{ v: 1, record: ReplayRecord, tierId, restartCount }` | useGame persistence |
| `ta:firsts:{gameId}` | `{ v: 1, calloutShown?: 1, firstGamePlayed?: 1 }` | callout machinery (§5.2.8) + first-game softening (§5.2.10) — one shared per-game record |
| `ta:streak` | `{ v: 1, lastDay, count }` | daily completion |
| `ta:daily:{day}` | `{ v: 1, gameId, result, moves, restarts }` | daily completion |
| `ta:settings` | `{ v: 1, theme, sound, haptics, motion, tier? }` | settings menu |

All reads go through `persistence.ts`: JSON parse failures and version mismatches return
`undefined` (fresh start) — never crash on corrupt storage. Private-mode storage failure
degrades silently (no persistence, no errors surfaced).

---

## 6. Teaching machinery — Sentence → Telegraph → Aha-callout (ux-lens §1)

The division: **games supply strings and frames; the shell supplies every mechanism.**

1. **Sentence (before):** `RuleCard` renders `manifest.ruleSentence` permanently above the
   board (§4.2); the same string is the library card copy, the OG description, and (Phase
   2) the invite text. The "How?" sheet (§4.3) renders the game's 3 `howSheetFrames`.
2. **Telegraph (during):** shell-provided *capabilities*, game-provided *usage*: `Cell`'s
   `ageStep` opacity tiers + `CountdownBadge` + ghost slot + the ink-desaturation token
   ramp (§9.1) are built once; each game's Board maps its state to them. Review gate (per
   game, not shell code): grayscale-screenshot legibility.
3. **Aha-callout (first occurrence):** `useGame` owns trigger-watching and the
   once-per-device flag (§5.2.8); `CalloutLayer` owns anchoring and dismissal (§4.15).
   **Anchor resolution convention** (this plan defines it, since game-spec's
   `anchor(ev): Json` is deliberately loose): the game returns the same `cellId` string
   its Board passes to `Cell`; `BoardContext`'s registry resolves it to coordinates. If
   the id is unregistered (cell vanished from DOM), the callout anchors to the board's
   top edge — degraded, never broken.

### 6.2 The announce composition rule (ux-lens §8 — the critical spec)

After every applied step the hook composes **one** sentence-sequence for the polite region,
in fixed order — *what happened → what's imminent → whose turn*:

```
composed = joinWithSpaces(
  presentation.announce({ kind: "moved", player, effects }),        // what happened
  presentation.announce({ kind: "imminent", ... }) || nothing,      // what's imminent
  decayClassEventOccurred ? presentation.announce({ kind: "boardSummary", ... }) : nothing,
  shellTurnPhrase                                                   // whose turn — SHELL-OWNED
)
```

- **Shell-owned turn phrase:** "Your move." / "{actor}'s move." / "Pass the device to
  {actor}." — games never write it (they don't know seats/modes).
- **Full-board readback** only on decay-class events (`lastEffects` containing `decayed`,
  `crumbled`, or `removed`) and via the `describeBoard()` control — verbosity is its own
  a11y failure (ux-lens §8).
- **Result** goes to the assertive region exactly once:
  `presentation.announce({ kind: "status", status })` (e.g. "You won — three in a row on
  the top row.").
- **What games must supply** (contract for every game's `announce`): one sentence per
  event kind; position-first ("Your X at top left fades next turn."); no trailing turn
  phrase; no color-only identification; ≤ ~15 words except boardSummary; `imminent`
  returns `""` when nothing is imminent. Cell `accessibleName`s follow the same grammar:
  "Row {r}, column {c}. {contents}, {pending change}." / "…Empty."

**Contract-change request (routed via orchestrator to platform — game-spec is
platform-owned and marked "shell refines pre-freeze"):** refine `GameEvent` from the loose
`moved | status | effect` union to
`moved | imminent | boardSummary | status`, each carrying the redacted view. This is the
pre-freeze semantic refinement platform plan §5.1 explicitly assigns to the shell team;
it must land before any game hard-codes `announce` against the loose union. §12.2.

---

## 7. Solo accommodation (solo-games-lens §2, §4, §6)

Solo is `mode: "solo-single"` (⇔ `manifest.players.max === 1`); the hook's loop is
unchanged (solo engines keep `active()` — platform contract). What changes is chrome:

### 7.1 `ScoreHUD` — the HUD two-player games don't have

Replaces `TurnIndicator` in the region between StatusLine and board.
`{ score?: number; par?: number; movesUsed: number; moveBudget?: number; banked?: number }`
- Daily puzzle: `moves 12 · par 19` (par from the daily certificate, via `resolveDaily()`).
- Score chase: `score 340` (live from `engine.score()`) `· 84 / 250 moves` when a budget
  exists. Numbers update with a 200 ms count transition (static value always present —
  reduced-motion loses nothing).
- StatusLine in solo drops turn phrases; phases become "Your run" / "finished".

### 7.2 Terminals and the result modal variants

| Case | Result line | Primary action | Secondary | Notes |
|---|---|---|---|---|
| 2P won/lost/draw | "You won" / "Bot wins" / "Draw" + textureLine | Rematch | Next twist | baseline (§4.10) |
| Solo puzzle `won` | "Solved in 23 — par 19" (or "— beat par 19!"; par may be a best-in-budget bound, so beating it is an achievement, never treated as an error) | **Tomorrow's tease** if daily done: "Next: {twist} →"; practice: "Play again" | Next twist | struggle-shape artifact preview |
| Solo `lost` — the terminal 2P never emits | Cause-specific, game's textureLine ("Stranded — the floor ran out behind you") | **Try again** (daily: same seed, restartCount++) | Next twist | never shame framing; the loss is a story |
| Score chase `scored` | "340 points" + textureLine | Try again (daily: same seed) | Next twist | percentile line deferred until a cohort exists (Phase 2+) |

Undo policy (decision, flagged §12.3): **daily solo puzzle — no undo; restart allowed and
counted** (par integrity; restarts appear in the artifact as ux-lens/solo-lens specify).
**Practice/endless solo — unlimited undo** (learning tool, per ux-lens §1's solo rule).
Score chases: no undo ever (press-your-luck stakes are the game).

### 7.3 The `resolveDaily()` seam

```ts
resolveDaily(date?: Date): Promise<{
  gameId: string; day: string; dayNumber: number; seed: string;
  tier: DifficultyTier;                     // budget.kind === "rollouts" asserted
  certificate?: { par: number; parKind: "optimal" | "best-in-budget" };
}>
```
Daily-team-owned eventually; shell's interim implementation uses the public formula
(roadmap Phase 1: `sha256("daily:" + gameId + ":" + engineVersion + ":" + yyyy-mm-dd
(UTC))`), a rotation table over launch games, and reads committed certificates from
`data/certificates/` at build time for solo days. Runs server-side (`/daily` page),
passed down as props — no client crypto.

### 7.4 Solo share artifacts

Frame unchanged (§4.11); daily header gains par: `"Crackstep #14 — solved in 23 (par 19)"`.
Body remains game-supplied (struggle-shape 🟩🟨🟥💥, bank rhythm 🏦💥 — solo-lens §6);
💨 is the house vanish glyph everywhere. The frame composer takes
`{ dayNumber?, par?, restarts? }` and renders the restart line when > 0.

---

## 8. Library home and navigation (ux-lens §4) — IA that scales 6 → 40+

### 8.1 Page structure at the 6→15 stage (Phase 1)

Top to bottom: **DailyHero** (playable) → *(Phase 2: Active-games strip)* → shelves →
"Browse all {N} →" footer (a no-op anchor until the Browse page exists at 40+).

**DailyHero** (client island): "TODAY'S GAME · Daily #{n}", title, rule sentence, a
**live** mini board (same `BoardShell`/`Cell`, same `useGame` in daily mode) — first tap
commits the move *and* navigates to `/daily` with the in-progress record already persisted
(§5.6), so the move survives navigation. Plus "▶ Play today's game". Loading state: static
board skeleton (server-painted); the hero is the only game-code chunk `/` ever loads, and
only after hydration + intersection.

### 8.2 Shelf derivation — pure function, no rewrite at 40

`buildShelves(manifests)`: group by `classic`; classics with ≥2 games become named shelves
("Twists on Tic-Tac-Toe"), horizontally scrollable rows of ≤8 `GameCard`s + "See all";
remainder collapses into one "All games" shelf. At 6 games this yields exactly ux-lens's
"hero + one/two shelves"; at 15–40 the same function yields the family shelves; at 40+
the home caps shelves at 4–6 curated rows and the overflow moves to a Browse page — the
grouping/facet logic (classic primary, `tags` secondary) is already this pure module, so
Browse is a new route, not a refactor. Mechanic chips on cards become tappable filter
links when Browse exists; until then they render as static chips (not fake buttons).

### 8.3 `pickNextTwist(currentId, manifests, recentlyShown?)` — the end-screen loop

Deterministic, pure: prefer same `classic` (excluding current and the immediately
previously-suggested id, so Rematch→Next doesn't ping-pong between two games), then
shared mechanic `tag`, then any other game; stable tie-break by id. Exactly **one**
suggestion, rendered with its rule sentence (§4.10). Unit-anchored (§11.1).

### 8.4 Empty/degenerate states

One game in the registry (Phase 0 reality): home renders hero-less with a single card;
`pickNextTwist` returns null → ResultModal hides the Next-twist slot (never suggests the
game you just played). No dailies certified for today (buffer failure): `/daily` renders
yesterday's completed state + "Today's Twist is late — play {fallback game}" (never a
blank page; the failure is platform-alerted long before, but the shell must degrade).

---

## 9. Design system — "ink on paper, arcade tempo" (ux-lens §9)

### 9.1 Tokens (Tailwind theme extension + `tokens.css` CSS variables)

Two-layer: CSS variables carry the values (theme-switchable via `.dark` class +
`prefers-color-scheme` default), Tailwind maps semantic names onto them.

| Token | Light | Dark | Rule |
|---|---|---|---|
| `--paper` | warm off-white | warm near-black | ground; never pure #fff/#000 |
| `--ink` | near-black warm | chalk-white | structure, text, board lines (4.5:1 text, 3:1 lines vs paper — verified both themes) |
| `--ink-muted` | ink @ reduced | ditto | secondary text (still 4.5:1) |
| `--accent-p1` | blue-family | lifted blue | **player-owned material only** |
| `--accent-p2` | orange-family | lifted orange | ditto — colorblind-safe pair; red/green banned as sole differentiator anywhere |
| `--age-1` / `--age-2` | opacity 0.65 / 0.40 | same | discrete steps; 0.40 floor pre-verified to keep 3:1 for both accents on both papers — if an accent value can't, the accent changes, not the floor |
| `--focus-ring` | ink | chalk | 2 px solid, 2 px offset, 3:1 |
| `--dur-place/-age/-win/-vanish` | 150/200/300/400 ms | — | the only durations any shell or game animation may use |
| `--ease` | ease-out | — | single easing |

**The two-accent rule as review gate:** UI chrome uses paper/ink exclusively; the accents
appear only on player-owned board material — so 100% of board colour is information.
Enforced by review checklist + the grayscale-screenshot test per game; the shell's own
components are audited once against it in stage 6.

shadcn config: neutral base mapped to paper/ink variables; shadcn's semantic colour slots
(primary/destructive) restricted to chrome contexts (dialog buttons), never board.

### 9.2 Identity is shape-first

`Cell.occupant` glyphs must be distinct shapes/patterns per seat (X vs O; per-game glyph
pairs), hue second. Shell provides two reference glyph components (stroke-drawn X and O)
games may reuse; the checklist requires distinct glyphs for any new pair.

### 9.3 The effects-to-animation mapper (`effects-map.ts`)

Pure function `mapEffects(effects: readonly Effect[], prefs): CellAnimation[]` keyed on
the engine vocabulary (platform §3, `view.lastEffects` — already redacted; the mapper
never sees `S`). **The governing rule, enforced by the table's last column:** every
animation restates a state change that static encodings already show — reduced-motion
loses zero information.

| Effect type | Animation | Duration | Reduced-motion | Static encoding it restates |
|---|---|---|---|---|
| `placed` | glyph stroke-draw-in | 150 | instant appear | occupant present |
| `removed` / `captured` | fade+shrink out | 400 | instant swap | cell empty (+ capture counted in game UI) |
| `decayed` / `crumbled` | fade+shrink → dashed ghost | 400 | instant swap to ghost | ghost outline (1 turn) + prior badge |
| `moved` | FLIP translate | 200 | instant reposition | new position |
| `revealed` | flip/uncover | 200 | instant | revealed content |
| `rotated` | board rotation + re-fall (Tilt) | 400 | instant final layout | final positions |
| `banked` | HUD count-up + pulse | 200 | instant number change | HUD value |
| *(age step)* | opacity/desat step-down at turn advance | 200 | instant step | `data-age` tier + badge |
| *(final turn)* | one 600 ms pulse, once | 600 | **dropped** | countdown badge "1" |
| *(win)* | line strokes through; losers dim | 300 | instant line | drawn line persists statically |
| *(unknown type)* | **ignored gracefully** | — | — | game's own static rendering |

Implementation: CSS transitions/keyframes driven by data attributes; FLIP hand-rolled or
Motion One (≤4 kB) — **no framer-motion anywhere near per-cell paths**
(architecture-lens §5); input is never blocked during animations (the 250 ms lockout is
the only gate, and it's input-side, not animation-side). Reduced-motion: single source of
truth `prefs.reducedMotion` = media query ⊕ settings override, passed down `BoardProps.prefs`
— games never read the media query themselves.

Haptics (`haptics.ts`): light on own placement, medium on vanish (`decayed`/`crumbled`),
success pattern on win — driven off the same effects stream; `navigator.vibrate` guarded,
mute in settings.

---

## 10. Sequencing — what runs when, so the shell team never idles

Platform dependency facts: **M0+M1 merge to main as one feature** (est. 3.5–5 days),
delivering workspace + all seam types + fixtures. **M2** (bots + worker protocol) ~3–4
days later. The shell team starts *now*.

### S0 — before M0+M1 merges (no seam types on main yet)

Pure modules + design assets that depend on nothing merged, TDD'd in this worktree with
**type shims copied verbatim from platform plan §3/§5 code blocks** into
`packages/shell/src/contracts-shim.ts` (one file, marked `// DELETE AT S1 REBASE`, deleted
wholesale when the real packages land — verbatim copying, not reinterpretation, keeps
drift near zero; any mismatch found at S1 is a 1-line import fix because the shim file is
the only consumer-visible surface). Deliverables:

- `tokens.css` + Tailwind theme extension + shadcn config (§9.1), both themes.
- `effects-map.ts`, `announcer.ts` (composition rule), `share-frame.ts`, `next-twist.ts`,
  `shelves.ts`, `persistence.ts`, `callouts.ts` — all pure, all unit-anchored (§11.1).
- Presentational components with no seam dependency: `CountdownBadge`, `StatusLine`,
  `TurnIndicator`, `ControlsRow`, `RuleCard`, `GameCard`, `ScoreHUD`, `AriaAnnouncer`,
  `PassDeviceInterstitial` — RTL-tested.
- `Cell` + `BoardShell` keyboard/pointer machinery against a dummy 3×3 harness (the APG
  grid, pointerup commit, lockout, sizing tokens — none of it needs the engine).
- File the `GameEvent` refinement request (§6.2) with the orchestrator **now** — it must
  land in M1 or immediately after, before games write `announce`.

Worktree carries its own minimal `package.json` devDeps (react, vitest, RTL, tailwind)
until rebase; reconciled onto the platform workspace at S1 (flagged §12.5).

### S1 — after M0+M1 merges (rebase first)

- Delete the shim; adopt `@twist-arcade/{engine,game-spec}` types; move shell code into
  the workspace package layout (§2).
- Real app: `layout.tsx`, `/`, `/play/[gameId]` + loading/not-found, registry-driven
  dynamic loading + the lint rule (§3.2), `generateMetadata`.
- `useGame` complete against the **stub** driver (§5.4), tested against the
  `classic-ttt` testkit fixture + `scriptedBotDriver`.
- `GameShell` composition, `HowSheet`, `CalloutLayer`, `ResultModal`, `ShareCard` wiring,
  hotseat handoff, persistence, announcement wiring.
- Playwright + axe suites live (§11.2).
- **Unblocks the Fadeout team's Board work** — this is the shell's critical deliverable;
  everything in S1 is ordered so `useGame` + `BoardShell`/`Cell` + `GameShell` land first,
  chrome polish second.

### S2 — after M2 merges

- `workerBotDriver` (postMessage adapter over the platform worker host), driver swap,
  `minReplyMs` floor verified, cancel-on-undo/unmount, difficulty switch UI in overflow +
  end screen ("Rematch · try Ruthless"), first-game softening (§5.2.10).
- Phase 0 exit pass: 8-second budget measured on mid-4G throttle, bundle budgets, axe,
  five-person playtest support build.

### S3 — Phase 1 (parallel with game teams; needs M2, and M3d only for solo-daily par)

- `/daily` + daily mode + streak + `resolveDaily()` interim (§7.3); certificate par
  consumption when M3d's artifacts exist.
- Full home: DailyHero, shelves, cards; OG images.
- Solo accommodation (§7): ScoreHUD, `lost`/`scored` modal variants, solo artifacts,
  daily-restart semantics — ready before Crackstep/Mine Run reach UI.
- ResultModal daily header, "Next twist" tease after daily completion.

Nothing in S0–S3 waits on anything it doesn't need: S0 has ~1.5–2 weeks of real work if
M1 slips; S1 needs only M1; only the driver swap needs M2; only par display needs M3d.

---

## 11. Testability — how Sonnet TDDs this under CLAUDE.md §3

(Stage-3 test *cases* come from Fable later; this section defines what is testable where,
and the red-first anchors Sonnet uses during stage 2.)

### 11.1 Unit (vitest + RTL) — the pure core, all red-first with known answers

- **Announce composition:** fixed event fixtures ⇒ exact composed strings, ordering
  (happened → imminent → turn), empty-imminent elision, boardSummary only on decay-class,
  result to assertive exactly once.
- **Effects mapper:** every vocabulary row of §9.3's table ⇒ expected animation record;
  reduced-motion variants; unknown effect type ⇒ ignored; final-turn pulse dropped.
- **Share frame:** frame + body fixtures ⇒ exact text; ≤7-line assertion trips on an
  8-line body; daily header + par + restart-line permutations.
- **`pickNextTwist`:** same-classic preference, tag fallback, no-repeat, null at
  registry-size-1, deterministic tie-break.
- **`buildShelves`:** 1 / 6 / 15 / 40-manifest fixtures ⇒ expected shelf structures.
- **Persistence:** round-trip; corrupt JSON ⇒ `undefined`; version mismatch ⇒ fresh;
  storage-throw ⇒ silent degrade.
- **Streak:** same-day idempotence, consecutive-day increment, gap reset.
- **`useGame`** (renderHook + `classic-ttt` fixture + scripted driver): loop advances on
  `active()`; illegal `submitMove` no-ops; undo ⇒ `encode(state)` equals
  `encode(replayTo(record, k))` (the replay-equivalence anchor); lockout timestamps set on
  bot-move landing but not own moves; hotseat view flips only after `confirmHandoff` for
  hidden-info; callout fires once across two hook lifetimes (storage-backed); soften flag:
  `soften: true` on every request of the device's first game, absent after the first
  terminal status, never present in daily mode; daily mode throws on a `deadlineMs` tier;
  in-flight bot request cancelled on undo.
- **Component states:** RTL renders of every state enumerated in §4 (e.g. Undo hidden not
  disabled in hotseat; ResultModal initial focus on primary; StatusLine copy per phase).

### 11.2 Playwright (against the dev server, stub driver until S2)

- Cold load `/play/fadeout` → first move committed — the 8-second-budget smoke (CI asserts
  interactive-board timing under throttle; the hard 8 s number is validated on device at
  exit).
- Full keyboard-only game: tab order (rule → board → controls → header), arrow cursor,
  Enter commit, focus ring visible, Ctrl+Z undo, result modal trap + Escape-to-board.
- Pointer semantics: drag-away cancels; tap landing within 250 ms of a bot move is
  swallowed (scripted driver makes this deterministic).
- 320 px viewport: every cell ≥48 px (the enforced-floor gate).
- `prefers-reduced-motion` emulation: after a decay event, ghost outline + badge (the
  static encodings) present with animations disabled — information parity.
- Live region: after a scripted decay turn, the polite region contains the exact composed
  sentence; result announced assertively once.
- Persistence: mid-game reload resumes the board.
- `/` and (S3) `/daily`: hero tap plays + navigates with move intact.

### 11.3 a11y gate (axe via Playwright — platform CI hook)

Zero critical violations on `/`, `/play/fadeout`, result-modal-open, and HowSheet-open
states, both themes. Contrast of every §9.1 token pair asserted in a unit test computing
ratios from the token values (so a token edit that breaks 3:1 at the 40% floor fails
before any screenshot).

### 11.4 Explicitly not automatable here

Grayscale-screenshot legibility (per-game design review), haptics, real-device
address-bar-collapse behaviour (manual device pass at Phase 0 exit; the `svh`-only rule is
enforced by a CI grep banning bare `vh` units in shell styles).

---

## 12. Open questions for the orchestrator

1. **`@twist-arcade/shell` package vs app-internal + alias** (§2) — needs the platform DoD
   dependency-rule amendment ("no react in packages") if the package is approved.
   Recommended: approve the package. Blocks S1's file layout only, not S0.
2. **`GameEvent` refinement** (§6.2) — `moved | imminent | boardSummary | status`, routed
   to platform pre-freeze as their plan invites. Needed before any game writes
   `announce()`; requested now so it can ride M1 or a fast-follow.
3. **Daily solo-puzzle undo policy** (§7.2) — recommended default: no undo in daily
   (restarts counted), unlimited undo in practice. Confirm, since it shapes par integrity
   and the artifact.
4. ~~First-game bot softening~~ — **resolved by orchestrator directive**: `soften?:
   boolean` on `BotRequest`, hook-owned flag, platform-owned modifier (§5.2.10, §5.4).
   Remaining coordination item only: confirm the field is in platform M2's `BotRequest`
   scope before M2 starts.
5. **S0 worktree devDeps** (§10) — confirm the shell worktree may carry a temporary
   `package.json` reconciled at the M0+M1 rebase.
6. **OG images** (§3.4) — `ImageResponse` cards in Phase 1, or text-only OG at launch?
   Recommended: build them; cuttable without harm.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Shim drift during S0 | Verbatim copy of platform plan code blocks, single shim file, deleted wholesale at S1; only imports change |
| Shell chrome bloats the game route past the <100 kB budget | Separate size-limit entry for the shared shell chunk (≤45 kB gz); no framer-motion; shadcn components imported piecemeal |
| `useGame` grows game-specific branches under game-team pressure | The §5.3 never-list is the review gate; any game needing a hook change routes through the orchestrator as a seam change |
| Announce/GameEvent refinement lands late and games hard-code the loose union | Request filed at S0 (§12.2); Fadeout is the only Phase-0 game and is coordinated directly |
| Stub driver ships by accident | Named `stubBotDriver`, banner comment, and a Phase-0-exit Playwright assertion that the worker driver is active |
| Lockout window feels laggy or misses | Own-moves never lock (§5.2.3); Playwright deterministic test pins the semantics; 250 ms is a token, tunable in one place |
| svh/dvh regressions reintroduce board reflow | CI grep bans bare `vh`; manual device pass at exit criteria |
| ResultModal delayed by win animation frustrates fast rematchers | Fixed 300 ms (the win token), input on the modal live immediately on open; Escape always available |

## 14. Definition of done (observable)

**Phase 0:** every §11.1 unit anchor green · Playwright suite green incl. keyboard-only
full game, 320 px cell floor, reduced-motion parity, lockout, resume · axe zero-critical
on both routes/both themes · Fadeout playable solo-bot (worker driver) + hotseat on a
phone, first move <8 s cold · game route within budgets (shell chunk ≤45 kB gz; route
total <100 kB; platform's 75 kB game-chunk gate green) · teaching layers observable:
rule card, telegraph slots exercised by Fadeout, callout fires exactly once per device ·
share artifact ≤7 lines, copies on desktop, shares on mobile · settings
(theme/sound/haptics/motion/difficulty) persist · no static `games/*` imports (lint
green).

**Phase 1 additions:** `/daily` live with pinned rollouts-budget bot + streak + daily
header/par in modal and artifact · home = playable hero + shelves + text-first cards ·
OG description = rule sentence on every game route (validated by fetch test) · solo:
ScoreHUD, `lost`/`scored` modal variants, restart-counted daily artifacts, par framing —
exercised by Crackstep and Mine Run · `pickNextTwist` live on the end screen with real
adjacency across 8 games.

---

## 15. Orchestrator decisions — addendum, 2026-08-02

All four open questions in §12 are resolved. This addendum is binding for the Sonnet
implementer; where it extends a section above, the addendum wins.

1. **`@twist-arcade/shell` approved as a React workspace package** (§2, §12.1). The
   platform DoD dependency rule is being amended by the orchestrator (already sent to the
   platform implementer): the rule's intent is that **`packages/engine` stays pure and
   framework-free** — zero runtime deps, never imports React/Next/Supabase — and that is
   untouched and non-negotiable. The shell is a component kit; React is its job. Build
   §2's package layout as written; the app-internal fallback is dead.

2. **The `GameEvent` refinement approved and routed to platform mid-M1** (§6.2, §12.2),
   so it lands in `game-spec` during M1 rather than as a breaking change after five teams
   consume the seam. The four variants — `moved`, `imminent`, `boardSummary`, `status` —
   are the **binding minimum (a floor, not a ceiling)**: this plan's richer fields (each
   variant carrying the redacted view, `moved` carrying player + effects) stand. Reason
   restated for the implementer: the announcer physically cannot produce the *what
   happened → what's imminent → whose turn* sequence if `announce()` receives an opaque
   blob, and `imminent` is the variant that makes the decay games legible to a screen
   reader at all. Sonnet builds `announcer.ts` against the four-variant union from day
   one — no shim for this.

3. **Daily undo policy confirmed and extended** (§7.2, §12.3): **no undo in daily mode,
   period — two-player dailies included**, not just solo. Same reason both places: undo
   makes "won in 9" and "par" meaningless, and comparability is the entire point of a
   daily. Implementation deltas: `useGame` disables (and ControlsRow therefore **hides**,
   per §4.9) Undo whenever `daily` is set, regardless of mode; §7.2's table row for solo
   applies unchanged. Undo remains exactly where ux-lens §6 put it: solo-vs-bot casual
   play, as a learning tool. Restarts are allowed, counted, and carried in the result
   record (`ta:daily:{day}.restarts`); the share artifact must not silently present a
   fifth attempt as a first — the frame's restart line (§4.11, §7.4) is mandatory
   whenever `restarts > 0`, for two-player dailies too. Add to §11.1 anchors: daily
   two-player game ⇒ `canUndo === false` and Undo absent from the DOM.

4. **`soften` confirmed in M2's `BotRequest` scope** (§5.2.10, §5.4) — the platform team
   has it. The `BotDriver` seam as specified (mirror of `BotRequest` + `soften?:
   boolean`) is the right shape; keep `stubBotDriver` deterministic so all S1 hook work
   is testable before M2 exists.

**Sequencing approved as written** (§10), including S0 against the verbatim type shim
deleted at the S1 rebase — the deletion is a forcing function that surfaces any drift
from the real contract immediately. §12.5 (S0 worktree devDeps) is implicitly approved by
the S0 approval; §12.6 (OG images) remains open and non-blocking.

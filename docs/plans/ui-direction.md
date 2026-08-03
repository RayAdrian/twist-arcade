# UI Direction — Twist Arcade

**Author:** Fable (designer) · 2026-08-03
**Mandate:** "Drastically improve the UI. It needs massive improvement." Libraries named: reactbits.dev, motion.dev.
**Scope:** design specification only (CLAUDE.md §1). Engineers build from this; nothing here is left to invention.

---

## 0. The decision, in one paragraph

**Keep "ink on paper, arcade tempo" — and execute it maximally instead of minimally.** The current
build implemented the *semantic* half of the direction (tokens, contrast floors, two informational
accents) and none of the *material* half: nothing on screen actually looks like ink, or paper, or
a hand. The identity is not wrong; it is unperformed. Replacing it would throw away three things
that are structurally load-bearing — pen-and-paper is the native aesthetic of the classics we twist,
the two-accent rule is what keeps 100% of board colour informational (a clinical-grade legibility
property, not a style), and a strokes-plus-two-accents system is the only visual language that
scales to 100 games with zero per-game art cost. What replaces the austerity is **the print shop**:
real typography, print-offset depth, paper texture, a marker-highlighter tint, and hand-drawn
"moments" — while the board itself stays exactly as quiet as the safety rules require. Richness
goes into chrome (paid once, in the shared shell chunk, per the 75 kB argument); the board gets
craft, not noise.

The governing rule, restated so it stops over-reaching: the research's "100% of colour is
information" constrains **the board**. The de facto extension of that rule to the whole product is
what made the site monochrome. The correct product-wide rule is narrower and stronger:
**an accent hue always means a player — everywhere it appears** (turn chip, result stamp, share
preview). Chrome otherwise uses ink, paper tiers, and one marker tint.

---

## 1. Identity: "Ink on paper, arcade tempo" — pressed harder

### 1.1 What stays fixed (unchanged, non-negotiable)

- Board state never rests on a single channel; grayscale-screenshot + reduced-motion parity gates.
- Contrast floors 4.5:1 / 3:1 both themes; the measured 0.72/0.60 age steps stand (measured
  reality over spec prose).
- Cells ≥48px (Mine Run's sanctioned 32px + two-tap exception); board sized off `svh`.
- APG grid, the single polite live region, *what happened → what's imminent → whose turn*.
- 75 kB gz per game route; richness lives in the shell chunk.
- Motion restates static encodings; it never informs alone.

### 1.2 The six material moves

**Move 1 — Typography (the single cheapest personality lever; currently system font).**
Three faces, all OFL, self-hosted via `next/font/google`, latin subset, `display: swap`:

| Role | Face | Loaded weights/styles | Used for |
|---|---|---|---|
| Display | **Fraunces** (variable: `opsz`, `wght`) | roman 600–900 var; italic 500 static | Game titles, hero headline, result stamp, shelf headers, texture lines (italic) |
| UI/body | **Instrument Sans** (variable) | 400–700 var | Everything else: rule sentences, buttons, cards, status |
| Mono | **Spline Sans Mono** | 500, 600 static | Countdown numerals, kickers ("TODAY'S TWIST · #37"), stats, streak counts, the emoji/move timeline, chips |

Fraunces is a serif with ink traps and a "wonk" character — it *is* ink on paper, without being a
handwriting font (handwriting reads childish; Fraunces reads printed-by-a-letterpress). The mono
carries "arcade tempo": every number in the product (countdowns, streaks, dailies, move counts) is
set in it, tabular, so numbers feel like machinery. Fonts are asset weight, not JS budget
(~120 kB woff2 total, cached across the whole library); `next/font` supplies size-adjusted
fallbacks so CLS stays zero.
**No synthetic bold/italic anywhere** — only the loaded styles above (Fraunces italic is real;
Instrument Sans italic is not loaded, so never style it italic).

**Move 2 — Print-offset depth (the signature).** No blurred drop shadows anywhere. Depth is a
**hard offset shadow**, like misregistered print: `box-shadow: 3px 3px 0 var(--shadow-print)`.
Press states physically move into the paper: `translate(2px, 2px)` + shadow collapses to
`1px 1px 0`. This one device makes buttons, cards, and the result slip feel like objects lying on
the page, costs zero kB, and is fully static (grayscale-safe, reduced-motion-safe — the press
translate is ≤2px and instant, exempt from motion gating as a non-animated state change).
Dark theme: shadow is a pale misregistration at reduced alpha (see tokens) — **screenshot-review
this in the first build**; if it reads as glow, dark theme drops to `2px 2px 0` at 0.18 alpha.

**Move 3 — Paper becomes material.** A tiled SVG `feTurbulence` grain (data-URI, ~0.7 kB) on the
page background: `fractalNoise`, `baseFrequency 0.8`, opacity 0.05 light / 0.07 dark (dark uses
inverted-luminance noise). Applied to `body` and to `--paper-lift` surfaces only, never inside
board cells. Grain is decorative and must be contrast-invisible: extend
`tokens.contrast.test.ts` to assert ink-over-(paper composited with worst-case grain pixel) still
clears every floor.

**Move 4 — Stroke scale replaces uniform 1px.** Three weights, tokenized:
`--stroke-hairline: 1px` (dividers, chips, cell interior lines — ink-muted),
`--stroke-ui: 2px` (interactive borders: buttons, cards, inputs — ink),
`--stroke-brush: 3px` (board frame, primary button, result stamp, rule-card spine — ink).
The visual hierarchy of every screen is carried by stroke weight before anything else.

**Move 5 — Paper tiers + one marker tint (new colour, chrome-only).**

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper-lift` | `#fffdf6` | `#201b13` | Raised sheets: cards, board frame, modal slip, rule card |
| `--paper-shade` | `#f1ead9` | `#100d09` | Recessed: skeleton base, disabled fills, footer band |
| `--marker` | `#f6e7b0` | `#3a3120` | Highlighter tint: daily hero band, aha-callout, "Copied" pill |
| `--shadow-print` | `#262019` | `rgba(242,236,223,0.25)` | Offset-print shadow |

Rules: marker/paper tiers are **decorative backgrounds only** — never the sole grouping or status
cue (always paired with a rule, heading, or words); text on them is always `--ink` (verify 4.5:1 in
the token test: ink on marker light ≈ 9.8:1, dark ≈ 10.5:1 — add assertions). Accents stay
player-only, product-wide (§0).

**Move 6 — Hand moments, rationed.** Hand-drawn irregularity appears only at *moments*, never as
wallpaper (three per screen maximum):
- **Wobble edge** utility `.edge-hand`: `border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px`
  — used on the result stamp, the aha-callout, and the daily hero board frame. Everything else is
  a normal `rounded-xl` (12px).
- **Squiggle divider**: an inline SVG hand-wavering horizontal path (100% × 8px, `--stroke-hairline`,
  ink-muted) between home sections and under the marker band, replacing straight `<hr>`s.
- **Ink glyphs**: every game gets one single-path SVG mark (24px grid, `stroke="currentColor"`,
  `stroke-linecap="round"`, stroke-width 2) for its card, hero, and OG image. Fadeout's: an X with
  its lower-right stroke broken into dashes. Drawn once per game — this is the entire per-game
  art budget, by design.

### 1.3 Token additions (exact, with the byte-match obligation)

Append to `tokens.css` **and mirror byte-for-byte in `design-tokens.ts`** (the cross-check test
will fail otherwise — that is the point):

```css
:root {
  --paper-lift: #fffdf6;
  --paper-shade: #f1ead9;
  --marker: #f6e7b0;
  --shadow-print: #262019;
  --stroke-hairline: 1px;
  --stroke-ui: 2px;
  --stroke-brush: 3px;
  /* Chrome-tier motion (formally extending the "ONLY durations" set — do not bootleg values): */
  --dur-sheet: 250ms;      /* modal/bottom-sheet enter; exit reuses --dur-moved (200ms) */
  --stagger-step: 30ms;    /* per-item delay for staggered entrances (delay, not duration) */
  --ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);  /* overshoot-settle; stamp, sheet enter */
}
:root.dark {
  --paper-lift: #201b13;
  --paper-shade: #100d09;
  --marker: #3a3120;
  --shadow-print: rgba(242, 236, 223, 0.25);
}
```

Tailwind mapping (extend `tailwind.config.ts` the same var-only way): `paper-lift`, `paper-shade`,
`marker`, plus `transitionDuration.sheet`, `transitionTimingFunction.pop`.
`fontFamily`: `display` (Fraunces var), `sans` (Instrument Sans var), `mono` (Spline Sans Mono) —
wired through `next/font` CSS variables in `app/layout.tsx`.

### 1.4 Type scale (named, no adjectives)

| Name | Spec | Where |
|---|---|---|
| `hero` | Fraunces 800, `clamp(2.25rem, 8vw, 4rem)`, lh 1.02, tracking −0.01em | Home hero title only |
| `display` | Fraunces 700, 1.5rem, lh 1.15 | Game-page title, result stamp base |
| `shelf` | Fraunces 600, 1.25rem, lh 1.2 | Shelf headers, card titles |
| `rule` | Instrument Sans 500, 1.0625rem (17px), lh 1.4 | The rule sentence — most-read line in the product, so it sits above body |
| `body` | Instrument Sans 400, 1rem, lh 1.5 | Default |
| `texture` | Fraunces italic 500, 1rem, lh 1.4, ink-muted | Texture lines, card rule sentences |
| `small` | Instrument Sans 400, 0.875rem | Secondary UI |
| `kicker` | Spline Sans Mono 500, 0.75rem, uppercase, tracking 0.12em, ink-muted | Section eyebrows, daily labels |
| `stat` | Spline Sans Mono 600, tabular-nums | Every number in the product |

Spacing: 4px base grid (Tailwind default). Home section rhythm `space-y-10` (40px) mobile,
`space-y-14` at `lg`. Card padding `p-4`. Touch targets ≥48px, unchanged.

---

## 2. Home page (the front door)

**User & context:** two arrivals — a returner deciding "what today?" (daily hero answers it in one
glance) and a first-timer who landed on the root (the hero must be *playable* — the 8-second rule
applies here too). Mobile portrait first.

**Information hierarchy:** 1 today's twist (playable) → 2 active-games strip (only if any) →
3 classic-family shelves → 4 search/browse (deferred until ~15 games) → 5 footer.

### 2.1 Wireframe (mobile portrait)

```
┌──────────────────────────────────────┐
│ ◇ Twist Arcade              🔥3   ⋯  │  h-14; wordmark = ink glyph + Fraunces 600;
├──────────────────────────────────────┤  streak flame (mono) only when >0; ⋯ = theme/settings
│ ░░ marker band ░░░░░░░░░░░░░░░░░░░░░ │
│ ░ TODAY'S TWIST · #37 · NEW IN 6H  ░ │  kicker (mono); omit "#37/NEW IN" until daily infra
│ ░ Fadeout                          ░ │  `hero` type, Fraunces 800
│ ░ Tic-Tac-Toe                      ░ │
│ ░ Your pieces vanish 3 turns after ░ │  `rule` type — the canonical sentence
│ ░ you place them.                  ░ │
│ ░  ┏━━━━━┯━━━━━┯━━━━━┓  ← .edge-hand│  LIVE board: min(100vw−48px, 36svh),
│ ░  ┃     │     │     ┃  brush frame │  paper-lift bg, print shadow 4px 4px 0.
│ ░  ┠─────┼─────┼─────┨             ░ │  Empty daily state; first tap = handoff (§2.3).
│ ░  ┃     │     │     ┃             ░ │  36svh (not 52) so a shelf peeks above the fold.
│ ░  ┠─────┼─────┼─────┨             ░ │
│ ░  ┃     │     │     ┃             ░ │
│ ░  ┗━━━━━┷━━━━━┷━━━━━┛             ░ │
│ ░ ┌────────────────────────────┐   ░ │
│ ░ │      ▶ Play today's game   │   ░ │  primary print button (brush border, offset shadow)
│ ░ └────────────────────────────┘   ░ │
│ ~~~~~~~~ squiggle divider ~~~~~~~~~~ │
│ YOUR GAMES                           │  kicker — ONLY if async links in localStorage
│ ▸ vs Sam — YOUR MOVE · Fadeout       │  (slot reserved now; feature later)
│ ~~~~~~~~ squiggle divider ~~~~~~~~~~ │
│ Twists on Tic-Tac-Toe    (4)  See all│  `shelf` type + mono count; See all if hasMore
│ ┌────────┐ ┌────────┐ ┌───────       │  horizontal snap scroll, next card peeking
│ │ ✕̶ glyph│ │ ⌄ glyph│ │              │
│ │Fadeout │ │Gravity │ │              │  card v2 spec §2.2
│ │a twist │ │a twist │ │              │
│ │on TTT  │ │on TTT  │ │              │
│ │"Your   │ │"Pieces │ │              │
│ │pieces… │ │fall…"  │ │              │
│ │decay·3m│ │grav·3m │ │              │  chips: mono 11px
│ └────────┘ └────────┘ └───────       │
│ ~~~~~~~~ squiggle divider ~~~~~~~~~~ │
│ All games                            │  remainder shelf from buildShelves()
│ …                                    │
│ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │
│  New twists weekly · About · ◇       │  footer, paper-shade band, small type
└──────────────────────────────────────┘
```

**Responsive:** `sm` as above (shelves: `flex gap-3 overflow-x-auto snap-x snap-mandatory
scroll-px-4 -mx-4 px-4`, cards `w-[248px] shrink-0 snap-start`). `lg+`: hero becomes a two-column
band (`grid lg:grid-cols-2 gap-8 items-center`, copy left / board right, board cap 44svh); shelves
with ≤8 games become static grids (`lg:grid-cols-3 xl:grid-cols-4`), no horizontal scroll on
desktop. Page container `max-w-5xl mx-auto px-4`.

### 2.2 GameCard v2 (shared component, restyled)

Anatomy fixed by research (glyph · twist name · classic · rule sentence · chips): keep it, dress it.
`bg-paper-lift`, `border-2 border-ink rounded-xl`, print shadow `3px 3px 0`, `p-4`. Glyph: the
game's ink glyph at 40px, ink-muted. Title in `shelf` type; "a twist on {classic}" in `small`
ink-muted; rule sentence in `texture` (Fraunces italic) clamped to 3 lines; chips as
`kicker`-styled pills with hairline borders. Hover (fine pointers only): `translate(-2px,-2px)`,
shadow grows to `5px 5px 0`, 150ms `--ease` — dropped under reduced motion (colour/underline
change remains). `featured` variant: brush border + `.edge-hand`. Focus ring: existing pattern,
unchanged.

### 2.3 Hero playability (flow + the engineering seam)

1. Server renders the hero board from `engine.init(dailySeed)` — the engine is pure, so this is a
   free server-side call. Cells render via a **non-interactive** presentational grid (not
   `BoardShell` — no client JS on home for the grid itself), each cell ≥48px, with an invisible
   `<button>` overlay per cell (real buttons: keyboard + SR reachable, labelled "Play today's
   game — start at row N, column M").
2. Tap/activate on cell → write `{ gameId, seed, firstMove, t: Date.now() }` to
   `sessionStorage["ta:hero-handoff"]` → `router.push("/play/{id}")`. `PlayClient` on mount reads
   the key, and applies the move only if fresh (<10 s) and legal on the inited state; otherwise
   ignores silently. (Search-param handoff is unavailable — this route is statically prerendered
   and must not read `searchParams`, per `page.tsx`'s documented conflict.)
3. The Play button below is the guaranteed path; the per-cell handoff is an enhancement and its
   failure mode is "game opens on an empty board," which is safe.
4. **Dependency flag:** daily seed derivation + "#37" numbering + reset-time source do not exist
   yet. Until they do, the band reads "FEATURED TWIST" with a date-deterministic pick from the
   registry (rotate by `dayIndex % registry.length`), and the kicker omits number/countdown.
   Never fake a daily number.

**Attract mode (build item #5, not launch-blocking):** after 2 s idle, an `aria-hidden`,
`pointer-events-none` SVG overlay on the hero board replays a scripted 6-move loop — pieces
appear, age (real 0.72/0.60 steps + badge), and vanish — at 1 move / 1.2 s. It is the twist
demonstrating itself on the front door. Stops permanently on first pointerdown/focus anywhere in
the hero; entirely absent under reduced motion (the empty board + sentence carry). The overlay is
decorative; the real board underneath remains the SR/keyboard truth at all times.

### 2.4 States

- **Default:** as wired above, from `buildShelves(manifests)` (exists, tested, unused — wire it).
- **Empty (0 games):** current copy stands, restyled on a paper-lift card.
- **One game:** hero only; shelves omitted entirely (a one-card shelf is worse than none); quiet
  footer line "New twists weekly."
- **Loading:** home is SSG — no client loading state. If a streaming boundary is ever added:
  shelf skeleton = 3 card-shaped `bg-paper-shade` blocks; `animate-pulse` must be inside the
  reduced-motion blanket (see §5.4 — this is currently a gap in `loading.tsx` too).
- **Error:** none reachable client-side (static page); registry failure is a build failure.

### 2.5 Accessibility

Landmarks: `<header>`, `<main>` (exists), `<footer>`; each shelf a `<section>` with
`aria-labelledby` its header. Shelf scrollers: `tabindex="0"` on the scroll container with
`role="group"` + label so keyboard users can arrow-scroll; cards are links in DOM order. Hero cell
buttons labelled as in §2.3. Squiggles/grain/glyphs `aria-hidden`. Marker band text is ink (4.5:1
verified in token test). No new live regions — home announces nothing.

---

## 3. Game page (crafted, not decorated)

The anatomy is fixed (header → rule card → status → board → controls). Every change below is
material, not structural — the board's informational encodings are untouched.

```
┌──────────────────────────────────────┐
│ ◇        Fadeout Tic-Tac-Toe      ⋯  │  title in `display` (Fraunces 700)
├──────────────────────────────────────┤
│ ┃ Classic tic-tac-toe — but your    │  RuleCard: bg-paper-lift, LEFT SPINE
│ ┃ pieces vanish after 3 turns. How? │  3px ink (--stroke-brush), rounded-r-xl,
│                                      │  `rule` type; "How?" underlined link
│        [✕] Your move                 │  StatusLine: glyph chip in YOUR accent
│                                      │  (accent = player, §0) + words, text-base 500
│  ┏━━━━━━┯━━━━━━┯━━━━━━┓             │  Board frame: bg-paper-lift, 3px ink border,
│  ┃      │      │      ┃             │  rounded-xl, print shadow 4px 4px 0, p-2
│  ┠──────┼──────┼──────┨             │  Interior: 1px hairline ink-muted (Cell borders)
│  ┃  ✕   │  ○ ₁ │ ┆✕┆  ┃             │  Glyphs: SVG strokes (§3.1), not text chars
│  ┠──────┼──────┼──────┨             │  ₁ = CountdownBadge, now mono 600
│  ┃ ✕ ₂  │      │      ┃             │  ┆✕┆ = ghost (dashed, unchanged semantics)
│  ┗━━━━━━┷━━━━━━┷━━━━━━┛             │
│  ┌─────────────────────────────┐    │  aha-callout: bg-marker, .edge-hand,
│  │ Your ✕ faded — pieces last  │    │  ink text, anchored triangle (unchanged
│  │ 3 turns.               ◢    │    │  behaviour, restyled)
│  └─────────────────────────────┘    │
│ ┌────────┐ ┌─────────┐ ┌────────┐   │  Controls: h-12 buttons, 2px ink border,
│ │ ↩ Undo │ │⟳ Restart│ │ ? How  │   │  rounded-xl, shadow 2px 2px 0, press-into-
│ └────────┘ └─────────┘ └────────┘   │  paper; icon + visible label, equal flex
└──────────────────────────────────────┘
```

### 3.1 The glyphs become drawn (the "you wrote this" moment, specced but never built)

Each player mark is a single-path SVG (viewBox 48, stroke-width 7, `stroke-linecap="round"`,
`stroke` = the player's accent token, no fill), sized to 44% of the cell. **Place animation:**
stroke draw via `stroke-dashoffset` (set `pathLength=1`, animate `1 → 0`), 150 ms
`--dur-place`/`--ease`, driven by Motion One vanilla `animate()` (sanctioned on board paths;
`motion/react`/framer-motion remain lint-banned there). Reduced motion: mark renders complete
instantly — the "from" state is set only inside the animation call, never in markup, so no-JS and
reduced-motion both see the final mark (see §5.3, rule R2).

### 3.2 Win moment

An SVG overlay line stroked through the three winning cells: brush weight 6px, winner's accent,
round caps, drawn via `pathLength` over 300 ms (`--dur-win`); losing pieces dim to `--age-2`.
The drawn line **is** the celebration (research §9) — no confetti. The line persists as a static
element (grayscale-safe: it is a shape, not a colour); reduced motion shows it instantly.
The existing assertive result announcement is untouched; the line is `aria-hidden`.

### 3.3 Everything else

- `CountdownBadge`: 18px min, `bg-paper-lift`, 2px ink border, numeral in mono 600 ink (4.5:1
  kept). Vanish stays 400 ms fade+shrink → ghost; port the hand-rolled `<style>`-injection pulse
  in `games/fadeout/ui/Board.tsx` to a shared keyframe in shell CSS (the current per-mount
  `document.createElement("style")` is a smell the restyle should clean up).
- Board slot sizing formula unchanged: `min(100vw − 32px, 52svh)`.
- Landscape: existing split (board left, stack right); frame/shadow identical.
- **States:** loading = existing skeleton (gate its pulse, §5.4); unknown id = 404 (exists);
  engine-load failure inside `GameShell` = paper-lift card, ink text: "This twist didn't load —
  Retry / Back to library" (two real buttons; no bare error strings).

---

## 4. End-of-game screen (the most important screen — now the best one)

Job order is fixed by research §5 (result → rematch → one next twist → share → streak → account
slot). Delight is unconstrained here — nothing on it encodes board state.

**Form: a torn score slip.** On mobile the `DialogContent` pins to the bottom as a sheet
(`max-h-[85svh]`, `rounded-t-2xl`, top edge cut by a receipt-tear SVG mask — a jagged 8px zigzag),
board still visible above; on `md+` it is a centered slip (`max-w-md`, `rounded-xl`, print shadow
`5px 5px 0`). `bg-paper-lift` + grain. Focus trap, Escape-to-board, initial focus on Rematch: all
existing behaviour preserved exactly.

```
┌──────────────────────────────────────┐
│  (finished board, dimmed, win line)  │
│ ╭─╌╌╌ receipt-tear top edge ╌╌╌─╮    │
│ │        ╱ YOU WON ╲             │   │  THE STAMP = DialogTitle (no duplicate node):
│ │        ╲__________╱            │   │  Fraunces 800 uppercase text-3xl, 3px border,
│ │                                │   │  .edge-hand, rotate(−3deg), colour = winner's
│ │  Bot's centre O faded at the   │   │  accent (you=P1 blue; bot=P2 orange; draw=ink)
│ │  worst possible moment.        │   │  texture line: Fraunces italic, ink-muted
│ │                                │   │
│ │  ❌⭕❌⭕❌💨⭕❌🎯               │   │  timeline in mono, letter-spacing 0.06em,
│ │                                │   │  staggered entrance 30ms/item (§5)
│ │ ┌────────────────────────────┐ │   │
│ │ │        ⟳ REMATCH           │ │   │  primary: brush border, shadow 3px 3px 0,
│ │ └────────────────────────────┘ │   │  h-14, Fraunces 700; press-into-paper
│ │ ┌────────────────────────────┐ │   │
│ │ │ ⌄  Next: Gravity TTT     → │ │   │  mini-GameCard: glyph + title (shelf type)
│ │ │    "Pieces fall to the     │ │   │  + rule sentence (texture italic);
│ │ │     bottom row."           │ │   │  2px ink-muted border, shadow 2px
│ │ └────────────────────────────┘ │   │
│ │ ┌────────────────────────────┐ │   │
│ │ │      ↗ Share result        │ │   │  tertiary: real button now (h-12, hairline
│ │ └────────────────────────────┘ │   │  border), not an underlined text link
│ │        [ Copied ✓ ]            │   │  copied-state: marker-tint pill, role=status
│ │                                │   │  (existing state machine untouched)
│ │  🔥 3 games today              │   │  streak: mono, CountUp on open (§6)
│ │  (account-offer slot, empty)   │   │
│ ╰────────────────────────────────╯   │
└──────────────────────────────────────┘
```

**The stamp entrance:** scale 1.3 → 1 with rotate −8° → −3°, 300 ms `--ease-pop`, paired with the
existing success haptic. On a *player* win only, an `aria-hidden` ink-burst (8 short radiating
strokes, SVG, draws over 400 ms) fires once behind the stamp. Reduced motion: stamp and slip
render in final position; burst is omitted entirely (pure celebration — allowed to vanish).
Share-failed fallback textarea, dismissed-state semantics, next-twist absence when registry has
one game: all existing logic preserved. `pickNextTwist` (exists, tested) supplies the mini-card.

---

## 5. Motion system (Motion One, three tiers, hard rules)

**Library decision:** **Motion One vanilla only, product-wide, for now** — `animate`, `inView`,
`stagger`, springs from the `motion` package's mini entry (~2.6–5 kB gz; verify with
`size-limit`). It is already the sanctioned hot-path library; the honest finding is that chrome
does not need `motion/react` either: Radix `data-state` + CSS handles dialog exit, and
`inView` + `stagger` handles entrances. Adopting `motion/react` (~20–30 kB gz even lazy) is
deferred until a feature genuinely needs layout/exit orchestration — it must earn its bytes then.
Board-path lint bans on framer-motion/gsap/`motion-react` stand unchanged.

### 5.1 Tier 1 — Board narration (unchanged vocabulary, upgraded execution)

| Moment | Animation | Duration | Reduced motion |
|---|---|---|---|
| Place | SVG stroke draw (dashoffset 1→0) | 150 ms `--dur-place` | complete mark, instant |
| Age step | opacity 1→0.72→0.60, turn-quantized | 200 ms `--dur-age` | instant step (badge + opacity remain) |
| Final-turn warning | one scale pulse 1→1.15→1, once | 600 ms `--dur-final-pulse` | dropped (badge + opacity carry) |
| Vanish | scale→0.85 + fade→0, then ghost | 400 ms `--dur-vanish` | instant swap to ghost |
| Win | line pathLength draw + losers dim | 300 ms `--dur-win` | line + dim appear instantly |

Every row restates a static encoding; nothing here informs alone. Input is never blocked by any
of these (existing 250 ms lockout is the only input gate).

### 5.2 Tier 2 — Chrome (shell)

| Moment | Animation | Duration | Reduced motion |
|---|---|---|---|
| Result slip enter | y 24px→0, `--ease-pop` | 250 ms `--dur-sheet` | renders in place |
| Slip exit | y 0→16px + fade | 200 ms `--dur-moved` | instant |
| Stamp | scale 1.3→1, rotate −8°→−3° | 300 ms `--dur-win` | static final |
| Timeline items | y 6px→0 per item | 150 ms, delay `--stagger-step`×i | all visible |
| Card hover lift | translate −2px, shadow 3→5px | 150 ms `--dur-place` | dropped (colour change stays) |
| Button press | translate 2px, shadow→1px | instant (state, not animation) | kept |
| Hero attract loop | scripted replay overlay | 1 move / 1.2 s | absent |
| Shelf entrance | `inView`, y 8px→0, stagger | 150 ms + 30 ms×i | static |

### 5.3 The three hard rules (each one is a defect class we have already paid for)

- **R1 — Gate everything.** Motion One does **not** respect `prefers-reduced-motion` by itself.
  One shell utility, `animateSafe(el, keyframes, opts)`: under reduce (or `board.reducedMotion`)
  it applies the final keyframe synchronously and returns a resolved handle; otherwise it calls
  `animate`. Every Motion One call site in shell and games goes through it — raw `animate` import
  outside that module becomes a lint rule.
- **R2 — Never author hidden initial states.** No element may have `opacity: 0`, `hidden`, or
  off-screen transforms in markup/CSS awaiting an entrance animation. The "from" state exists
  only inside the `animateSafe` call. Consequence: no-JS, reduced-motion, and full-page
  screenshots always show final content. (This exact failure — entrance animations blanking
  content for reduced-motion users — has shipped elsewhere; it must not ship here.)
- **R3 — CSS blanket.** Add once to `globals.css`:
  `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }`
  This also fixes the **existing gap**: `app/play/[gameId]/loading.tsx`'s `animate-pulse`
  skeleton is not currently reduced-motion-gated.

### 5.4 What motion communicates (so it can be reviewed, not vibed)

Place = authorship ("you wrote this"). Age = turn-quantization ("aging happens at turn
boundaries, not continuously"). Pulse = imminence, once. Vanish = witnessed consequence. Win line
= the game explaining its own verdict. Chrome staggers = tempo — the arcade half of the name.
Anything not in the tables does not animate.

---

## 6. ReactBits adoption (copy-in source; every port lands dependency-free)

ReactBits components mostly depend on framer-motion or GSAP. Since it is copy-in source, the rule
is: **adopt the pattern, port the implementation to Motion One vanilla or CSS** — no ReactBits
copy may bring framer-motion/GSAP into the tree. Costs below are post-port estimates; each lands
with a `size-limit` check.

| ReactBits component | Verdict | Where | Post-port cost (gz) |
|---|---|---|---|
| **CountUp** | Adopt (port to rAF/Motion One) | Streak line on result slip; daily countdown in hero kicker | ~0.8 kB |
| **SplitText** | Adopt the *pattern* only → shell `InkRise` (word-level y-rise stagger, Motion One; GSAP dep dropped) | Home hero title on first paint | ~0.6 kB |
| **TiltedCard** | Adopt, tamed (max 3° tilt, fine pointers only, off under reduce) | GameCard hover on desktop | ~0.9 kB |
| **ClickSpark** | Adopt, re-inked (canvas sparks → 6 ink flecks in `--ink`) | Primary-button presses on the result slip only | ~1.2 kB |
| Aurora / Ballpit / Particles / Hyperspeed / Waves / Squares | **Reject** | GPU haze and animated backgrounds compete with board legibility and contradict flat ink | — |
| ShinyText / GradientText / StarBorder | **Reject** | gradient sheen is the opposite of ink | — |
| DecryptedText | **Reject** | sci-fi register, off-voice | — |
| Dock / Magnet | **Reject** | macOS metaphor / cursor gimmick; pointer-only interactions | — |

Total adopted: ~3.5 kB gz into the shell chunk. The rejections are identity decisions, not
effort savings — write them down so the next pass doesn't relitigate.

---

## 7. Bundle accounting (against the 75 kB gz/route budget)

| Addition | Chunk | Est. gz | Note |
|---|---|---|---|
| Motion One mini | shell (also importable by games) | 2.6–5 kB | verify via size-limit |
| ReactBits ports (4) | shell | ~3.5 kB | §6 |
| Grain data-URIs, squiggle, tear-mask SVGs | CSS/inline | ~1.5 kB | |
| `animateSafe`, `InkRise`, stamp/slip styles | shell | ~2 kB | |
| Home page (hero + shelves) | home route only | ~4 kB | server-rendered; hero handoff is the only new client JS |
| **JS total** | | **~13–16 kB** | one-time, shared; game routes gain only Motion One mini |
| Fonts (3 families, subsets) | assets (not JS budget) | ~120 kB woff2 | cached library-wide; `next/font` fallback-adjusted, zero CLS |

---

## 8. Build order (visible impact ÷ work)

1. **Material foundation** — fonts via `next/font`, token additions (§1.3) + mirrored TS +
   contrast-test extensions, print-shadow/stroke/button system, grain, squiggle, GameCard v2,
   RuleCard spine, ControlsRow buttons, reduced-motion blanket + `animateSafe`.
   *Every screen in the product changes character in one pass; nothing structural moves.*
2. **Home page phase 1** — hero band (featured/daily board, static render, tap-to-play +
   sessionStorage handoff, Play button), shelves wired to `buildShelves()`, footer. The front
   door stops being a stub.
3. **End-screen score slip** — sheet/slip layout, stamp-as-DialogTitle, timeline stagger,
   next-twist mini-card, CountUp streak, share-as-button. The retention screen becomes the best
   screen, as the research demands.
4. Board craft — SVG glyph draw-in + win-line overlay (highest craft density, but per-game
   surface and hot-path test burden; do it fourth, carefully).
5. Hero attract mode + daily infra (seed/number/reset) when daily mode lands.

## 9. Review gates added by this direction

- Grayscale + reduced-motion screenshot gates now also cover chrome moments (stamp, slip, hero).
- Token contrast tests extended: ink on marker/lift/shade (both themes); ink-over-grain composite.
- `animateSafe`-only lint rule for Motion One imports.
- Reduced-motion e2e asserts *content is visible*, not merely that animations stopped (R2).
- Dark-theme print shadow: screenshot review in build 1; fallback value specced (§1.2).

## 10. Open questions (flagged, with recommended defaults)

1. **Daily infra** (seed util, numbering, reset source) — until built, hero says "FEATURED
   TWIST" with date-rotation; never a fabricated "#N". (Default: ship featured now.)
2. **Hero move handoff** — sessionStorage mechanism needs engineering sign-off; fallback (open
   game, empty board) is safe either way. (Default: ship handoff behind the fallback.)
3. **Dark-theme offset shadow** — misregistration vs. glow is a screenshot call. (Default:
   0.25 alpha, drop to 2px/0.18 if it glows.)
4. **`52svh` board cap** — on tall phones the board is smaller than it could be; not touched
   here because it is entangled with the no-reflow guarantee, but worth a measured revisit.

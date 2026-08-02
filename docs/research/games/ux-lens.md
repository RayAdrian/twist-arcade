# UX & Product Design Research — Twisted Classics Game Library

**Lens:** user experience and product design.
**Design target:** a first-time visitor arriving from a shared link on a phone, who leaves in 8 seconds if confused.
**Seed example:** decay tic-tac-toe — your moves fade and disappear after N turns.

Everything below is written as decisions, not options. Where alternatives were considered they are
compared briefly and then one is picked.

---

## 1. The core UX problem: teaching a rule change without a tutorial wall

### The problem, precisely

The player's prior knowledge is the product's greatest asset and its greatest hazard. "Tic-tac-toe"
buys us a zero-cost mental model: 3×3 grid, alternate turns, three in a row. The twist then
*violates* that model — and a violated model feels like a bug, not a feature, unless the violation
is (a) announced before it happens, (b) visible as it happens, and (c) explained the first time it
happens. Miss any of the three and the player's first decay event reads as "the site ate my move,"
and they close the tab.

The classic-plus-twist structure also means we never need to teach the base game. The teaching
budget is therefore tiny: **one delta, one sentence, one visual system.** Any game whose twist
cannot be stated in one sentence is the wrong game for this library (this is a content-selection
rule, not just a UI rule).

### Technique analysis

| Technique | What it does well | Failure mode | Verdict |
|---|---|---|---|
| **One-sentence rule card** (persistent, above board) | Announces the delta before play; costs ~1.5s to read; zero interaction | Players skip text; a sentence alone cannot carry timing details ("after N turns" is abstract until seen) | **Adopt as layer 1.** Necessary, not sufficient. |
| **Ghosting / fading pieces** (telegraph decay via opacity before it happens) | Teaches by *foreshadowing* — the piece visibly ages, so its disappearance is the payoff of a trend, not a surprise | Opacity alone is subtle on bright phone screens outdoors; ambiguous ("is that faded piece still mine? does it still count?") | **Adopt as layer 2**, but never alone — pair with an explicit counter (see §2). |
| **Countdown badges on pieces** (small "2", "1" on the aging pieces) | Unambiguous, precise, accessible, screen-reader-translatable | Visual noise if on every piece; numbers demand reading during play | **Adopt, scoped:** badge appears only when a piece has ≤2 turns left. Fresh pieces are clean. |
| **Learn-by-doing first move** (no gate, just play; the twist reveals itself) | Respects the 8-second budget; the first decay is a genuine "oh!" moment, which *is* the product's hook | Alone, the first decay feels like a bug (see above); the "oh!" must be an "oh, I see!" not an "oh, what?" | **Adopt as the spine.** The other layers exist to convert surprise into insight. |
| **First-occurrence inline explanation** ("why did that happen?") | Just-in-time teaching at the exact moment of maximum curiosity; one-shot, then never again | If modal, it interrupts flow; if it recurs, it patronizes | **Adopt as layer 3:** a non-blocking callout anchored to the vanished cell, auto-dismisses after the next move, shown once per game per device (localStorage flag). |
| **Undo/rewind as learning tool** | Converts "the twist punished me" into "let me try that again"; removes fear of experimenting | Undermines stakes in competitive modes; complicates bot pacing | **Adopt in solo-vs-bot only**, unlimited, one tap. Disabled (and hidden, not greyed) in multiplayer. |
| **Tutorial overlay / multi-step walkthrough** | — | Death on arrival for an 8-second visitor; also implies the game is complicated, which contradicts the brand ("you already know this game") | **Rejected.** |

### Recommended pattern: "Sentence → Telegraph → Aha-callout"

Three layers, each cheap, redundantly encoding the same one delta:

1. **Sentence (before):** the rule card is a single line permanently visible above the board:
   *"Classic tic-tac-toe — but your pieces vanish 3 turns after you place them."*
   Max ~90 characters. This is a hard content constraint on every game in the library.
2. **Telegraph (during):** pieces age visibly (opacity ramp + countdown badge at ≤2 turns,
   full spec in §2). The player *watches the rule operate* before it ever costs them anything —
   in decay TTT with N=3, a piece starts aging on the player's very next turn, so the mechanic
   is on screen within ~10 seconds of the first move.
3. **Aha-callout (first occurrence):** the first time a piece vanishes, a small inline callout
   appears at the vacated cell: *"Your X faded — pieces last 3 turns."* Non-modal, does not block
   input, dismisses on next move. Shown once, then trusted to the telegraph.

**Rationale.** The layers map exactly to the three failure conditions (announce / show / explain).
Each layer alone has a known failure mode; together they cover skim-readers (layer 2 catches them),
readers (layer 1 primes them), and the confused (layer 3 rescues them) — at a total interaction
cost of zero taps and zero screens. This pattern generalizes: every twist in the library gets a
sentence, a telegraph encoding, and a first-occurrence callout. Games design their telegraph;
the shell (§10) provides the callout and rule-card machinery.

---

## 2. Legibility of state: seeing what is about to change

### Principle

Dynamic mechanics split board state into three classes the eye must separate instantly:
**stable** (not going anywhere), **imminent** (changing within 1–2 turns), and **just-changed**
(changed on the last move). A player scanning mid-turn must classify every cell in <1 second.

### Concrete encodings (decay-style; the vocabulary generalizes)

Use **three redundant channels** for "imminent," so no single channel is load-bearing:

1. **Opacity ramp** (analog, ambient): a piece's fill steps down with age. For N=3:
   fresh = 100%, age 1 = 100%, age 2 = 65%, final turn = 40%. Two discrete steps, not a
   continuous fade — discrete steps are readable ("that one is older than this one");
   continuous ramps are not. Floor at 40%: the piece must still meet **3:1 contrast against the
   board background** (WCAG 1.4.11 non-text contrast) at its faintest. Never fade below
   legibility while the piece is still in play.
2. **Numeric countdown badge** (symbolic, precise): a small circular badge on the piece's corner
   showing turns remaining, appearing only at ≤2. The badge is the *authoritative* encoding —
   opacity suggests, the number states. Badge: ≥16px diameter, bold numeral, 4.5:1 contrast.
3. **Desaturation / temperature shift** (supporting): aging pieces also shift toward the board's
   neutral (ink → grey), reinforcing "leaving the game world." This is the third, sacrificial
   channel — it may be invisible to some users and that must be fine.

**Just-changed** state: the cell where a piece vanished shows a brief ghost outline (dashed stroke
of the departed symbol) for one turn, so the player can reconstruct *what* changed even if they
looked away. This matters enormously on mobile, where a notification can steal attention mid-game.

**Pulse/motion:** a single soft pulse on the piece entering its final turn (once, ~600ms, then
static). Motion is an attention *interrupt*; a continuously pulsing board is unreadable and
hostile. Never use continuous animation as a state encoding.

### Accessibility of the encoding

- **Never encode by color alone** — and more strictly for this product: **never encode "about to
  change" by any single channel alone.** The countdown badge is the guaranteed-legible channel;
  opacity and temperature are enhancements. A grayscale screenshot of any board state must be
  fully readable. This is a shell-level review gate for every new game.
- **Colorblind safety:** player identity is shape-first (X vs O; icons/patterns in other games),
  hue second, and the two hues are chosen from a colorblind-safe pair (e.g., blue/orange —
  never red/green as the only difference). Aging uses opacity + numerals, which are
  hue-independent by construction.
- **Reduced motion** (`prefers-reduced-motion`): the final-turn pulse is dropped; the vanish
  animation (fade+shrink, §9) becomes an instant swap to the ghost outline. All *information*
  survives because the badges and opacity steps are static encodings — motion only ever
  restates what statics already say (this is the design rule, stated in §9).
- **Screen readers:** aging is in the accessible name of each cell ("top left, X, fades in
  1 turn") and imminent decay is announced after each move (full spec in §8).

---

## 3. The 8-second first session

### Budget

From tap-on-shared-link to **first move made: under 8 seconds**, decomposed:

| Phase | Budget | Design consequence |
|---|---|---|
| Load to interactive board | ≤2.0s on mid 4G | Game page is the landing page. Board renders server-side or from a tiny static bundle; no framework splash, no spinner theater. Total JS for the game route <100KB. |
| Orient: recognize the game | ≤2s | The classic's silhouette does the work — a 3×3 grid *is* the orientation. Title says "Tic-Tac-Toe" prominently with the twist name as modifier ("Fadeout Tic-Tac-Toe"). |
| Read the twist sentence | ≤2s | The one-sentence rule card sits directly above the board, and is the only paragraph of text on the screen. |
| First tap | ≤2s | Board is live immediately; player is X and moves first, always, in solo. No "choose difficulty" gate — default bot level is preselected; changing it is post-hoc. |

**Nothing gates play.** No sign-up, no cookie wall doubling as a gate (consent UI, if legally
required, must be a dismissible bottom bar, never a blocking modal), no "choose your side," no
difficulty picker, no name entry. Every choice we could ask up front is either defaulted
(difficulty: Standard; side: X; mode: vs bot) or deferred to the end screen.

### What is on the arrival page (game page, mobile portrait — wireframe in §11)

Top to bottom: compact header (site mark + game title + overflow menu) → one-sentence rule card →
status line ("Your move") → the board, sized to dominate → controls row (Undo, Restart, "How?").
That is the entire screen. The library is one tap away behind the site mark, not competing for
attention on the game screen.

**"How?"** opens a bottom sheet with the rule sentence, a 3-frame illustrated strip of the twist
operating, and nothing else. It exists for the player who wants confirmation, and its existence
lets the main screen stay silent.

### Landing on the home page instead

Visitors who arrive at the root (not a game link) get the library home (§4) — whose hero is a
**playable** featured game, not a thumbnail of one. The 8-second rule applies there too: the hero
board accepts a move in place, then navigates into the full game page on first tap.

### When (if ever) an account is requested, and what earns it

**Never required. Never requested in the first session's play path.** Everything core works
anonymous: play, rematch, hotseat, creating and joining link-multiplayer games (device identity
via localStorage token). The product's viral loop (shared links) must have zero registration
friction on either end.

An account is *offered*, softly, only when the player has something worth saving:

- After the **3rd completed game** (any mix), the end screen gains one quiet line:
  "Save your streak across devices — takes 10 seconds." One tap, email-link or OAuth, no password.
- What an account earns the player: cross-device streaks and stats, game history,
  "your turn" notifications for async games (email), and a persistent handle shown to friends.
- What it never gates: any game, any mode, any difficulty, sharing.

Rationale: the honest trade is "you have accumulated state; we can keep it for you." Asking
before state exists is asking for nothing in exchange for friction.

---

## 4. Library navigation: 6 → 40 → 100+ games

### The failure to avoid

The "wall of thumbnails portal" (Coolmath/itch-style grid) fails here for a specific reason:
these games are near-identical at thumbnail level (they're all *classics* — every screenshot is a
grid) and the differentiator — the twist — is verbal, not visual. Thumbnails communicate the wrong
axis. The IA must be organized around **what the player already knows (the classic)** and
**what is new (the mechanic)**.

### Option comparison

| Approach | Strength | Weakness | Role |
|---|---|---|---|
| Game-of-the-day hero | Return ritual, freshness signal, solves "what should I play" | Only surfaces 1 game; useless as an organizing scheme | **Adopt as the top of home**, playable in place |
| Classic-adjacency ("twists on Tic-Tac-Toe") | Matches the user's actual mental model — they search memory by classic, not by mechanic | Skewed shelf sizes; some classics will have 8 twists, some 1 | **Adopt as the primary shelf axis** |
| Mechanic tags ("decay", "hidden info", "simultaneous") | The connoisseur's axis; enables "more like this twist"; scales content-independently | Meaningless to first-timers ("what is 'simultaneous'?") | **Adopt as secondary**: chips on cards + a browse facet, not the shelf structure |
| Length/difficulty filters | Honest fit for "I have 3 minutes" | All launch games are 2–5 min; the filter would be a no-op | **Defer** until the catalog actually varies (>40 games); show per-card "~3 min" labels from day one instead |
| Search | Mandatory at scale | Dead weight at 6 games | **Add at ~15 games**, as a top-of-library input matching game name, classic name, and tag |

### Recommended IA (scales 6 → 100)

- **At 6–15 games:** Home = **Today's game hero (playable)** + one shelf, "All games," as
  horizontal rows grouped by classic where a classic has ≥2 twists. Cards are **text-first**:
  twist name, classic ("a twist on Chess"), the one-sentence rule, mechanic chips, "~3 min".
  A tiny abstract glyph per game (not a screenshot) gives scannability without pretending
  thumbnails differentiate.
- **At 15–40:** Home = hero + **classic-family shelves** ("Twists on Tic-Tac-Toe," "Twists on
  Connect Four," …), each a horizontally scrollable row of ≤8 cards with "See all." Add search.
  Add a "New this week" shelf. Mechanic chips on every card are tappable → filtered browse view.
- **At 40–100+:** Same home (hero + 4–6 curated shelves: Today, New, most-played, 2–3 classic
  families rotated) + a full **Browse** page: facet by classic (primary), mechanic tag,
  length; searchable. Home stays curated and shallow; Browse absorbs the depth. Add
  **"if you liked X"** rows on every end-of-game screen (§5) — at scale, the end screen is a more
  important discovery surface than the home page, because that's where a player with proven
  intent is standing.

**Card anatomy (fixed component):** glyph · twist name · "a twist on {classic}" · rule sentence ·
chips (mechanic, ~length) · play affordance. The rule sentence on the card is the same string as
the in-game rule card — one canonical sentence per game, everywhere.

---

## 5. Session shape and the return hook

### Target session

A single game: **2–5 minutes.** A session: **2–4 games (~8–12 minutes)** — the "one more quick
one" shape. Games in this library must individually be short; the *library* provides length.
This is a content rule: a twist that makes tic-tac-toe last 20 minutes is mis-scoped for the
product regardless of how clever it is.

### End of game — the most important screen in the product

The end screen (full-screen takeover with the final board visible beneath/above it, wireframe
in §11) carries four jobs in strict priority order:

1. **Result, unambiguous:** "You won" / "Bot wins" / "Draw" + one line of texture
   ("Your center X faded at the worst moment"). The game engine supplies this line (§10) —
   it converts a loss into a *story*, which is what makes people rematch instead of leave.
2. **Rematch** — the primary button. Same game, same opponent, one tap, board resets in place.
   Losers rematch at very high rates *if the loss felt legible*; the texture line above is
   doing retention work.
3. **Next twist** — secondary button: "Next: Gravity Tic-Tac-Toe →" (one algorithmically chosen
   adjacent game — same classic first, then same mechanic). This is the library's compounding
   loop: every game ending advertises exactly one other game. Not a grid of nine suggestions —
   one, chosen, with its rule sentence shown.
4. **Share** — tertiary but permanent: produces the share artifact (below) via the native share
   sheet on mobile, clipboard on desktop.

Below these: the quiet streak line ("3 games today") and, from game 3 on, the save-your-streak
account offer (§3).

### The share artifact (Wordle-grid analysis → our design)

Why the Wordle grid worked: (a) **spoiler-free** — shows the *shape* of the attempt, not the
answer, so it provokes rather than satisfies; (b) **pure text/emoji** — survives every chat app,
no link-unfurl dependency, renders in notifications; (c) **implicitly comparative** — a shared
daily instance means your grid and mine are commensurable; (d) **compact** — fits a phone screen
in a group chat without collapsing.

Our games differ: most plays are not a shared daily instance, and "spoilers" mostly don't apply
outside daily challenges. What *is* shareable is the **drama of the twist** — the story of pieces
appearing and vanishing. So the artifact is a **move-timeline, not a board snapshot**:

```
Fadeout Tic-Tac-Toe — won in 9 moves 🏆
❌⭕❌⭕❌💨⭕❌🎯
pieces faded: 3 · longest-lived X: 5 turns
tttwist.game/fadeout
```

- One emoji per move in sequence; `💨` marks each turn where a piece vanished; `🎯` is the
  winning move. The final board is never shown — the reader sees *rhythm and chaos*, not a
  position, which both avoids daily-mode spoilers and (more importantly) makes the twist itself
  the visible star: a 💨 in a tic-tac-toe share line is a question mark that the link answers.
- One stat line, game-supplied, max ~40 chars.
- The URL is a plain path (unfurls to the game with its rule sentence as the OG description —
  the rule sentence is the ad).
- **Daily challenge mode** (same seed/bot script for everyone each day, per game, rotating) is
  what activates the comparative property — "won in 9" becomes commensurable. Daily mode is the
  single highest-leverage retention feature after rematch and should ship early; the share
  artifact gains a header line "Daily #37" in that mode.
- Each game implements a `shareArtifact(history)` hook (§10); the shell owns the frame
  (title, result, URL) so every artifact in the library is recognizably the same format.

---

## 6. Opponent modes and their UX

### Ranking by value per unit of build effort (launch ordering)

1. **Solo vs bot** — *build first.* Zero coordination cost for the player, works for 100% of
   arrivals, enables undo-as-learning, enables daily mode. Effort: moderate (a per-game bot
   policy — for small-state games like decay TTT, minimax/heuristics are cheap). Every game
   must ship with a bot; it is the default opponent everywhere.
2. **Hotseat / pass-and-play** — *nearly free, ship at launch.* Same device, alternate turns.
   Effort is ~UI-only: a "pass the phone" interstitial between turns for hidden-info games
   (plain turn handoff banner for open-info games like TTT). High real-world value: two people
   waiting somewhere with one phone is a core usage scene for 2-minute games.
3. **Async link-based multiplayer** — *the growth feature; ship soon after launch.* Highest
   strategic value (it is the viral loop) at meaningful but bounded effort: server-held game
   state keyed by token, no accounts. Flow specified below.
4. **Realtime multiplayer** — *defer.* Presence, matchmaking or lobbies, disconnect handling,
   clocks — the largest build for the smallest launch delta, since these turn-based 2-minute
   games lose little by being async ("realtime" async: if both players have the link open,
   moves push live over the same channel — that's the cheap 80% and falls out of the async
   architecture).

### Bot difficulty presentation without insulting the player

Never "Easy." Labels: **Casual / Standard / Ruthless** — framing the *bot's* attitude, not the
player's ability. Default: Standard, preselected, changeable from the controls overflow and the
end screen ("Rematch · try Ruthless"). One extra rule for this product: on **each player's first
game of a given twist**, the bot (at any label) does not punish twist-ignorance mercilessly —
it plays the base game well but doesn't exploit decay traps on game one. Losing to the rule you
haven't internalized yet feels like being cheated; losing to it on game three feels like a lesson.

### Invite/join flow for link-based async (no accounts)

1. **Create:** on the game page, "Play a friend" → server creates a game, returns
   `tttwist.game/g/aB3xK9` (unguessable token ≈ the capability). Creator's device identity =
   a localStorage token bound server-side to the "host" seat.
2. **Invite:** immediately open the native share sheet with prefilled text:
   *"Your move — Fadeout Tic-Tac-Toe (your pieces vanish after 3 turns). tttwist.game/g/aB3xK9"*.
   The rule sentence rides along in the invite: the recipient is taught before they even tap.
   The creator's screen becomes the live board with status "Waiting for your friend — you can
   make your first move now" (host moves first; never make the inviter stare at an empty
   waiting room).
3. **Join:** recipient opens the link → the board, with the rule card, the host's first move
   already visible, and status "You're O — your move." First unclaimed non-host device to open
   the link claims the guest seat (bound to its localStorage token). Subsequent openers get
   spectator view with a "start your own game" CTA. No name entry required; an optional
   inline "playing as: Guest ✎" affordance lets either player set a display name.
4. **Turns:** on your turn with the page open, moves appear live; with it closed, the page
   simply shows current state on return. Status line always answers the only question that
   matters: *whose move is it.* Returning to the site surfaces an "Active games" strip on home
   for any in-progress links held in localStorage. (Push/email "your turn" notifications are
   the account carrot, §3.)
5. **Finish:** shared end screen for both; Rematch creates the next game on the same link
   thread with seats swapped, so one shared URL becomes a standing series ("Series: you 2–1").
   The series scoreline is a quiet but potent return hook.

Failure states to design: expired/finished link (show the final board + "start a rematch");
host abandons before guest joins (game GC'd after 7 days; link shows "this game expired" +
start-new CTA); both seats claimed (spectator view, stated plainly).

---

## 7. Mobile-first constraints

- **Minimum tappable cell: 48×48 CSS px, hard floor; 56×56 target for boards ≤5×5.**
  (Rationale: 48px is the WCAG 2.5.8-plus-industry floor; small boards have room to be
  generous, and generous cells are the single cheapest mis-tap prevention.) Boards where the
  grid math would force cells below 48px on a 320px-wide viewport must redesign their board
  (zoom/pan regions or a different layout), not shrink the targets — this is a shell-enforced
  constraint each game is validated against.
- **Board sizing:** `board = min(100vw − 32px, 52svh)` in portrait — square boards sized off
  the *small* viewport height so the controls row below never gets pushed under the browser
  chrome. Board horizontally centered; 16px min gutters.
- **Thumb zones:** the board's bottom edge sits in the natural thumb arc; the controls row
  (Undo/Restart/How) sits directly below the board — the highest-frequency non-board taps live
  in the easiest zone. The header (menu, library link) takes the hard-to-reach top, correctly,
  because it's the leave-the-game zone. Status line sits *above* the board where the eye (not
  the thumb) goes.
- **Portrait vs landscape:** portrait-first, fully supported landscape (board left,
  rule card + status + controls stacked right). No "rotate your device" nags ever.
- **Avoiding accidental moves:** (a) generous cells (above); (b) moves commit on `pointerup`
  within the same cell, never `pointerdown`, so a drag-away cancels; (c) ignore taps within
  250ms of a board-state change (the bot's move landing must not eat a tap intended for the
  previous state); (d) games with irreversible high-stakes moves in *multiplayer* use
  tap-to-stage → tap-again-to-confirm (staged piece shown translucent at 50%); solo play never
  confirms — Undo is the safety net there, and double-tap friction would poison the fast
  rematch loop.
- **Haptics:** light impact on own move placed, medium on a piece vanishing, distinct success
  pattern on win — via `navigator.vibrate` where available, silently absent elsewhere, with a
  mute toggle in settings (shell-owned). Haptics are the one channel that works when the user's
  eyes leave the screen mid-async-game.
- **Address-bar resize:** size everything vertical off **`svh`** (small viewport units), so
  browser-chrome expansion never reflows the board mid-game; treat the `dvh − svh` band as
  bonus whitespace, never as layout space. No layout element may move when the URL bar
  collapses — a board that shifts under a descending finger causes mis-taps. Fixed-position
  bottom sheets use `dvh` with `svh` fallback.

---

## 8. Accessibility baseline

- **Keyboard play:** the board is a roving-tabindex grid (APG grid pattern): one tab stop for
  the whole board, arrow keys move the cell cursor, Enter/Space places. Visible focus ring
  (2px solid, offset, meets 3:1) distinct from selection/hover. Tab order: rule card link →
  board → controls → header. All controls reachable; Undo = `Ctrl/Cmd+Z` bonus binding.
  The result modal traps focus, initial focus on Rematch, Escape closes to the finished board.
- **Screen-reader board representation:** the board is `role="grid"` with `aria-rowcount`/
  `colcount`; each cell's accessible name is **position, contents, and pending change**:
  "Row 1, column 3. O, fades in 1 turn." Empty: "Row 2, column 2. Empty."
- **Live region announcements (the critical spec):** one polite `aria-live` region, owned by
  the shell, receives a single composed sentence after each state change, in this order:
  *what happened → what's imminent → whose turn.* E.g.:
  "Bot placed O, middle center. Your X at top left fades next turn. Your move." — and on a
  decay event: "Your X at top left faded. Board is now: X middle center, O middle right… Your
  move." Full-board readback only on decay events and on request (a "describe board" control),
  not every move — verbosity is its own accessibility failure. Game result is announced
  assertively once: "You won — three in a row on the top row."
  Each game supplies its `announce()` strings (§10); the shell owns the region and sequencing.
- **Reduced motion:** `prefers-reduced-motion` drops the final-turn pulse, replaces
  fade+shrink vanish with an instant swap to the ghost outline, and disables board-entry
  transitions. All state information must survive with zero animation (guaranteed by §2's
  static-encodings rule). Confetti-class win effects are skipped entirely.
- **Colorblind-safe identity:** player identity is **shape/glyph first** (X vs O; every game
  must give the two sides distinct glyphs or fill patterns, not just hues), with hues drawn
  from a blue/orange-family pair. Red-vs-green is banned as a sole differentiator anywhere,
  including status ("your turn" is stated in words, never only a colored dot). Grayscale
  screenshot test is part of each game's design review.
- **Contrast:** text 4.5:1; board lines, glyphs (including at the 40% decay floor), and focus
  indicators 3:1 non-text minimum. Verified in both light and dark themes.

---

## 9. Visual and motion direction

### The direction (a decision): **"Ink on paper, arcade tempo."**

Warm off-white ground (paper, not sterile white; near-black warm ink for structure), board and
glyphs drawn with confident rounded ink strokes, exactly **two saturated accent hues — player
one blue-family, player two orange-family** — used *only* for player-owned material, so 100% of
color on the board is information. UI chrome stays ink-and-paper. Dark theme: warm near-black
paper, chalk-white ink, the same two accents lifted for contrast.

**Rationale.** (1) It photographs the brand promise — "familiar classic, hand-altered": pen-and-
paper is the native aesthetic of tic-tac-toe, dots-and-boxes, hangman; the twist reads as
someone *drawing on the classic*. (2) It is content-first: with only two hues on the board and
both meaning "player," the decay encodings of §2 (opacity, desaturation toward ink) have a
clean, quiet field to operate on. (3) It scales across 100 games without art cost — the system
is strokes, two accents, and one glyph pair per game, not per-game illustration. (4) It ages
well and avoids both the "neon arcade" and "flat corporate playful" clichés of casual game
portals. "Arcade tempo" = the snap lives in the *motion*, not in visual loudness.

### Animation communicates rules; it never decorates

The rule, stated once and enforced in review: **every animation must restate a state change that
static encodings already show** (reduced-motion users lose nothing; everyone else gets the rule
*narrated*). Vocabulary:

- **Place:** glyph draws in stroke-by-stroke, 150ms ease-out — "you wrote this."
- **Age step:** opacity/desaturation steps down in 200ms *at the moment the turn advances*,
  not gradually — aging is turn-quantized, and the animation teaches exactly that.
- **Final-turn warning:** one 600ms pulse, once (dropped under reduced motion).
- **Vanish:** 400ms fade+shrink to the dashed ghost outline — long enough to be witnessed
  peripherally, short enough not to delay the next move. Input is *not* blocked during it.
- **Win:** the winning line strokes through, 300ms; losing pieces dim. No confetti by default —
  the drawn line *is* the celebration, on-brand.
- Timing tokens shared library-wide: 150/200/300/400ms, ease-out, so every game feels like the
  same hand made it.

### Shared component inventory (built once, used by every game)

`GameShell` (frame, §10) · `RuleCard` (the one-sentence card + "How?" sheet trigger) ·
`BoardShell` (sizing, gutters, focus/keyboard grid wiring, pointer-commit logic) ·
`Cell` (target sizing, staged/committed/ghost states, badge slot, focus ring) ·
`CountdownBadge` · `StatusLine` (whose turn / waiting / result, with live-region mirroring) ·
`TurnIndicator` (player glyph + name chips) · `ControlsRow` (Undo/Restart/How + overflow) ·
`ResultModal` (result, texture line, Rematch / Next twist / Share) · `ShareCard`
(artifact composer + share-sheet/clipboard) · `PassDeviceInterstitial` (hotseat) ·
`InviteSheet` (link-multiplayer create/share) · `GameCard` (library card, §4) ·
`AriaAnnouncer` (the live region).

---

## 10. The shared "game shell" spec (primary deliverable)

### Concept

The shell is the constant frame every game plugs into. A game is a *plugin*: pure rules engine +
board renderer + a handful of string/artifact hooks. The shell owns everything a player touches
that isn't the board itself. Consequence: a new game adds **no new chrome, no new navigation, no
new modals** — and every game the library ships automatically gets teaching layers, a11y,
multiplayer plumbing, share, and the end-screen loop.

### Screen anatomy (portrait; regions top→bottom)

```
1 HEADER      shell   site mark (→ home) · game title · overflow menu
                      (settings: sound/haptics/motion/theme · switch difficulty · report bug)
2 RULECARD    shell   the game's one-sentence rule (≤90 chars) · "How?" → bottom sheet
                      (sheet content supplied by game: sentence + 3-frame strip)
3 STATUSLINE  shell   whose turn / waiting-for-friend / result · mirrors to live region
4 BOARD SLOT  game    the game's board component, rendered inside BoardShell
                      (shell provides sizing box, keyboard-grid wiring, pointer-commit,
                       input-lockout window after state changes)
5 CONTROLS    shell   Undo (solo only) · Restart · How? · [game-specific extras slot]
6 RESULT      shell   ResultModal: result + game's texture line · Rematch · Next twist ·
                      Share (artifact via game hook) · streak line · account offer (game ≥3)
```

### Ownership contract

| Concern | Shell owns | Game owns |
|---|---|---|
| Rules & legality | turn sequencing scaffold, undo stack, history | `engine`: init/legalMoves/applyMove/status — the *only* authority on rules |
| Rendering | page frame, board sizing box, cells' focus/tap machinery via `BoardShell`/`Cell` | board layout & piece rendering *using* shared `Cell`s; the decay/telegraph visuals via shared tokens |
| Teaching | rule-card slot, "How?" sheet, first-occurrence callout machinery (anchor, once-per-device flag) | the rule sentence, the How-sheet frames, callout trigger + text |
| Opponents | mode switching, hotseat interstitial, async link create/join/sync, seat & token management | `bot(level)`: a move policy; declaring which modes it supports |
| A11y | grid keyboard nav, focus management, live region, reduced-motion switch, contrast tokens | `announce()` strings per event; accessible names for cells |
| End of game | ResultModal, rematch reset, next-twist selection, share-sheet plumbing, streaks/account | result texture line; `shareArtifact(history)` emoji timeline |
| Persistence & routing | URLs, localStorage (in-progress solo games, seen-callout flags, streaks), server sync for async games | `serialize()/deserialize()` of its state |
| Settings | sound, haptics, motion, theme, difficulty UI | nothing (games read settings, never present them) |

### The interface (what an engineer builds against)

```ts
interface GameDefinition<S, M> {
  id: string;                       // "fadeout-ttt"
  title: string;                    // "Fadeout Tic-Tac-Toe"
  classic: string;                  // "Tic-Tac-Toe"  (drives library shelves & cards)
  ruleSentence: string;             // ≤90 chars — the ONE canonical sentence, used on the
                                    //   rule card, library card, OG description, invites
  tags: MechanicTag[];              // ["decay"] — drives browse facets & next-twist choice
  estMinutes: number;               // card label "~3 min"
  modes: { bot: true; hotseat: boolean; asyncLink: boolean };

  engine: {
    init(seed?: string): S;                       // seed ⇒ daily mode support
    legalMoves(s: S): M[];
    applyMove(s: S, m: M): S;                     // pure; ALL twist logic lives here
    status(s: S): { kind: "playing"|"won"|"draw"; winner?: Seat;
                    textureLine?: string };       // e.g. "Your center X faded at the worst moment"
    serialize(s: S): string;  deserialize(x: string): S;
  };

  Board: Component<{                              // renders INSIDE BoardShell
    state: S;
    legal: M[];
    onMove(m: M): void;                           // shell wraps with commit/lockout/undo
    seatView: Seat | "spectator";
    prefs: { reducedMotion: boolean; theme: Theme };
  }>;

  bot(level: "casual"|"standard"|"ruthless"): (s: S) => M;   // pure; may be worker-hosted
  // shell softens level-appropriate twist-exploitation on a device's first game (§6)

  announce(ev: GameEvent<S, M>): string;          // live-region sentences (§8)
  firstOccurrence?: { trigger(ev): boolean;       // e.g. first decay event
                      text: string; anchorCell(ev): CellRef };
  shareArtifact(history: M[], final: S): string;  // emoji timeline body (§5);
                                                  //   shell adds title/result/URL frame
  howSheetFrames: [Frame, Frame, Frame];          // 3 illustrated steps for the "How?" sheet
}
```

The shell guarantees to every game: input arrives only when legal and only via `onMove`;
undo/redo, persistence, opponents, and announcements happen without game code; and the game's
`engine` is the single source of truth the shell replays for undo, async sync, and daily seeds.
A game that keeps its engine pure gets async multiplayer and daily mode *for free* — this is the
architectural payoff of the shell and the reason the engine/Board split is non-negotiable.

**Definition of done for a new game (review gate):** rule sentence ≤90 chars · telegraph encoding
passes the grayscale-screenshot test · cells ≥48px at 320px viewport · announce strings for
every event type · reduced-motion parity · bot at three levels · shareArtifact renders <7 lines.

---

## 11. ASCII wireframes

### A. Home / library page (mobile portrait, ~15-game stage)

```
┌────────────────────────────────────┐
│ ◇ TWIST                     ☰      │  header: mark → home, menu
├────────────────────────────────────┤
│  TODAY'S GAME · Daily #37          │
│  Fadeout Tic-Tac-Toe               │
│  “Your pieces vanish 3 turns       │
│   after you place them.”           │
│  ┌───────┬───────┬───────┐         │
│  │       │   O   │       │         │  hero board is LIVE —
│  ├───────┼───────┼───────┤         │  first tap plays the move
│  │       │  X ₂  │       │         │  and enters the game page
│  ├───────┼───────┼───────┤         │
│  │  ✕    │       │       │         │  (✕ = fading piece, ₂ = badge)
│  └───────┴───────┴───────┘         │
│  [ ▶ Play today’s game ]           │
├────────────────────────────────────┤
│  Your active games                 │  only if async links in progress
│  ▸ vs Sam — YOUR MOVE · Fadeout    │
├────────────────────────────────────┤
│  Twists on Tic-Tac-Toe        →    │
│ ┌─────────┐ ┌─────────┐ ┌────────  │  horizontally scrollable shelf
│ │ ◍ Grav- │ │ ◍ Blind │ │ ◍ 4x4    │
│ │ ity TTT │ │  TTT    │ │  Decay   │
│ │ pieces  │ │ you see │ │ …        │
│ │ fall to │ │ only yr │ │          │
│ │ bottom  │ │ last 2  │ │          │
│ │ decay·3m│ │ hidden·2m│ │          │  chips: mechanic · ~length
│ └─────────┘ └─────────┘ └────────  │
├────────────────────────────────────┤
│  Twists on Connect Four       →    │
│ ┌─────────┐ ┌─────────┐ ┌────────  │
│ │ …       │ │ …       │ │          │
├────────────────────────────────────┤
│  🔍 Search games…                  │
│  Browse all 15 →                   │
└────────────────────────────────────┘
```

### B. Game page (mobile portrait — the arrival screen)

```
┌────────────────────────────────────┐
│ ◇          Fadeout TTT        ⋯    │  header (top = hard thumb zone, fine)
├────────────────────────────────────┤
│ Classic tic-tac-toe — but your     │  RULE CARD: the one sentence,
│ pieces vanish after 3 turns. ⓘHow? │  always visible
├────────────────────────────────────┤
│           ● Your move              │  STATUS LINE (words, not just color)
├────────────────────────────────────┤
│                                    │
│   ┌────────┬────────┬────────┐     │
│   │        │        │        │     │  board = min(100vw−32, 52svh)
│   │        │   O    │        │     │  cells ≥ 48px (here ~104px)
│   ├────────┼────────┼────────┤     │
│   │        │        │  ┌─┐   │     │
│   │   X    │   O ₁  │  ¦X¦   │     │  O ₁ = countdown badge, 65% opacity
│   │        │        │  └─┘   │     │  ¦X¦ = ghost outline (just vanished)
│   ├────────┼────────┼────────┤     │
│   │        │        │        │     │  ┌──────────────────────────┐
│   │  X ₂   │        │        │     │  │ Your X faded — pieces    │ first-
│   │        │        │        │     │  │ last 3 turns.            │ occurrence
│   └────────┴────────┴────────┘     │  └────────────△─────────────┘ callout
│                                    │
├────────────────────────────────────┤
│   ↩ Undo      ⟳ Restart     ? How  │  CONTROLS (bottom = easy thumb zone)
└────────────────────────────────────┘
```

### C. End-of-game screen (result modal over the finished board)

```
┌────────────────────────────────────┐
│ ◇          Fadeout TTT        ⋯    │
│  (finished board, dimmed, winning  │
│   line drawn through, beneath)     │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │        🏆 You won            │  │  1. result, unambiguous
│  │   Bot’s center O faded at    │  │     + texture line (the story)
│  │   the worst possible moment  │  │
│  │                              │  │
│  │  ❌⭕❌⭕❌💨⭕❌🎯            │  │  move timeline (= share artifact)
│  │                              │  │
│  │  ┌────────────────────────┐  │  │
│  │  │      ⟳ REMATCH         │  │  │  2. primary
│  │  └────────────────────────┘  │  │
│  │  ┌────────────────────────┐  │  │
│  │  │ Next: Gravity TTT  →   │  │  │  3. one chosen adjacent game
│  │  │ “pieces fall to the    │  │  │     with its rule sentence
│  │  │  bottom row”           │  │  │
│  │  └────────────────────────┘  │  │
│  │       ↗ Share result         │  │  4. tertiary, persistent
│  │                              │  │
│  │  🔥 3 games today            │  │  streak line
│  │  Save your streak across     │  │  account offer (from game 3;
│  │  devices — 10 seconds →      │  │  one quiet line, never a modal)
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

---

## 12. Open questions for the other lenses

- **Daily mode economics:** per-game dailies vs one site-wide daily — retention data needed;
  design assumes per-game seeds with one site-wide featured daily.
- **Bot hosting:** client-side bots (worker) keep async infra tiny; confirm no game in the
  first 20 needs server-side compute.
- **Naming:** "Fadeout Tic-Tac-Toe"-style names ({Twist} {Classic}) assumed throughout;
  trademark review needed for classic names (e.g., "Connect Four" is Hasbro's — likely
  "twists on four-in-a-row").
- **Consent/ads:** design assumes no interstitial ads ever inside the play loop; if ads fund
  the product, placement is between games on the end screen only — anything else breaks the
  8-second and rematch loops this whole document is built on.

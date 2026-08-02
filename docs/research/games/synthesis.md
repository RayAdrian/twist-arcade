# Synthesis — "Twisted Classics" Free Game Library

*Orchestrator synthesis of four independent Fable research passes — game theory
(`game-theory-lens.md`), market (`market-lens.md`), UX (`ux-lens.md`), and architecture
(`architecture-lens.md`) — run in parallel with no knowledge of each other. 2026-08-02.*

> Note: `docs/research/*.md` (one directory up) belongs to a **different, earlier product
> exploration** (document-compliance SaaS). It is unrelated to this and is retained, not
> superseded.

---

## 1. What the four lenses agreed on without coordinating

Four passes, four vocabularies, one product:

| Lens | Independent conclusion |
|---|---|
| Game theory | "A twist is good exactly when it destroys the classic's known solution without destroying its legibility" — and that must be **measured**, not judged. |
| Market | The empty quadrant is *free + browser + curated library + twisted playground classics + daily ritual*. The seed game alone is not defensible (it already went viral and was cloned). **The library + ritual is the product.** |
| UX | The teaching budget is **one delta, one sentence, one visual system**. Any twist that needs a paragraph is the wrong game. |
| Architecture | Every game is a **pure deterministic state machine** behind one interface; everything else (bots, multiplayer, dailies, replays, anti-cheat, the balance harness) falls out of that for free. |

These are the same claim seen from four sides: **one sentence of new rules, on a chassis
everyone already knows, validated by machine before a human sees it, collected into a
destination with a daily habit.** Nothing in the four documents contradicts that thesis.
The convergence is strong enough to build on.

Three findings are load-bearing and were each found by only one lens:

1. **The seed mechanic is already validated *and* already cloned.** "Infinite / Vanishing
   Tic-Tac-Toe" (3 pieces max, oldest vanishes) went viral on TikTok, spawned App Store
   clones and a physical toy (GiiKER). Read both ways: demand is proven; the single game
   is not a moat. *(market)*
2. **Decay tic-tac-toe is small.** ≲10⁵ reachable states — exhaustively solvable in an
   afternoon, and the working hypothesis is a **first-player win via center**. It ships
   as the flagship for brand reasons, but only with a balancing device and a bigger
   ranked escalation behind it. *(game theory)*
3. **Variant demand is creator-ignited, not searched.** Lichess variants cap at ~2% of
   players each; Chess.com variant spikes track GothamChess/Rosen videos. Twists are
   *watchable* — that is the distribution channel, and it argues for twisting
   kindergarten-simple games rather than hard ones. *(market)*

---

## 2. Conflicts between the lenses, and the resolution

The passes disagreed in six places. Each is resolved here; these resolutions are the
decisions the roadmap is built on.

### 2.1 Depth in one family vs. breadth across classics

- **Game theory** ranked six launch games; four are tic-tac-toe-family.
- **Market** wants breadth (four-in-a-row, snake, minesweeper, dots-and-boxes) for SEO
  surface and recognition.
- **UX** wants ≥2 twists per classic so classic-family shelves and the "next twist"
  adjacency loop have anything to work with.

**Resolution: depth-first, with one bridgehead.** Launch **4 tic-tac-toe-family twists +
2 non-TTT**. The TTT shelf is instantly the best-populated shelf on the internet for that
classic (which is exactly what the end-of-game "Next twist" loop needs), while the second
family proves the shelf pattern generalizes. Breadth comes from the weekly drop cadence,
not from launch day.

### 2.2 Two-player abstracts vs. single-player score games

Market implicitly wants snake/minesweeper-style twists (huge search volume, trivially
shareable scores, no opponent needed). Game theory's entire validation apparatus — FPA,
draw rate, self-play ladders — **does not apply to single-player games**, and the
architecture's harness assumes two seats.

**Original resolution (2026-08-02, superseded):** launch is 2-player abstracts only;
single-player is a Phase 3 second product line, because it would fork the harness and the
shell before either is proven.

**Revised resolution (2026-08-02, after the user chose to include solo at launch and a
fifth research pass examined it — `solo-games-lens.md`):** **two solo games ship at
launch.** The deferral over-sized the cost. Solo is an *extension*, not a fork: the
purity/seeded-RNG/replay spine already carries it, and the engine delta is one new
`Status` variant (`lost`), one optional `score?()`, and legalizing `minPlayers: 1`. The
solo *validation* model is genuinely different and is specified in full in
`solo-games-lens.md` §3 — skill measured as distribution separation between policies over
paired seed sets, with Grind / Always-Safe / Greedy-Only probes replacing the mirror and
stall bots.

The original caution survives as **binding guardrails**: turn-quantized games only (the
real fork is the real-time tick loop, still deferred), and the two-player slate keeps
priority when time is short. Launch slate: **Crackstep** (crumbling-floor daily puzzle —
the house decay mechanic in solo form) and **Mine Run** (press-your-luck minesweeper score
chase). One per format proves the whole solo platform. Cost: ~5–8 platform dev-days plus
~1–2 days per game.

### 2.3 Two different "game interface" specs

UX authored a `GameDefinition` (rule sentence, Board component, announce, shareArtifact,
bot levels). Architecture authored `GameEngine<S, M, V>` (setup/legalMoves/apply/status/
playerView/encode). They overlap and disagree in detail.

**Resolution: they nest.** `GameEngine<S,M,V>` (architecture's, the stricter one — it
carries seeded RNG, simultaneous moves, and the hidden-info redaction boundary) is
**the** engine contract. UX's `GameDefinition` becomes the *presentation manifest* that
wraps it:

```ts
GameDefinition = {
  meta / manifest bits (id, title, classic, tags, estMinutes, modes),
  ruleSentence,            // ≤90 chars — hard content constraint (UX)
  engine: GameEngine<S,M,V>,   // architecture's contract, verbatim
  Board, bot levels, announce(), firstOccurrence?, shareArtifact(), howSheetFrames,
  thresholds               // harness gates (game theory)
}
```
Nothing is dropped from either document. The engine stays framework-free; everything
React-shaped lives in the wrapper.

### 2.4 Two sets of balance thresholds

| Metric | Game theory ("ship it") | Architecture (CI hard fail) |
|---|---|---|
| First-player win rate | 45–55% raw | outside 35–65% |
| Draw rate | <10% | >60% |
| Strong vs random | ≥90% | <90% |

**Resolution: two tiers, both kept.** Architecture's wide bands are the **CI gate** — a
build-breaking assertion that catches degenerate games automatically. Game theory's
tighter bands are the **design gate** — a human decision in the Fable review stage about
whether the game is *good*, not merely *not broken*. A game can pass CI and still be sent
back for rebalancing. Game theory's extra probes (mirror bot, stall bot, comeback
fraction, opening-move concentration, exact solver under 10⁷ states) are added to the
harness spec; the architecture doc did not have them.

### 2.5 Daily mode in a two-player game

Market and UX both want the Wordle-style daily ritual as the retention spine. But a
"daily" in a 2-player game is only comparable if the *opponent* is identical for everyone
too.

**Resolution:** the daily is **same seed + a pinned, fully deterministic bot** (fixed
tier, fixed rollout budget, fixed RNG seed, pinned `engine_version`). Everyone faces
literally the same opponent behaviour for the same play. This makes "won in 9" a
comparable number — and it means **the daily bot must never be silently retuned**;
changing it invalidates the day's comparability and any leaderboard built on it. That
constraint is not in any lens's document and is added here.

### 2.6 Supabase before it is needed

CLAUDE.md mandates a local Supabase stack per agent team. Architecture's honest finding:
solo + hotseat play **touches no server at all**, and anonymous auth should be minted on
first server-touching action, not on page load.

**Resolution:** teams still register worktrees and claim port blocks per `CLAUDE.md` §5,
but a team whose feature genuinely never touches the database may skip `supabase start`
and record that in `docs/worktrees.md` (`Supabase: not started — client-only feature`).
The teardown checklist still applies to whatever *was* started. Phase 2 (async
multiplayer) is where Supabase becomes load-bearing.

---

## 3. The decisions this produces

**Product.** A destination site of two-player twisted classics, free, no login, one
site-wide Daily Twist, an emoji share artifact per game, weekly new twists.

**Launch slate (6 games)** — game theory's ranking, filtered through market's
"twist simple, not hard" rule and UX's one-sentence constraint:

| # | Working name | Classic | The one sentence (≤90 chars) | Cx | Notes |
|---|---|---|---|---|---|
| 1 | **Fadeout** | Tic-tac-toe | "Your pieces vanish 3 turns after you place them." | S | Flagship. Exact-solve first; pie rule + series alternation; 4×4/cap-4 ranked escalation. |
| 2 | **Nine Grids** | Tic-tac-toe | "Where you play in a small board sends your opponent to that board." | M | Ultimate TTT, strict ruleset. Proven demand; the depth anchor. |
| 3 | **Wrap** | Tic-tac-toe | "The 5×5 board wraps around — lines continue off every edge." | S | Cheapest total heuristic reset. Expect high FPA → pie rule. |
| 4 | **Order vs Chaos** | Tic-tac-toe | "Both players place X or O. Order wants 5 in a row; Chaos wants none." | S | Asymmetric roles kill mirroring; best hotseat game on the list. Role-swap pairs. |
| 5 | **Tilt** | Four-in-a-row (**never** "Connect Four") | "Every 4th turn the board rotates and every piece falls again." | M | Invalidates the 1988 solve; the re-fall animation *is* the marketing clip. |
| 6 | **Bid-Tac-Toe** | Tic-tac-toe | "No turns — bid chips each round; the higher bid pays and plays." | M | Richman bidding: **zero first-player advantage by construction**. The "for clever people" entry. |

Fast-follow queue (validated in the harness before UI): Fog Pools (nim + hidden pile),
Duel Draft (simultaneous), Crossout (misère/Notakto family), Closing Walls (shrinking
board), Pawn Rush (breakthrough). Held: Blindfold Reversi and Secret Lines (both need
belief-state bots — ISMCTS — so they are the month-3+ content beat).

**Refused outright, with reasons on the record:** 3+ player variants (kingmaker +
matchmaking liquidity); standalone misère TTT (known draw, one-sentence strategy);
Battleship-family (zero-skill first half, trademarked name); realtime multiplayer and Elo
at launch (liquidity death); required accounts (friction death); "unblocked" branding
(policy/reputation tar pit — win that traffic by being fast, login-free, and school-safe
instead); Poki web-exclusivity (kills the destination); building 40 games before the
ritual is proven.

**IP posture.** Mechanics are unprotectable; names and trade dress are the hazard. Every
game gets an original coined name, original visual identity, and self-written rules text.
Say "reversi," never "Othello." Never "Connect Four," never its blue-rack/red-yellow
dress. Descriptive references ("a tic-tac-toe variant") are safe and good for SEO.

**Platform.** House stack unmodified: Next.js 15 App Router + TypeScript + Tailwind/shadcn
on Vercel, Supabase for Phase 2 onward. Owned core: `packages/engine`, `packages/bots`,
`packages/harness` — all pure TS, ~1–2k lines. Everything else is commodity (fast-check,
mulberry32, size-limit, axe-core, Motion One). Learn from boardgame.io; adopt nothing.

**Experience.** "Sentence → Telegraph → Aha-callout" teaching, never a tutorial. Board is
the landing page; first move under 8 seconds; nothing gates play. Accounts offered after
the 3rd completed game, required never. End-of-game screen is the most important screen:
result + texture line → Rematch → exactly one Next twist → Share. Share artifact is an
emoji **move timeline**, not a board snapshot. "Ink on paper, arcade tempo"; two accent
hues, both meaning "player," so 100% of board color is information.

---

## 4. What must be true for this to work (the falsifiable bets)

1. **Machine validation predicts fun well enough to be a gate.** If games that pass the
   harness still feel bad in playtest, the harness is theater and the cadence collapses.
   Cheap early test: run the §3.5 five-hotseat-playtest protocol on the first three games
   and check agreement with the metrics.
2. **The share artifact converts.** Market's growth model rests on it. Target ≥8% of
   completed dailies shared; below 2–3% after a real traffic spike means the artifact or
   the daily is wrong, and *no amount of additional games fixes it*.
3. **People try more than one game.** Games-tried-per-visit ≥2.0 by month 3. Below that,
   we built a game, not a library — and the correct response is to double down on the one
   game that over-performs.
4. **A new game really costs ~a day** once the scaffold exists. If game 12 takes three
   weeks, the content pipeline is the product's actual bug.

Break-even is ~100–300 sessions/day against near-zero hosting cost, so the downside is a
cheap asset that compounds in search; the upside is asymmetric (a viral hit the library
catches, or the Puzzmo/Wordle acquisition shape). Year-one revenue is beer money in every
realistic scenario — that is the honest framing, not a pessimistic one.

---

## 5. Decisions — resolved by the user, 2026-08-02

1. **Site name: Twist Arcade.** Repo `twist-arcade`
   (github.com/RayAdrian/twist-arcade). No trademark clearance performed.
2. **Flagship name: Fadeout.**
3. **Ads: yes**, from month 2 — end screen and between games only, never inside the play
   loop.
4. **Single-player twists: included at launch**, not deferred. See the revised §2.2 and
   `solo-games-lens.md`.

# Roadmap — Twisted Classics Game Library

*Derived from the four research passes in `docs/research/games/` and their synthesis
(`docs/research/games/synthesis.md`). Written 2026-08-02. Week 1 = the first build week.*

**The product in one sentence:** classic games you already know how to play, with one rule
changed that changes everything — free, in the browser, a new twist every week.

**The thing that is actually being built:** not a game. A **content pipeline** — an engine
contract, a generic bot, a self-play balance harness, and a game shell — such that a new
validated game costs about a day. The games are the output; the pipeline is the asset.

---

## 0. Ground rules for every phase

- Each phase has **exit criteria**. A phase does not end because time passed; it ends when
  its criteria are met, or it triggers a documented pivot.
- Every game passes **both** gates before it ships: the CI gate (automated, build-breaking)
  and the design gate (Fable review of the harness numbers). See §6.
- Every feature follows `CLAUDE.md` §2 — Fable plans → Sonnet builds (TDD) → Fable designs
  test cases → Sonnet executes them → Sonnet fixes → Fable reviews → green.
- One feature = one agent team = one worktree = one branch (`CLAUDE.md` §4). Teams whose
  work never touches the database record `Supabase: not started` in `docs/worktrees.md`
  rather than booting an unused stack (synthesis §2.6).
- Nothing ships that requires an account. Nothing gates the first move.

---

## Phase 0 — The spine (Weeks 1–2)

**Goal:** one game, end to end, on infrastructure that makes the next five cheap. No
marketing surface, no polish beyond the shell, not public.

### Scope

| Workstream | Deliverable |
|---|---|
| `packages/engine` | `GameEngine<S,M,V>` contract verbatim from the architecture pass: seeded `Rng` (no `Math.random`, lint-enforced), `apply` as the single transition running all cascades to quiescence, `playerView` redaction with a distinct view type, `encode`/`decode`, `heuristic?`. Plus the shared property-test kit (`engineContract(engine)`). |
| `packages/bots` | Generic Random / minimax+αβ / MCTS-UCT consuming only the interface. Difficulty = budget + blunder rate (ε-softmax) + policy mix, declared as **manifest data, not code**. Runs in a Web Worker; 200–800 ms reply budget with a ~250 ms artificial floor on Casual. |
| `packages/harness` | Headless self-play CLI. Reports first-player win rate, draw rate, mean/median/p95 plies, branching factor, strong-vs-random, tier ordering, plus game theory's degeneracy probes: **mirror bot, stall bot, rush bot, opening-move concentration, comeback fraction**. Exact solver (value iteration on the cyclic game graph) for any game under ~10⁷ reachable states. |
| Game shell | `GameShell` and the component inventory from the UX pass: `RuleCard`, `BoardShell`, `Cell`, `CountdownBadge`, `StatusLine`, `ControlsRow`, `ResultModal`, `ShareCard`, `AriaAnnouncer`, `PassDeviceInterstitial`. Shell owns chrome, teaching, a11y, undo, persistence, end screen; the game owns rules + board + strings. |
| Game 1 | **Fadeout** (decay tic-tac-toe), solo-vs-bot + hotseat, with the "Sentence → Telegraph → Aha-callout" teaching pattern fully implemented. |
| Scaffold | `pnpm new-game <id>` stamping engine skeleton + pre-wired contract tests + Board wired to the platform hook + manifest + `CHECKLIST.md`. |

### Sequencing note

**Exact-solve Fadeout before building its UI.** It is ≲10⁵ states; the working hypothesis
is a first-player win via center. The solve decides the shipping ruleset (does the doomed
mark disappear before or after placement? is it playable-through?), whether the pie rule
is needed, and whether the 4×4/cap-4 escalation must ship alongside. An afternoon of
compute that could otherwise cost a rebuild.

### Exit criteria

- [ ] Fadeout playable start-to-finish on a phone, first move under 8 seconds from cold load
- [ ] Exact solve complete; ruleset chosen on the strength of it; balancing device decided
- [ ] Harness runs Fadeout and reports the full metric set; thresholds committed to its manifest
- [ ] Contract property suite green; axe clean; game route ≤75 kB gz
- [ ] `pnpm new-game` produces a compiling, test-passing stub in under a minute
- [ ] Five-person hotseat playtest: at least one player makes a *twist-aware* play (deliberately waiting out a decay) within their first two games, unprompted

---

## Phase 1 — Launch (Weeks 3–6)

**Goal:** a public destination with six games, one daily ritual, and a share artifact.
Prove the ritual and the artifact — not the catalog size.

### Scope

**The six launch games** (synthesis §3): Fadeout · Nine Grids · Wrap · Order vs Chaos ·
Tilt · Bid-Tac-Toe. Four tic-tac-toe-family twists give the classic-family shelf and the
"Next twist" adjacency loop something real to work with; Tilt opens the second family.

Each ships with: bot at three levels (Casual / Standard / Ruthless), hotseat, the
one-sentence rule card, telegraph encoding, first-occurrence callout, `announce()` strings,
share artifact, and harness numbers on the record.

**Platform features:**
- **Daily Twist** — one site-wide daily, rotating across games. Same seed **and a pinned,
  fully deterministic bot** (fixed tier, fixed budget, fixed RNG seed, pinned
  `engine_version`) so "won in 9" is comparable between players. Seed is public and
  offline-computable: `sha256("daily:" + gameId + ":" + engineVersion + ":" + yyyy-mm-dd(UTC))`.
- **Share artifact** — emoji move-timeline per game, never a board snapshot; the shell owns
  the frame (title, result, URL), the game supplies the body and one ≤40-char stat line.
- **Streaks** — site-level only, `localStorage`, one streak ("played today's Twist"). Never
  per-game streaks: dozens of them create guilt-debt and churn.
- **Library home** — playable daily hero + text-first cards + one classic-family shelf.
- **End-of-game screen** — result + texture line → Rematch → exactly one Next twist (with
  its rule sentence) → Share.
- No accounts, no ads, no leaderboards, no realtime, no search (search arrives at ~15 games).

**Launch week:** Show HN, then r/InternetIsBeautiful, then r/WebGames — staggered, one at a
time, posted as the thing itself with no marketing tone. Simultaneously seed 3–5 short
vertical clips of the *vanish moment*; the twist is the content. Then DM small/mid puzzle
and chess creators offering a novel format for their videos — you are giving them material,
not asking a favour.

### Exit criteria

- [ ] Six games live, each with published harness numbers and both gates passed
- [ ] One traffic spike ≥10k visits from a community post
- [ ] **Share rate ≥5%** of completed dailies (target ≥8%)
- [ ] Any organic day-7 returners at all
- [ ] Lighthouse/CWV green on a mid-tier Android over 4G; cells ≥48 px at a 320 px viewport
- [ ] `docs/tests/*.md` test plans executed against each game with results recorded

### Pivot trigger

Spikes with **<2% share rate and D7 ≈ 0** means the artifact or the daily is wrong. Fix
those before adding a seventh game. Adding games to a broken retention layer is the classic
portal mistake and it is expensive.

---

## Phase 2 — Cadence and the viral loop (Months 2–3)

**Goal:** prove the pipeline sustains a weekly drop, and turn every player into
distribution.

### Scope

- **"New Twist Tuesday"** — one validated game per week, 12–15 games by end of phase. From
  the fast-follow queue: Fog Pools (hidden-info nim), Duel Draft (simultaneous), Crossout
  (misère/Notakto family), Closing Walls (shrinking board), Pawn Rush (breakthrough).
- **Async link-based multiplayer** — the growth feature, and the first time Supabase is
  load-bearing. Server-authoritative from the first online move: the Next.js route handler
  runs the *same* engine, validates with `isLegal`, advances with `apply`, and returns only
  `playerView(S, requester)`. Canonical state and seed never cross the wire. Anonymous
  Supabase sign-in, minted on first server-touching action — not on page load. Tables:
  `matches` / `match_players` / `moves`, RLS denying client reads of `state` and `seed`.
  One shared URL becomes a standing series with seats swapped each rematch.
- **Second classic family** filled out so the shelf IA has two real shelves.
- **Search** in the library (~15 games), mechanic-tag browse facets.
- **SEO pages** per coined game name and per "classic + variant" query. Search is *the*
  web-games channel — Poki takes ~44% of desktop traffic from organic.
- **H5 Games Ads on** — end screen and between games only, never inside the play loop.
- Submit **one older, non-daily game** to CrazyGames (60/40, non-exclusive) as funded
  marketing carrying the site's brand. Decline any web-exclusivity offer.

### Exit criteria

- [ ] 12–15 games; **median authoring lead time ≤2 days per game** (this is the real metric)
- [ ] 300–1,000 organic sessions/day baseline *between* spikes
- [ ] **Games-tried-per-visit ≥2.0**
- [ ] First Search Console impressions on variant queries
- [ ] Async multiplayer: median time-to-first-friend-move under 24h; zero hidden-state leaks in the redaction contract test

### Pivot trigger

Traffic that exists only during launch posts means the retention layer is failing, not the
catalog. Stop shipping games; fix the daily and the end-screen loop.

---

## Phase 3 — Compounding (Months 4–6)

**Goal:** turn traffic into habit and identity, and find the franchise game.

- **Daily leaderboards, per-seed, reset daily.** Server-verified by **replaying the move
  log through the engine** and recomputing the metrics — the client's claimed score is
  discarded. Rank by verified move efficiency, never by client-reported time. Friend
  leaderboards over global ones; do not build an anti-cheat department for a free site.
- **Account claim** — Supabase `linkIdentity` onto the *same* anonymous user id, so nothing
  migrates and nothing is lost. Offered after the 3rd completed game, one quiet line on the
  end screen. Earns: cross-device streaks, history, "your turn" emails, a handle.
- **Realtime pokes** (Supabase Realtime broadcast → client refetches its view; never
  `postgres_changes`, which would ship canonical state to subscribers). This is an upgrade
  of the async tier, not a new system.
- **Creator outreach** at scale on whichever game performs best.
- **Supporter tier**, $2–3/mo or $15–25/yr: ad-free, daily archive, extra stats. Priced well
  under NYT Games and BGA.
- **Single-player score twists** (snake/minesweeper family) — the deferred second product
  line from synthesis §2.2, if and only if the two-player pipeline is running at cadence.
  They need their own validation model (difficulty curve, score distribution, seed
  solvability); do not fork the harness before Phase 2's exit criteria are met.
- Held games unblocked here: Blindfold Reversi and Secret Lines, once determinized/ISMCTS
  bots exist.

**Exit criteria:** 2,000–5,000 sessions/day · D7 ≥8% of daily-finishers · one game showing
outsized pull (the franchise) · first $100s/month of ad revenue.

**Pivot trigger:** <500 sessions/day with flat search growth means the library concept
isn't compounding — pivot to the single game that over-performs and make *it* the product.

---

## Phase 4 — Scale or sharpen (Months 7–12)

Whichever the data says:

- **Double down on the franchise game** — it becomes the brand's Wordle. Depth modes,
  ranked play, a real strategy wiki, its own share culture.
- **Realtime versus and Elo** — only now, and only if one game demonstrably sustains a
  versus community. Matchmaking with an empty queue is negative value; Lichess variant data
  (~2% of players per variant) is the warning.
- **Cosmetics** (piece skins, board themes) once accounts exist. Never pay-to-win — it
  would destroy the fairness that makes twists legible.
- **B2B / licensing** — school packs, corporate icebreakers, LinkedIn-style format
  licensing. Genuine options at 100k+ MAU with a clean brand; not before.

**Working at month 12:** 10k–30k sessions/day · supporter tier with 100+ subscribers · a
creator-made video about at least one game · searches for *your coined game names* appearing.

**First scaling cliff to watch:** Postgres write/connection pressure from async play +
polling, somewhere in the 100k→1M sessions/month band. Mitigations in deployment order:
pooler, poke-over-poll, batched move writes, finished-match archival. Every step is
incremental; no re-architecture is on the path until well beyond 1M sessions/month.

---

## 6. The two gates every game passes

**CI gate — automated, build-breaking** (from the architecture pass):

| Check | Fails the build |
|---|---|
| Strong vs random win rate | < 90% (the twist destroyed skill expression) |
| First-player win rate, strong vs strong | outside 35–65% |
| Draw rate, strong vs strong | > 60% |
| Mean game length | outside 4–200 plies, or any playout hitting the ply cap |
| Hard vs medium | < 60% (fake difficulty tiers) — warn at PR budget, fail nightly |
| Engine contract property suite | any failure (purity, determinism, encode∘decode, legality coherence, no `Math.random`) |
| Redaction contract test | serialized `playerView` ever contains an opponent secret |
| Bundle budget | game route > 75 kB gz, or catalog route grew |
| a11y (axe + Playwright smoke) | any critical violation |

A game may declare an intentional exception (e.g. deliberate role asymmetry) in its
manifest with a justification string, visible in review.

**Design gate — Fable review, human judgment** (from the game-theory pass): first-player
win rate 45–55% raw or after a balancing device · draw rate <10% · median 10–40 plies ·
MCTS-1k vs MCTS-100 ≥60% (search must keep paying) · ladder Elo spread ≥300 for a "skill"
slot · mirror bot <40% as P2 · stalling not rewarded · comeback fraction 20–60% ·
branching factor 4–30 · **strategy-description-length test** (if the winning strategy fits
in a googleable sentence, it dies on the open web) · rule sentence ≤90 characters ·
grayscale-screenshot test passes · cells ≥48 px at 320 px.

A game can pass CI and still be sent back. CI proves it isn't broken; the design gate
decides whether it's good.

---

## 7. Metrics, in priority order

1. **Share rate** — % of completed dailies whose artifact is copied. The growth engine. ≥8%.
2. **Games-tried-per-visit** — the library's whole reason to exist. ≥2.0 by month 3.
3. **D1 / D7 for daily-finishers** — 20–25% / 8–12% (anonymous web will undercut app
   benchmarks of ~32% / ~12%; treat those as ceilings).
4. **Authoring lead time per game** — the pipeline's health. ≤2 days median.
5. **Share of traffic from organic search** — the compounding channel.
6. K-factor proxy: new visitors landing on a shared-result URL ÷ sharers.

Break-even is ~100–300 sessions/day against near-zero hosting ($0 at 1k sessions/mo,
~$45–70 at 100k, ~$300–800 at 1M). Ad revenue realistically runs **$1.50–8 net per 1,000
sessions**. This is a low-cost, slow-compounding media asset with asymmetric upside — not
a fast business. Plan accordingly and don't let revenue pressure distort the game slate.

---

## 8. Standing risks

| Risk | Mitigation |
|---|---|
| Engine interface v1 too narrow at game N | Build three deliberately diverse games (perfect-info sequential, hidden-info, simultaneous+stochastic) **before freezing v1**; version the interface; store `engine_version` on every replay |
| Hidden-state leakage | Distinct view type `V`, single server redaction path, poke-then-fetch Realtime, RLS denying state/seed reads, contract test over random playouts |
| Content cadence collapse (game 12 takes three weeks) | Scaffold + platform hook own all plumbing; track authoring lead time and treat growth as an architecture bug, not an author problem |
| Bundle erosion | Per-route size budgets in CI; eager-manifest/lazy-everything registry; dependency additions to `games/*` require review |
| The flagship gets cloned | It already has been — that is why the moat is the library plus the ritual, never one game |
| Daily bot retuned silently | Pin tier, budget, seed, and `engine_version` per daily; changing them invalidates comparability and any leaderboard built on it |
| Async multiplayer scaling surprise | Pre-planned ladder: pooler → poke-over-poll → batched writes → archival; alert on connections, invocations, bandwidth before plan limits |

---

## 9. Decisions still owed by the user

1. **Site name + domain.** Candidates: "One Rule Off", "Twist Arcade", "Recess Remixed". No
   trademark clearance performed.
2. **Flagship name:** "Fadeout" (recommended) vs "Fade".
3. **Ads from month 2** on the end screen only — confirm.
4. **Single-player score twists deferred to Phase 3** — confirm, or accept an earlier
   harness fork.

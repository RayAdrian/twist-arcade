# Daily Twist, Share Artifact & Streaks — Implementation Plan (Fable, 2026-08-02)

*Team: `daily` (worktree `../claude-project-daily`, branch `feature/daily`, port block
54721–54729, Supabase: **not started** — Phase 1 is client + static assets only; record
stands in `docs/worktrees.md`).*

*Sources: `docs/roadmap.md` Phase 1 · `research/games/ux-lens.md` §3/§5/§10 ·
`research/games/market-lens.md` §4.1/§5 · `research/games/solo-games-lens.md` §3.7/§5/§6 ·
`plans/phase-0-platform-spine.md` §3.4/§5.2/§7.7 · `plans/fadeout.md` §9/§14 ·
`research/games/synthesis.md` §2.5. This plan produces no implementation code; it is the
input to CLAUDE.md §2 stages 2–6.*

**What this team ships:** the one site-wide Daily Twist (rotating across all eight launch
games), the share artifact system every game plugs into, and the single site-level streak.
Per the roadmap, the share artifact is the growth engine (share rate is metric #1, target
≥8%, pivot trigger <2–3%) and the daily is the retention spine. Everything here runs from
static assets + localStorage — no database, no server-rendered pages.

---

## 0. Two binding orchestrator decisions, stated up front

These are exceptions to site-wide rules and they govern everything below. Neither may be
"harmonized away" by an implementer.

**D1 — Series alternation is suspended in daily mode. The human is always P1.**
Site-wide, the shell alternates who moves first across a rematch series (the invisible
default balancing device, fadeout plan §4). **Not in the daily.** If half of players opened
the daily as P2, "won in 9" would compare two different games and the day's comparability
— the entire point of a daily — would be dead. Every daily manifest pins `humanSeat: 0`;
the daily integration must never route a daily game through the shell's alternation logic.
(Confirmed as fadeout §14 Q3; restated here because this team implements it.)

**D2 — No undo in any daily mode. Two-player dailies included.**
Undo is a solo-vs-bot *casual* learning tool (ux-lens §1) and stays there. In daily mode —
vs-bot, solo puzzle, and solo chase alike — undo is disabled and hidden (not greyed).
"Won in 9" and "solved in 23 (par 19)" are meaningless if moves are retractable.
**Restarts are allowed, counted, and carried in the result record.** The share artifact
must not silently present a fifth attempt as a first: whenever the first completion was
preceded by ≥1 restart, the artifact's result line carries `· attempt {k}` (see §5.3).

---

## 1. The Daily Twist mechanic

### 1.1 Shape

One site-wide daily. Each UTC calendar day has exactly one featured game with one pinned
configuration. The ritual attaches to the *brand*, not to any game (market lens §5). The
site-wide daily counter is **Daily #N**, where `N = daysBetween(DAILY_EPOCH, dayUTC) + 1`
and `DAILY_EPOCH` is the committed launch date (a constant in `packages/daily/src/day.ts`;
set at launch, then never changed).

Three daily kinds, matching the launch slate:

| Kind | Games | Comparable number | Pinned by |
|---|---|---|---|
| `vs-bot` | the six two-player games | "won in 9" | seed + pinned deterministic bot (§2) |
| `solo-puzzle` | Crackstep | "solved in 23 (par 19)" | certified seed + par (§3) |
| `solo-chase` | Mine Run | "340 pts in 250 moves" | certified seed + fixed move budget (§3) |

### 1.2 Rotation: authored as committed data, proposed by a generator

The authority is **one committed manifest file per day**: `data/daily/<yyyy-mm-dd>.json`
(schema §1.5). How those files come to exist:

- `pnpm daily:schedule --days 90` (build-time CLI in `packages/daily`) emits a
  **proposal** from a deterministic weighted-rotation policy:
  - Fadeout (flagship, the only oracle-audited game) at least 1×/week;
  - every launch game at least once per 14 days;
  - Crackstep 1–2×/week, Mine Run ~1×/week; no game twice in a row; no two solo days
    in a row (the two-player ritual is the launch thesis);
  - a solo game is only ever scheduled on a day for which a valid certificate exists
    (the generator reads `data/certificates/` and refuses otherwise).
- A human **hand-curates** by editing the proposed files before commit (swap a day, pin a
  launch-week sequence, feature a new game on its drop day). The generator is
  deterministic and idempotent over already-committed days: it never touches an existing
  file, only appends future days. Curation is therefore an ordinary reviewed diff.

This is "hand-curated with a round-robin safety net": the site never depends on a human
remembering to schedule, and a human can always override what ships.

**Buffer policy (mirrors the certificate buffer, platform §7.7):** ≥90 days of manifests
committed at all times; CI alerts below 30, hard-fails below 7. A missing day is a
build-time problem, never a 6 a.m. incident.

### 1.3 UTC day boundary and mid-game rollover

- The daily day **is the UTC calendar date** — the same date that feeds the seed formula
  (§2.1). One clock, one truth. (Streak consequences for non-UTC players: §6.2.)
- **A daily binds to its day at game start, not at completion.** When a player starts
  Daily #37, the manifest (day, N, seed, bot record / certificate subset) is copied into
  the in-progress localStorage record. Rollover mid-game changes nothing: the player
  finishes #37 as #37 — same seed, same bot, same par — and the completion counts as #37
  for the artifact and the streak, regardless of wall-clock time at completion.
- A fresh page load after rollover resolves the *new* day. An unfinished previous daily
  remains resumable from its stored record ("Finish yesterday's Twist" affordance on the
  daily entry point) and completes as its own N. Unfinished dailies older than 7 days are
  garbage-collected.
- Nothing force-quits, nothing expires under the player's finger.

### 1.4 Static resolution — the daily page is edge-cacheable

No server renders "today". The mechanism:

1. The daily page (`/daily`, and the home hero) is **fully static** — same HTML for every
   visitor on every day. It contains no baked-in "today".
2. The client computes the current UTC date (`new Date()` → UTC components — no timezone
   library needed) and fetches `/data/daily/<yyyy-mm-dd>.json` as a plain static asset.
3. Because the **URL is date-keyed and each file's content never changes** (§2.4
   immutability), every manifest is served with `Cache-Control: public, max-age=31536000,
   immutable`. There is nothing to invalidate, ever — tomorrow is simply a different URL.
   The CDN serves the whole daily system from edge cache indefinitely.
4. Deploys are only needed to *extend the buffer*, not to roll the day. With 90 days
   committed, the site rolls dailies for three months with zero deploys.

OG/unfurl: Phase 1 keeps the game's generic OG (the rule sentence is the ad, ux-lens §5).
Per-day OG images ("Daily #37") would need per-day rendering — a Phase 2 nicety, noted
and not built.

Client clock skew: a device with a wrong clock gets the wrong day's manifest and plays it
as that day. Accepted — harmless, self-inflicted, and the manifest's embedded `day`/`n`
keep the record internally consistent.

### 1.5 The `DailyManifest` schema

```ts
// packages/daily/src/manifest.ts
export interface DailyManifest {
  day: string;                 // "2026-09-14" (UTC) — must match the filename
  n: number;                   // Daily #N — CI asserts n === dailyNumber(day)
  gameId: string;
  kind: "vs-bot" | "solo-puzzle" | "solo-chase";
  seed: string;                // vs-bot: dailySeed(gameId, engineVersion, day) exactly;
                               // solo: the CERTIFIED seed (formula + ":" + nonce, §3.1)
  engineVersion: string;       // pinned — also an input to the seed formula
  gameVersion: number;

  bot?: DailyBotRecord;        // vs-bot only — the pinned opponent (§2.2)
  puzzle?: {                   // solo-puzzle only — PUBLIC certificate subset (§3.2)
    par: number;
    parKind: "optimal" | "best-in-budget";
    difficulty: "gentle" | "standard" | "mean";   // band label from the z-score
    guessFree?: boolean;       // fog games
  };
  chase?: { moveBudget: number };  // solo-chase only — e.g. Mine Run's 250 moves
}
```

The manifest is deliberately **self-contained**: the client needs this one fetch (plus the
game bundle it already loads) to play the daily. No secondary lookups on the play path.

---

## 2. Seed derivation and the comparability contract

### 2.1 The seed — public and offline-computable

```
dailySeed(gameId, engineVersion, dayUTC) =
  sha256("daily:" + gameId + ":" + engineVersion + ":" + yyyy-mm-dd(dayUTC))   // hex
```

Implemented in `packages/daily/src/seed.ts` over Web Crypto (`crypto.subtle.digest`) —
works in browser, worker, and Node ≥20 alike. Golden-vector tests pin exact outputs for
fixed inputs; like the platform Rng (§3.4 there), **this formula is a wire format** —
changing it orphans every committed manifest and certificate, so it is frozen from day
one and ADR-only thereafter.

Two properties this buys:

- **Anyone can verify** today's seed with ten lines of code — the daily is provably not
  rigged per-player.
- `engineVersion` in the formula means an engine version bump *changes the seed* — a new
  engine era is automatically a new seed era, never a silent behavioral shift under an
  old seed. (Consequence: an engine bump invalidates the not-yet-shipped tail of the
  manifest buffer and the certificate buffer; both get regenerated. Platform §7.7 already
  states this for certificates; it holds identically for manifests.)

### 2.2 The pinned bot — a stored, versioned artifact, not a runtime default

The same seed is **not sufficient** for a two-player daily. "Won in 9" is comparable only
if every player faced the identical opponent making the identical moves. The opponent is
therefore a **record, stored and versioned**, never "whatever the Standard tier happens
to be today":

```ts
// data/daily/era.json — one entry per two-player game; the review point for any change
export interface DailyBotRecord {
  era: number;                  // monotonically increasing per game; bumped on ANY change
  tier: "standard";             // fixed (fadeout §14 Q3: Standard, not Ruthless)
  policy: PolicySpec;           // resolved copy — e.g. { kind: "mcts" }
  budget: { kind: "rollouts"; n: number };   // NEVER deadlineMs — see below
  blunder: { epsilon: number; temperature: number } | null;  // frozen ε/τ, if any
  botsVersion: string;          // @twist-arcade/bots package version — the search
                                // implementation is part of the bot's behavior
  humanSeat: 0;                 // D1: human always P1; alternation suspended
}
```

Each day's manifest **embeds a resolved copy** of the record (self-contained client) and
names its `era`; CI asserts the embedded copy is byte-identical to `era.json` for that
era. The bot's policy RNG seed is derived from the daily seed exactly as the worker host
already does (`rngFor(seed + ":bot", step)`, platform §6) — no second seed to pin.

**Why `rollouts` and never `deadlineMs`** (platform §5.2, inherited constraint): a
wall-clock budget plays differently on a fast laptop than a slow phone — same seed, same
tier, different moves — which silently destroys the day's comparability. Fadeout already
uses `rollouts` for all tiers (fadeout §6), so pinning is satisfied by construction. The
daily code **asserts `budget.kind === "rollouts"` at manifest load and refuses to start
a daily otherwise** — a typed, loud failure, not a fallback.

### 2.3 What breaks if any pinned field changes silently — and how we make silent impossible

If `tier`, `budget.n`, `blunder`, `botsVersion`, `engineVersion`, `humanSeat`, or the
seed derivation changes without a new era: **every result recorded that day becomes
incomparable with every other** — two players who both "won in 9" may have beaten
different opponents — and any leaderboard ever built on that day (Phase 3) is
retroactively meaningless. This is roadmap standing-risk "Daily bot retuned silently,"
and the defense is structural, not procedural:

1. **Era snapshot test** — a committed vitest snapshot of `era.json`. Any edit fails CI
   unless the `era` number was bumped in the same diff and a line added to
   `data/daily/CHANGELOG.md`. A bot change is thereby always a visible, reviewed event.
2. **Manifest immutability guard** — CI diffs `data/daily/*.json` against `main` and
   **hard-fails if any file whose `day` ≤ today-at-build changes at all** (byte-diff).
   Shipped days are frozen forever; era bumps apply only to not-yet-shipped days.
3. **Formula re-derivation** — CI recomputes `dailySeed(...)` for every `vs-bot` manifest
   and asserts equality with the stored `seed`; asserts `n === dailyNumber(day)`;
   asserts `budget.kind === "rollouts"` and `humanSeat === 0`.
4. **Cross-machine determinism check** (needs M2) — nightly, replay the pinned bot on a
   fixed manifest twice through the worker host and assert identical move sequences.
   This is the platform's determinism contract, pointed at the daily's exact config.

What the system does on detection: the build fails. The fix is always "bump the era for
future days" — never "edit history."

---

## 3. The solo daily — seed + certificate + par

A different shape: there is no opponent to pin. The opponent is the position itself, and
it ships with a machine-checked proof of fairness (solo-games-lens §0).

### 3.1 Where the artifacts come from

`harness certify` (platform §7.7) runs the generate → exact-solve → reject → store loop
offline at build time and commits `data/certificates/<gameId>/<yyyy-mm-dd>.json`. Two
facts this team consumes:

- The **certified seed is not the raw formula output** — it is
  `dailySeed(...) + ":" + nonce`, where the nonce counts rejected candidates. The
  manifest's `seed` field carries the certified seed verbatim; the client uses it as-is
  and never re-runs the rejection loop.
- **Par is L*** from the certificate (`parKind` distinguishes proven-optimal from
  best-in-budget; a player beating a best-in-budget par is an achievement to celebrate
  in copy, never treated as an error).

### 3.2 What reaches the client, what is shown, what is withheld

The certificate contains the **solution** (`moveLog`) and solver diagnostics. None of
that ships on the play path. The manifest embeds only the public subset (§1.5 `puzzle`
block): **par, parKind, difficulty band label, guessFree**.

Shown before play: `Daily #37 · par 19 · difficulty: standard` (par is the hook — a
challenge with a machine-guaranteed answer, solo lens §6). For Mine Run: the move budget
("best score in 250 moves"). Withheld: the move log, solver features (greedy gap, forced
moves — they are hints), and anything positional.

Post-completion struggle-shape (🟩🟨🟥, §5): computed **client-side after completion** by
re-running the game's own solver against the player's log (Crackstep's DFS solves these
boards in milliseconds; `loadSolver()` exists in the registry). If a future puzzle
game's solver is not client-affordable, its artifact degrades to moves-vs-par only —
the grammar rule, not the solver, is the contract.

Honesty note: the repo (and therefore the full certificates) may be public. A determined
player can look up the solution — the same class as looking up today's Wordle (§8). We
don't hand it to the client bundle; we don't pretend it's a secret.

### 3.3 Missing certificate — the failure mode

**The answer is never "ship it uncertified"** (roadmap §6: one unsolvable daily ruins the
day for everyone at once). Defense in depth, ordered so runtime never sees the failure:

1. **Schedule-time:** the rotation generator refuses to schedule a solo game on a day
   without a stored, valid certificate (§1.2).
2. **Build-time:** CI runs `verifyCertificate` (replays the certificate's move log
   through the engine) for every solo manifest in the buffer; asserts the manifest's
   public subset matches the certificate; the existing buffer gates (alert <30 days,
   fail <7) apply.
3. **Runtime (should be unreachable):** if the solo daily's assets still fail to load or
   an assertion trips, the client falls back to a **vs-bot Fadeout daily derived purely
   client-side** — seed from the public formula for today, bot record from the bundled
   `era.json` copy. The fallback needs zero per-day artifacts, so it cannot itself be
   missing. The failure is logged as a metric event (`daily_fallback`), because if this
   ever fires, the build gates have a hole.

---

## 4–5. The share artifact system

### 4.1 Ownership (ux-lens §5/§10, platform §5.3 — restated as the contract)

- **The shell owns the frame:** header line (glyph, title, daily header, result), stat
  line placement, URL line, and the share-sheet/clipboard plumbing (`ShareCard`).
- **The game owns the body:** `shareArtifact(record: ReplayRecord, finalView: V)` returns
  the emoji move-timeline body only, plus the game's ≤40-char stat line.
- **This team owns the composer** — the pure function that assembles frame + body and
  validates the result — shipped in `packages/daily/src/share.ts` and consumed by the
  shell's `ShareCard`:

```ts
export interface ShareInput {
  glyph: string;               // per-game emoji (table in packages/daily — see note)
  title: string;               // manifest title, e.g. "Fadeout"
  mode: { kind: "casual" } | { kind: "daily"; n: number };
  result: string;              // "won in 9 🏆" | "lost in 12" | "solved in 23 (par 19)"
                               //   | "340 pts in 250 moves"
  attempt: number;             // restarts + 1 at first completion (D2); 1 = clean
  body: string;                // game-supplied, validated (§4.2)
  statLine: string;            // game-supplied, ≤40 chars
  url: string;                 // "twistarcade.game/d/{gameId}" — plain path, no params
}
export function composeShareText(input: ShareInput): string;  // throws on violations
```

*Per-game glyph note:* game manifests have no emoji field, and `game-spec` is a frozen
platform-owned seam. Rather than force a contract change, the glyph table
(`gameId → emoji`: ❌ Fadeout, 🧊 Crackstep, 💣 Mine Run, …) lives in `packages/daily`
for Phase 1. Proposing a `shareGlyph` manifest field is queued for the orchestrator as a
nice-to-have (§11).

### 4.2 The frame format and the family grammar

Exact layout (≤7 lines total, plain text, no markdown — must render in a notification):

```
{glyph} {title} — Daily #{n} · {result}[ · attempt {k}]     ← daily mode
{glyph} {title} — {result}[ · attempt {k}]                  ← casual mode
{body: 1–2 lines}
{statLine}
{url}
```

**Emoji grammar rules — what keeps 100 games recognizably one family:**

1. One glyph per move/decision, strictly chronological. Never a board snapshot, never
   positions, never directions (spoiler-free: the reader sees *rhythm*, not answers).
2. **💨 is the house glyph** — every decay/vanish event across every game (Fadeout
   vanish, rotted apple, crumbled tile, re-fogged cell). One glyph, one meaning,
   library-wide. It is the brand made visible in a group chat.
3. Reserved terminals: 🎯 = the game-ending winning move (whoever made it);
   ☠️/💥 = terminal failure/restart. Solo-puzzle struggle shape: 🟩 on-optimal ·
   🟨 detour · 🟥 made-unsolvable · ✅ solved. 🏦 = banked (press-your-luck).
4. Seat glyphs are the game's two player glyphs (❌/⭕ for the TTT family).
5. Single codepoints or simple emoji only — no ZWJ sequences, no skin-tone modifiers
   (rendering safety across chat apps).
6. The composer **validates**: body ≤2 lines, ≤14 glyphs per line, only glyphs from the
   family alphabet plus the game's declared seat glyphs; stat line ≤40 chars; total
   ≤7 lines and ≤320 characters including the URL. Violations throw in dev and are a
   test failure — a game cannot drift the family grammar silently.
7. Long games truncate from the front: if a timeline exceeds 28 moves, keep the final
   28 with a leading `…` (the endgame is the drama).

**Attempt honesty (D2):** `attempt` comes from the daily result record's restart counter
(§7.1). When `attempt > 1`, the header carries `· attempt {k}` — visible, small, honest.
Practice replays after the first completion never regenerate the artifact (§7.2), so the
artifact always describes the first completion.

### 4.3 Share paths

Mobile: `navigator.share({ text })` — the native sheet; resolution = a completed share,
rejection = cancel (measurable, §10). Desktop / no Web Share API:
`navigator.clipboard.writeText` + a "Copied!" confirmation. Final fallback: a selectable
text box. All plumbing lives in the shell's `ShareCard`; this team supplies the text and
the metric hooks.

### 4.4 Three literal artifacts

**Two-player daily win (Fadeout, clean first attempt):**

```
❌ Fadeout — Daily #37 · won in 9 🏆
❌⭕❌⭕❌💨⭕❌🎯
pieces faded: 2 · longest-lived X: 5 turns
twistarcade.game/d/fadeout
```

**Two-player casual loss (Fadeout — no daily header, no #):**

```
❌ Fadeout — lost in 12
❌⭕❌⭕💨⭕❌💨⭕❌⭕🎯
pieces faded: 4 · longest-lived X: 3 turns
twistarcade.game/d/fadeout
```

**Solo daily with par (Crackstep, one restart — note `attempt 2`):**

```
🧊 Crackstep — Daily #37 · solved in 23 (par 19) · attempt 2
🟩🟩🟩🟨🟨🟩🟩🟥💥
🟩🟩🟩🟩🟩🟨🟨🟩🟩🟩🟩🟩🟩🟩✅
1 restart · the floor crumbles behind you
twistarcade.game/d/crackstep
```

Every 💨/💥/🏦 in a group chat is a question mark; the rule sentence in the link's OG
description is the answer. The artifact is the ad; the URL closes the loop.

---

## 6. Streaks

### 6.1 The decision, restated with its reason

**One streak, site-level: "played today's Twist." localStorage. No account.** Per-game
streaks are rejected outright (roadmap Phase 1, market lens §5): with a dozen-plus games,
per-game streaks become a wall of guilt-debt — a dashboard of dying flames that punishes
sampling the library, which is the exact behavior (games-tried-per-visit ≥2.0) the
product needs. One streak makes the *ritual* the habit, not any game. Any future
implementer proposing per-game streaks is proposing churn.

### 6.2 Record shape and rules

```ts
// localStorage key "ta:streak:v1"
export interface StreakRecord {
  current: number;         // consecutive dailies played
  best: number;
  lastDailyN: number;      // highest daily # ever completed
  lastDay: string;         // that daily's UTC date (display/debug)
}
```

The reducer is pure (`streak.ts`, fully unit-tested) and keyed on **daily numbers, not
local dates** — which makes the timezone rule exact:

- On completion of daily N: `N === lastDailyN` → no-op (repeat play).
  `N === lastDailyN + 1` → `current++`. `N > lastDailyN + 1` → `current = 1`.
  `N < lastDailyN` (finishing a resumed old daily after a newer one) → no change.
  Always `lastDailyN = max(N, lastDailyN)`, `best = max(best, current)`.
- **The day is UTC because the seed is UTC** — one clock everywhere. For a player in
  Manila (UTC+8) the daily rolls at 8:00 AM local: playing at 7 AM plays *yesterday's*
  Twist; playing at 9 AM plays today's. Because the streak counts consecutive daily
  *numbers*, both count correctly — an every-morning-at-7 player and an
  every-morning-at-9 player each play one daily per day and hold their streaks. The only
  way to break a streak is to skip a daily number entirely. The UI never shows dates,
  only "Daily #N" and the countdown to the next one, so the 8 AM boundary reads as "when
  the next Twist drops," not as a wrong-timezone bug.
- **"Played" means completed** — the game reached a terminal status (won, lost, drawn,
  solved, failed, or scored at the move budget). A loss counts: the streak is "played
  today's Twist," not "won it." Starting and abandoning counts for nothing. Restarts
  don't matter to the streak (only completion does); undo doesn't exist here (D2).
- Rollover grace is inherent: a daily started before rollover and finished after counts
  as its own N (§1.3) — no player loses a streak to a slow game.

### 6.3 Streak repair — the question, answered

**No repair mechanic in Phase 1.** Reasons on the record: (a) repair monetizes or
gamifies *obligation* — the exact guilt-debt this design rejects; (b) with
localStorage-only persistence, a streak already dies to a cleared cache or a new device,
so "repair" would be theater on top of fragile storage; (c) there is no account, no
payment, and no server to arbitrate it. The honest posture: streaks are lightweight
local pride, stated as such. The known future home: Phase 3's account claim carries
cross-device streaks, and the supporter tier's "streak insurance" (market lens §6) is
where a repair-shaped feature may legitimately live — behind an account, as a kept
promise rather than a guilt tax. Until then: a broken streak is a broken streak, and
`best` is retained forever, which is the consolation the UI leans on ("best: 21").

Display rule: the flame line ("🔥 4-day Twist streak") appears at `current ≥ 2`; day one
shows "Played today ✓".

---

## 7. End-of-game and pre-play integration

This team does **not** build the result modal, the hero, or `useGame` — the shell does
(ux-lens §10). This team contributes a defined slice through a seam agreed with the shell
team via the orchestrator (CLAUDE.md §4 — shared contract, never sideways). The proposed
seam:

### 7.1 `useDaily()` — the daily slice the shell consumes

```ts
export interface DailyState {
  manifest: DailyManifest | null;      // today's, resolved per §1.4
  status: "not-started" | "in-progress" | "done";
  firstResult?: DailyResult;           // frozen at first completion
  streak: StreakRecord;
  nextTwistInMs: number;               // countdown to UTC midnight
}
export interface DailyResult {
  n: number; day: string; gameId: string;
  result: Status;                      // engine terminal status
  moves: number;
  restarts: number;                    // D2 — restarts before first completion
  replay: ReplayRecord;                // kept for Phase 3 verification (§8)
  artifactText: string;                // composed once, frozen
}
// localStorage: "ta:daily:<yyyy-mm-dd>" → DailyResult; "ta:streak:v1" → StreakRecord
```

**First-completion binding:** the artifact, the streak credit, and `DailyResult` freeze
at the **first completion** of a day's daily. Replaying the same daily afterward is
allowed and framed as **practice** ("Practice run — your Daily result is locked in"):
no new artifact, no streak effect, no result overwrite. This closes retry-scumming of
the share artifact at the UX level (the localStorage-editing cheater is §8's business).
Restarts *before* the first completion increment `restarts` and surface as
`attempt {restarts+1}` (§4.2).

### 7.2 What the daily contributes to the shell's ResultModal

The modal's priority order (result → Rematch → Next twist → Share, ux-lens §5) is
preserved; in daily mode the slots fill differently:

1. **Result + texture line** — unchanged (game-supplied).
2. **Rematch** → relabeled **"Play again (practice)"** after first completion.
3. **Next twist** — unchanged (the daily should feed games-tried-per-visit too), plus
   the **come-back-tomorrow line**: "Next Twist in 9h 14m" (live countdown to UTC
   midnight, from `nextTwistInMs`).
4. **Share** — the daily artifact (`artifactText`, with the Daily #N header).
5. **Streak line** replaces the casual "3 games today" line: "🔥 4-day Twist streak"
   (or "Played today ✓").

Also contributed: daily-mode flags the shell must honor — **hide Undo entirely (D2)**,
**pin the human to P1 / suppress series alternation (D1)**, count Restart presses into
`restarts`.

### 7.3 Pre-play entry point — the home hero

The hero (ux-lens §11-A) is shell chrome; this team supplies its data and states:

- **Not started:** "TODAY'S GAME · Daily #37" badge · game title · rule sentence · the
  live hero board (first tap plays the move and enters the game page) · "▶ Play today's
  game". Streak flame shown beside the badge when `current ≥ 2`.
- **In progress:** "Continue today's Twist" (and "Finish yesterday's Twist" if an old
  in-progress record exists, §1.3).
- **Done:** "Done for today ✓ · won in 9" · Share button (same frozen artifact) ·
  "Next Twist in 9h 14m". The hero never nags; done is a calm state.

---

## 8. Anti-cheat posture for dailies — stated honestly

**The daily seed is public by design** (§2.1 is a feature, not a leak). Consequences,
accepted and designed for rather than fought:

- **A determined player can simulate ahead**: compute tomorrow's seed (or fetch
  tomorrow's committed manifest — the 90-day buffer is public static data), practice
  against the pinned bot offline, or read a solo certificate's solution out of the repo.
  This is the same posture as Wordle, whose answer list shipped in its bundle for years
  while it conquered the world. For a free casual site with no prizes, the cost of
  *preventing* this (server-held seeds, server-mediated moves) is a server on the hot
  path of every solo move — breaking the $0 static architecture for a threat the product
  shape already defangs. Tolerated, on the record.
- **What is verifiable, mechanically:** given `(gameId, engineVersion, gameVersion,
  seed, moveLog)` — the `ReplayRecord` this team already stores per completion (§7.1) —
  the pure engine replays the entire game: every move's legality, the terminal status,
  the move count, the bot's moves (deterministic from the pinned record), all generated
  content (deterministic from the seed), and moves-vs-par. **The claimed result is
  always discardable; the replay is the result.** This is the platform's verification
  model (platform §3.3, solo lens §5) and the reason `DailyResult.replay` exists now,
  two phases before anything reads it.
- **What is not verifiable, ever:** wall-clock time (never ranked on — site rule), who
  or what played (a solver-assisted run is indistinguishable from brilliance; on a
  puzzle daily it is *exactly par*, every day), local attempt count beyond what the
  client honestly reports, and fog integrity on client-held state (devtools sees mines).
- **The design line: the dishonest case cannot corrupt the honest players' experience.**
  In Phase 1 this holds by construction — there is no shared surface. A cheater's
  forged artifact is text in their own group chat, exactly as forgeable as typing a fake
  Wordle grid, and socially self-limiting the same way. Streaks are local pride; a
  localStorage editor is lying to nobody but themselves. In Phase 3, leaderboards keep
  the line by: accepting **only server-verified replays** (kills forged-score spam — the
  load-bearing 90%), per-seed daily boards reset daily, **percentile framing over rank
  framing** (a handful of solver-assisted par runs distort ranks 1–10, barely move
  percentiles), friend boards as the primary competitive surface, and quiet
  flag-and-exclude for statistical outliers. No anti-cheat department — the roadmap's
  words — because the architecture spends its integrity budget where it pays: replay
  verification, which is already free.

---

## 9. What ships without a server — and the Phase 3 seam

Phase 1 has no database (worktrees registry: `Supabase: not started`). The complete
runtime inventory:

**Static assets (committed, immutable, edge-cached):**
- `data/daily/<yyyy-mm-dd>.json` — daily manifests, ≥90-day buffer
- `data/daily/era.json` + `CHANGELOG.md` — pinned bot records (also bundled for the §3.3
  fallback)
- `data/certificates/<gameId>/<day>.json` — certificates (platform-owned; only public
  subsets ever reach the play path)

**Client-side computation:** UTC day + Daily #N · seed derivation (Web Crypto) ·
manifest fetch + assertions (rollouts, humanSeat, seed match) · streak reducer · share
composer · post-completion solver diff (struggle shape).

**localStorage:** `ta:streak:v1` · `ta:daily:<date>` (first-completion results incl.
replays) · in-progress daily state · metric dedup guards (§10).

**What moves server-side in Phase 3 — extension seams, so nothing is rewritten:**

| Concern | Phase 1 | Phase 3 | The seam that makes it extend-only |
|---|---|---|---|
| Manifest source | static `/data/daily/…` fetch | same JSON from an API route (or stays static) | `loadDailyManifest(fetcher)` takes the fetcher; schema unchanged |
| Result submission | `DailyResult` stored locally | POST `replay` → server re-runs engine → leaderboard row | the payload **is** the already-stored `ReplayRecord` — shaped for verification since day one |
| Comparability line | "won in 9" | + "top 18%" percentile in artifact header | composer's `result` string gains a segment; frame unchanged (solo lens §6 already shows the format) |
| Streaks | localStorage | account-claimed via Supabase `linkIdentity` on the same anonymous id | `StreakRecord` uploads verbatim; reducer unchanged |
| Certificates | committed JSON | Postgres buffer (platform Q2) | `DailyCertificate` schema explicitly designed to survive the move |
| First-view stamps | none | server stamps first view of a day's seed | additive endpoint; no client rewrite |

The rule this table enforces: **Phase 3 adds readers and writers around the same
artifacts; it never changes their shape.**

---

## 10. Metrics instrumentation — the number must be computable

**Share rate is the single most important number in the product** (roadmap metric #1:
≥8% target, <2–3% after a real spike = pivot trigger). A metric nobody can compute is
not a metric, so this section specifies the events, the collector, and the arithmetic.

### 10.1 Events (client-fired, deduped via localStorage guards)

| Event | Fires | Once per | Props |
|---|---|---|---|
| `daily_start` | first move of a day's daily made | device × daily N | `gameId, kind, n` |
| `daily_complete` | first completion (terminal status) | device × daily N | `gameId, kind, n, result, moves, restarts` |
| `share_open` | Share button tapped (any surface) | — (counted, but rate uses `share_done`) | `gameId, mode` |
| `share_done` | `navigator.share` resolved OR clipboard write succeeded | device × daily N (daily mode) | `gameId, mode, path: "native" \| "clipboard"` |
| `daily_fallback` | §3.3 runtime fallback engaged | — | `day, reason` |

Dedup matters: without the once-per-device-per-N guard, one enthusiast sharing to three
chats inflates the growth metric. `share_open` vs `share_done` also splits "the button
is findable" from "the artifact got out" — a diagnostic pair when the rate disappoints.

### 10.2 Where events go with no backend

**Vercel Web Analytics custom events** (`track(name, props)`) — a platform feature of
the host we already deploy on, zero server code of ours, no cookies, no PII. **Caveat
flagged for the orchestrator (§11 Q1):** custom events require a paid Vercel Analytics
tier; if the plan doesn't carry it at launch, the designated fallback is **GoatCounter
(free) or Plausible (~$9/mo)** — both are a `<script>` + a pixel endpoint, both count
custom events, both give a queryable dashboard. The adapter in
`packages/daily/src/metrics.ts` is ~30 lines and collector-agnostic (`track()` facade),
so the choice is a config swap, not a rewrite. What is **not** acceptable: launching
with no collector — the pivot trigger would be unevaluable, which is flying blind on
the product's #1 bet.

### 10.3 The arithmetic

```
share_rate(window) = unique share_done (mode=daily) / unique daily_complete, same window
```

Computed directly in the collector's dashboard (both events carry `n`; the window is
typically per-day or trailing-7). Reviewed weekly against the roadmap thresholds; the
<2–3%-after-a-spike pivot check is evaluated on the first ≥10k-visit day
(`daily_complete` volume confirms the spike reached the daily at all — a spike with
traffic but no completions is a *funnel* problem, not an artifact problem, and the pair
of numbers distinguishes those).

K-factor proxy (roadmap metric #6): the artifact URL stays clean (no `?ref=` — the plain
path *is* the design, §4.2), so the proxy is external-referrer landings on `/d/<gameId>`
divided by `share_done` — weaker than a tagged link, accepted as the price of an
artifact that looks like a note from a friend rather than a tracking payload.

---

## 11. Sequencing, dependencies, and open questions

### 11.1 Stages

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **DY0 — now** (no platform deps) | `packages/daily` scaffold: `day.ts` (epoch, N), `seed.ts` + golden vectors, `manifest.ts`/`era.ts` schemas + assertions, `streak.ts` reducer (full TDD), `share.ts` composer + grammar validator (TDD against §4.4's literal artifacts as fixtures), `metrics.ts` facade, rotation generator + `daily:schedule` CLI (against fixture certificates) | nothing | everything below |
| **DY1 — CI guards** | Era snapshot test · manifest immutability diff-guard · formula re-derivation job · buffer alert/fail thresholds · manifest↔certificate cross-checks | DY0 (+ M3d for real certificates; fixture certs until then) | the comparability contract is enforced, not aspirational |
| **DY2 — pinned-bot verification** | Assert-rollouts at load · cross-machine determinism nightly (worker host replay ×2 ⇒ identical moves) · Fadeout era record authored (Standard/rollouts-1000 per fadeout §6, pending F4 tuning) | **M2** (bots, worker host) | vs-bot dailies trustworthy |
| **DY3 — shell integration** | `useDaily()` slice · ResultModal contributions (streak line, practice relabel, countdown, share text, D1/D2 flags) · home-hero states · ShareCard wiring | **shell team's `useGame` + `ResultModal` + `ShareCard`** (seam agreed via orchestrator) | playable daily end-to-end |
| **DY4 — solo daily** | Manifest `puzzle`/`chase` blocks live · public-subset extraction · client-side struggle-shape diff (Crackstep solver) · §3.3 fallback path + test | **M3d** (certificates) + Crackstep team's engine/solver | solo daily days schedulable |
| **DY5 — metrics + launch checks** | Collector wired (per Q1 decision) · event dedup guards · dashboard queries documented · full E2E: cold load → play daily → share → streak, on a mid-tier phone | DY3, collector decision | Phase 1 exit criteria measurable |

DY0 is pure TypeScript with zero platform imports except types — **it can start today**
and is where all the TDD-able logic lives. DY1 runs on fixture data until M3d lands.
DY2 and DY4 parallelize. The long pole is DY3, gated on the shell team.

### 11.2 Dependency summary (what needs which milestone)

- **M1** (contract/types): `ReplayRecord` type import, manifest typing against
  `PolicySpec`/`SearchBudget`. Thin — DY0 can stub the types and re-point on merge.
- **M2** (bots/worker): DY2's determinism verification; the pinned bot exists at all.
- **M3d** (certificates): DY4; real data for DY1's cross-checks; solo days in rotation.
- **Shell `useGame`/`ResultModal`/`ShareCard`:** DY3. The seam (§7.1–7.2) needs shell-team
  agreement routed through the orchestrator — no shell plan exists yet in `docs/plans/`,
  so this contract should be on the shell planner's inputs list.
- **Fadeout F2/F4:** Daily #1's *content* needs a green Fadeout and its tuned Standard
  tier; none of the daily *machinery* does.

### 11.3 Open questions for the orchestrator (none block DY0–DY2)

1. **Metrics collector:** confirm Vercel Analytics custom-events tier at launch, or
   authorize the GoatCounter/Plausible fallback (§10.2). Needed before DY5; the facade
   makes the swap cheap, but launching without *a* collector is not an option.
2. **Shell seam:** bless §7.1–7.2 as the daily↔shell contract and put it on the shell
   planner's inputs list (CLAUDE.md §4 routing). Includes the two daily-mode flags the
   shell must honor: no-undo (D2) and P1-pinned/no-alternation (D1).
3. **`DAILY_EPOCH`:** confirm Daily #1 = public launch day (proposed), set the constant
   at launch, freeze forever.
4. **`shareGlyph` manifest field:** nice-to-have contract addition vs. the local table
   (§4.1). Zero urgency; the local table ships either way.
5. **Practice-replay framing** (§7.1): confirm "practice, result locked at first
   completion" as the site-wide daily-replay rule.

### 11.4 Risks

| Risk | Mitigation |
|---|---|
| Daily bot retuned silently (roadmap standing risk) | Era snapshot test + manifest immutability guard + formula re-derivation + nightly determinism check (§2.3) — silent is structurally impossible on CI-green main |
| `deadlineMs` sneaks into a daily config | Load-time assertion refuses to start the daily; CI asserts on every manifest |
| A day ships with no manifest / no certificate | 90-day buffers with alert-30/fail-7 for both; generator refuses uncertified solo days; runtime fallback (§3.3) as the last net — and `daily_fallback` firing is itself an incident signal |
| Share artifact drifts off-family as games multiply | Composer validates grammar/lengths and throws; the alphabet is code, not convention |
| Artifact inflation via retry (fifth attempt shared as first) | D2: restarts counted, `attempt {k}` in the frame, artifact frozen at first completion |
| Streak logic vs timezones confuses players | Streak keyed on daily numbers, not dates (§6.2); UI shows only #N + countdown |
| Shell seam churn (daily built against an unagreed contract) | §7 routed through orchestrator before DY3 starts; DY0–DY2 have zero shell deps |
| Share rate uncomputable at the moment it matters | Collector is a launch gate (Q1); events + dedup specified now, not improvised post-launch |

### 11.5 Definition of done (observable)

- [ ] `dailySeed` golden vectors green; a documented ten-line snippet reproduces today's
      seed offline.
- [ ] `pnpm daily:schedule --days 90` emits valid manifests honoring all rotation
      constraints; re-running touches zero existing files.
- [ ] CI: era edit without era bump fails; editing a shipped day's manifest fails; a
      manifest with `deadlineMs`, wrong seed, wrong `n`, or `humanSeat ≠ 0` fails; solo
      manifest without a verifiable certificate fails.
- [ ] Nightly determinism: pinned-bot replay ×2 ⇒ identical move sequences.
- [ ] The three §4.4 artifacts are literal test fixtures; composer reproduces them
      byte-for-byte; grammar violations throw.
- [ ] Streak reducer: property tests over completion sequences incl. rollover-grace,
      resumed-old-daily, gap, and repeat cases; Manila 7 AM/9 AM scenario is an explicit
      test.
- [ ] Daily E2E on a phone: cold load → hero → play → complete → modal shows streak line
      + countdown + share; share sheet carries the exact artifact; replay shows practice
      framing; Undo absent in daily mode; human is P1.
- [ ] Restart-then-complete daily produces `attempt 2` in the artifact.
- [ ] Fallback drill: delete today's manifest from a local build → client serves the
      formula-derived Fadeout daily and fires `daily_fallback`.
- [ ] Metrics: all five events observable in the collector from a real device;
      share-rate query documented and returning a number.
- [ ] `docs/worktrees.md` status updated; Supabase still `not started`.

---

## 12. Orchestrator decisions — addendum, 2026-08-02

Rulings on §11.3's open questions Q1–Q3. These are binding; the Sonnet implementer
inherits them as-is. (Q4 `shareGlyph` and Q5 practice-replay framing remain open and
non-blocking; the plan's defaults — local glyph table, practice-locked-at-first-completion
— stand until ruled otherwise.)

**Q1 — Metrics collector: Umami Cloud free tier, behind a provider-agnostic wrapper.**
Reasoning on the record: Vercel Analytics gates custom events behind a paid tier and the
site is pre-revenue; Cloudflare Web Analytics is free but has no custom events, which
makes it useless for share rate specifically; GoatCounter's free tier is intended for
non-commercial use and this site carries ads from month 2 — relying on it would be
leaning on a licence we are about to fall outside of. Umami Cloud's free tier supports
custom events, is open-source, and — the deciding factor — is **self-hostable on
Postgres**, so it can move onto our own Supabase instance in Phase 2 without changing a
single call site.

**The wrapper is the actual requirement, not the vendor.** Binding constraints on
`packages/daily/src/metrics.ts` (§10.2's facade, now sharpened):

- One `track(event, props)` module; **every** call site goes through it. No component
  anywhere may import an analytics SDK directly (lint-enforceable). Swapping providers
  must be a one-file change.
- **No personally identifying data in event props** — game ids, daily numbers, result
  kinds, counts; never names, emails, raw URLs with tokens, or anything device-unique
  beyond the collector's own anonymous accounting.
- **Events fire on completion, not on start** as the rate denominators (§10.1's table
  already keys share rate on `daily_complete`/`share_done`; this is now a stated rule,
  not an emergent property).
- The share event **distinguishes "artifact actually copied/shared" from "share sheet
  opened but dismissed"** — `share_done` fires only on `navigator.share` *resolution* or
  a successful clipboard write; a rejected share promise (user dismissed the sheet) is
  never `share_done`. Otherwise the number flatters itself. (§4.3 and §10.1 already
  encode this; it is confirmed as load-bearing.)

Operational note: the Umami Cloud account is created around **week 3**, alongside the
Vercel and Supabase accounts — tracked by the orchestrator as a **user-owned item**.
DY5's collector wiring depends on it existing.

**Q3 — `DAILY_EPOCH` = 2026-09-01 UTC.** Daily #1 falls on the launch window, so the
number in a share artifact is meaningful from day one rather than starting at #47
because the constant was set during development. **Frozen as a wire-format constant with
a golden vector, same discipline as the seed formula** (§2.1): changing it later
renumbers every artifact ever shared. Add to §11.5's checklist: golden test asserting
`dailyNumber("2026-09-01") === 1` and a spot value further out.

**Q2 — the `useDaily()` / ResultModal seam: approved**, routed to the shell team as an
input to their plan rather than this team specifying their internals. Scope line, made
explicit: this plan defines **the daily side precisely** — what the daily feature hands
the shell: the streak line, the daily-specific share artifact text, the
come-back-tomorrow state (countdown), the restart count / `attempt {k}`, and the two
daily-mode flags (D1 P1-pinned/no-alternation, D2 no-undo). The **shell-side contract
(component shape, slot mechanics, `useGame` integration) is an external dependency** on
the shell team's plan — this team does not design their components. §7.2's slot-by-slot
walkthrough is to be read as *what fills the slots*, not *how the modal is built*.

**Why the era-snapshot guard is shaped the way it is (orchestrator, recorded so it
survives review):** pinning the daily bot as a stored, versioned artifact with a
byte-diff immutability guard turns "someone retuned the bot and quietly invalidated a
week of results" from an invisible failure into a build break. That failure mode is
silent by nature — nothing errors, the numbers just stop meaning anything — so a
structural guard is the only real defence. Reviewers of future changes to §2.2–§2.3
should treat any weakening of these guards as removing the defence, not simplifying it.

# Architecture Lens — Free Browser Game-Variant Library

Research pass: systems architecture and engineering strategy for a website of free, short,
browser-based twists on classic games ("decay tic-tac-toe"), optimized for adding a new
game every 1–2 weeks. House stack assumed: Next.js 15 App Router + Supabase + TypeScript +
Tailwind/shadcn. Deviations flagged explicitly where they occur (spoiler: almost none —
the stack fits this product unusually well).

---

## 1. The core abstraction: the game engine interface

Everything downstream — bots, multiplayer, replays, the balance harness, anti-cheat —
hangs off one decision: **every game is a pure, deterministic state machine described by a
single TypeScript interface, with zero framework imports.** The engine package must run
identically in the browser, a Web Worker, a Node CLI, and a Next.js route handler.

### The interface

```ts
// packages/engine/src/types.ts — no imports from react/next/supabase, ever.

export type PlayerId = number; // 0-indexed seat, not a user id. Mapping seats→users is the platform's job.

export type Status =
  | { kind: "ongoing" }
  | { kind: "won"; winner: PlayerId }
  | { kind: "draw" }
  | { kind: "scored"; scores: number[] }; // for point-based variants

/** Deterministic PRNG handle. Engines NEVER call Math.random(). */
export interface Rng {
  next(): number;            // [0, 1)
  int(maxExclusive: number): number;
  shuffle<T>(xs: readonly T[]): T[];
}

/** Who must act right now. Covers sequential AND simultaneous games. */
export type ActiveSpec =
  | { mode: "sequential"; player: PlayerId }
  | { mode: "simultaneous"; players: PlayerId[] };

export interface GameMeta {
  id: string;                // "decay-ttt" — stable, used in URLs, DB rows, registry
  name: string;
  minPlayers: number;
  maxPlayers: number;
  hiddenInformation: boolean; // drives which multiplayer/anti-cheat path applies
  simultaneous: boolean;
  stochastic: boolean;        // any chance events after setup?
  version: number;            // bump on any rules change; replays store it
}

export interface GameEngine<S, M, V = S> {
  meta: GameMeta;

  /** Build initial state. All randomness (deck shuffle, starting player) via rng. */
  setup(numPlayers: number, rng: Rng): S;

  /** Legal moves for one player in this state. [] means that player cannot act. */
  legalMoves(state: S, player: PlayerId): M[];

  /** Cheap membership check — server-side validation calls this, not legalMoves(). */
  isLegal(state: S, player: PlayerId, move: M): boolean;

  /** Who acts next. For simultaneous games, all listed players submit before apply. */
  active(state: S): ActiveSpec;

  /**
   * The ONLY state transition. Takes the full set of moves for this step
   * (one entry for sequential, one per active player for simultaneous),
   * resolves chance via rng, then runs ALL automatic post-move transitions
   * (decay, gravity, cascades, forced captures) to a quiescent state.
   * MUST be pure: same (state, moves, rng stream) => identical result.
   * MUST NOT mutate its input.
   */
  apply(state: S, moves: ReadonlyMap<PlayerId, M>, rng: Rng): S;

  status(state: S): Status;

  /**
   * Redaction boundary for hidden information. Returns what `player` may see;
   * player === null is the spectator view. V must contain NO recoverable
   * secret of any other player — omit, don't mask (counts are fine: give
   * opponentHandCount, never opponentHand with nulled fields that leak length
   * of something secret, ordering, etc.).
   */
  playerView(state: S, player: PlayerId | null): V;

  /** Stable serialization for persistence/replay. JSON-safe. */
  encode(state: S): string;
  decode(encoded: string): S;

  /** Optional per-game evaluation for minimax bots; MCTS needs nothing. */
  heuristic?(state: S, player: PlayerId): number; // + good for player
}
```

### How each hard case maps onto this

- **Turn-based perfect info** (decay-TTT, most launches): `active()` returns
  `sequential`, `playerView` is the identity, `hiddenInformation: false`. The simple case
  costs nothing extra.
- **Simultaneous moves** (RPS variants, simultaneous-placement games): `active()` returns
  `{ mode: "simultaneous", players }`. The *platform* collects commitments — each player's
  move is held (server-side, or hash-committed client-side for hotseat honesty) until all
  active players have submitted, then a single `apply(state, movesMap, rng)` resolves
  them atomically. The engine never sees a half-submitted step, so there is no partial
  state to leak.
- **Hidden information** (hidden-setup battleship-likes, card variants): the canonical
  `S` lives only where it is trusted (server for online play; in-memory for hotseat).
  Clients receive `V = playerView(S, me)` and *nothing else*. See §4 for the wire model.
- **Stochastic elements**: no `Math.random()` anywhere in `packages/engine` or `games/*`
  — enforced by an ESLint `no-restricted-globals`/`no-restricted-properties` rule in CI.
  All chance flows through the injected `Rng`, implemented as a small splitmix32/
  mulberry32 PRNG seeded from the match seed. Determinism contract: the rng passed to
  `apply` for step *k* is derived as `rngFor(matchSeed, k)` — child-seed-per-step, so
  replaying moves 0..k always consumes the identical random stream regardless of how many
  numbers earlier steps drew. (This "fork the PRNG per step" detail is what makes replays
  robust to engine-internal refactors that change draw counts within a step.)
- **Post-move automatic transitions** (decay): they live *inside* `apply`, which always
  returns a quiescent state. Decay-TTT stores `placedAtTurn` per mark; `apply` places the
  move, then deletes marks where `turn - placedAtTurn >= TTL`. No separate `tick()`
  lifecycle — a second lifecycle method is a second thing every consumer (bot, server
  validator, replayer) can call in the wrong order. One transition function, no ordering
  bugs, ever.

### Per-player view redaction, concretely

Rule: **the canonical state never crosses a trust boundary.** For an online
hidden-info match:

1. Server holds `S` (encoded in Postgres).
2. When player P polls/subscribes, the server computes `engine.playerView(S, P)` and
   returns only that. The view type `V` is a *different type* — it structurally cannot
   contain the opponent's secrets (e.g. `{ myHand: Card[]; opponentHandCount: number }`).
   Making V a distinct type turns "did we leak?" from a runtime audit into a compile-time
   check: if `V` has no field for opponent cards, no code path can serialize them.
3. Redact derived data too: legal-move lists can leak (`legalMoves` revealing "opponent
   has a playable 7"). The client computes *its own* legal moves from its view where
   possible; for games where legality depends on hidden state, the server returns the
   move list for the requesting player only, and it is part of `V`'s contract.
4. RNG secrets: for hidden stochastic state (shuffled deck), the deck order lives in `S`
   server-side; the view exposes only draw results the player has seen. Seeds for
   hidden-info matches are server-generated and never sent to clients (a client with the
   seed can reconstruct the shuffle).

For perfect-info games all of this collapses to `playerView = identity` and the client
can run the whole engine locally — which is why perfect-info games get optimistic UI and
offline play for free.

---

## 2. Why purity and determinism matter here

This is the load-bearing constraint of the whole platform. Each payoff, concretely:

- **Replay** = `(engineId, engineVersion, seed, moveLog)`. A full game is a few hundred
  bytes. Replays power: sharing ("look at this game" URLs), leaderboard verification
  (§8), bug reports (a failing game state is reproducible from 4 values), and undo/redo
  (re-apply moves 0..k-1).
- **Share/seed reproducibility**: the daily-puzzle mechanic (§8) *is* determinism —
  everyone who opens today's puzzle runs `setup(n, rngFrom(dailySeed))` and gets the
  identical position. No server involvement to deal the puzzle.
- **Server-side anti-cheat**: the server validates a move with
  `isLegal(state, p, m)` and advances with the same `apply` the client ran. One codebase,
  no drift between "what the client allows" and "what the server accepts." This is only
  possible because the engine is framework-free and runs in a route handler as-is.
- **Bot search**: minimax and MCTS are "clone state, roll forward, evaluate" in a loop.
  A pure `apply` that never mutates its input makes cloning free (just keep the old
  reference) and makes tree nodes safe to share.
- **Testability**: property-based tests (fast-check) can hammer
  `∀ seed, ∀ random legal move sequence: apply never throws, status is coherent,
  encode∘decode is identity, same seed ⇒ same trajectory` with zero mocking.

### Immutable vs. mutable-with-undo

**Recommendation: immutable, plain-object, hand-written spreads (not Immer) — with a
declared escape hatch that no launch game should need.**

Reasoning:

- These are *small* states. Decay-TTT is ~9 cells + a turn counter; even a card variant
  is a few hundred bytes. Copying a 9-cell array is nanoseconds. Measured reality for
  states this size: a naive immutable `apply` supports on the order of 10⁵–10⁶
  applies/sec in V8, and MCTS with a 200–500 ms think budget needs 10⁴–10⁵ node
  expansions to play far above casual-human strength at these branching factors (≤ ~30).
  We have 10–100× headroom before mutation matters.
- Mutable-with-undo (do/undo move pairs, the chess-engine pattern) is faster for deep
  minimax on big states, but it doubles the per-game API surface (every game author must
  write a correct `undo`, and undo bugs are the classic source of subtle search
  corruption). That is a tax on exactly the thing we're optimizing — cheap weekly game
  authorship. Rejected as the default.
- Skip Immer in the engine: its proxy overhead is 10–50× a hand-written spread and it's
  an unnecessary dependency in the hot path. Engine states are shallow; spreads are
  readable.
- **Escape hatch, documented but not built**: if a future game profiles as
  search-bound (e.g. a deep connect-four-like where we want expert-level minimax), the
  engine may additionally implement `applyInPlace(state, moves, rng)` + `clone(state)`,
  and the search framework will prefer them when present. The trigger to build it is a
  measured bot-strength problem, not a hunch.

---

## 3. Bot / AI strategy

**One generic framework, per-game knobs — not per-game bots.** A per-game bot is 1–3 days
of specialist work per game; that alone kills the weekly cadence. The engine interface was
designed so that generic search needs nothing game-specific.

The ladder (all in `packages/bots`, consuming only `GameEngine`):

1. **RandomPolicy** — uniform over `legalMoves`. Cost: free. Role: baseline for the
   harness (§7) and the "very easy" tier.
2. **Minimax + alpha-beta** — generic implementation; requires the optional
   `heuristic(state, player)` and only fits sequential perfect-info games. Worth wiring
   for games where a 20-line heuristic exists (line-counting in TTT-likes), because at
   equal think-time it plays sharper endgames than MCTS on tactical games. Optional per
   game.
3. **MCTS (UCT)** — the workhorse. Needs *only* `legalMoves`/`apply`/`status`/`active`.
   Handles stochastic games (rollouts draw from a fresh rng per playout) and simultaneous
   games (treat the joint move space, or decoupled UCT — start with joint, it's simpler
   and fine at our branching factors). Handles hidden info via determinization: sample a
   world consistent with the bot's view, run MCTS in it, aggregate over ~10–50 samples.
   That requires one optional per-game hook:
   `sampleConsistentState?(view: V, rng: Rng): S` — a fair price; it's usually
   "shuffle the unseen cards."
4. **Difficulty tiers** — built from three orthogonal knobs, no extra code:
   - *budget*: rollout count / depth (Easy: 50 rollouts, Medium: 1k, Hard: 20k or 400 ms);
   - *blunder rate*: with probability ε, sample from the softmax of root visit counts at
     temperature τ instead of the argmax — this produces human-feeling "plausible
     mistakes" rather than uniform-random howlers;
   - *policy mix*: Easy can be `0.5·Random + 0.5·MCTS(50)`.
   Tune ε/τ/budget per game per tier in the game's manifest (data, not code), using the
   harness (§7) to verify tier ordering actually holds (Hard beats Medium ≥ 65%).

### Where the bot runs

**Web Worker, always.** Main thread is out — 300 ms of search jank on a click is exactly
the kind of low-grade broken feel that kills a casual games site. Server-side bots are out
for solo play — they add latency, cost per move, and an outage mode to something the
client can do free and offline. (One exception later: async matches vs. bot where the bot
must move while the human is gone — that's a server cron running the same `packages/bots`
code. Same code, different host; purity pays again.)

Latency budget: bot replies in **200–800 ms** (below 200 ms feels like it isn't
"thinking"; artificial minimum delay of ~250 ms on Easy is a UX feature). Worker protocol:
`postMessage({ engineId, encodedView|encodedState, tier, seed }) → { move, stats }`. Time-box
search with a deadline, not a fixed rollout count, so weak devices still respond in
budget. One shared worker bundle that dynamically imports the engine module for the
requested game — engines are already code-split (§6), the worker reuses the same chunks.

---

## 4. Multiplayer, ranked by cost/benefit

Ranked. Ship in this order; each tier is strictly additive.

| Tier | Cost | Benefit | Verdict |
|---|---|---|---|
| 1. Hotseat | ~0 (it's the solo UI with the bot removed) | Two-player games playable day one, fully offline, no backend | Ship at launch |
| 2. Async link-based | Small: 3 tables + 1 route handler + polling | The viral loop ("your move" URL to a friend), no accounts needed, fits turn-based perfectly | Ship in month 1–2 — **the recommended core online mode** |
| 3. Realtime presence | Medium: Supabase Realtime channels on top of tier 2 | "Opponent is typing/moved" liveness for both-online sessions | Ship when async has traction; it's an upgrade of tier 2, not a new system |
| 4. Matchmaking | High: queues, ratings, abuse/AFK handling, liquidity problem (empty queue = dead feature) | Strangers can play | Defer until DAU makes queues non-empty; matchmaking with no players is negative value |

Simultaneous games in hotseat get a pass-the-device commit screen (or hash-commit) —
platform concern, engine unchanged.

### Tier 2 — async link-based (the important design)

**Authority model: server-authoritative from the first online move.** The Next.js route
handler (running the same engine package) is the only writer of match state. Clients
propose moves; the server validates (`isLegal`), applies (`apply` with the server-held
rng stream), persists, and returns the requester's new `playerView`. Clients of
perfect-info games may *optimistically* apply locally for snappy UX, reconciling on the
server response — allowed precisely because both sides run the identical pure engine, so
divergence means "you cheated or you're stale," never "implementations disagree."

Anti-cheat for hidden info falls out of §1's redaction rule: the DB row holds encoded
canonical `S`; **no API path ever returns S** — only `playerView(S, requester)`. The seed
column is never selected into any client-facing query. A cheating client has nothing to
inspect: the secret bits simply never reach the wire. For simultaneous steps the server
holds submitted moves in a `pending_moves` column invisible to the other player until all
seats have submitted, then applies atomically.

No accounts: on first visit, call Supabase **anonymous sign-in** (built-in) — every
visitor gets a real `auth.users` row and JWT with zero friction. This makes RLS work
without inventing a parallel token scheme, and it is what makes account-claiming (§8)
free later.

**Schema sketch (recommended path):**

```sql
create table matches (
  id            uuid primary key default gen_random_uuid(),
  game_id       text not null,              -- engine meta.id
  engine_version int not null,
  seed          text not null,              -- SECRET for hidden-info games; never exposed via API
  state         jsonb not null,             -- encode(S); canonical, server-only meaning
  status        text not null default 'open',  -- open | ongoing | finished
  active_seats  int[] not null,             -- derived from active(S), denormalized for querying
  join_code     text unique not null,       -- unguessable slug in the share URL
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table match_players (
  match_id  uuid references matches on delete cascade,
  seat      int not null,
  user_id   uuid not null references auth.users,  -- anonymous users included
  primary key (match_id, seat),
  unique (match_id, user_id)
);

create table moves (
  match_id  uuid references matches on delete cascade,
  idx       int not null,                   -- step number; PK gives ordering + idempotency
  seat      int not null,
  move      jsonb not null,
  created_at timestamptz default now(),
  primary key (match_id, idx, seat)         -- seat in PK to allow simultaneous steps
);
```

**RLS intent** (policies in plain words):

- `matches`: **no client-facing SELECT of `state`/`seed` for hidden-info games.** Simplest
  safe posture: clients get match data only through an RPC/route that returns
  `playerView`; direct table SELECT is limited to non-sensitive columns (status,
  game_id, updated_at) for participants (`exists` check against `match_players`). No
  client INSERT/UPDATE on `matches` at all — writes go through the route handler using
  the service role (or a `security definer` function). Given CLAUDE.md's Supabase-local
  workflow, RLS-tested per worktree.
- `match_players`: SELECT for participants of the same match; INSERT only via the
  join-by-code function (checks seat free, match open).
- `moves`: SELECT for participants **only where the move is visible to the requester**
  — for perfect-info games that's all rows; for hidden-info/simultaneous games move
  bodies route through `playerView` like state does (a submitted-but-unrevealed
  simultaneous move must not be readable by the opponent). No client writes.

Turn notification for async: polling `updated_at` (every 20–30 s while tab open) is fine
at this tier and costs nothing. Tier 3 replaces polling with a Supabase Realtime
**broadcast poke** ("match X changed — refetch your view via the authoritative route"),
never with `postgres_changes` on the `matches` row — pushing row payloads would ship the
canonical state to subscribers and reopen the hidden-info hole. Poke-then-fetch keeps the
single redaction path authoritative.

---

## 5. Rendering approach

For the actual catalog — small grid-based abstract games with juice — the ranking is
clear-cut:

- **DOM/CSS — the default, and the recommendation for ~90% of the catalog.** Grid games
  are literally CSS Grid. You get for free: accessibility (real buttons, focus order,
  ARIA), responsive layout, theming via Tailwind tokens, effortless text, dev velocity in
  the house stack, and CSS transitions/animations that are GPU-composited. A 9–100 cell
  board re-rendering through React is nowhere near any performance limit. shadcn covers
  all chrome (dialogs, menus, toasts).
- **SVG — inside the DOM, for the exceptions**: connection lines, irregular/hex boards,
  arbitrary shapes (hex variants, graph games like a Dots-and-Boxes twist). Inline SVG in
  JSX keeps the same React data flow and CSS animatability. Not a separate stack — a
  drawing surface within the default one.
- **Canvas — only when element count breaks the DOM**, i.e. hundreds of independently
  animated particles or a falling-sand-style twist with thousands of cells. One
  `<canvas>` FX overlay on top of a DOM board is the pattern (board stays accessible,
  particles go to canvas). Expect ≤1 game a year to need a canvas *board*.
- **WebGL/PixiJS/Three — no.** Payload (Pixi ~100 kB+, Three ~600 kB) and complexity buy
  nothing for abstract 2D grids. Adopting one "just in case" is exactly the bundle bloat
  §6 exists to prevent. Revisit only if the catalog pivots to real-time arcade games.

**Animation approach for decay/state transitions:** the engine emits states, not
animations — but a diff of two quiescent states can't distinguish "captured" from
"decayed" from "moved." So `apply` optionally records a lightweight **effects log**:
`apply` returns `S` whose type may include a transient `lastEffects: Effect[]`
(`{type:"decayed",cell:4}`, `{type:"placed",cell:0}` …) — pure data, part of the state,
cleared next step, ignored by bots. The UI maps effects to CSS: decay = a per-cell
`data-age` attribute driving opacity/desaturation tiers (`age-1`, `age-2`, gone), with
the final disappearance animated via a CSS keyframe (shrink+fade) triggered by an
exit-state class; placements/moves use FLIP or `viewTransition` for repositioning. Motion
One or plain CSS over Framer Motion for the hot path (Framer is ~30 kB; fine in chrome,
avoid inside per-cell rendering). All motion behind `prefers-reduced-motion`.

---

## 6. Content pipeline — a new game in a day

This is the actual product. The architecture exists to make step "add game" cheap.

### Layout (monorepo-lite inside the Next app's workspace)

```
packages/
  engine/            # types (§1), Rng, replay utils, property-test kit — pure TS
  bots/              # RandomPolicy, minimax, MCTS, difficulty tiers — pure TS
  harness/           # self-play CLI (§7) — node, imports engine+bots
games/
  decay-ttt/
    engine.ts        # implements GameEngine<S,M,V> — pure, no react
    engine.test.ts   # game-specific unit tests + the shared property suite
    heuristic.ts     # optional
    ui/Board.tsx     # client component; imports ONLY from engine.ts + platform kit
    manifest.ts      # tiny: id, name, tagline, tags, players, difficultyKnobs, thumbnail
  registry.ts        # the single wiring point (below)
app/
  page.tsx           # catalog — imports ONLY manifests (small, static)
  play/[gameId]/page.tsx   # dynamic-imports the game module for that route
  api/match/...      # route handlers importing games/*/engine.ts (server-side, tree-shaken per route)
```

### Registry and code-splitting

`registry.ts` maps id → `{ manifest, loadEngine: () => import(...), loadUi: () => import(...) }`.
Two rules make bundle isolation automatic:

1. **Manifests are eagerly imported; engines/UI only via dynamic `import()`.** The
   catalog page's payload is the sum of manifests (a few hundred bytes each), never game
   code.
2. **`app/play/[gameId]` loads exactly one game's chunks** via the registry's dynamic
   importers (`next/dynamic` for the UI component). Next/webpack splits each `games/*`
   module into its own chunk; game 40 adds zero bytes to game 1's route. Engines are
   isomorphic — the same `engine.ts` chunk serves the client, the bot worker, and (via
   normal server-side imports) the API routes.

### Scaffold

`pnpm new-game <id>` (a plop/custom script) stamps the `games/<id>/` directory from a
template: typed engine skeleton with TODOs, the shared property-test suite pre-wired
(passing a `GameEngine` into `engineContract(engine)` from `packages/engine/testkit`),
a Board.tsx wired to the platform's `useGame` hook (state, optimistic apply, bot worker,
hotseat), manifest stub, and a `CHECKLIST.md`: engine → unit tests green → heuristic
(optional) → UI → harness run → thresholds tuned → manifest polish → PR. With the
platform hook owning game loop/bot/persistence plumbing, a day of work is: rules in
`apply` + legality + a board component. That's the credible day.

### Automated gates (CI, per PR touching `games/*`)

1. **Engine contract property tests** (shared suite, fast-check): random legal playouts
   never throw and terminate under a ply cap; `isLegal ⟺ ∈ legalMoves`; encode/decode
   round-trip; determinism (same seed+moves twice ⇒ deep-equal trajectories); no
   `Math.random`/`Date.now` in engine files (lint rule).
2. **Self-play balance harness** (§7) at CI budget with threshold assertions.
3. **Bundle budget**: size-limit on the play-route chunk group — e.g. ≤ 75 kB gz per
   game (engine+UI, excluding shared platform chunks) and an assertion that the catalog
   route's JS didn't grow.
4. **A11y**: axe-core run via Playwright against the game page (board reachable by
   keyboard, no critical violations); part of the same Playwright pass that smoke-plays
   one full game via the UI.

CLAUDE.md's feature loop maps 1:1 onto this: Fable plans the variant + designs test
cases, Sonnet implements engine-first via TDD (the contract suite is the ready-made red),
the harness and gates are the objective part of "green."

---

## 7. The balance / self-play harness as infrastructure

The harness is the game-theory pass made executable — it answers "is this variant
actually a game?" before a human playtests it.

**CLI** (`packages/harness`, runs headless in Node — possible only because engines are
pure):

```
pnpm harness decay-ttt --games 5000 --matchup mcts1k:mcts1k --seed 42
pnpm harness decay-ttt --suite ci        # the standard CI matchup set, deterministic seeds
```

Per matchup it reports (JSON + pretty table): first-player win rate, draw rate, win rate
by seat, mean/median/p95 game length (plies), mean branching factor (mean
`|legalMoves|` over visited states), decisiveness curve (when do wins get decided), and
throughput. Standard matchups: `random:random` (structure sanity), `strong:random`
(does skill exist?), `strong:strong` (balance under good play), `hard:medium` (tier
ordering). Deterministic seeds per run ⇒ reproducible failures. Workers parallelize
across cores; 5k games of a small game is seconds-to-minutes.

**CI integration and thresholds.** Each game's manifest declares its thresholds (with
platform defaults); the harness `--suite ci` run fails the build when:

- `strong vs random` win rate **< 90%** → the twist destroyed skill expression; the game
  is effectively a coin flip. Hard fail.
- `strong vs strong` first-player win rate outside **35–65%** → first/second-mover
  advantage is game-breaking. Hard fail (a game may *declare* asymmetry intentional in
  its manifest with a justification string — visible in review — to widen the band).
- Draw rate at strong:strong **> 60%** → likely drawn-out under decent play (classic TTT
  fails this — which is *why* the variants exist; the harness proves each twist fixed
  it). Hard fail, same declared-exception mechanism.
- Mean game length outside **4–200 plies**, or any playout hitting the ply cap →
  degenerate or non-terminating. Hard fail.
- `hard vs medium` win rate **< 60%** → difficulty tiers are fake. Soft fail (warn) at
  PR budget, hard fail nightly.

Two budgets: PR runs ~1–2k games per matchup (minutes, wide confidence intervals —
thresholds above are set wide enough to be meaningful at n=2k); a nightly job runs 20k+
across all registered games and files an issue on drift (catches balance regressions from
"harmless" rule tweaks).

---

## 8. Persistence and identity

**Anonymous-first, claim-later.** Principle: solo play must work with zero backend;
the server stores only what needs to be shared, verified, or durable across devices.

- **Local (client)**: preferences and per-game stats/streaks in `localStorage`
  (small, synchronous, fine); local game history/replays in IndexedDB (moveLogs are
  tiny; thousands fit trivially). Solo/hotseat games never touch the server. Explicitly
  framed to the user as device-local until they claim an account.
- **Server**: async matches (§4), leaderboard entries, daily-puzzle results, claimed
  profiles.
- **Identity**: Supabase **anonymous sign-in** on first server-touching action (not on
  page load — don't mint rows for bounces). The visitor gets a durable `auth.users` id
  used in `match_players`/leaderboards. **Claiming an account = Supabase
  `updateUser`/`linkIdentity` attaching email or OAuth to the *same* user id** — every
  match and score already points at that id, so claiming loses nothing and requires no
  migration. On claim, additionally sync the IndexedDB history up to a `game_results`
  table (idempotent upsert on client-generated UUIDs) so pre-claim local history becomes
  durable too. This "same id, upgraded credentials" property is the single best reason to
  use Supabase auth here rather than hand-rolled tokens.
- **Daily seed**: deterministic and public — `seed = sha256("daily:" + gameId + ":" + engineVersion + ":" + yyyy-mm-dd(UTC))`.
  Computable offline by any client; everyone gets the same deal. Note the honest
  limitation: for the *daily* mode the seed is inherently public, so daily puzzles for
  hidden-info games are only advisory-fair (a determined cheater can simulate). Daily
  leaderboards therefore lean on the replay check below plus one-submission-per-user, and
  we accept residual "looked ahead" cheating on dailies as tolerable for a free casual
  site — same posture as Wordle. Competitive integrity lives in the async H2H mode,
  where seeds are server-secret.
- **Leaderboard integrity — server-verified replays, not trusted scores.** A submission
  is `(gameId, engineVersion, seed, moveLog, claimedMetrics)`. A route handler replays
  the log through the engine (pure ⇒ cheap ⇒ verifiable) and *recomputes* the metrics —
  the claimed score is discarded; only derived-from-replay values (won, move count,
  efficiency) enter the board. Consequences of this model, stated plainly:
  - Move-count/outcome metrics are **fully verified**.
  - **Wall-clock time is unverifiable** (any timestamp the client sends is forgeable).
    Options: don't rank by time (preferred — rank by verified move efficiency); or
    server-stamp start (first-view request) and end (submission) for a coarse
    server-observed duration with sanity bounds. Never rank by client-reported time.
  - The residual cheat is **bot-assisted play** (submit a replay your bot found). Undefeatable
    in principle for an open engine; mitigations are statistical (flag optimal-move-rate
    outliers) and product-level (friend leaderboards over global ones — cheating at a
    global anonymous leaderboard on a free site is a self-limiting problem; don't build
    an anti-cheat department for it).

---

## 9. Performance, hosting, and cost

**Static-first.** The catalog, game pages, rules, and all solo/hotseat play are static
assets + client JS — cacheable at the CDN edge, zero server work per game played. The
server exists for exactly four things: async match routes, leaderboard verify, daily
result submission, auth. Everything else must not touch it. This is the whole cost model:
**solo sessions (the vast majority for a casual site) cost ~$0 marginal.**

- **Hosting**: Vercel (house-adjacent, zero-ops, per-route serverless for match/verify
  routes) + Supabase (Postgres, auth, Realtime). Deviation note: none — this is the house
  stack. If Vercel bandwidth pricing ever bites, the static shell is trivially portable
  to Cloudflare Pages precisely because gameplay doesn't depend on the host's compute.
- **Caching**: immutable hashed chunks (default); catalog page ISR/static; game routes
  static shells; API routes no-cache. Game thumbnails/OG images pre-generated at build.
  A played game fetches: HTML shell (edge cache), shared platform chunk (cached across
  games), one game chunk (≤75 kB budget) — repeat visits are effectively free bandwidth.
- **Cost curve** (assumptions: ~15% of sessions touch any server feature; async match ≈
  30 request/response cycles of ~2 kB; page+chunks ~300 kB first visit, heavily cached
  after):
  - **1k sessions/mo**: $0. Vercel Hobby + Supabase Free clear this by an order of
    magnitude. (Supabase Free pauses after 7 idle days — a $25 upgrade removes that
    once anything real is live.)
  - **100k sessions/mo**: **~$45–70/mo.** Vercel Pro $20 + Supabase Pro $25; bandwidth
    (~30–60 GB with good caching) and function invocations (~500k–1M) sit inside or just
    above included tiers. DB volume: tens of thousands of match rows — nothing.
  - **1M sessions/mo**: **~$300–800/mo.** Drivers, in order: Vercel bandwidth overage
    (300 GB–1 TB depending on cache hit rate — this is the line item to watch),
    function invocations (~5–10M), Supabase compute upgrade for connection/write volume,
    Realtime concurrent connections if tier 3 is popular. Still no dedicated infra team;
    still no servers to patch.
- **First scaling cliff**: **Postgres write/connection pressure from async multiplayer +
  polling**, somewhere in the 100k→1M band *if* online-play share is high. Specifically:
  polling clients hammering match reads, one row update per move, and `moves` append
  volume. Mitigations, in deployment order: pooler (pgBouncer, already in Supabase) and
  read-your-view via a single cheap indexed query; replace polling with Realtime pokes
  (tier 3) which converts N polls/min into 1 broadcast/move; batch/JSONB-append move
  writes; archive finished matches to cold storage monthly. The comforting property:
  the cliff only arrives attached to a success signal (lots of online matches), and every
  mitigation is incremental — no re-architecture is on the path until far beyond 1M
  sessions.

Client performance: the §5 choices (DOM/CSS, per-game budgets, worker-hosted bots) keep
the interaction thread idle; the only real client risk is undisciplined per-game
dependencies, which the size-limit gate exists to catch.

---

## 10. Build vs. buy

| Option | What it gives | What it costs / lock-in | Verdict |
|---|---|---|---|
| **boardgame.io** | The closest prior art: move/phase state machine, `playerView` secret-state redaction, generic bots, lobby + multiplayer server. Validates our design almost point-for-point. | Effectively dormant maintenance (sparse releases for years); its transport/server is its own Node stack (doesn't fit Vercel serverless + Supabase); its immutability layer (Immer) and framing own your engine shape; simultaneous-move + determinization support weaker than we need. | **Learn, don't adopt.** Steal the `playerView` and phases ideas (we did); owning ~1–2k lines of engine/bot core is cheaper than adopting a dormant framework's worldview. |
| **Rune / Dusk SDK** | Polished deterministic-logic SDK (`logic.js` is essentially our pure engine), free hosted multiplayer, built-in audience. | It's a *distribution platform*: games run inside their mobile app, their UI constraints, their audience — you don't own the site, the URL, or the user. Total platform lock-in. | **No** for the product (which *is* a website we own). Worth reading their logic/update model as convergent design evidence. |
| **Colyseus** | Mature authoritative realtime room server, state sync, matchmaking primitives. | Stateful Node servers to host/scale (breaks the serverless cost model), schema-coupled state sync, its room lifecycle owns your session model. Designed for tick-based realtime — wrong grain for turn-based. | **No for now.** Re-evaluate only if the catalog adds real-time action games (tier-4+ territory). |
| **PlayroomKit** | Fastest possible multiplayer bolt-on (sync state, presence, lobbies as a hosted SaaS). | Closed SaaS on the critical path, per-MAU pricing at scale, client-trust model awkward for hidden info, and it duplicates what Supabase already gives us. | **No.** Supabase (already in-house) covers the same ground with more control. |
| **GGPO-style rollback netcode** | Gold standard for real-time low-latency determinism (fighting games). | Solves input-latency masking for 60 Hz simultaneous input — a problem turn-based games do not have. Large complexity. | **Not applicable.** The *concept* (determinism enables prediction+rollback) is already ours via the pure engine; the machinery is for a different genre. |
| Commodity buys (adopt freely) | fast-check (property tests), a published mulberry32/splitmix, Zustand (client state), Motion One, size-limit, axe-core | Tiny, replaceable, no architectural opinion. | **Buy.** |

**Overall verdict: build the thin core (engine interface, bots, harness — small, pure,
fully owned), buy all commodity infrastructure (Supabase, Vercel, testing/animation
libs).** The build surface is deliberately tiny; the differentiating asset is the engine
contract plus the content pipeline, and no off-the-shelf option owns those without
owning us.

---

## Recommended architecture (one diagram)

```
                        ┌──────────────────────────────────────────────────────┐
                        │                      BROWSER                         │
                        │                                                      │
                        │  Catalog (static, manifests only)                    │
                        │  Play route /play/[gameId]  ── dynamic import ──┐    │
                        │                                                 ▼    │
                        │  ┌───────────────┐   views/moves   ┌──────────────┐  │
                        │  │ Game UI (DOM/ │◄───────────────►│ games/<id>/  │  │
                        │  │ CSS, shadcn)  │   effects log   │ engine.ts    │  │
                        │  └──────┬────────┘                 │ (pure TS)    │  │
                        │         │ postMessage              └──────┬───────┘  │
                        │  ┌──────▼────────┐   same chunk          │          │
                        │  │  Web Worker   │◄──────────────────────┘          │
                        │  │  bots: MCTS/  │                                   │
                        │  │  minimax/rand │   localStorage: prefs/streaks     │
                        │  └───────────────┘   IndexedDB: local replays        │
                        └───────────────┬──────────────────────────────────────┘
             solo/hotseat: no requests  │  online only: propose move / fetch playerView
                                        ▼
                        ┌──────────────────────────────────────────────────────┐
                        │        VERCEL (static CDN + route handlers)          │
                        │  /api/match/*  ── imports SAME engine.ts ──────────┐ │
                        │  isLegal → apply → persist → return playerView(S,p)│ │
                        │  /api/leaderboard/submit ── replay-verify moveLog ─┘ │
                        └───────────────┬──────────────────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────────────────┐
                        │                    SUPABASE                          │
                        │  Postgres: matches(state,seed: server-only),         │
                        │            match_players, moves, game_results,       │
                        │            leaderboards          + RLS                │
                        │  Auth: anonymous-first → linkIdentity to claim       │
                        │  Realtime: broadcast "poke" → client refetches view  │
                        └──────────────────────────────────────────────────────┘

  CI/dev:  pnpm new-game scaffold → engine contract property tests (fast-check)
           → self-play harness (packages/harness, bots vs bots, thresholds)
           → size-limit bundle budget → axe a11y → Playwright smoke
```

## Top 5 technical risks and mitigations

1. **Engine interface v1 turns out too narrow at game N** (a variant needs something the
   contract can't express — multi-step turns, interrupts, partial reveals), forcing a
   breaking change under a growing catalog. *Mitigation*: before freezing v1, implement
   three deliberately diverse games (perfect-info sequential, hidden-info, simultaneous
   +stochastic); version the interface (`meta.version` + engine package semver) and store
   `engine_version` on every match/replay so old replays stay verifiable; treat interface
   changes as ADRs.
2. **Hidden-state leakage** — one lazy endpoint or Realtime `postgres_changes` payload
   ships canonical `S` and the anti-cheat story is dead. *Mitigation*: distinct view type
   `V` (compile-time absence of secret fields), redaction confined to one server code
   path, poke-then-fetch Realtime pattern, RLS denying state/seed column reads, plus a
   contract test asserting `JSON.stringify(playerView(S,p))` never contains opponents'
   secret values across random playouts.
3. **Content cadence collapse** — game 12 quietly takes three weeks because per-game
   glue accreted (custom bot tweaks, bespoke persistence, snowflake UI plumbing).
   *Mitigation*: the scaffold + platform `useGame` hook own all plumbing; the automated
   gates keep "done" objective; track authoring lead time per game and treat any growth
   as an architecture bug, not an author problem.
4. **Bundle/perf erosion** — each game drags in a chart lib here, an animation lib
   there; two years in, the site loads like an enterprise dashboard. *Mitigation*:
   per-route size-limit budgets failing CI, eager-manifest/lazy-everything registry rule,
   dependency additions to `games/*` require review, quarterly bundle audit.
5. **The async-multiplayer scaling cliff arrives as a cost/incident surprise** (polling
   storms, `moves` write volume, Realtime connection ceilings in the 100k–1M band).
   *Mitigation*: the pre-planned incremental ladder — pooler, poke-over-poll, batched
   move writes, finished-match archival — plus alerts on DB connections, function
   invocation counts, and bandwidth *before* they hit plan limits; each step is
   deployable independently with no re-architecture.

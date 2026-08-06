# Phase 2 — Async link-based multiplayer

*Fable plan, 2026-08-07. Implements roadmap Phase 2's "viral loop" item. Builds on:
`docs/research/games/architecture-lens.md` §4 (tier-2 design + schema sketch),
`docs/research/games/ux-lens.md` §6 (invite/join flow), `docs/plans/platform-corrections.md`
(C1, C4, C10, and the remote-Supabase deny-all entry — all binding here), and the shipped
engine contract (`packages/engine/src/types.ts`).*

*Terminology: "S" is canonical state, "V" is `playerView(S, seat)`. "The remote" is Supabase
project `fjiwrzaosluymamannaw`. "Deny-all" means RLS enabled with zero policies.*

---

## 1. Overview and goals

Send a friend a URL; take turns over hours or days; no accounts. One shared URL becomes a
standing series with seats swapped each rematch. Server-authoritative from the first online
move.

**Goals (from roadmap Phase 2 exit criteria):**

- Median time-to-first-friend-move under 24h — measurable from schema timestamps alone.
- Zero hidden-state leaks in the redaction contract test — and, stronger, zero paths on
  which a leak is *expressible* (see §3).
- The loop works with **one game** first (Fadeout — the only shipped two-player game), but
  everything is registry-driven so game N+1 costs ~zero (the pipeline thesis).

**Non-goals — explicitly out of Phase 2** (§13 has the reasoning):

- Matchmaking, lobbies, queues, ratings ("a lobby with nobody in it is worse than no lobby").
- Realtime anything: presence, live push, Supabase Realtime channels. Phase 3.
- Push/email "your turn" notifications. That is the Phase 3 account carrot.
- Clocks, forfeit timers, AFK adjudication. A match can simply sit (bounded by expiry, §7.5).
- Simultaneous-move games online. No shipped engine needs it and `useGame` is
  sequential-only by documented scope; the schema keeps the seam (§4).
- Account claim / `linkIdentity`. Phase 3 — but §6 keeps it free by binding seats to
  `auth.users.id` now.
- Daily-certificate migration to Postgres. A roadmap Phase 2 item, but a **separate feature
  team** — it shares nothing with this plan except the Supabase project.
- Spectator live-board polish beyond a static redacted view (§14's cut line).

---

## 2. Requirements

**Functional:** create match → share URL (native share sheet, rule sentence in the invite
text) → host may move immediately → guest joins via URL → alternating turns with the page
open or across days → finish → rematch on the same URL with seats swapped → series
scoreline.

**Non-functional:**

- **Confidentiality:** canonical `state` and `seed` never cross the wire, to anyone,
  including the match's own players. This is the load-bearing NFR; §3 is its design.
- **Integrity:** every accepted move was validated by the server's own engine (`isLegal`)
  against the server's own current state. Duplicate and concurrent submissions cannot
  corrupt a match (§8.3).
- **Latency:** submit round-trip is uncritical (async cadence); target <1s perceived. No
  optimistic apply in v0 (§9.2 — a deliberate simplification, not an oversight).
- **Cost/scale:** polling only while a tab is open, 15–30s interval with hidden-tab
  backoff. Roadmap's scaling ladder (pooler → poke-over-poll → batching → archival) is
  pre-planned for Phase 4 scale; nothing here forecloses it.
- **Bundle:** `/g/[code]` is a game-playing route and inherits the 75 kB gz budget.
  supabase-js must not enter the shared shell chunk (§9.4).
- **No accounts:** nothing gates the first move; anonymous identity is minted lazily (§6).

---

## 3. The authority model

### 3.1 The invariant, stated once

> **A match's canonical state `S` and its `seed` exist in exactly two places: the `matches`
> row and the memory of a server-side request handler. The only representation of a match
> that is ever serialized toward a client is the output of `playerView(S, seat)` for the
> requesting seat (or `playerView(S, null)` for spectators), produced by one chokepoint
> function.**

Clients propose moves. A route handler running the *same pure engine* validates with
`isLegal`, applies with `apply` (server-held rng stream via `rngFor(seed, idx)`), persists,
and returns only the requester's view.

### 3.2 What enforces it — three layers, none of which is prose

C1 failed twice, both times at a seam its own text had named. Assume the third attempt: a
future route handler, written quickly, returns `match.state` or passes `S` where `V`
belongs. The design makes that attempt fail at **compile time**, then at **runtime**, then
in **CI against real bytes** — in that order.

**Layer 1 — the type system: a branded wire type and one producer.**

New package `packages/match` (pure TS, no react/next), with a hard server/client split:

```
packages/match/
  src/wire.ts        # shared: WirePayload types — the ONLY shapes routes may return
  src/server/        # exported as @twist-arcade/match/server; first line: import "server-only"
    redact.ts        # the single chokepoint (below)
    guard.ts         # the runtime leak trap (layer 2)
    service.ts       # create / claim / view / move / rematch — all DB access, service role
    db.ts            # service-role client construction; the only file that reads the key
  src/client/        # exported as @twist-arcade/match/client
    useAsyncMatch.ts # the client hook (§9)
    api.ts           # typed fetch wrappers; only ever parses WirePayload
```

```ts
// wire.ts
declare const REDACTED: unique symbol;
/** Constructible ONLY by redactForWire(). Everything a route returns is one of these. */
export type Redacted<T> = T & { readonly [REDACTED]: true };

export interface MatchViewPayload {
  code: string;
  gameId: string;
  gameVersion: number;
  round: number;                 // series round (§7.4)
  seriesScore: [number, number];
  stepCount: number;             // = moves.length; the poll comparator
  status: WireStatus;            // ongoing | won/draw | expired | superseded (§11)
  yourSeat: 0 | 1 | null;        // null = spectator / unclaimed
  activeSeat: 0 | 1 | null;
  view: Json;                    // serialized V for yourSeat — and NOTHING else
  updatedAt: string;
}
```

```ts
// server/redact.ts — the chokepoint. The ONLY call to playerView in the server tree,
// and the ONLY producer of Redacted<>.
export function redactForWire<S, M, V>(
  engine: GameEngine<S, M, V>,
  row: MatchRow,                  // carries encoded S + seed; never leaves this module's callers
  state: S,
  seat: PlayerId | null,
  extra: WireEnvelope
): Redacted<MatchViewPayload> {
  const view = engine.playerView(state, seat);
  const payload = { ...extra, view: toJson(view) };
  assertNoCanonicalLeak(payload, row);      // layer 2, inline — not optional, not a wrapper
  return payload as Redacted<MatchViewPayload>;
}
```

Route handlers are typed to return `Redacted<...>` and go through one response helper,
`matchResponse(payload: Redacted<MatchViewPayload | MatchPokePayload | ...>)`. Returning a
raw row, a raw `S`, or a hand-built object is a **type error** — the brand has exactly one
producer. `service.ts` never exports `S`, `seed`, or `MatchRow` from the package; its public
return types are all `Redacted<>` payloads or void. The engine's `decode`/`apply` on
canonical state happen inside `service.ts` only.

Two mechanical rules make the boundary non-bypassable rather than conventional:

- `src/server/index.ts` begins with `import "server-only"` — any client-bundle import of
  the authority code is a **build failure**, not a review comment (same mechanism Next uses
  for service keys).
- An eslint boundary block (the repo's existing `no-restricted-imports` apparatus,
  `eslint.config.mjs`) forbids `@twist-arcade/match/server` and `server/*` deep paths from
  `app/**` client files, `packages/shell/**`, and `games/**`; and forbids
  `@supabase/supabase-js` service-role construction (`SUPABASE_SERVICE_ROLE_KEY`) anywhere
  outside `packages/match/src/server/db.ts`.

**Layer 2 — the runtime leak trap, inside the chokepoint.**

Types are erased and C1's history says a bypass will be attempted where the types are
loosest (`view: Json` is such a spot — a leaky `playerView` satisfies it). So
`assertNoCanonicalLeak(payload, row)` runs on **every** redaction, in production, not just
tests:

- serialize `payload` once with `stableStringify`;
- **throw** if the match `seed` appears as a substring;
- **throw** if the row's canonical `encode(S)` appears as a substring, or if any top-level
  key is named `state` or `seed`;
- for `engine.meta.hiddenInformation` games, additionally assert
  `stableStringify(view) !== engine.encode(state)` — a `playerView` that is the identity
  function on a hidden-info game is a bug by definition (the redaction contract's own rule,
  enforced per-request rather than per-CI-run).

Cost: one extra stringify of a few-KB payload per request — nothing at this tier. Failure
mode: a thrown `CanonicalLeakError` → 500 → the leak **does not ship bytes**. A 500 is a
visible incident; a leak is a silent one. That trade is the whole point.

**Layer 3 — tests that plant a leak (CI, against real bytes and a real row).**

The deny-all verification taught the standard: `200 []` proves nothing; verify against a
row that actually contains a secret. Permanent fixtures:

1. **A leaky mock engine** (`hiddenInformation: true`, secret `mines` in S, canary string
   `"SECRET-MINE-DO-NOT-LEAK"`) whose `playerView` is deliberately the identity function.
   Test: `redactForWire` with it **throws**. A second mock with correct redaction passes.
   This is the "assume the third C1 attempt" test — it proves the guard guards.
2. **Full-HTTP-bytes grep**: integration test against the team's local stack — create a
   hidden-info mock match server-side with a canary seed and canary secret; drive every
   route (`view`, `poke`, `move` response, `rematch`, spectator view) as guest, host, and
   spectator; assert the canary strings appear in **zero raw response bodies** (headers
   included). Runs in CI per PR touching `packages/match` or `app/api/match`.
3. **RLS probes against a non-empty table** (re-run, not assumed): with the anon key and an
   anonymous user's JWT, `select *`, `select seed,state` on all three tables **containing a
   planted row** → 0 rows; any INSERT/UPDATE → `42501`. This test is the tripwire that
   fires if anyone ever adds a permissive policy "temporarily" — the silent-failure mode
   the corrections file warns about becomes a red test.
4. **The existing redaction contract test** (CI gate row: "serialized playerView contains
   an opponent secret") continues to run per-engine over random playouts — unchanged, it
   guards the engines while layers 1–3 guard the transport.

### 3.3 Why moves also route through the view

`moves.move` bodies are secrets for hidden-info/simultaneous games (an unrevealed
simultaneous submission must not be readable by the opponent). Rather than a per-game
column policy, Phase 2 simply **never serves the `moves` table to clients at all**: the
client's knowledge of history is whatever `V` encodes plus the wire envelope's `stepCount`.
No shipped game needs a client-visible move list; when one does (Phase 3 replays), it goes
through a `redactMoveLog` chokepoint sibling with the same brand. Recorded here so nobody
"just adds a SELECT policy on moves" later.

---

## 4. Data model — judgment on the applied schema, and amendments

**Verdict: the schema's bones are right (three tables, the seat/user split, `(match_id,
idx)` move ordering) and should be kept. Four amendments are needed, all near-free now
because every table is empty, and one of them is a genuine defect.**

### 4.1 Defect: `engine_version int` conflates two version axes

`ReplayRecord` (the shipped contract, `packages/engine/src/replay.ts`) carries
`gameVersion: number` (rules version, `GameMeta.version`) **and** `engineVersion: string`
(`@twist-arcade/engine` package version — part of the replay format per the freeze policy).
The applied `matches.engine_version int` can store neither faithfully and predates this
contract. C4's lesson applies: this row *is* a trust-boundary record — it must be able to
reconstruct a `ReplayRecord` exactly.

**Amend:** drop `engine_version int`; add `game_version int not null` and
`engine_version text not null`.

### 4.2 Decision: the move log is the record of truth; `state` is a cache

Storing both `moves` rows and a `state jsonb` invites split-brain — the exact
silent-divergence shape (C8) this build keeps producing. Ruling for this plan:

- **Truth** = `(seed, game_version, engine_version, moves[])` — precisely a `ReplayRecord`,
  replayable through the existing `replay()` (which validates every move and refuses
  illegal logs loudly, and which C4's throwing-`decode` protects).
- **`matches.state`** holds `encode(S)` as a same-transaction cache so a view request is
  one row read + one `decode` instead of an N-step replay. At ≤~100 plies replay is
  microseconds, so the cache is an optimization, not a dependency.
- **Invariant test** (testkit + integration): after any sequence of commits,
  `encode(replay(record).final) === matches.state`. If they ever diverge, the *replay*
  wins and the match is quarantined (status `void`), never silently served.

This also makes Phase 3 leaderback verification ("replay the move log, discard the claimed
score") free — the table already stores the verifiable object.

### 4.3 Series: the URL names the series, rounds are matches

Rematch-with-seats-swapped on the same URL is a hard requirement (ux-lens §6.5). The
applied `join_code text unique` binds the code to one match. **Amend:** `join_code` stays
on `matches`, uniqueness becomes `unique (join_code, round)` with `round int not null
default 1`; `/g/<code>` resolves to `max(round)` for that code. Older rounds report
`status: superseded` with a pointer forward. No fourth table; the series scoreline is a
two-line aggregate over rounds sharing the code. Seat swap: round *n*'s host seat is
`(n − 1) % 2` — derived, and also recorded per-round in `match_players` (recorded beats
derived at a trust boundary).

### 4.4 Lifecycle columns

**Amend:** `status` gains `expired` and `void`; add `expires_at timestamptz not null`
(creation: +7 days while `open` with one player; refreshed to +30 days on every committed
move). Expiry is **evaluated lazily at read time** (`now() > expires_at` → served as
`expired`); no cron, no background job in Phase 2. Actual row deletion is a Phase 3+
archival concern (roadmap's ladder).

### 4.5 Kept as-is, deliberately

- `moves` PK `(match_id, idx, seat)` — seat-in-PK is the simultaneous seam; costs nothing
  now, saves a migration later. Phase 2 writes only one row per idx.
- `active_seats int[]` denormalization — feeds the "Active games" strip cheaply.
- `seed` — required even for `stochastic: false` games: `setup()` draws from
  `rngForSetup(seed)`, so the seed is part of the replay format regardless. It stays
  `SECRET` for every game uniformly (one rule, no per-game carve-out for C1's seam to
  live in).
- `match_players.user_id references auth.users` — **with a recorded operational
  constraint**: no anonymous-user cleanup job may run against this project while matches
  reference anon users (deleting a stale anon user would cascade/violate into live seats).
  Revisit at Phase 3 account claim.
- **Not added:** `pending_moves` (simultaneous), display-name column is added
  (`match_players.display_name text` — trivial, feeds ux-lens's "playing as Guest ✎",
  cuttable per §14).

### 4.6 One more amendment: `matches.step_count int not null default 0`

The compare-and-set token for §8.3 and the poll comparator — cheaper and less ambiguous
than `updated_at` (which also moves on join/rename).

---

## 5. RLS position: zero policies, forever within Phase 2

**Position: no client-facing table access at all — reads included. Every read and write
goes through a route handler using the service role. The deny-all posture (RLS enabled,
zero policies) is not a temporary state to be opened "one policy at a time"; it is the
end-state of Phase 2.**

Reasoning, per the "each policy is a hole; justify it" standard — the justification here is
that **no policy clears the bar**:

- *Writes*: the server is the only writer by the authority model. Client INSERT/UPDATE
  policies: none needed, none added.
- *Reads of `matches`*: a direct SELECT policy would need column-level restriction
  (`state`/`seed` excluded), participant scoping via a `match_players` subquery, and
  per-game hidden-info awareness. That is a **second read path duplicating the redaction
  decision in a second language** — exactly the C1 seam ("a single policy-invocation
  signature across perfect- and hidden-info games without care… is where the bug comes
  back"). The only thing it would buy is skipping a route handler on the poll, worth
  fractions of a cent at Phase 2 scale.
- *Reads of `moves`*: §3.3 — never served directly, so no policy.
- *Reads of `match_players`*: the wire envelope already carries seat/series facts; no
  direct read needed.

What this buys, concretely:

1. **The audit is trivial.** "Zero policies exist" is checkable in one query and the
   `rls_enabled_no_policy` advisories remain the expected signature. Compare against
   auditing three column-scoped, subquery-scoped policies for correctness — the
   "partially-written policy set reads as reviewed while leaking" failure cannot occur
   because there is no policy set.
2. **The rollback story collapses** (§12): a leak can only live in deployed route code, so
   remediation is a Vercel deploy rollback — seconds — never a policy migration against a
   live database.
3. The permanent RLS probe test (§3.2 layer 3) turns "someone added a policy" from a
   silent regression into a red build.

Costs, stated honestly: every poll is a function invocation instead of a PostgREST read
(at 100k sessions/month with 20s polling this is well inside free/hobby budgets; the
roadmap's Phase 4 ladder — poke-over-poll — is the planned relief, not a schema change);
and Supabase Auth is no longer doing authorization work, only identity (§6) — RLS-based
authorization can be revisited at Phase 3 if leaderboards want PostgREST reads, as a new
ADR with these arguments on the table.

**Deviation note:** architecture-lens §4's prose allowed "direct table SELECT limited to
non-sensitive columns for participants." This plan overrules that with the reasoning
above; the lens's own "simplest safe posture" clause is the position adopted.

---

## 6. Anonymous identity

### 6.1 When the session is minted

`supabase.auth.signInAnonymously()` is called at exactly two moments, both inside the
client API wrapper (`match/client/api.ts`) as a just-in-time step before the first
authenticated request — **never on page load**:

1. Tapping **"Play a friend"** (about to POST create).
2. Submitting a **first move on an unclaimed seat** via an invite link (about to POST
   move+claim — see §7.2).

Opening an invite link mints nothing: the initial board view for an anonymous visitor is
served without auth (it is the guest-candidate or spectator view — redacted like
everything else). Bounces, lurkers, and link-preview fetches create zero `auth.users`
rows. The session (supabase-js default: localStorage) is attached to subsequent requests
as `Authorization: Bearer <access_token>`; route handlers resolve identity with
`auth.getUser(jwt)` (correct-over-fast for v0; local JWKS verification is a later
optimization).

### 6.2 How a device rejoins its own match

Same device, same browser: the anon session persists in localStorage; `user_id` matches
`match_players.user_id`; the route hands back `yourSeat` and the seat's view. A
localStorage list of joined codes feeds the home "Active games" strip — a convenience
cache only; the server mapping is authoritative.

### 6.3 If the session is lost

Cleared storage, private window, different browser/device: the anon identity is
**unrecoverable by design** — anonymous users have no credential to re-authenticate.
Honest consequences, shown plainly rather than papered over:

- The device becomes a spectator of its own match ("This game is between two other
  players — or was yours on another device. Start a new game?").
- The seat is orphaned; the match runs out its `expires_at`.
- No recovery mechanism ships in Phase 2. The real fix is Phase 3 account claim
  (`linkIdentity` onto the same user id — which this design keeps free by never binding
  seats to anything except `auth.users.id`). Building a bespoke seat-recovery token now
  would duplicate that machinery worse.

One self-inflicted edge, accepted and documented: a host who opens their own invite link
on a *second* device is an anonymous stranger to the server and can claim their own guest
seat. Unpreventable without accounts; harmless (they play themselves).

---

## 7. Invite, join, series — and the failure states

### 7.1 Create and invite

On "Play a friend": mint session (§6.1) → `POST /api/match` `{ gameId }` → server creates
round-1 match (`setup()` with a crypto-random seed — **never** the daily seed formula,
§10), claims seat 0 for the caller, returns the code. Client opens the native share sheet
with the rule sentence riding along (ux-lens §6.2 verbatim). Host's screen becomes the
live board: "Waiting for your friend — you can make your first move now." Host moves
before the guest exists; nothing blocks on the second seat.

`join_code`: 12 chars base62 (~71 bits) from a CSPRNG. The token *is* the capability;
ux-lens's 6-char example (~35 bits) is guessable at scale and is overruled. URL stays
short (`/g/x7Kp2mQr9ZtA`). Enumeration hardening beyond entropy (rate limits) is deferred
and recorded as an accepted risk at Phase 2 traffic.

### 7.2 Join — claim on first move (a flagged deviation from ux-lens §6.3)

ux-lens says the first unclaimed device to *open* the link takes the guest seat. This plan
claims the seat on the first **move** instead:

- An anonymous visitor to `/g/<code>` with seat 1 unclaimed sees the guest-candidate
  board (seat-1 view), rule card, host's moves, "You're O — your move." No session is
  minted, no row written.
- Their first cell tap mints the session and sends `POST .../move`; the server claims
  seat 1 and commits the move **atomically** (§8.3).

Why deviate: (1) claim-on-open mints an `auth.users` row on page load for anyone who taps
the link — including the accidental-tap bounce the "not on page load" rule exists to
avoid; (2) a claimed-but-vanished guest dead-locks the match with no recovery (no
accounts → no unclaim), whereas a claimant who has moved has demonstrably joined the
loop; (3) two simultaneous openers resolve by an atomic DB claim instead of a fuzzy
"first render wins." Costs: two "candidates" can both believe they're joining until one
moves — the loser gets an explicit "Someone else just took this seat — you're watching
now" state (§7.6), which is a *specified* failure instead of a silent one. For the
perfect-info launch game the candidate preview leaks nothing; for future hidden-info
games the candidate is served the **spectator** view until claimed, and the seat view
only after — one extra rule, noted in `redactForWire`'s seat resolution. **Orchestrator
sign-off requested on this deviation** (it amends a cited spec).

### 7.3 Turns

Poll while open (§8.4); on return, the page shows current state. The status line always
answers *whose move is it*. Terminal → shared end screen both sides; Rematch (either
player) → §7.4.

### 7.4 Rematch and series

`POST .../rematch` (participants only, current round terminal): creates round n+1 with
the same code, seats swapped, fresh seed; idempotent — if round n+1 already exists,
returns it (both players tapping Rematch race-safely converge on one new round). Series
scoreline ("Series: you 2–1") aggregates rounds by code.

### 7.5 The failure states — most of the real work

| State | Detection | What each viewer sees |
|---|---|---|
| Guest never comes | `open`, one player, `now() > expires_at` (7d) | Host: "Your friend never showed. Start a new game?" · Link opener: "This game expired before it started." + new-game CTA |
| Host abandons mid-match | No move refresh for 30d → expired | Both: final board so far + "This game expired." + rematch-as-new CTA. **No forfeit result** — an expiry is not a win (non-goal: clocks) |
| Finished link reopened | status terminal | Final board + result + "Start a rematch" (participants) / "Start your own game" (others) |
| Both seats claimed, third opener | seat resolution → null | Spectator view (`playerView(S, null)`), stated plainly, "start your own game" CTA |
| Candidate loses the claim race | atomic claim fails (§8.3) | Explicit "seat just taken — you're spectating"; their attempted move is discarded client-side |
| Stale round URL | round < max(round) | "This series has moved on" + forward link (status `superseded`) |
| Session lost | §6.3 | Spectator of own match + honest copy |
| Engine rules bump mid-match | `game_version` ≠ current `meta.version` | §11: match `void` — "Fadeout's rules were updated; this game can't continue. Start a rematch on the new rules." |
| Invalid/unknown code | lookup miss | 404 page, no oracle beyond existence (constant-time-ish handler; entropy is the real defense) |

### 7.6 Spectators

Phase 2 ships the minimum honest version: a **static** redacted board
(`playerView(S, null)`) with the standard poll — no presence, no count, no chat. This is
one branch of the existing seat resolution, not a feature; cutting even this (redirect
third openers to "start your own") is §14's first cut if the milestone squeezes.

---

## 8. Server design

### 8.1 Routes (all thin; all logic in `packages/match/server`)

```
POST /api/match                      create (auth required — this call is what minted it)
GET  /api/match/[code]               full envelope + view for resolved seat (auth optional)
GET  /api/match/[code]/poke          { stepCount, status, round, updatedAt } — numbers only
POST /api/match/[code]/move          { round, idx, move } — claims seat 1 if unclaimed
POST /api/match/[code]/rematch       participants only
POST /api/match/[code]/name          { displayName } — cuttable
```

Every non-poke response is a `Redacted<...>` payload (§3.2). The poke payload contains no
game data at all — it cannot leak because it never touches `S` (its handler reads only
envelope columns; `redactForWire` is not even in its path, and the leak-plant test in §3.2
covers it anyway by grepping its bytes).

### 8.2 Move validation sequence (per request)

1. Resolve identity (JWT → user_id, or anonymous-candidate).
2. Load match row + registry entry by `game_id`; **refuse** unknown game or
   `game_version` mismatch (§11).
3. `decode(state_cache)` — C4 guarantees this throws on a corrupt cache rather than
   validating garbage; on throw, fall back to `replay()` of the move log; if that also
   fails → `void` + 500, quarantined loudly.
4. Seat check: requester's seat === `active(S).player`. Includes the claim branch.
5. `isLegal(S, seat, move)` — the cheap membership check, exactly as the contract
   prescribes (never `legalMoves` scan).
6. `apply(S, Map([[seat, move]]), rngFor(seed, idx))` — identical semantics to
   `useGame`/`replay`, same rng derivation, so server matches, local replays, and future
   leaderboard verification are byte-compatible by construction.
7. Commit (§8.3) → `redactForWire` → respond.

### 8.3 Concurrency: one SQL primitive, zero game logic in SQL

supabase-js has no multi-statement transactions, and game logic cannot run in Postgres
(the engine is TS). The split: **all rules in Node, one atomic commit primitive in SQL** —
a plain function `commit_move(match_id, expected_step, seat, claim_user, move, new_state,
new_status, new_active_seats)` that, in one transaction: inserts the seat claim if
requested (PK conflict → raise `seat_taken`), inserts the `moves` row (PK `(match_id,
idx, seat)` conflict → raise `duplicate_move`), and updates `matches` guarded by
`where step_count = expected_step` (0 rows → raise `stale_state`). The function contains
no conditionals about the game — it is a CAS, nothing more.

Client-visible mapping: `seat_taken` → the race-loss state (§7.5); `duplicate_move` /
`stale_state` → 409, client refetches the view and re-renders (a double-tap or a
same-seat second tab resolves itself; the losing submission simply never existed).
Idempotent retries: the client sends `idx`; a retry of an already-committed idx gets 409 +
fresh view showing the move landed — safe under flaky mobile networks.

### 8.4 Polling

`GET .../poke` every 20s while visible; 60s when `document.hidden`; stopped on terminal
status. `stepCount` (or `round`) change → fetch the full view. No ETag machinery in v0 —
the poke payload is ~100 bytes.

---

## 9. Client design

### 9.1 A separate hook — `useAsyncMatch`, not a `useGame` mode

`useGame` is a *local-authority* loop: it holds `S`, applies moves itself, drives the bot,
replays for undo, persists locally. An async client is the opposite shape: it holds only
`V`, proposes moves, and reconciles with server truth. Grafting a mode onto `useGame`
would hand the canonical-state-holding code paths to a surface that must never have them —
the structural version of the C1 mistake. So: `packages/match/client/useAsyncMatch.ts`,
sharing the *presentation* layer (`GameShell`, `BoardShell`, announcer composition,
`StatusLine`, `ResultModal`) but none of the authority loop. `useGame` is untouched.

Surface (deliberately parallel to `UseGameResult` where meaning matches): `view`, `legal`
(computed via `presentation`-safe means — see below), `status`, `yourSeat`, `activeSeat`,
`seriesScore`, `submitMove`, `rematch`, `polling`/`submitError` states. No `undo` (server
matches are undo-free, like dailies), no tiers, no bot states, no handoff.

`legal`: for perfect-info games `legalMoves(V-as-S, seat)` runs client-side (V ≅ S — the
engine chunk is already on the page). For hidden-info games client-side legality is
advisory-only against V; the server verdict is authoritative and an ILLEGAL response
re-syncs. Phase 2 ships perfect-info only, but the hook's contract states this now so the
first hidden-info game doesn't discover it.

### 9.2 No optimistic apply in v0

Architecture-lens sanctions optimistic local apply for perfect-info games. Deliberately
cut: moves in this mode are hours apart — a sub-second submit round-trip is imperceptible
at the cadence that matters — and cutting it means **the client never applies canonical
transitions at all**, one code path for perfect- and hidden-info alike, and one less seam
for state divergence. Reinstate later behind a measured complaint, not preemptively.

### 9.3 Routes and surfaces

- `app/g/[code]/page.tsx` — the match page (board via the registry's `loadEngine`/
  `loadPresentation`, exactly like `PlayClient`).
- "Play a friend" entry: game page controls + end screen (beside Rematch/Share).
- Home "Active games" strip from the localStorage code list (server-verified on render).
- Share artifact for a finished async match = **the invite/rematch URL itself** plus the
  series scoreline — not an emoji grid (C12/C18: no new artifact grammar without a swept
  distribution; the URL is the artifact here).

### 9.4 Bundle discipline

`@supabase/supabase-js` (or `@supabase/auth-js` alone if it fits the need — implementer
measures both) is imported **only** inside `match/client`, loaded via dynamic import on
first use (`/g/` route chunk and the "Play a friend" action). CI's existing per-route
budget covers `/g/[code]` at 75 kB gz; the shared shell chunk must not grow — asserted by
the existing budget gate, with `/g/[code]` added to its route list.

### 9.5 The Realtime tripwire, installed now

Phase 3's upgrade is Broadcast poke-then-fetch. A `postgres_changes` subscription would
ship raw row payloads — canonical `state` — to every subscriber, reopening the hole
around all three of §3's layers (it bypasses the route tier entirely). Two guards land
**in this phase**, while the temptation doesn't yet exist:

- eslint `no-restricted-syntax`/`no-restricted-properties` entry (the repo's existing
  pattern) banning `postgres_changes` and `.channel(` outside a single future
  `match/client/poke.ts` allowlist, with a message citing this section.
- This paragraph in the plan, so Phase 3's planner inherits the constraint: **the poke
  carries a match code and a counter, never a payload.**

---

## 10. The daily and async never intersect

Stated explicitly so nobody wires them together later:

- The daily's comparability contract (pinned bot era, suspended series alternation,
  no-undo, rollouts-only budget, offline-computable seed) is about **one human vs one
  pinned bot on one shared seed**. Async has no bot, no par, no certificate, and
  crypto-random per-match seeds. There is no meaningful "daily async match," and none
  ships.
- Structural guards, not discipline: `useAsyncMatch` has **no daily option** in its type
  (the field does not exist, unlike `useGame`); match creation derives seeds from
  `crypto.randomUUID`, never `dailySeed()`; `recordDailyCompletion`/streak writes are
  called from `useGame`'s terminal path only — async terminals never touch streak or
  daily-result storage. The streak remains "played today's Twist," and an async win does
  not feed it.
- Share grammar: daily artifacts keep the C8 grammar; async shares are URLs (§9.3). No
  shared composer, no drift surface.

---

## 11. Engine versioning across days-long matches

Async matches live for days; games update weekly; `GameMeta.version` bumps on **any**
rules change. Policy, chosen for honesty over machinery:

- Every match pins `game_version` + `engine_version` at creation (§4.1).
- The server **refuses to advance** a match whose `game_version` no longer matches the
  deployed engine's `meta.version` → status `void`, copy per §7.5's table, one-tap
  rematch on current rules. The final board (from the move log replayed by… nothing —
  we do not replay under mismatched rules; we show the cached last view state only,
  clearly labeled).
- Rejected alternative: shipping versioned engine bundles so old matches finish under old
  rules — real complexity (N live engine versions in the bundle and on the server) to
  save a casual match, and it violates the single-deployed-version simplicity the
  platform is built on. Rules bumps to *shipped* two-player games should be rare and
  reviewed; the void policy makes their cost visible instead of hidden.

---

## 12. Migration, ordering, and rollback

Ordering principle: **at every intermediate state, the remote is either deny-all with no
server code deployed, or deny-all with server code deployed — there is no state in which
a policy exists.** Nothing to exploit between steps because the access model never passes
through a permissive phase.

1. **Bring the schema home.** The repo has **no `supabase/` directory** — the applied
   schema exists only remotely (applied via MCP). Create `supabase/config.toml` (template
   per CLAUDE.md §5 port-block convention) and check in migration 0001 as the byte-exact
   baseline of `phase2_async_match_schema_deny_all`, verified by diffing against
   `supabase db pull` from the remote. Local worktree stacks now reproduce the remote.
   *(This is a prerequisite for every team that follows; do it first.)*
2. **Migration 0002 — amendments** (§4): version columns, `(join_code, round)`, `round`,
   `step_count`, `expires_at`, status values, `display_name`, plus `commit_move()`.
   Apply locally → test → apply remotely. Tables are empty; this is `ALTER`s with zero
   data risk. Re-run the canary verification after (plant a row with canary seed/state,
   probe as anon for `select *` and `select seed,state` **and the new columns**, delete
   the row) — new columns are new surface, and the standing rule holds: verify against a
   table that contains a row.
3. **Enable anonymous sign-in** in the remote's auth settings (config toggle,
   reversible, no schema impact).
4. **Deploy server code + routes** (dark — no UI links to them yet). Leak-plant and RLS
   probe tests green in CI first. Env: `SUPABASE_SERVICE_ROLE_KEY` server-only on Vercel;
   `NEXT_PUBLIC_SUPABASE_URL` / anon key public.
5. **Ship the UI** (`/g/`, "Play a friend").

**Rollback / incident story:**

- *A route leaks canonical state* (the C1-third-attempt scenario shipping despite three
  layers): remediation is a **Vercel deploy rollback** — seconds, no DB touch — because
  no policy layer exists to migrate. Belt-and-braces kill switch: `MATCH_API_ENABLED`
  env check in the route tier → 503 with honest copy, flippable without a deploy.
- *Blast radius accounting*: a leaked seed/state compromises the affected hidden-info
  matches only (no shipped hidden-info 2-player game in Phase 2 → blast radius of the
  launch config is "opponent saw nothing they couldn't derive"). Compromised matches
  cannot be re-secreted (the seed defines the match): mark them `void`, say why in the
  UI, offer rematch. These are casual games; this is proportionate, and it is the honest
  ceiling of what rotation can do.
- *A policy appears* (someone "temporarily" opens a table): the §3.2 RLS probe test goes
  red on the next CI run; revert is `drop policy` — but the real defense is that no
  workflow in this plan ever needs one.
- *Schema amendment regret*: tables are empty until launch; pre-launch, roll forward
  with plain migrations. Post-launch, additive-only changes (the same discipline as
  everywhere else in this repo).

---

## 13. Scope discipline — what is not in Phase 2, and why

Consolidated (see §1 non-goals for the list): everything cut shares one property — it
adds an *audience* or a *liveness* dimension before the loop is proven. Matchmaking needs
liquidity that doesn't exist (roadmap: "a lobby with nobody in it is worse than no
lobby"); realtime needs presence infrastructure to improve a cadence measured in hours;
clocks/forfeits add adjudication to a product with no stakes; notifications need the
account layer. The Phase 2 exit metric is *median time-to-first-friend-move* and share
rate — every cut item could double the build without moving either number. Each has a
named home (Phase 3/4 rows in the roadmap) rather than a silent omission.

---

## 14. The cheapest shippable slice — recommendation

**Ship "Phase 2a": Fadeout-only async, ~the smallest thing that can prove the viral
hypothesis**, then generalize. The hypothesis is *"a shared URL converts a friend into a
player and both return"* — it is testable with:

- one game (Fadeout — the flagship, perfect-info, already shipped),
- create → share sheet → claim-on-move join → alternate → finish → rematch/series,
- polling, lazy expiry, the full §3 authority stack (this is the one part that must ship
  complete — it is the part that cannot be retrofitted safely),
- **cut from 2a**: spectators (third opener → "seats taken, start your own"), display
  names, the Active-games strip (localStorage list → a simple "resume" link on the game
  page), optimistic apply (§9.2 — already cut from v0 entirely), hidden-info/simultaneous
  serving paths (code seams exist; no game exercises them).

Because the whole stack is registry-driven, "generalize to every 2-player game" is
Phase 2b ≈ flipping a manifest flag per game once each game's `announce()`/presentation
strings are verified in the async context — near-zero marginal cost, which is the
pipeline thesis doing its job. The instrumentation for the exit criteria (time-to-first-
friend-move, share-URL landings) is a SQL query over `matches`/`moves` timestamps plus
the existing K-factor proxy — no product surface needed.

What 2a must **not** cut: the three enforcement layers (§3), the CAS commit primitive
(§8.3), lazy expiry states (§7.5 — "most of the real work" is these, and a dead-end link
with no copy kills the loop faster than a missing feature), and the version-void policy
(§11 — weekly updates *will* hit a live match in week one).

---

## 15. Definition of done (feeds stage-3 test design)

Green means all of:

1. §3.2's four test families green in CI: leak-plant chokepoint test, full-HTTP-bytes
   canary grep across every route as host/guest/spectator, RLS probes against non-empty
   tables, per-engine redaction contract suite.
2. Two-browser-context Playwright flow: create → share URL → second context claims by
   moving → alternate to terminal → rematch → seats verifiably swapped → series score
   correct.
3. Every §7.5 failure state reachable in a test and rendering its specified copy —
   including the claim-race loser, the stale-round URL, duplicate/stale submissions
   (409 + converged view), and the version-void state (simulated by bumping a test
   engine's `meta.version`).
4. Replay invariant: after any committed sequence, `encode(replay(record).final) ===
   matches.state`, including under concurrent submission attempts.
5. Session-loss behavior verified (cleared storage → spectator of own match, honest copy).
6. Bundle gate: `/g/[code]` ≤ 75 kB gz; shared shell chunk unchanged; supabase-js absent
   from all non-match chunks.
7. Lint gates firing: `postgres_changes` ban, server-package import ban from client code
   (verified by *planting* a violation of each, per the repo's own practice).
8. `pnpm typecheck`, `pnpm lint`, full suite green; migration 0001 byte-matches the
   remote; canary re-verification (§12.2) recorded in the PR.

Stage-3 (Fable test design) should additionally attack: unfurl-bot GET on an invite link
(no row minted), Authorization-header replay against another match's code, `idx` skipping
(submitting idx+5), malformed move JSON (C4 path — typed throw, 400, no partial write),
and clock skew around `expires_at` boundaries.

---

## 16. Sequencing (agent-team milestones)

| # | Milestone | Contents |
|---|---|---|
| A0 | Schema home + amendments | §12.1–.2: `supabase/` dir, migrations 0001/0002, `commit_move`, canary re-verification. Small, unblocks everything |
| A1 | Authority core | `packages/match` skeleton, wire brand, `redactForWire`, `assertNoCanonicalLeak`, leaky-mock tests, service layer create/view/move/rematch vs local stack (TDD) |
| A2 | Routes + identity | Route handlers, JWT resolution, anonymous sign-in flow, poke endpoint, full-bytes leak tests, lint boundary blocks |
| A3 | Client | `useAsyncMatch`, `/g/[code]`, Play-a-friend + share sheet, polling with visibility backoff, series UI |
| A4 | Failure states + hardening | §7.5 table end-to-end, version-void, expiry copy, bundle check, two-context Playwright, metrics queries |

One worktree/team per CLAUDE.md §4–5 (this feature is one team; A0–A4 are sequential
stages, not parallel teams). The team's local stack must have anonymous sign-in enabled
in its `config.toml` (`[auth] enable_anonymous_sign_ins = true`) — note it in the
worktree registration so test runs don't chase a config ghost.

---

## 17. Open questions (none blocking A0–A1)

1. **§7.2 deviation sign-off** — claim-on-move vs ux-lens's claim-on-open. Orchestrator
   decision requested; the plan proceeds on claim-on-move.
2. `@supabase/auth-js` alone vs full `supabase-js` on the client — implementer measures;
   the plan constrains only the chunk placement and budget.
3. Poke interval (20s visible / 60s hidden) — tune freely; only the "no payload in the
   poke" rule is binding.
4. Whether 2a ships display names or the "Guest ✎" affordance waits for 2b — cuttable
   either way; zero structural impact.

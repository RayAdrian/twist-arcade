# Platform corrections — found during game planning

*Orchestrator-owned. Three corrections to `phase-0-platform-spine.md`, each surfaced by a
game team's planning pass after that plan was written and approved. None affects M1; all
are binding on the milestone named. 2026-08-02.*

Why this file exists: the game plans found real errors in the platform plan. That is the
system working — a plan reviewed only by its author is a plan reviewed by nobody — but the
findings must reach the platform implementer at the right milestone rather than living in
a chat log.

---

## C1 — Policies for hidden-information games must receive the view, not the state

**Milestone: M2 (bots) and M3b/M3c (harness). Severity: critical — fails silently.**

*Found by: Mine Run plan, §4.4.*

Harness policies currently receive the full canonical state. For a game with
`hiddenInformation: true`, that means a "Strong" agent can read unrevealed secrets —
mine positions, an opponent's hidden pile — and play at a level no human could reach.

The consequence is not a crash. It is a **passing gate on a broken game**: Strong posts a
Strong/Random ratio far above threshold, the CI gate goes green, the game ships, and it is
unplayable blind. Nothing errors. The number simply means something other than what
everyone reading it believes.

**Fix, in preference order:**

1. **Type-level (preferred).** Policies evaluated against a hidden-info game receive
   `playerView(state, seat)`, not `state`. View-honesty stops being a discipline the
   policy author must remember and becomes something the compiler enforces.
2. **Runtime probe (keep regardless).** The resampling test from the Mine Run plan: fix a
   view, re-deal the hidden worlds consistent with it, assert the policy returns an
   identical move. A compile-time guarantee plus a runtime probe is the right
   belt-and-braces for a failure this quiet.

This also means the harness cannot use a single policy-invocation signature across
perfect- and hidden-information games without care — that seam is where the bug would come
back.

---

## C2 — Solo CI gates must be selected by `manifest.solo.format`, not by player count

**Milestone: M3c (solo suite). Severity: blocking for the solo games.**

*Found by: Crackstep plan.*

Crackstep and Mine Run are both `maxPlayers: 1` and share almost no gates. Crackstep is a
deterministic puzzle: it has no `score()`, no `safeMove`, and structural termination, so
the score-chase gates (Strong/Random ratio, score-distribution overlap, Always-Safe, Grind,
run-length CV, ceiling pile-up) are not merely unmet — they are **inapplicable**. Mine Run
is a score chase and needs all of them.

Keying the gate table on player count would run score-chase gates against a puzzle and
hard-error it for lacking a `safeMove` hook it has no business having.

**Fix:** the `solo-ci` / `solo-design` runners select their gate table from
`manifest.solo.format` (`puzzle` | `chase`). A gate that does not apply to a format must be
reported as **explicitly N/A**, never silently skipped — a skipped gate and a passed gate
must never look the same in a report.

---

## C3 — `harness solve` is not generic; history-dependent games compose it locally

**Milestone: M3a (solver). Severity: documentation and API shape.**

*Found by: Fadeout plan, §3.4 / §14.*

Platform plan §7.6 implies `harness solve <game>` works for any game under the state-space
ceiling. It does not. Under **superko**, legality depends on the history of positions
reached, so that history lives in the state — and `encode` is therefore *not* a valid
position key. Deduplicating on `encode` would conflate genuinely different game states and
silently misvalue the solve.

**Fix:** ship `harness solve` with an explicit caveat and expose the reach/retrograde
building blocks as importable pieces, so a history-dependent game composes a game-local
solver instead of receiving a broken promise. Fadeout's solve is such a script.

The general test for a future author, worth stating in the docs: **if legality or outcome
depends on the path taken rather than the position reached, `encode` is not a position
key.** Fadeout (superko) is one pattern; Crackstep is the other — its positions can never
repeat, so `encode` is a sound key and the generic dedup works directly.

---

## C4 — `decode` must throw on malformed input, never return a partial state

**Milestone: contract ruling now; enforcement property in M2. Severity: contract decision.**

*Raised by: the M1 re-review (gap G-7). Ruled by the orchestrator 2026-08-03.*

The plan never said what `decode` does with input that is not a valid encoding of that
game's state. Crackstep and Mine Run are both registered and would each answer it
differently, and divergence here gets expensive once games ship.

**Ruling:** `decode(x)` either returns a state satisfying the engine's own invariants, or
it **throws a typed error**. It must never return a partially-constructed, type-unsound,
or silently-defaulted state.

The reason is the trust boundary, not tidiness. `decode` feeds `replay()` and
`verifyCertificate` — the two places where the platform decides whether a submitted move
log or a shipped daily is genuine. A `decode` that quietly accepts garbage and returns a
plausible-looking state means a forged record can validate. That failure is invisible: no
exception, no red test, just a bad record treated as good.

Scope for now: every game's `decode` honours this. Full schema validation and a testkit
property that plants malformed encodings land in M2 — the ruling binds today so nobody
writes a lenient `decode` in the meantime.

---

## M2 entry checklist (from the M1 re-review's deferrals)

Conditions attached to approving M1 with these gaps open. Each names the point at which it
stops being deferrable:

- **G-2 (encode injectivity) and G-9 (`Map`-mutation purity blind spot) — before the first
  game team's contract gate runs.** G-9 is the likeliest real-bug catcher of the set:
  mutating the `moves` Map is an easy mistake, and a collision-prone `encode` breaks solver
  dedup silently.
- **G-6 (`replay()` ignores `gameId`/`gameVersion`) — before any engine version bump**, so
  a replay can never be validated against the wrong game or the wrong rules. The
  certificate boundary already validates both; `replay()` itself does not.
- **G-4 (NaN/Infinity encode as `null`) — early in M2**, before games generate real states.
  Tightening later cannot orphan valid replays, since anything containing NaN was never
  JSON-plain to begin with.
- **G-14 — accepted deviation**, with two conditions: fix `checkDeterminism`'s undocumented
  default of 10 to match the documented 20, and have M3's CI gate configs pass an explicit
  `runs` (≥100) rather than relying on defaults.
- **G-12 (`ruleSentence` assertion home) — re-scoped to M5 template tests**, recorded so the
  decision is not silently lost.

---

## C5 — Animation libraries (ReactBits et al.): welcome in chrome, never as board state

**Owner: shell team. Severity: standing design rule.**

*User decision, 2026-08-03: component libraries like reactbits.dev are approved for richer
animation and visual polish.*

**Welcome (chrome):** result modal, library home and cards, route transitions, streak and
share moments, empty states, hover/focus flourishes, the daily hero. Delight is the point
and motion carries no information.

**Not welcome (the board):** `ux-lens.md` §9 requires every animation to restate something
a static encoding already shows. This is not stylistic — it is what makes
`prefers-reduced-motion` safe. If imminent decay is communicated *by* a pulse, a
reduced-motion player cannot see it coming and the game is unplayable for them. The
countdown badge and opacity step are authoritative; motion narrates what they already say.
An effect that becomes the sole carrier of a state change is a bug regardless of how good
it looks.

**Constraints, mostly inherited from `architecture-lens.md` §5:**

- ReactBits is copy-in source, not a dependency — each effect's cost shows up in the diff
  rather than hiding in a bundle. Keep it that way.
- Its components often pull GSAP or Framer Motion. Framer (~30 kB) is acceptable in chrome
  if it earns its weight; it must never appear inside per-cell rendering. Motion One or
  plain CSS in the hot path.
- The 75 kB gz per-game-route budget is a hard CI gate. Chrome-level animation lives in the
  shared shell chunk and is therefore paid once across the whole library — an argument for
  putting polish in the shell rather than in game code.
- `prefers-reduced-motion` and the grayscale-screenshot test still apply to every board
  state.

A board-level effect proposal goes through the orchestrator with its backing static
encoding named — not adopted quietly.

---

## Related, already routed to their owning teams

- **`firstOccurrence` becomes an array** (shell). Games have more than one teachable
  first — Crackstep alone has the first crumble and the first stone-tile survival. Each
  entry carries its own once-per-device flag key.
- **Determinized Strong lives in `packages/bots`** (M2), not in any game. It is reused by
  every hidden-info game and it becomes the shipped hint feature; a game-local copy would
  fork the thing players actually touch.
- **A documented exception to the 48 px cell floor** exists for Mine Run (10×10 cannot fit
  at a 320 px viewport), conditional on mandatory two-tap commit on every platform. The
  shell team owns the floor and must know it has exactly one sanctioned violation.

---

## C6 — A validation yardstick must be strong enough to measure with

**Milestone: M2 bots + Mine Run. Severity: high — produces both false passes and false
failures, silently.**

*Found by: the M3c solo-harness implementer, 2026-08-03. Ruled by the orchestrator.*

The shipped solo `Strong` agent — `determinize(flatMonteCarloPolicy())`, one sample, a
**uniform-random** rollout — could not reliably clear the Always-Safe gate even against a
*healthy* Mine Run. Validating the gate's mechanism required a test-local K-sample,
greedy-rollout Strong.

**Why this is C1's problem one level deeper.** C1 guards against a policy that *peeks* —
an omniscient bot posts a passing skill ratio on an unplayable game. C6 is a policy that is
honest but **too weak to be a yardstick**. Every solo gate is defined relative to Strong:
"Strong/Random median ratio < 1.5", "Always-Safe ≥ 95% of Strong". If Strong is weak, the
ratio collapses toward 1 on a *good* game (false fail), and any threshold loosened to
accommodate it stops catching a genuinely degenerate one (false pass). Both directions are
silent.

**Root causes, both already specified and both unbuilt:**

1. `flatMonteCarloPolicy`'s rollout is uniform-random; `mine-run.md` §4.4 specifies a
   **greedy** rollout. This is the game's own open question O1, unresolved.
2. `games/mine-run/heuristic.ts` is specced in `mine-run.md` §4.5 and **does not exist**, so
   `greedyOnlyPolicy` and beam's `evaluate()` fall back to bare `engine.score()` — which
   equals `banked` and is therefore **blind to unbanked streak value**, the entire quantity
   the press-your-luck decision turns on.

**Ruling:** build both before any solo gate result is trusted. Implement the greedy rollout
in `packages/bots` (parameterised, so a game supplies its rollout policy) and
`games/mine-run/heuristic.ts` scoring banked **plus** unbanked-streak expectation. Then
re-run the Always-Safe validation with the shipped Strong and confirm the separation the
test-local Strong demonstrated. Until that holds, **no solo gate number is evidence**.

**The general rule, worth applying beyond this game:** a gate defined relative to a
reference agent is only as trustworthy as that agent. Before believing a threshold, verify
the reference clears it on a known-good input — otherwise the gate measures the yardstick,
not the game.

**Also record:** an Always-Safe separation requires the reveal budget to be tighter than the
cell count. Where `revealsLeft budget == totalCells` there is no reveal scarcity and the
gate shows zero separation at any mine density. Belongs in the plan's tuning notes.

---

## C7 — `manifest.solo.format` literals: the code is right, the docs are wrong

**Severity: documentation.**

C2 and `roadmap.md` §6 say `"puzzle" | "chase"`. The shipped
`packages/game-spec/src/manifest.ts` uses **`"daily-puzzle" | "score-chase"`**. The M3c
implementer built against the real code, which is correct. The docs are the error and are
corrected here; C2's *substance* (select the gate table by format, never by player count)
is unchanged.

---

## C8 — One implementation of streak and share composition, in `packages/shell`

**Owner: shell + daily teams. Severity: divergence that will rot silently.**

*Found by: the Phase-1 daily implementer, 2026-08-03. Ruled by the orchestrator.*

`packages/shell/src/streak.ts` and `share-frame.ts` shipped with the shell merge. The daily
team, correctly told to build on the shell rather than replace it, then built plan-correct
versions in `packages/daily` — because the shell's differ **materially**, not cosmetically:

- shell's streak has no `best` field and **does not protect against a resumed old daily
  resetting the count** — precisely the case `daily-and-share.md` §6.2 calls out;
- shell's `composeShareArtifact` cannot reproduce the plan's binding grammar: no glyph,
  `#37` rather than `Daily #37`, and a separate restart line instead of the inline
  `· attempt k`.

Two implementations of the same concept, both live, differing in ways a reader would not
notice. They will drift, and the wrong one will be used in the wrong place with nothing
erroring — the same silent-divergence shape as every other defect this build has produced.

**Ruling: consolidate into `packages/shell`, correcting it to the plan-binding behaviour.**

Direction matters. `shell` is the lower-level package — `useGame`, `ResultModal`, and
`GameShell` already import these modules — and `daily` is the feature layer above it. So the
corrected logic lives in `shell` and `daily` imports it. Moving it the other way would
invert the dependency.

Concretely: port the daily versions' behaviour into `packages/shell/src/streak.ts` and
`share-frame.ts` (the `best` field, resumed-old-daily protection, the binding share
grammar), update shell's existing consumers and tests, delete the duplicates in
`packages/daily`, and have `packages/daily` import from `@twist-arcade/shell`. One
implementation, one set of tests.

**Also settled here:** `daily-and-share.md` §4.2's prose caps (stat line ≤40 chars, body
line ≤14 glyphs) contradict its own §4.4 literal fixtures (42 and 41 chars; 15 glyphs). The
Definition of Done requires byte-for-byte fixture reproduction, so **the fixtures win** —
enforced caps are 42 and 15. The prose is the error. The implementer chose this and
documented it rather than silently satisfying one and failing the other; that was right.

---

## C9 — `grindProbe` is structurally blind to the farming loop it exists to catch

**Milestone: M3c. Severity: high — the probe cannot detect its own headline case.**

*Found by: the M3c stage-6 review, 2026-08-03, with an executed counterexample.*

Spine §7.4 specifies Grind as "cycle detection on `encode(S)` … score delta ≥ 0". Those two
clauses **contradict each other**, and the implementation inherits the contradiction
faithfully.

`probes-solo.ts:94` requires `encode(next) === startEncoded`. But score (`banked`) lives
**inside canonical state**, so encode-equality forces `delta === 0` exactly — the `>= 0`
clause is dead code. The probe can only ever see zero-delta self-loops.

**Executed proof:** a Mine Run mutant whose `bank` credits `streakValue` but never resets
the streak is a genuine infinite zero-risk farm — banked strictly increases by `v` per bank
across five iterations, every other field byte-identical, status ongoing. `grindProbe`
returned `found: false`.

The one shape the probe *can* see is the bank-at-`streakLen 0` delta-0 self-loop, which is
exactly the case the M3c tests plant. So the probe passes its own test while being blind to
the class the solo lens describes as "score grows linearly with moves".

**This is a plan defect, not an implementation slip** — hence a recorded correction rather
than a patch. Spine §7.4's mechanism must change to one of:

- cycle-detect on a **score-projected key** (score fields normalised out before encoding), or
- detect a **move sequence repeatable k times with identical positive per-iteration delta**.

The second is closer to what the gate means and is harder to fool.

*Verified clean in the over-fire direction:* a near-miss mutant (a legal no-op that costs a
reveal — bounded, not a loop) correctly stays quiet, as does the healthy engine.

---

## C10 — `verifyCertificate` never checks the one number the certificate exists to publish

**Milestone: M3d + engine testkit. Severity: high — a forged par validates.**

*Found by: the M3c stage-6 review, 2026-08-03, by tampering a real certificate.*

`verifyCertificate` (`packages/engine/testkit/checks.ts:743-771`) checks `gameId` and
`gameVersion`, and replays `moveLog` to a `won` terminal. It **never compares `par` to
`moveLog.length`**.

**Executed:** tampering a freshly certified hole-walk certificate to `par: 999` passes
verification, and the gate's par-range row passes for any in-band forged value.

`par` is *the* published number — it is simultaneously the fairness proof, the difficulty
calibration, and the share hook. A certificate whose replay is valid but whose par is wrong
is worse than no certificate: it carries the full authority of having been verified.

**Fix** (route through the orchestrator, since `checks.ts` belongs to the engine lane):
extend `CertificateReplayInput` with an optional `par`, throwing when supplied and
`≠ moveLog.length`; or add a harness-side verification wrapper that certify and the CI job
both call. The same gap covers `parKind` and `guessFree` tampering.

---

## C11 — Fog dailies must be rejected unless deduction-only

**Milestone: M3d. Severity: medium — silently omitted rather than explicitly N/A.**

Spine §7.7 and solo-lens §3.3 both list "fog games — if not deduction-only" as an explicit
rejection clause, and lens §3.8 carries a CI row for it. `certifyDay` records
`guessFree: solveResult.guessFree ?? false` for hidden-info engines but **never rejects on
it** — a fog daily requiring a guess gets certified with `guessFree: false` and ships.

`SoloGatePuzzleInputs` has no `guessFree` field and neither gate table carries the row, so
by C2's own standard the concern is *silently omitted* rather than reported N/A. No shipped
game hits it today (Crackstep is perfect-information; Mine Run publishes no certificates),
but this is the platform-wide pipeline and the next fog game inherits it.

**Fix:** a rejection clause in `certifyDay` when
`engine.meta.hiddenInformation && !solveResult.guessFree`, plus a `fogDeductionOnly` row in
both gate tables (N/A with a reason for non-fog and for chase formats).

---

## Remote Supabase — prepped 2026-08-03, deny-all until Phase 2

**Project:** `fjiwrzaosluymamannaw` · `https://fjiwrzaosluymamannaw.supabase.co`

Applied migration `phase2_async_match_schema_deny_all` — the Phase 2 async-multiplayer
schema from `architecture-lens.md` §4 (`matches` / `match_players` / `moves`, with indexes
on `join_code`, `updated_at`, and `(match_id, idx)`).

**Every table has RLS enabled and zero policies.** That is the point, not an oversight.
The plan states its RLS intent in prose — "no client-facing SELECT of `state`/`seed` for
hidden-info games" — and prose is not enforcement. A partially-written policy set reads as
reviewed while leaking; an empty policy set cannot leak at all. Phase 2 opens exactly the
access it needs, one policy at a time, each justified. The three `rls_enabled_no_policy`
INFO advisories are the expected signature of this posture.

**Verified rather than assumed.** Writes from an anon client are refused (`42501`, RLS
violation). For reads, an empty table returning `200 []` proves nothing — so a row was
inserted server-side carrying `seed = 'SECRET-SEED-DO-NOT-LEAK'` and a canary in `state`,
and the anon client was queried for `select=*` and for `select=seed,state` directly. Both
returned `[]`; the canary appeared nowhere in any response. The probe row was then deleted
(0 rows remain).

That distinction matters and is worth keeping: **`200 []` from PostgREST is
indistinguishable between "RLS filtered everything" and "the table is empty."** If a
permissive SELECT policy is ever added by accident, the failure is silent — the endpoint
simply starts returning rows and nothing errors. Any future RLS work here must be verified
against a table that actually contains a row.

**Not applied, deliberately:** Phase 3's `game_results` and leaderboard tables, and any
policy at all. Phase 2 has no Fable plan yet, and this schema predates what M1–M3 taught us
about view redaction (C1) and trust boundaries (C4) — it will likely be revised when the
async-multiplayer feature is actually planned.

**Local development is unchanged.** Agent teams use per-worktree local stacks per
`CLAUDE.md` §5 and never point at this project. The remote is for deployed environments
only.

---

## RULESET FREEZE — Fadeout ships `remove-first` / solid / **threefold**

**Decided by the orchestrator 2026-08-03, on the F2 exact solve and its stage-6 review.
This unblocks F3 (UI). It is a freeze: changing it later is an ADR, not an edit.**

### What the solve proved

The eight syntactic configs are **six distinct games**. Five of them are dead on criterion 1
— each is a first-player forced win with the line `1→0→4→2→7`, **five plies, plainly
quotable**. Post that sentence once and the variant is over. The line was replayed through
the real public engine and produces a genuine win.

`remove-first`/solid under **threefold** is the sole survivor: **exact draw, all nine
openings drawn, no forced line to spoil.** Confirmed by two independent implementations.

### Why not superko, which the plan defaulted to

**Because a superko draw is impossible by construction, so the "unproven draw" the report
recommended shipping was never on the table.** Under superko the engine has no draw
terminal — positions can never repeat, and a stuck mover loses — so every superko game ends
decisively. The open questions were only *who* wins and *how quotable* the line is.

That inverts the report's own plausibility argument ("no forced-loss positions, so a hidden
forced win seems less likely"): a forced win for someone is **certain**. And the code had
been saying so all along — `pass2`'s draw arm is provably dead, three-valued minimax written
for a two-valued game. Nobody noticed, which is exactly how the prose error survived.

So option (b) was not a risk to weigh. It was eliminated.

### What threefold costs, honestly

The game-theory lens preferred superko for two reasons, and both dissolve here:

- **Draw rate** — moot. The game is a 100% draw under optimal play either way.
- **Termination** — threefold also terminates by construction: a position occurs at most
  twice before the third occurrence ends it, and the *engine* declares it, so players track
  nothing.

One cost superko would have carried, unflagged until review: with no draw exit at all, two
cautious humans in the 77k-node residue can grind indefinitely long decisive games.
Threefold gives the game a natural ending.

**Nothing downstream is wasted.** The engine's superko implementation stays a tested config
axis (unshipped, not deleted), `pass2` remains research tooling, and the harness never
depended on the repetition rule.

### The two decisions that follow

- **No pie rule.** It is gated on first-player advantage landing in 55–70%, and every
  opening here is already drawn. There is no advantage to correct. F4 should confirm the
  self-play FPA sits near 50%, but nothing in the exact values suggests otherwise.
- **No 4×4 / cap-4 escalation at launch.** That was conditional on the 3×3 solution being
  quotable. It has no forced win to quote at all.

### The one thing that could reopen this

A converged run of the reformulated superko attack showing a **P0 win with a long,
non-quotable line**. That would pass criterion 1's second clause *and* beat threefold on
criterion 3 (0% versus 100% optimal-play draw rate) — a genuine trade. The reformulation is
principled rather than "more nodes": the WIN-witness shortcut is sound for a *stronger*
unstated reason than its own doc claims, which collapses the search to vertex geography on
the 77,338-node draw residue, plus a free 3× from root symmetry.

Worth one bounded run. **F3 does not wait for it.** Per the plan's own standing rule: do not
ship a claim the solve did not prove.

---

## C12 — Fadeout's share timeline saturates; the §8 encoding predates the freeze

**Owner: Fadeout (F3/F4). Severity: the artifact is the growth engine, and this becomes the
library's template.**

*Found by the F3 stage-6 review, 2026-08-03, by executing 2,000 random games rather than
reading the encoding.*

**The measurement:** under the frozen ruleset (`remove-first`/solid), every move from ply 7
onward decays the mover's own oldest mark. Verified `faded ≡ max(0, plies − 6)` on
**2,000/2,000** games spanning 5–88 plies. Since 💨 *substitutes* for the seat glyph, every
artifact is `❌⭕❌⭕❌⭕` followed by an unbroken run of 💨 — a 60-ply game renders **54
consecutive 💨**. All seat identity is lost after ply 6.

And `pieces faded: 54 · 60 plies` prints **one degree of freedom twice**: given the identity
above, the two numbers are the same fact.

**This is the fourth iteration of the same lesson** (§14 → §15 → §16 → here). The plan's §8
encoding was written before the ruleset was frozen and was never re-run against it. §16's
own instruction — *sweep the per-game statistic the artifact actually prints* — was applied
to the stat line and not to the timeline.

### Ruling

1. **Drop `pieces faded`.** It is provably derivable from ply count under this ruleset.
   Keep plies.
2. **💨 marks only the first decay**, and seat glyphs are retained for every move. That
   marks the moment the twist becomes visible — the artifact's actual hook — instead of
   erasing the board's identity from ply 7 onward.
3. **Accept that Fadeout is a low-variance artifact game, and say so rather than
   over-engineering it.** Strict alternation makes the seat sequence deterministic, so the
   timeline's genuine information is *length*, *result*, and *where the winning move fell*.
   That is thin, and it is honest. The daily number and the result carry most of the social
   weight; not every game in the library needs a rich artifact, and inventing variance that
   isn't there is worse than admitting there is little.
4. **This artifact must not be copied as the library's template** without re-running the
   distribution sweep for that game's own ruleset. Encoding decisions made before a freeze
   are unvalidated by construction.

### Related, and due before the next daily increment

Post-rebase, `main`'s C8 strict grammar (`composeShareText`, 15 glyphs per line,
`timelineToBody` splitting into 2×14) will **reject** Fadeout's single-line timeline for any
game over 15 plies. Nothing calls it with a game body yet, so it is not an at-merge crash —
but the committed daily days on `main` *are* Fadeout days. Decide explicitly whether Fadeout
chunks its own timeline or the daily adapter does, and record it, rather than discovering it
as a thrown `ShareGrammarError` inside a live daily.

---

## C13 — There is no way to run the CI gates for one registered game

**Milestone: M4 follow-up. Severity: friction that pushes teams into ad-hoc scripts.**

*Found by the Wrap team, 2026-08-04, while trying to run its own ship/no-ship gates.*

Two entry points exist and neither does the obvious thing:

- **`harness suite`** hard-refuses anything outside the built-in testkit fixtures, so it
  cannot run against a real registered game at all.
- **`scripts/ci-gates.ts`** iterates the *entire* registry, so checking one game re-runs
  every other game's gates too — at 10,000 rollouts per move for the ruthless tier, that is
  minutes of wasted compute per invocation and it grows with every game added.

The Wrap team's workaround was a temporary hand-written script calling
`runTwoPlayerCiGate` directly for one game. That works, but every future game team will
independently rediscover the need and write their own — which is precisely how a codebase
accumulates six subtly different versions of the same measurement, and how a team ends up
tuning a gate locally because running the real one was inconvenient.

**Fix:** teach `scripts/ci-gates.ts` a `--game <id>` filter (and, while there, let
`harness suite` resolve registered games rather than refusing them). Small change; it
removes the incentive to improvise around the gates, which are the one thing that decides
whether a game ships.

---

## C14 — Wrap fails its gate, in the direction nobody predicted

**Status: the first game the gates have killed. Escalated to design, not tuned.**

*Measured by the Wrap team, 2026-08-04.*

```
[PASS] strong-vs-random:      100.0%  (min 90%)
[FAIL] first-player-win-rate:  24.0%  (band 35–65%)
[PASS] draw-rate:               0.0%  (max 60%)
[PASS] mean-plies:             11.6, 0 cap hits
[PASS] ruthless-vs-standard:   76.0%  (min 60%)
```

Equal-strength self-play (ruthless vs ruthless, identical agents, so no seat effect is
possible) gives seat 0 a **24% win rate — a 76% advantage to the second player.**

**This inverts the design hypothesis.** `game-theory-lens.md` §1.7 and Wrap's own manifest
both predicted a strong *first*-player edge, because a torus is centrally symmetric and
strategy-stealing applies with extra force.

**Why the theory didn't protect us, and this generalizes:** strategy-stealing is a statement
about **optimal** play — it proves P1 cannot be a guaranteed loser against a perfect
opponent, since an extra mark never hurts you in this class of game. It says nothing about
two **equally configured but imperfect** MCTS agents at a fixed rollout budget. That is
precisely where the surprise lives, and it is where every game in this library will actually
be played. **A theorem about perfect play is not a prediction about the bots you ship.**

**It is not the mirroring risk we guarded against.** The mirror probe passed with total
margin — 0.0% over 500 games — and there is a structural reason: cell 12 is the centre of a
5×5 board and a fixed point of the point-reflection (24 − 12 = 12), so a mirroring P2 cannot
even mirror a centre opening. The 76% edge appears only under real MCTS-vs-MCTS search, so
it is a tempo phenomenon, not a copy-the-opponent vulnerability.

**The sanctioned remedy does not apply.** The pie rule converts an overly strong *first*
player opening into a strategic decision, and works only when a near-balanced opening exists
for P2 to decline. Here **P2 is already winning** — offered a swap, they simply never take
it, and the rule is a no-op. §5.9's cliff check doesn't even trigger by its own stated
condition (it is gated on first-player advantage of 55–70%; ours is a 76% *second*-player
advantage, outside the band entirely). There is no reverse-pie in this codebase's toolbox,
and inventing one is a design decision, not a parameter.

**Nothing was tuned.** No threshold changed, no `exceptions[]` entry added, no tier adjusted
— exactly the standing instruction. The remaining remedy on the plan's own menu is "a
different board": win-length, board size, or torus configuration. That is Fable's call.

**Worth stating plainly: this is the apparatus working.** Five research passes, a gate table,
and a self-play harness existed precisely so a game that looks clever on paper gets caught
before it reaches players rather than after. It cost one measurement run.

---

## C15 — Three scaffold gaps found by M5's first real user

*Found by the Wrap team while building the first game from `pnpm new-game`.*

1. **The registry template emits an unresolvable specifier.** It writes a bare
   `@twist-arcade/<id>`, but the root `package.json` never lists per-game workspace
   packages. Hand-worked-around once; will bite every future scaffold run until the template
   itself is fixed.
2. **No supported way to gate one registered game** — see C13. The Wrap team hand-wrote a
   throwaway script to avoid re-running Fadeout's ruthless-tier gates.
3. **`mirrorAgent()` requires a non-null `M`**, but every per-game `mirrorMove` is documented
   as returning `M | null` with a "falls back to random" promise that **is implemented
   nowhere** in `roster.ts` or `runner.ts`. A documented fallback that does not exist — the
   same defect shape this build keeps producing, now in the probe wiring. It has been locally
   worked around twice rather than fixed once.

4. **`pnpm new-game` registers the game unconditionally.** There is no `--no-registry` flag,
   so building an engine *without* registering it — which gate-before-UI (C16) now makes the
   normal case — requires manually reverting `games/registry.ts` afterwards. Found by the
   Nine Grids team, who had to do exactly that.

**What the scaffold got right**, and it is the larger half: after rebasing across ten commits
of shell restyle and the real bot worker landing, Wrap's board UI, four-variant `announce()`,
and registration were **already correct with zero adaptation** — confirmed by planting two
lint violations by hand to prove the boundaries actually fire.

---

## C16 — The Wrap diagnosis, and the rule it generalizes to

*Fable's ruling, 2026-08-04. Full reasoning in `docs/plans/wrap-redesign.md`.*

**Mechanism, verified by enumeration rather than inferred.** On a 5-cycle, win-length 4 is
**degenerate**: C(5,4) = 5 equals the number of wrap-windows, so *every* 4-subset of every
line-cycle is a winning set. "In a row" is vacuous when win length = cycle length − 1.

The consequences follow mechanically: any 3 stones in a clean cycle are a double threat; one
enemy stone collapses a cycle's 5 windows to 1 **from any cell**, so every block is
placement-free and therefore reliably dual-purpose; every stone quad-poisons, since each cell
sits on 4 cycles; and vertex-transitivity means P1's opening carries **zero** targeting
signal. Defense is over-efficient, the responder always places with strictly more
information, and the initiative becomes a liability.

Two plausible hypotheses were **rejected with evidence**, which is why the diagnosis is
trustworthy: parity is irrelevant (games end near ply 12, so P1's 13th stone never exists),
and line density cannot be the operative variable (per-cell window incidence is 16 on both
5×5 and 6×6).

**Ruling: 6×6 torus, win length unchanged at 4.** Each degenerate quantity disappears — 6 of
15 subsets win, consecutiveness becomes real, one stone no longer kills a cycle. One
measurement run. **If FPA lands outside 35–65 in either direction: kill Wrap, promote Duel
Draft, and pass the topology slot to Closing Walls.** No third board — a second failure would
indict vertex-transitivity, which no torus escapes.

Rejected alternatives: a cylinder (keeps the degeneracy on the wrapped axis), win-5 (draw
city), reverse-pie (papers over "attacking never works" rather than fixing it).

**Caveat that matters for the re-run:** 6×6 has no reflection-fixed cell. Wrap's 0.0% mirror
result depended on cell 12 being its own reflection on a 5×5 board, so **the mirror probe
becomes load-bearing again** and must not be treated as already passed.

### The new design-time trap (proposed as game-theory-lens §5.12)

**Cyclic boards require cycle length ≥ win length + 2.** §1.7's pencil check was run at 3×3
and skipped at 5×5. This is a one-line arithmetic check that would have caught the whole
thing before a line of code was written.

### What the queue inherits

1. **Gate-before-UI is now mandatory**: engine → `runTwoPlayerCiGate --game <id>` → UI.
   C13's per-game filter becomes a prerequisite rather than a convenience.
2. **The taxonomy stands; the shortlist's FPA column is downgraded to *hypothesis*.**
   Strategy-stealing is a perfect-play existence theorem, so remedies are chosen *after* the
   number, never before it.
3. **"None by construction" claims get measured too.** Bid-Tac-Toe's FPA is rated "none by
   construction" on the strength of Richman theory — that is exactly the shape of confidence
   that just failed, and it costs one measurement run to check.

---

## C17 — Nothing smoke-tests a registered game's actual route, and a game was 500ing

**Milestone: M4 follow-up. Severity: high — this class is invisible to every existing gate.**

*Found by the Crackstep team, 2026-08-04, by running `next dev` and opening the page.*

**`/play/crackstep` returned a 500 in the live application** while `pnpm typecheck`, `pnpm
lint`, and 1,321 tests were all green. `solver.ts` imported `@twist-arcade/harness`'s full
barrel, which dragged `node:fs/promises` into a browser bundle. A second, quieter leak:
`index.ts` re-exported `solver`, silently pulling it into `loadEngine`/`loadPresentation`'s
own chunk and defeating the code-splitting the registry exists to provide.

**Both files carried loud header comments asserting this could not happen.** That is the
sharpest example yet of this build's recurring failure: not a guard that doesn't guard, but a
*comment* asserting an invariant the code violates, with every gate green.

**The systemic gap:** no CI step builds and loads each registered game's real route. The
existing gates check engines (unit tests, contract suite, harness gates) and the shell
(component tests, one Playwright pass). Nothing exercises the seam where a game's module
graph meets the browser — which is exactly where both leaks lived.

**Fix:** add a CI step that, for every entry in `games/registry.ts`, builds and requests
`/play/<id>` and asserts a 200 plus a rendered board. The Playwright harness already exists;
this is a loop over the registry rather than new machinery. Cheap, and it is the only thing
that would have caught a 500 on a shipped route.

**Related, found in the same pass:** the `pnpm harness certify` CLI that `crackstep.md`
describes **does not exist**. The team built the real thing from lower-level library pieces.
Another instance of a plan describing a tool as though it were shipped.

---

## C18 — Crackstep's share invariant was false on 40% of days

*Found by sweeping 150+ real generated boards rather than trusting the plan.*

The plan claimed `🟨 count == moves − par`. **False on 36 of 90 certified days (40%)**,
because `GamePresentation.shareArtifact(record, finalView)` receives no `par` parameter — and
because some boards' *optimal* solve itself requires a stone revisit, so the identity does
not hold even in principle.

Replaced with the true, locally provable invariant: `🟨 == moves − (walkable − 1)`.

This is C12's lesson recurring in a third form. Fadeout's timeline saturated; Fadeout's
`longestLife` was near-constant; here a stated identity is simply false at scale. **Every
share-artifact claim in a plan is a hypothesis until swept against real generated data.**

---

## C19 — The CI gate budget is fixed, but gate *cost* scales with the board

**Milestone: M4 follow-up. Severity: the gates cannot run in CI at current settings.**

*Observed 2026-08-04: Wrap's 6×6 gate run took **43+ minutes**; Mine Run's solo chase gate
**25+ minutes**. Both pinned at ~100% CPU — computing, not hung.*

The gate table uses a fixed budget: three 100-game matchups, ruthless at **10,000 rollouts
per move**. That was sized against Fadeout — a 3×3 board, 9 cells, games ending near ply 12.
It is comfortable there.

It does not survive a bigger board. Wrap's 6×6 has 36 cells and longer games, so the same
nominal budget is roughly `300 games × ~20 plies × 10,000 rollouts` — tens of millions of
playouts, each simulating to terminal, with branching factor ~21 at every node. **Cost scales
with cells × plies × rollouts, while the budget is a constant.**

Consequences, in order of seriousness:

1. **These gates cannot run in CI.** A 43-minute step on every PR is not viable, and it grows
   with each game added — `scripts/ci-gates.ts` currently loops the whole registry (see C13).
2. **It pushes teams toward improvising.** Two teams have already hand-written throwaway
   scripts to gate a single game. Improvised gates are the ones that get quietly tuned.
3. **It makes gate-before-UI (C16) expensive** exactly when we have just made it mandatory.

**Fix, in order of preference:**

- **Scale the rollout budget to board size** rather than fixing it — e.g. a per-manifest
  budget, or derive it from cell count so a 6×6 costs no more wall-clock than a 3×3. The
  gates measure *relative* strength, so a smaller absolute budget is fine provided the tiers
  stay separated (which `hard-vs-medium` already checks).
- **Split PR from nightly properly.** The plan always intended two budgets (§7: ~1–2k games
  at PR budget, 20k+ nightly). The implementation uses one. PR should be a fast smoke gate;
  the full table belongs in nightly.
- **Land C13's `--game` filter**, so one game's gate does not re-run every other game's.

Worth stating plainly: the gates have already earned their cost — they killed Wrap at 5×5
before it reached players, and that is exactly what they exist for. The problem is not that
measurement is expensive; it is that a constant budget silently becomes unaffordable as the
library grows.

---

## C20 — Wrap is killed. Duel Draft is promoted.

**Decision, 2026-08-04. The rule was fixed before the number, and the number is outside it.**

| Board | First-player win rate | Diagnosis |
|---|---|---|
| 5×5, win 4 | **24%** | P1 too weak — `C(5,4) = 5` made every 4-subset a winning set, so blocking was free and dual-purpose |
| 6×6, win 4 | **74%** | P1 too strong — games end near ply 8; first-mover tempo dominates before either side reaches a genuine double threat |

Removing the arithmetic degeneracy did not land the game near 50% — it **overcorrected past
it**. That is the outcome Fable named in advance as decisive: *"a second failure indicts
vertex-transitivity, which no torus escapes."* On a torus every cell is topologically
identical, so there is no corner/edge asymmetry a defender can exploit. **No third board.**

**Per the ruling: kill Wrap, promote Duel Draft to the launch slate, and pass the topology
slot to Closing Walls** (a shrinking board — dynamic topology without vertex-transitivity).

### What Wrap was providing, that its replacements must

Wrap's pitch was "everything you know is wrong at zero teaching cost" — rules verbatim from
tic-tac-toe, but every imported heuristic dead. **Duel Draft** (simultaneous commit, collision
destroys the cell) delivers the same heuristic reset by a different route and has **no turn
order at all**, so it cannot fail the way Wrap did twice. **Closing Walls** keeps the
dynamic-topology slot with a shrinking board, which is asymmetric by construction.

### The measurement discipline that made this cheap

- **The verdict was not budget-sensitive** — 74% at 2,000 rollouts, 70% at 1,000, same
  direction, both far outside the band.
- **But one gate was**, and the team caught why: at 1,000 rollouts `ruthless` collides with
  `standard`'s own 1,000-rollout budget, so they become the same tier and
  `ruthless-vs-standard`'s 50% is an artifact, not a failure. Worth remembering — a tier gate
  is meaningless once two tiers share a budget.
- **The mirror probe's 0.0% is earned this time.** On 5×5 it was structurally guaranteed
  (cell 12 is its own reflection). On 6×6, `35 − c = c` has no integer solution, so mirroring
  was available on every move and still lost every game.
- **The shipped `ruthless` tier was never touched** — measurement ran through an in-memory
  manifest clone, so the difficulty a real player faces is unchanged.

### C19 validated in the same run

**103 seconds at 2,000 rollouts versus 52+ minutes at 10,000 — a ~30× speedup with the
verdict unchanged.** That is the fix: scale the rollout budget to the board, keep the tiers
separated, and let `ruthless-vs-standard` police the separation. Make it the default.

---

## C21 — Phase 2 sign-offs, and the schema that lived only on a server

*Orchestrator ruling on `docs/plans/phase-2-async-multiplayer.md`. Three approvals, one
overrule, one admitted orchestrator error.*

### The orchestrator error: the schema was never in version control

The async-multiplayer schema was applied to the remote Supabase project via MCP and **never
checked in**. There is no `supabase/` directory in this repo. For weeks the shape of the
production database existed in exactly one place — a hosted project — with no migration
file, no diff, no review, and no way to recreate it. Nothing in the build would have caught
this: every test, gate, typecheck and lint was green throughout, because none of them look
at a database that no code has used yet.

That is the same defect class as the rest of this document, applied to infrastructure rather
than code: **the artifact that governs behaviour was not the artifact under review.** It is
also the one instance where the orchestrator wrote it. Milestone A0 checks the applied
schema in as migration `0001`, generated from the live database rather than from memory, so
the file is a record of what is true and not a guess at it.

### Approved: RLS stays at zero policies — as the end-state, not a transition (§5)

The plan's position — no client-facing table access at all, reads included, every access
through a service-role route handler — is adopted, and it overrules `architecture-lens` §4's
allowance of "direct table SELECT limited to non-sensitive columns for participants."

The reasoning that carries it: a participant-scoped SELECT policy would need column
exclusion, a `match_players` subquery, and per-game hidden-info awareness. That is **a second
redaction path, expressed in a second language**. C1 has now failed twice, both times at a
seam where one redaction decision was re-made somewhere else. Buying a fractions-of-a-cent
saving on a poll by opening that seam is a bad trade at any scale this product will reach.

The audit consequence is what makes it worth stating as policy: *"zero policies exist"* is
one query and cannot be partially true. A set of three column-scoped policies reads as
reviewed while leaking; an empty set cannot.

### Approved: claim-on-first-move (§7.2), amending `ux-lens` §6.3

Seat claim moves from link-open to first move. The deciding argument is the second one: a
claimed-but-vanished guest **dead-locks the match with no recovery**, because anonymous play
means there is no account to unclaim from. Claim-on-open converts an accidental tap into a
permanently wedged game. A claimant who has moved has demonstrably joined.

Two openers can now both believe they are joining. That is accepted *because it is
specified*: the loser gets "Someone else just took this seat — you're watching now," which is
a designed state rather than a silent one. The hidden-info rule stands as written — a
candidate is served the **spectator** view until the claim commits, never the seat view.

### Approved: the move log is the record of truth, `state` is a cache (§4.2)

With the invariant test as the enforcement: `encode(replay(record).final) === matches.state`,
divergence quarantines the match rather than serving it. Replay wins. This is the correct
shape — the guard is a test that runs, not a comment asserting the two agree.

### Overruled: `moves` PK keeps `seat` (§4.5)

**Ruling: the primary key becomes `(match_id, idx)`.**

§4.5 keeps `(match_id, idx, seat)` on the grounds that seat-in-PK "is the simultaneous seam;
costs nothing now, saves a migration later," and that **"Phase 2 writes only one row per
idx."**

That last sentence is the problem. It is an intention recorded in prose while the schema
permits its violation — the standing instruction *"a comment asserting an invariant is not
enforcement; comments don't run"* applies exactly. With `seat` in the key, `(m, 5, 0)` and
`(m, 5, 1)` are both legal rows.

It matters more here than it would have a section earlier, because §4.2 just made the move
log **the record of truth**. A duplicate `idx` makes `replay()` ambiguous between two
different move sequences — and the failure surfaces as a state-vs-replay divergence, i.e.
as the quarantine path in §4.2, which reports a corrupted match without explaining why. The
CAS on `step_count` (§8.3) is intended to prevent the double-write, but that is a guard
depending on another guard being correct with no structural backstop underneath — the
precise arrangement that has failed twenty-three times in this build. The PK is free
enforcement; declining it keeps only the *option* of a schema we have no design for.

The "saves a migration later" argument also inverts: §4 opens by observing the amendments
are near-free **because every table is empty**. That is an argument for making the schema
correct now, not for preserving optionality against a simultaneous-move mode that no
shipped or planned game requires.

If simultaneity arrives in Phase 4+, it migrates then — against a table whose real access
patterns are known, instead of being pre-paid for today with a weakened invariant.

---

## C22 — The gate-cost fix shipped as opt-in, and nobody opted in

*Orchestrator finding while verifying the C13/C17/C19 work. The mechanism is sound. The
default is not.*

### What was verified, by planting violations rather than reading code

- **C19 tier-collapse guard — VERIFIED.** Planted three budgets against Fadeout (`standard`
  = 1000, `ruthless` = 10000): a scaled `twoPlayerCiRollouts` of **1000 — Wrap's exact
  collision — throws `TierBudgetCollapseError` in 0ms**; 800 throws; 1001 runs. The boundary
  is strictly-greater and the refusal happens *before* the matchup runs, so a collapsed tier
  can never surface as a meaningless 50% ratio. The override is an in-memory manifest clone,
  so the difficulty a real player faces is untouched.
- **C19 yardstick floor guard — present** (`MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE`, checked
  against the *resolved* budget rather than the raw override) with planted-violation tests in
  the suite.
- **C13 `--game` filter — covered, and the tests are not tautological.** The unknown-id test
  deliberately uses a registry containing *only* a two-player fixture, so `resolveSafeMove`
  cannot be a plausible source of the throw — the filter's own refusal is the only thing that
  can make it reject. Without the check, an unrecognized `--game` would silently fall through
  to running the whole registry and not throw at all.
- **C17 route smoke test — present and actually invoked.** It loops `games/registry.ts` with
  no hardcoded id list, asserts 200 **plus** a rendered board (`role="grid"` + at least one
  `gridcell`), and CI runs it via `pnpm test:e2e` against `next start` — a real production
  build, which is the only thing that could have caught the original bundling failure.

### The finding: the fix is opt-in, and every registered game skips it

`ciGateBudget.twoPlayerCiRollouts` is an **optional** manifest field with no default.
**Fadeout does not set it.** So `--suite ci --game fadeout` runs at the shipped 10,000
rollouts, and the measured result is **~37 minutes** (process elapsed 29:26 when the watch was
armed, exiting 7:40 later) — for a **3×3 board, the smallest game in the catalogue**, with the
`--game` filter working perfectly and doing exactly what it promised.

*Stated precisely, because a measurement's provenance matters here:* that is wall-clock for
the process, observed directly. Its stdout was owned by another agent's shell and was never
seen by the orchestrator, so **this records a duration, not a verdict** — no claim is made
that the run produced a passing gate table. The duration is the finding; the verdict is
irrelevant to it.

C20's close-out sentence was *"Make it the default."* What shipped is a knob each team sets
by hand. That is the same defect this document keeps recording, in a new place: **the
mechanism exists, is well-guarded, is tested — and does not run.** C13's own motivation was
"without it every team improvises a script, and improvised gates get tuned"; an opt-in budget
each team picks by hand is that same improvisation moved into the manifest.

It also interacts badly with the now-mandatory **gate-before-UI** rule (C16). A queue of six
remaining games, each paying ~30+ minutes minimum before anyone may build a board, is exactly
the pressure that produces a waived or hand-tuned gate.

### Required, before the game queue restarts

The budget must be **scaled by default, not by remembering**. Either:

1. compute it from board size and tier spacing, respecting the tier-collapse floor (the
   `ruthless` budget must stay strictly above `standard`'s); or
2. **require** the field for every registered game and fail loudly when it is absent — the
   same move C2 made for inapplicable solo gates, which report `n/a` explicitly rather than
   silently not running.

Option 2 is weaker but honest, and it is compatible with option 1 as the computed default.
What is not acceptable is the current state, where a game that says nothing gets the most
expensive possible run and no warning that it did.

**A default nobody sets is not a default. It is a comment.**

### C21 addendum — A0 landed; the anonymous-sign-in config call

**A0 is done** (`feature/phase2-schema`, `91ebb09`). Migrations `0001` (a faithful record of
the already-applied schema, generated from live introspection) and `0002` (plan §4 amendments
as corrected by C21, applied against verified-empty tables) are in version control, and the
database's shape no longer lives only on a hosted server.

**The drift guard was verified by the orchestrator, not accepted on report.** Planted a
nullability drift — flipped `engine_version text not null` to nullable in the checked-in
migration, confirming by `diff` that the edit actually applied — and the suite went red naming
exactly the sabotaged column (`is_nullable: "NO" → "YES"`). Reverted, green again, 1.85s.

This mattered specifically because the implementer had **weakened a comparison to get green**:
pglite catalogues `NOT NULL` as `pg_constraint` rows (`contype = 'n'`) while the hosted
instance does not, so `contype = 'n'` was excluded, with the claim that `columns.is_nullable`
covers it losslessly. That is the exact shape of the twenty-three defects in `PROGRESS.md` —
an exclusion that makes a test pass, justified by a comment. **The claim happened to be
true**, and is now observed rather than trusted. It would have been equally cheap to check and
find it false.

The fixture is a snapshot of the **real remote database**, not of the migration file's intent,
so the test cannot pass tautologically — and `supabase/` was added to `vitest.workspace.ts`,
so CI's `pnpm test` actually invokes it (the Daily lesson: three working guards that no CI
step invoked).

**Ruling on `enable_anonymous_sign_ins = true` in `config.toml`:** keep it. `config.toml`
configures the *local* stack only; it is inert until A1 wires auth, and plan §16 has A0–A4
sharing one worktree, so deferring it just creates a config ghost.

**But the remote setting is a separate, deliberate act with an abuse surface, and it is not
authorized by this ruling.** Anonymous sign-in lets any caller mint `auth.users` rows without
a credential — a spam and quota vector, and one that interacts with C21's recorded constraint
that no anon-user cleanup job may run while matches reference those users. Enabling it on
`fjiwrzaosluymamannaw` waits for A1 and must arrive with a rate-limiting and abuse story, not
as a checkbox flipped in passing.

### C22 resolution — the computed default was measured, and it was wrong

**A computed budget was tried first and rejected on evidence.** Scaling Fadeout to 2,000
rollouts — *the exact ratio validated for Wrap in C19/C20* — produced **mean-plies 40+, a
100% draw rate, and 0% first-player wins**, a verdict the shipped 10,000-rollout budget does
not produce.

That is **C6's yardstick collapse appearing in the two-player self-play lane**, where it had
only ever been guarded for in the hidden-info one. The mechanism is specific to a game like
Fadeout: pieces vanish, so an agent too weak to construct a winning line never finds one, and
the game degenerates into an endless draw. The gate would have failed — and the failure would
have measured *the agent's weakness*, with nothing in the report to distinguish it from a real
balance defect.

**The ratio that was safe for Wrap was unsafe for Fadeout.** Board size alone does not
determine how much search a game needs to stay decidable. That kills option 1 (compute the
budget from board dimensions) as stated in C22 — not because the arithmetic was wrong, but
because the quantity it predicts is not a function of the inputs it was given.

**Shipped: option 2.** `runCiSuite` now *requires* `ciGateBudget.twoPlayerCiRollouts` for
suite `"ci"` whenever the shipped `ruthless` budget exceeds `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE`
(3000), throwing `MissingCiRolloutBudgetError` **before any self-play runs**. Games at or
under the ceiling are unaffected; nightly is exempt unconditionally.

Verified against the real Fadeout manifest, not a fixture: **`--game fadeout` now refuses in
0.4 seconds** instead of running 37 minutes. Crackstep, which has no two-player lane, is
untouched at 0.67s. Both pre-existing guards re-fired at the same boundaries the orchestrator
measured independently (override 1000 and 800 → `TierBudgetCollapseError` in 0ms).

### The consequence, stated plainly rather than buried

**Fadeout's two-player CI gate now hard-fails until someone validates a budget for it**, and
no validated value exists: 2,000 is *proven* unsafe, and the implementer correctly declined to
guess one under time pressure rather than ship a number that looks like a measurement. This
would turn `main`'s CI red on merge.

So the honest state is: the gate went from *37 minutes and possibly meaningless* to *0.4
seconds and openly unanswered*. The second is better — a gate that refuses is not a gate that
lies — but it is not done, and the queue behind it is still blocked until Fadeout has a real
number.

**What the validation sweep must answer** (the C19/C20 rigor, applied to Fadeout): not "which
budget is fastest" but "which is the cheapest budget whose **mean-plies, draw-rate, and
first-player win-rate still match the 10,000-rollout baseline**." Speed alone is not the
criterion — that is precisely how 2,000 looked acceptable.

**And cost has a second axis.** Gate cost is `games × rollouts`. `CI_GAMES` is fixed at 100
for every game regardless of expense, so the sweep must report the surface across *both*
dimensions — 100 games × 5,000 rollouts and 300 × 1,700 cost the same and buy different things
(statistical power versus agent strength). C19 named board size as the scaling axis the budget
ignored; this is the same oversight one level up.

### C21 addendum, corrected — "A0 is done" was wrong, and the drift guard is narrower than its header

The addendum above said **"A0 is done."** That was an orchestrator overclaim and the stage-6
review caught it. Against plan §16's own definition of A0 — *"`supabase/` dir, migrations
0001/0002, `commit_move`, canary re-verification"* — **two of the four are absent**, and
neither absence was recorded as a deviation. My verification of the drift guard was real, but
verifying one component is not the same as completing a milestone, and I wrote the stronger
claim.

The review is the model for what stage 6 is for: it planted a **10-mutant matrix** rather than
reading code, and four mutants passed green.

**Fires correctly:** a planted `create policy`, a changed `check` predicate, a dropped index, a
changed column default, RLS disabled, a changed table comment.

**Blind (executed, not theorised):** a **new table**, a **new function**, a **`grant`**, and a
changed column comment.

That first set is serious precisely because of C21. The introspection whitelists the three
table names, so `policy_count === 0` is true-but-vacuous for anything else — **a new table
created with RLS off, or carrying its own policy, passes green.** C21 made "zero policies" a
load-bearing invariant; the guard enforces it only for tables that already existed when the
guard was written. A1 lands `commit_move()`, a SECURITY-relevant SQL function, into exactly
that blind spot.

**And the guard is one-directional while its header claims otherwise.** `schema-drift.test.ts`
says drift goes red "if a migration file is edited without the live database being changed to
match, *or vice versa*." The "or vice versa" is false: the test compares migrations against a
**frozen fixture** and nothing in CI ever contacts the remote. So **the exact original sin this
milestone exists to fix — apply a change to the remote via MCP, never check it in — still
passes green**, and the only thing preventing it is a procedure that lives in a comment.
Comments don't run. The reviewer confirmed remote ≡ fixture as of today, so this is forward
risk, not present drift.

### Ruling on the reviewer's escalation: `on delete cascade` → `on delete restrict`

`match_players.user_id references auth.users on delete cascade`, paired with §4.5's recorded
constraint that *"no anonymous-user cleanup job may run… deleting a stale anon user would
cascade into live seats,"* **is the same defect C21's PK overrule condemned two sections
above** — an intention in prose while the schema not merely permits but *performs* its
violation, silently unseating a live player.

Consistency is not the only reason. Under `restrict`, a cleanup job that would corrupt a live
match **fails loudly** instead of succeeding quietly, and account deletion is forced into an
explicit anonymise-or-resolve decision rather than a silent cascade — which is the behaviour
account deletion should have anyway. §4's own argument applies with full force: this is
near-free **only while the tables are empty**, and that window closes at launch.

**Ruled: `on delete restrict`.** I approved §4.5 as written in C21 and was wrong to; the PK
reasoning I applied in the same correction should have been applied here in the same pass.

---

## C23 — The gate fires on correct play. Fadeout is a *proven draw*, and three gates demand it not be.

*The C22 sweep completed. It falsifies C22's own central claim — including a claim the
orchestrator repeated without checking evidence already sitting in this repo.*

### The measurement

Six configurations, fixed seed `c22-sweep` so every budget played identical games:

| Config | wall-clock | mean-plies | draw-rate | FPA | verdict |
|---|---|---|---|---|---|
| 100 × 10,000 (baseline) | 2802s | 45.5 | **100.0%** | **0.0%** | fail |
| 100 × 8,000 | 2275s | 42.9 | **100.0%** | **0.0%** | fail |
| 100 × 5,000 | 1305s | 40.4 | **100.0%** | **0.0%** | fail |
| 100 × 3,000 | 848s | 40.9 | **100.0%** | **0.0%** | fail |
| 50 × 10,000 | 1625s | 44.0 | **100.0%** | **0.0%** | fail |
| 25 × 10,000 | 955s | 46.5 | **100.0%** | **0.0%** | fail |

`strong-vs-random` passes at **100.0%** in every single row. The agents are not weak.

### What this overturns

**C22's resolution said the 2,000-rollout run's 100% draw rate was C6 yardstick collapse —
"a verdict the shipped 10,000-rollout budget does not produce."** The baseline produces
**exactly** that verdict. There was no collapse. 100% draws is not a symptom of a weakened
agent; **it is Fadeout's actual behaviour at every budget from 2,000 to 10,000.**

**The evidence was already in the repository.** `docs/research/games/fadeout-solve-report.md`
records an *exact* solve: under `threefold` repetition — Fadeout's frozen shipped ruleset —
the root value is **draw**, over 128,170 reachable states, and **every one of the nine legal
opening moves is a draw.** Proven, not estimated.

So the self-play measurement is not a failure. **It is the bots correctly reaching the game's
proven game-theoretic value**, and the gate is failing them for it.

I accepted the implementer's yardstick-collapse framing and wrote it into C22 without opening
the solve report that refutes it — a report this project produced, and which I had already
cited elsewhere. The standing instruction covers this exactly: *subagent claims are not
evidence.* A 2½-hour sweep then went looking for a budget that would reproduce a "healthy"
baseline that has never existed.

### The actual defect: three gates are unsatisfiable by construction

For a proven-draw game, these cannot pass, at any budget, ever:

- `first-player-win-rate` band **[35%, 65%]** — in a drawn game nobody wins; 0% is *correct*.
- `draw-rate` ceiling **60%** — the true value is 100%.
- `ruthless-vs-standard` min **60%** — ruthless cannot out-win standard when neither can win.
  (Currently WARN at `ci`, **hard-fail at nightly** — so nightly is broken for Fadeout too.)

This is the mirror image of the twenty-three defects catalogued in `PROGRESS.md`. Those were
guards that stayed green while something was wrong. **This is a guard that goes red while
everything is right** — and it is worse in one respect, because a gate that cannot be
satisfied trains everyone to route around it.

**`games/fadeout/manifest.ts` predicted this in a comment** (lines 76–85): a proven-draw root
"is expected to pull the MEASURED draw rate toward the high end of — or past — the default 0.60
`maxDrawRate` ceiling; if F4's numbers land there, the fix is an `exceptions[]` entry." The
comment was right, and it was a comment, so nothing acted on it and the gate has presumably
been failing ever since. It also anticipated only **one** of the three unsatisfiable gates.

### Ruling: N/A with a cited proof, not an `exceptions[]` waiver

`exceptions[]` says *"this game is permitted to fail this gate."* That is the wrong statement
and it is abusable — it reads identically whether the game is proven drawn or merely
disappointing.

**C2's principle governs**: a gate that does not apply must be reported **explicitly N/A**,
never silently skipped, and never confusable with a pass. Extend it from `solo.format` to
solved value:

1. The manifest declares `solvedValue: "draw" | "p0-win" | "p1-win" | "unknown"` **with a
   pointer to the artifact that proves it.** `"unknown"` is the default and grants nothing.
2. When `solvedValue` is a proven draw, the three decisiveness gates report **`n/a`, citing
   the proof** — not `pass`, not `fail`, not `waived`.
3. **The gate inverts into a real one.** For a proven-draw game the meaningful check is that
   self-play *does* reach ~100% draws, confirming the bots are strong enough to find the value.
   **If Fadeout's self-play draw rate fell to 70%, that would be a genuine regression — and the
   current gate would score it as an improvement.** That is the signal worth having, and it is
   the exact opposite of what ships today.

A game may only claim relief with a proof artifact. Bid-Tac-Toe's "none by construction"
balance claim gets no relief under this rule — asserting a value is not proving one, which is
the confidence that already failed on Wrap.

### The budget question C22 asked, now answerable

Every budget produces an identical verdict, so **no budget is "unsafe" for Fadeout** and the
yardstick concern was unfounded. `100 × 3,000` costs **848s against the baseline's 2802s — 3.3×
cheaper for the same answer**, and rollouts dominate cost far more than game count (25 × 10,000
still costs 955s). Once the gates are corrected, CI should run the cheap end and nightly the
full table.

### Also observed, minor

The baseline reports `cap-hit-rate (self-play): 0.00%` while its own gate row fails on
`cap-hit rate 1.00% > 0`. Two different numbers for one quantity in one report — worth a look
when the gate table is touched.

### C23 postscript — the gate contradicted a deliberate product decision

Worth recording, because it explains how this survived so long unnoticed: **Fadeout's drawn
value is not an accident of the ruleset. It is the reason that ruleset was chosen.**

The freeze note in `games/fadeout/manifest.ts` and `fadeout-solve-report.md` §3.1 record the
orchestrator ruling of 2026-08-03: ship `remove-first/solid/**threefold**` rather than the
report's original `superko` recommendation, precisely because threefold's value is a *proven,
fair draw*, while superko **has no draw terminal at all** and its value hit a computational
wall confirmed twice (53–62M nodes). Shipping superko would mean shipping an unknown,
unquantifiable win-or-loss outcome for the one variant chosen specifically for its fairness.

So the shipped CI gate demanded a **35–65% first-player win rate and under 60% draws** from a
game deliberately selected for being provably drawn. The product decision and the gate table
were in direct contradiction — one document arguing the draw is the guarantee, another
treating it as the failure — and both were written by this project, days apart.

Neither was wrong in isolation. The gate table is right for an unsolved game, which is what
every other game in the queue will be. What was missing is the thing C2 already established
for solo formats and this correction now extends: **a gate must know which claims apply to the
game in front of it.** The defect was not a bad threshold; it was a threshold applied without
asking whether the game could satisfy it even in principle.

Verified end-to-end on the real registered game after the fix:

```
[PASS] strong-vs-random: 100.0% (min 90.0%)
[N/A ] first-player-win-rate: proven "draw" (…§1.1) — a balanced-FPA band does not apply
[N/A ] draw-rate: … unsatisfiable by construction for a drawn game
[PASS] mean-plies: mean 35.5 plies, 0 cap hits across all matchups
[N/A ] ruthless-vs-standard: … ruthless cannot out-win standard when neither can win
[PASS] solved-value-reached: self-play reached the proven "draw" 100.0% (floor 90%)
```

And the relief mechanism is self-policing, which `exceptions[]` would not have been. Planted
by the orchestrator: a `solvedValue` with **no proof pointer** is refused; a **whitespace-only**
proof is refused; and a **false claim** — `"p0-win"` asserted with a proof pointer on this
provably drawn game — **fails** with `self-play reached the proven "p0-win" 0.0% of the time
(floor 90%)`. A game cannot buy gate relief by naming a convenient value.

---

## C24 — Two independent agents wrote the same confounded seed. That is a platform defect.

*Observed twice in one day, in unrelated worktrees, by agents who never saw each other's code.*

Both the Fadeout budget sweep and the Nine Grids budget pilot seeded their comparison runs by
templating the varying parameter into the seed:

```
seed: `c22-sweep:${label}:games=${games}:rollouts=${rollouts}`     // Fadeout
seed: `pilot:nine-grids:${n}:${games}`                             // Nine Grids
```

`runner.ts:201` derives game *i* as `${seed}:${i}`. So **every budget plays a different set of
games**, and any measured difference between two budgets conflates the budget's effect with
seed variance. The comparison cannot distinguish signal from sample.

Both were caught before they produced a wrong conclusion — the Fadeout one before launch, the
Nine Grids one mid-flight. Neither agent was careless; **both wrote the natural thing.** When
two independent authors reach for the same wrong construction, the defect is in the tool, not
in them.

### Why the shipped path is fine and the ad-hoc path is not

`scripts/ci-gates.ts` seeds `ci:${gameId}:${opts.suite}` — fixed per game and suite, correct,
never varying with a budget. The gates that actually run in CI have never had this problem.

The trap is that `RunCiSuiteOptions.seed` is **required with no default**. An author writing a
one-off comparison must invent a seed, and the most natural way to make it "descriptive" is to
interpolate exactly the parameters under comparison — which is precisely what must stay
constant. The API asks a question whose obvious answer is wrong.

### Fix, in preference order

1. **Provide the comparison as a first-class harness helper** — something like
   `compareBudgets(engine, manifest, budgets[], { seed, games })` that takes **one** seed and
   varies only the budget. Make the correct thing the easy thing; nobody hand-rolls the loop,
   nobody invents a seed. This is the C15 lesson (a scaffold gap is fixed by changing what the
   scaffold generates, not by documenting the gap).
2. **Document the rule at the field itself**, not in a plan: on `RunCiSuiteOptions.seed`, state
   that game *i* derives from `${seed}:${i}`, so a seed that varies across compared runs changes
   which games are played and invalidates the comparison. A comment on the field is read at the
   moment the mistake is made; a comment in a document is not.

### The general lesson, which outlives this API

**A recurrence across independent authors is evidence about the tool.** The twenty-three
defects in `PROGRESS.md` were each diagnosed as a specific oversight. This one arrived twice in
a day from two people who could not have copied each other, which is a different signal
entirely: it means the interface makes the wrong thing natural. Fixing the two call sites and
moving on would guarantee a third.

---

## C25 — I repeated C22's own mistake, in the brief that cited C22

*Orchestrator error, caught by the implementer it was given to.*

The Mine Run brief told the team: *"a viable scaled budget of 320 (~8.9 samples/candidate on
the 36-cell board) is already proven in the harness tests against your real engine — start
from that evidence."*

That evidence was measured against Mine Run's **6×6 test fixture**. The real launch config is
**10×10, 20 mines, 60 budget**, and the implementer measured its actual root branching factor:
**87 legal moves at the opening**. At 320 rollouts that is ≈3.7 samples per candidate — well
under the K≥8 floor the harness enforces. The number did not transfer, and the team correctly
derived **750** (K≈8.62) from a fresh measurement on the real board instead.

This is the *same* error C22 records, made by the same person who wrote C22 the same day:

> *"The ratio that was safe for Wrap was unsafe for Fadeout. That kills option 1 — not because
> the arithmetic was wrong, but because the quantity it predicts is not a function of the
> inputs it was given."*

I wrote that about board size, and then handed a fixture-derived budget to a team working on a
board with nearly three times the branching factor, describing it as proven "against your real
engine." It was proven against a *fixture*, and the two are not the same thing.

**The rule, stated so it stops recurring:** a rollout budget is evidence **about the board it
was measured on**, and nothing else. Test fixtures are boards too — a number measured on a 6×6
fixture is not a number about a 10×10 launch config, even when the same engine produces both.
Any budget handed to a team must name the board it came from, and the team must re-derive it
against the board it will actually gate.

The catch is also the process working as intended: an implementer given a wrong premise
measured it instead of accepting it, which is precisely what *subagent claims are not evidence*
is supposed to cut in both directions.

### Related, still open: a gate metric that can be `Infinity`

The same probe reported `healthy alwaysSafeVsStrong=Infinity` — Strong scored zero, so the
ratio divided by zero. A gate metric that can be `Infinity` cannot be thresholded, cannot be
compared across runs, and serialises to `null` in JSON, so a report can carry it onward
silently. C4's reasoning applies: a boundary value must be a real value or a loud typed
failure, never a plausible-looking artifact. A zero-scoring Strong is either a broken yardstick
(C6) or a broken engine, and both deserve an explicit error rather than a float. Under
investigation — the reading came from a deliberately reduced-scope diagnostic, so it is not yet
known whether a full run can produce it.

---

## C26 — Nine Grids survives. And its one WARN exposes a hole in C19's tier-collapse guard.

### The verdict: Nine Grids passes

```
CI suite (ci) for "nine-grids" — OK
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [PASS] first-player-win-rate: 46.0% (band [35%, 65%])
  [PASS] draw-rate: 30.0% (max 60.0%)
  [PASS] mean-plies: mean 50.2 plies, 0 cap hits across all matchups
  [WARN] ruthless-vs-standard: 42.0% (min 60.0%, ci)
  [N/A ] solved-value-reached: no proven manifest.solvedValue — nothing to confirm
```

**First-player win rate 46.0%, near the centre of the band, with a 30% draw rate.** Ultimate
Tic-Tac-Toe is decisive and balanced under this engine. It is the first two-player game since
Fadeout to clear the balance gates, and unlike Wrap it did so on a real 100-game sample.

**The pilot said 13.3%.** A 15-game pilot read a *severe second-player advantage* — the same
direction as Wrap's 76% — and the full run says 46.0%. The pilot was noise: 13.3% is 2 wins in
15, with a confidence interval spanning roughly 2–40%. Had that been treated as a verdict,
a balanced game would have been killed, and the kill would have looked like corroboration of
Wrap's pattern. **A directional read from a sample that small is not weak evidence; it is no
evidence.** Cost measurements can run at 15 games. Verdicts cannot.

### The hole: the tier-collapse guard checks budgets, not strength

`ruthless-vs-standard` measured **42.0%** — the *harder* tier losing to the easier one. Nine
Grids' tiers are `standard` 1,000 rollouts and shipped `ruthless` 10,000, with
`ciGateBudget.twoPlayerCiRollouts: 1500`. So under suite `"ci"` the comparison is **1,500
versus 1,000 — a 1.5× gap**, where the shipped game is 10×.

C19's `TierBudgetCollapseError` fired correctly on Wrap and refuses when the scaled `ruthless`
budget is **≤** `standard`'s. 1,500 > 1,000, so it passed. But **strict inequality is nowhere
near sufficient**: MCTS strength grows roughly with the *logarithm* of rollouts, so a 1.5×
budget gap is a strength difference easily swamped by noise. The guard verifies budget
separation as a **proxy for strength separation, and this is direct evidence the proxy fails.**

The measured number is not a finding about Nine Grids. It is an artifact of the CI substitution:
at the shipped 10,000-vs-1,000 the tiers are genuinely 10× apart, and nightly — which never
applies the override — is where that comparison is real.

### Ruling

**When a CI rollout override is active, `ruthless-vs-standard` must report `n/a`, citing the
override — not `WARN` with a number.** The gate cannot measure what it claims once the
substitution has changed the very quantity under comparison, and per C2/C23 a gate that cannot
measure its claim says so rather than emitting a figure people will read as a result.

Nightly keeps the gate at shipped budgets, unchanged, where it means something. This also
removes a live hazard: `ruthless-vs-standard` is a **hard fail at nightly**, so as things stand
Nine Grids would pass CI and fail nightly on a number that was never meaningful in CI.

Strengthening the existing error to demand a *ratio* rather than strict inequality is the
obvious alternative, and it is worse: any threshold would be a guess about how strength scales
with rollouts for an unknown game, which is exactly the assumption C22 and C25 have already
punished twice.

---

## C27 — Mine Run's gate is unaffordable, there is no status for "deferred", and Always-Safe may be beating Strong

### Measured, not projected

At the real `moveCap=400`, `soloChaseCiRollouts=750`, real 10×10/20-mine/60-budget board:

```
seed ci-0  strong: 178.3s, 40 decisions, finalScore=630, capHit=false
seed ci-1  strong: 152.3s, 37 decisions, finalScore=91,  capHit=false
always-safe (both seeds): 6ms, scores=[849, 686]
```

**165.3s per seed → ~4.6 hours at `seedCount=100`; ~1.8 hours even at 40.** Not a CI gate at any
seed count near G-14's floor of 100.

The cost model, with the axis that actually binds:

`cost ≈ seedCount × decisionsPerGame × rolloutsPerDecision × per-rollout-ms`

- **`decisionsPerGame` (~38) is set by the *budget* of 60, not by `moveCap`.** `moveCap=400` is
  slack — neither seed came close, `capHit=false` both times. So `moveCap` is not a lever, and
  cutting it below natural game length is what produced the zero-scoring pathology that made
  `alwaysSafeVsStrong` read `Infinity` earlier.
- **`soloChaseCiRollouts` is barely a lever.** 750 already sits at K≈8.6 against the empirical
  floor of 8 (branching factor 87). Cutting further trips `HiddenInfoBudgetTooLowError` or
  produces a Strong too weak to trust (C6). Floor-to-750 saves ~7%.
- **`seedCount` is the only real axis, and it is a resolution tradeoff, not free.**

**Ruled: Mine Run's Strong-dependent solo-chase gates run at nightly only.** CI keeps what is
genuinely cheap and already proven — the contract/redaction/view-honesty/manifest suite (136
tests, ~2.7s) and `grindProbe` (~0.5s, verified against real planted violations).

### The platform gap the team found and correctly declined to fix

The gate vocabulary is `pass | warn | fail | n/a`, and `n/a` means **"does not apply to this
format"** (C2). Reporting a Strong-dependent row as `n/a` in a CI-tier run would conflate *"this
gate does not apply"* with *"this gate is too expensive to measure at this tier."*

That is the **exact silent-conflation shape C2 and C23 exist to prevent, appearing in a third
place.** C2's own words: *a skipped gate and a passed gate must never look the same in a report.*
A deferred gate and an inapplicable gate must not look the same either — the first will be
measured tonight, the second never will be, and a reader cannot tell them apart.

**Required: a distinct `deferred` status** naming the tier where the gate does run. Until it
exists, no Strong-dependent Mine Run row may be reported as `n/a`.

### The finding that actually matters: Always-Safe outscored Strong on both seeds

**849 vs 630, and 686 vs 91.** `alwaysSafeVsStrong` is a ratio that must stay **below 0.95**;
these are ~1.35 and ~7.5. The team flagged it as low-confidence (n=2) rather than concluding
from it, which is right. But two readings both matter:

1. **Yardstick collapse (C6).** Strong at 750/K≈8.6 is too weak *on the real 100-cell board*.
   Every prior C6 validation was on 36-cell fixtures — and **C25 established two days' running
   that fixture-derived numbers do not transfer.** If this is the cause, the fix is a larger
   budget, which makes an already-unaffordable gate worse.
2. **A game-design problem.** Mine Run genuinely does not reward skilled play over always
   banking. That would be a Wrap-class finding about the game, not the harness.

**Ruling: Mine Run does not get a board until this is resolved** (C16, gate before UI). An n=2
signal is not a verdict, but it sits on the game's *central* solo gate, and building UI on an
unresolved central gate is exactly what C16 forbids — Wrap had a complete board before anyone
measured it.

**The discriminating experiment is cheap and should run before any expensive one.** Raise Strong's
budget (750 → ~3,000) on a handful of seeds and re-measure against the same Always-Safe scores.
If Strong overtakes, it is hypothesis 1 and the yardstick was too weak. If Always-Safe still
wins at 4× the search, it is hypothesis 2 and the game has a design problem no budget will fix.
~5 seeds × ~660s ≈ **under an hour to discriminate**, against ~1.8 hours to merely restate the
question at higher n.

---

## C28 — Nine Grids test-plan rulings, a scaffold that registers before gating, and a brief citing a correction the reader could not see

### Two ground-truth corrections from the test designer, both correct

**1. I cited C26 to an agent whose worktree predated it.** C26 was committed to `main` at
`bcffe4f`; the Nine Grids worktree had rebased onto `500b284`, so the file it could read had no
such section. The agent reported *"C26 does not exist"* and named what it actually found instead
of inferring what I probably meant. That is the correct response, and the error is mine: **a
brief must cite what is in the tree the reader has**, or say explicitly that the reference is
newer and summarise it inline. Citing a document the reader cannot open is indistinguishable, to
them, from citing one that does not exist.

**2. `nine-grids` is already in `games/registry.ts` — inserted by the scaffold, not by a
decision.** It is absent from `main` but present in the worktree, so `/play/nine-grids` resolves
today to a placeholder board.

**This is C15's fourth scaffold gap ("unconditional registry insertion"), still unfixed, and it
quietly inverts C16.** `new-game` registers a game — making it routable — at *scaffold* time,
before an engine exists, before any gate has run. The rule bought by Wrap's death is engine →
gates → UI; the scaffold ships step three first and nobody has to choose it. Nine Grids happens
to have passed, so its registration is now legitimate, but that is luck of ordering, not the
process working.

**Required:** `new-game` must scaffold **unregistered**, and registration becomes an explicit
step a team takes after its gates are green. A generator that pre-commits the decision a gate is
supposed to make is not a convenience.

### Rulings on the three flagged ambiguities

**A1 — dead-position draws: implement detection; end the game.** Today, when no macro line
remains achievable for either side, play continues to all 81 cells. A game that continues after
its outcome is decided is a UX defect in its own right — players who can see it is over keep
being asked to move — and Nine Grids' measured **mean-plies of 50.2 sits above `ux-lens`'s 10–40
band**, which this directly addresses. The check is cheap: eight macro lines, each still-winnable
or not. **This changes measured mean-plies, so the gates must be re-run after** (~17 minutes);
do not carry the old numbers forward.

**A2 — confirmed as pinned.** A free move may be played into any **open** board; empty cells of a
won-but-not-full board stay illegal. This is the standard rule and the only coherent one — a
resolved board's cells cannot affect anything, so allowing moves there would create legal moves
that are guaranteed no-ops.

**A3 — `decode` must reject the structurally impossible board.** The plan observed that a
sub-board carrying two completed lines for *different* players decodes successfully, with
ownership settled by internal line-scan order. **C4 is not scoped to "cheap invariants"** — its
words are that `decode` returns a state satisfying *the engine's own invariants* or throws a
typed error. A position no legal sequence can reach fails that test, and silent ownership by
scan order is precisely the "plausible-looking state" C4 exists to forbid: this feeds `replay()`
and certificate verification, where a forged record that decodes cleanly validates cleanly.

### On the plan itself

70 cases, each carrying a named **"a failure would mean"** — the discipline that addresses the
23-defect table directly, since a check whose failure mode nobody can state is not a check.
Three details worth keeping:

- **SEND-003 uses asymmetric indices deliberately**, because a row/column transpose bug is
  invisible to a symmetric probe. That is the Fadeout mirror-probe lesson applied unprompted.
- **The accessibility cases are tagged `[SPEC] — expected to FAIL today`**, since `announce()` is
  still a placeholder. Cases that fail loudly beat cases that pass vacuously.
- **A11Y-008 requires asserting `matchMedia('(prefers-reduced-motion: reduce)').matches` inside
  the page** before trusting any reduced-motion result — because Playwright's emulation has
  silently failed to apply in this repo before, and the assertion then checked the wrong state.

---

## C29 — Quadrupling Strong's search did not close the gap. Mine Run has a design problem.

*The discriminating experiment from C27. Interim result on two seeds; the run is still adding
seeds, but both budgets already point the same way.*

```
seed   alwaysSafe   strong@750   strong@3000   ratio@750   ratio@3000
ci-0         849          630           378       1.348       2.246
ci-1         686           91           276       7.538       2.486
```

`alwaysSafeVsStrong` must stay **below 0.95**. At 4× the search it is **2.2–2.5**.

**Hypothesis 1 (C6 yardstick collapse) predicted Strong would overtake Always-Safe at a larger
budget. It did not.** The ratio moved in *opposite directions* on the two seeds — worse on ci-0
(1.35 → 2.25), better on ci-1 (7.54 → 2.49) — and stayed roughly 2.4× outside the threshold on
both. A too-weak yardstick gets stronger with more search; this did not.

**On seed ci-0, four times the search made Strong actively worse: 630 → 378.** That is not a
strength story at all. More search converging on a *lower* score means Strong is optimising
something that does not track the score it is judged by.

### The mechanism, stated as a hypothesis to be tested rather than a conclusion

Mine Run is press-your-luck: accumulate, then bank before hitting a mine. `Always-Safe` banks at
the first safe opportunity. If banking early dominates deep search by 2.4×, then **the
press-your-luck decision the game is built around may not be a real decision** — the safe line
simply wins, and the "should I push?" tension is cosmetic. That is a Wrap-class finding about the
game, not its harness, and no rollout budget fixes it.

The alternative reading, still open: Strong's rollout policy or value estimate rewards survival
over banked score, so more search buys more caution. That would be a *bot* defect rather than a
game defect, and it is distinguishable — compare Strong's banked total against a policy that
simply pushes N steps then banks, across a sweep of N. If some fixed-N policy beats both, the
game's risk curve is the problem; if Strong trails a fixed-N policy it should dominate, the bot's
objective is the problem.

### What this does not yet justify

**n=2.** Two seeds, and the direction is consistent across two budgets, which is stronger than n=2
at one budget — but it is not a verdict, and Mine Run is not killed on it. **C26's lesson is one
day old: Nine Grids' 15-game pilot read a severe second-player advantage that vanished at 100
games.** A small sample that agrees with a plausible story is exactly when to be most careful.

**Standing: Mine Run gets no board** (C16). The gate that would catch this is the game's central
solo gate, and it is failing by a factor of 2.4 at every budget measured.

### The cost, which is now its own finding

Seed ci-1's `strong@3000` run took **4,977,176 ms — 83 minutes for a single seed.** Seed ci-0's
took 11 minutes at the same budget. **A 7.5× spread between two seeds of the same configuration**
means Mine Run's per-seed cost is wildly variable, so any wall-clock projection from a small
sample — including C27's 165.3s/seed average — carries far more uncertainty than a mean suggests.

### C29 update — three seeds, and more search makes Strong *worse* on two of them

```
seed   alwaysSafe   strong@750   strong@3000   ratio@750   ratio@3000
ci-0         849          630           378       1.348       2.246
ci-1         686           91           276       7.538       2.486
ci-2        1247          231           105       5.398      11.876
```

**On ci-0 and ci-2, quadrupling the search made Strong substantially worse** (630 → 378;
231 → **105**). Only ci-1 improved. The ratio must stay under 0.95; ci-2 is now **11.9**.

A too-weak yardstick gets *monotonically better* with more search. This does the opposite on
two thirds of the sample. **That is not a strength problem — it is a direction problem: Strong
is searching harder toward something that is not banked score.**

That shifts the leading hypothesis from *"the game is broken"* to *"the bot's objective is
wrong"*, and the two demand opposite responses — one kills a game, the other fixes a policy.

**The decisive check is a code read, not another multi-hour run.** What value does Strong's MCTS
back up in the solo-chase lane? If it maximises survival, or reveal count, or anything other
than **expected banked score**, the numbers above are explained entirely and the game has not
been tested at all yet. Note the shape of the evidence: Always-Safe banks early and scores
*higher* than Strong, so Strong is not merely risk-averse — it is actively choosing lines worse
than the trivial policy, which a correct objective at higher search should never do.

**This also means C29's original reading was premature.** "Banking early dominates deep search,
so the press-your-luck decision may not be real" assumed Strong was competently maximising
score. Two of three seeds now say it is not. Mine Run may be fine and its yardstick broken —
which would make this the fourth instance of C6 (*the yardstick must be strong enough to measure
with*), and the first where the yardstick was pointed the wrong way rather than merely being too
weak.

**Cost note for whoever runs the next sweep:** these three seeds took ~2 hours for six Strong
runs, with a single seed's `strong@3000` taking 83 minutes against another's 11. Any projection
from a small sample carries far more uncertainty than its mean suggests.

---

## C30 — Strong cannot see Mine Run's central mechanic. Two correct decisions, one broken seam.

**This is a platform defect, not a game defect. Mine Run has not been tested yet.**

### The mechanism, found by reading rather than by another multi-hour run

Mine Run is hidden-information, so Strong is a **determinized flat Monte Carlo** with
`rolloutCapPlies = 60` (`agents.ts:133`). Measured game length is **38–60 decisions** (C27), and
seed ci-2 hit exactly 60 — **so rollouts routinely hit the cap while still `ongoing`** rather
than reaching a terminal.

A horizon-capped leaf is valued by `valueOfStatus`, whose `"ongoing"` branch is:

```ts
if (engine.score) return engine.score(state, player);          // preferred
if (engine.heuristic) return Math.tanh(engine.heuristic(...)); // fallback only
```

And Mine Run's engine defines:

```ts
score(state) { return state.banked; }   // banked ONLY — not the live streak
```

with a comment, written by the game's own author, stating that **`heuristic()` exists precisely
because "bare score() (== banked) is blind to the entire press-your-luck decision."**

**So Strong evaluates every truncated rollout by banked score alone.** Points held in the live
streak — the entire substance of the push-or-bank decision — are worth **exactly zero** to its
search. It cannot distinguish "sitting on a huge live streak" from "holding nothing."

That explains every number in C29, including the one that made no sense: **more search made
Strong worse** (630→378, 231→105). Additional samples do not correct a blind valuation; they
average it more confidently. And it explains why Always-Safe wins — Always-Safe banks, so its
score is real, while Strong optimises a quantity that ignores the mechanic it is playing.

### Neither file is wrong. The seam is.

`search-utils.ts:112–114` documents the priority split deliberately: **`valueOfStatus` prefers
`score()`** because a horizon-capped leaf must stay commensurate with the terminal `scored`
value (no ±1 squashing), while **`rankingValueOf` prefers `heuristic()`**. That reasoning is
sound in general.

Mine Run's split is also sound: `score()` must equal `banked` because the terminal
`{ kind: "scored", scores: [state.banked] }` is banked, and `heuristic()` carries the
continuation value.

**Each decision is correct locally, and together they produce a Strong that cannot see the
game.** This is the same species as the twenty-three catalogued defects — nothing failed, no
test went red, both authors documented their reasoning — but it is the first where the defect
lives *between* two files rather than inside one.

### Why every guard missed it

- `strong-vs-random` passes: Strong still beats random, because banked-only is a *bad* objective,
  not a random one.
- `probeViewHonesty` passes: Strong is scrupulously view-honest. It is honest and blind.
- The engine's own tests pass: `score()` returns `banked`, exactly as specified.
- **`alwaysSafeVsStrong` is the one gate that caught it** — and it is precisely the gate C6
  installed as the yardstick check. It has been reporting 1.3–11.9 against a 0.95 threshold and
  was, until this read, being interpreted as evidence about the *game*.

### Ruling

**The engine must declare which value a search should use at a non-terminal horizon.** Only the
game author knows whether `score()` is a meaningful mid-game estimate; the platform cannot infer
it, and defaulting to `score()` silently produced a blind bot here. Any game whose `score()` is
a poor mid-game estimate has this defect latent — Mine Run is simply the first solo score-chase
to expose it.

Do **not** fix it by making Mine Run's `score()` include the live streak: that breaks the
terminal contract, and a game bending its own semantics to satisfy a search convention is the
tail wagging the dog.

**C29 is superseded on its central question.** Mine Run is not known to have a design problem.
Its yardstick was pointed at the wrong quantity, and the game must be re-gated once Strong can
see the streak.

---

## C31 — Three plans landed. All three corrected the brief I gave them.

*Plans for Order vs Chaos, Tilt and Bid-Tac-Toe are at `docs/plans/`. Rulings live in each
plan's final section; this records what the round taught.*

**Every one of the three planners found an error in my brief**, and in each case reported it
rather than quietly working around it:

1. **Tilt.** I described the mechanic as "you play a piece, then the board tips" — a *per-move*
   tilt. The research entry specifies a **scheduled 90° rotation every 4th ply with a full
   re-fall**. The planner followed the research entry, flagged the discrepancy in its header,
   and noted why it matters: a scheduled rotation is *predictable chaos players can plan into*,
   a clock both players see coming, not a weapon one player aims. That is the design point, and
   my summary had destroyed it.
2. **Bid-Tac-Toe.** I described it as hidden-information with private budgets. **Under the
   shortlist's own winner-pays-loser rule that is arithmetically impossible**, and the proof is
   three sentences: every chip transfer equals a winning bid; the payer knows it because they
   bid it, the receiver because they received it; so both budgets are always derivable from the
   public starting stack. "Private budgets" is not a presentation choice — it is a *payment-rule*
   choice, and the shortlist had specified the rule that forecloses it.
3. **Order vs Chaos.** Not an error in my brief but in my framing: I asked whether the gate table
   *can* judge an asymmetric game. The answer is subtler than yes or no — it can judge *this*
   game only because seat and role are confounded (seat 0 is always Order), so `first-player-win-
   rate` accidentally measures exactly the right quantity. A future asymmetric game where role is
   *chosen* would break the instrument, and the gate's **name** already mislabels what it
   measures.

### Why this pattern matters more than the three fixes

Earlier today C25 recorded me repeating C22's own mistake in the brief that cited C22. This is
the same failure at larger scale: **I am the highest-bandwidth source of wrong premises in this
build.** Briefs are written fast, from memory, under a completion pressure the plans themselves
are not under — and a wrong premise in a brief propagates into a plan, then an engine, then a
gate that measures the wrong thing.

The mitigation that worked was not care on my part. It was that **each planner read the primary
source and treated my summary as a pointer rather than a specification.** Two of them said so
explicitly. That behaviour is worth naming as expected practice, not lucky diligence:

> **A brief is a pointer to the source, never a substitute for it. When a brief and a primary
> document disagree, the document wins and the disagreement gets reported.**

This cuts the same direction as *subagent claims are not evidence* — which C29/C30 showed I had
been applying in one direction only.

### Two rulings with reasoning worth keeping

**Tilt's 48 px floor (§12.1): exception granted with mandatory two-tap commit, and 6×6 refused
as the fix.** Seven columns at 320 px is ~41 px, under the floor. The mitigating fact is real — a
~41 × ~290 px column strip is a far larger target than the 41 px square the floor was written
for. But the reason 6×6 is *not* the answer matters more: **6×6 is reserved as a balance remedy**,
and spending it on a layout problem would leave the balance ladder one rung short if the gate
fails. Letting a UI constraint pick the board size would also invert the ordering the whole plan
is built on. Carried caveat: the two-tap commit inherits the still-unverified TalkBack
synthesized-click premise; the five-person playtest resolves both together.

**Bid-Tac-Toe's variant (§14.1): Variant R (public Richman) ships.** Beyond the arithmetic, three
things decide it. The balance theorem the game was shortlisted for is a theorem about the
*public* winner-pays-loser game, so the hidden variant weakens the very claim it was chosen for.
The hidden variant cannot run today — `runMatchup` and the bot worker host both refuse 2-player
hidden-info games. And Variant R makes an **exact solve feasible** (~3.9M states at budget 16),
which is the cheapest kill-test this game owns; the hidden variant puts it out of reach.

**And a sequencing rule generalised from C29/C30:** every one of these plans now runs its
*discriminating* experiment before its *accumulating* one — Bid-Tac-Toe solves before it
self-plays, Tilt runs a kill-test sweep before its gates, Order vs Chaos runs a 10k-board
line-probability script before anything is built. Two hours were spent today accumulating seeds
on a question a five-minute code read answered.

---

## C32 — A1 fires. The 6-point swing was not a defect; the comparison was.

The A1 firing diagnostic, instrumented rather than re-run blind:

```
firstPlayerWinRate=0.4  drawRate=0.3  meanPlies=49.78
{ wonCount: 70, capHitCount: 0, deadPositionDraws: 14, fullBoardDraws: 16, unexpected: 0, total: 100 }
dead-position games: 7 mirrored pairs (seeds 10, 26, 27, 32, 43, 46, 48), each ending with openBoardsAtEnd=1
```

**The rule is not inert: 14 of 100 games (7 mirrored pairs) now terminate by dead-position
detection**, all with exactly one sub-board still open — precisely the case A1 was ruled to
catch. `14 + 16 = 30` reconciles with the reported 30% draw rate, and `70 + 30 = 100`. The
mechanism runs.

### Why mean-plies barely moved, and why that is correct

The 14 affected games were **already going to be draws**; A1 only ends them sooner. So the draw
rate is unchanged by construction (what changed is the *reason* 14 draws terminate: full-board
before, dead-position now — `fullBoardDraws` fell from 30 to 16), and the ply saving is small
because these games were already near the end. 14 games × ~3 plies saved ÷ 100 ≈ 0.4 — exactly
the observed 50.2 → 49.8.

I predicted mean-plies would "drop" and told the implementer to investigate if it didn't. **The
prediction was too coarse.** Ending only near-terminal drawn games can shorten 14% of games and
still move the mean by less than half a ply. Investigating was still right — the number was
consistent with an inert rule, and only instrumentation could tell the two apart.

### The 6-point FPA swing: my comparison was invalid, not the data

46.0% → 40.0% cannot be attributed to A1 turning wins into draws — the draw count is identical.
The actual cause is that **A1 changes the tree the bots search**. Rollouts that previously played
dead positions out to a full board now terminate as draws, which changes leaf values, which
changes evaluations, which changes moves — **from early in the game, not only at the end.**

So the two runs are **not a paired comparison**. They are independent samples from two different
games, and comparing them point-to-point was my error. At n=100 the 95% interval on a win rate is
roughly ±10 points; 46% and 40% are indistinguishable, and both sit inside [35, 65].

**This generalises, and it is the C24 lesson one level up.** C24 was about holding the *seed*
fixed so a comparison isolates one variable. Here the seed was fixed and the comparison was still
invalid, because **the engine change altered what the seed produces**. A fixed seed guarantees the
same starting positions, not the same games. Any rules change that a search can observe makes
before/after gate numbers independent samples — they can be compared for *band membership*, never
for drift.

### Ruling

**Nine Grids' recorded numbers are the post-A1 ones: FPA 40.0%, draws 30.0%, mean-plies 49.8,
zero cap hits.** A1 stays — it fires on 14% of games and removes play after the outcome is
settled, which is what it was ruled in to do. The earlier 46.0% belongs to a different ruleset and
is superseded, not averaged.

One thing to carry into the UI stage: **40.0% sits nearer the band edge than 46.0%.** Not a
concern at n=100, but if any future change moves it again, the next measurement wants more games
rather than a tighter reading of the same 100.

---

## C33 — A game dropped from the registry would be untested, not failed

*Found by a false alarm of my own, which is the useful part.*

Checking `main` after the Nine Grids merge, I grepped `games/registry.ts` for quoted top-level
keys and got `crackstep, nine-grids` — **no Fadeout**. For a moment it looked like the flagship
had been dropped by a merge that touched registration.

It had not. `fadeout` uses an **unquoted** key (`fadeout:`) while the others are quoted, so my
pattern `^\s{2}"` simply missed it. Importing the module reports all three. My check was the
defect, not the code — the same species as the three probe errors above it, and the same fix:
**check the thing that runs, not a pattern that resembles it.**

### The real gap the false alarm exposed

If a game *had* been dropped, **nothing would have failed.** C17's route smoke test loops
`Object.keys(registry)` and asserts each route returns 200 with a rendered board. A game absent
from the registry is absent from that loop — it is not tested, and *not tested* reports
identically to *passing*. Likewise `ci-gates` iterates the registry, so a dropped game's gates
silently stop running.

This is the twenty-third-defect shape in a new place: **a test that loops over a list cannot
detect a missing entry.** It is also exactly the hole the A0 drift guard closed on the database
side — where the fix was to assert *the set of public tables is exactly the expected set*, not
merely to check each table found.

**Required:** an assertion that the registry contains exactly the expected game ids, updated
deliberately when a game is added or killed. It is three lines, it runs in milliseconds, and it
converts "a game vanished" from a silent non-event into a red build. Wrap was killed on purpose
and Duel Draft promoted in its place — the catalogue *does* change, so the list must be edited
knowingly rather than drift.

Note also that `registry.ts` mixes quoted and unquoted keys. Cosmetic, but it is what made a
plain-text check unreliable, and lint should settle on one form.

---

## C34 — C30's fix is inert. The guard is real; the mechanism I diagnosed probably is not.

*Correcting C30 while the instrumentation runs, because the evidence against it is already in.*

The paired re-gate, `preFix` hardcoded from C29 and `post` measured live:

```
ROW ci-0  pre(alwaysSafe=849, strong@750=630, ratio=1.348)  post(849, 630, 1.348)  decisions=40
ROW ci-1  pre(alwaysSafe=686, strong@750= 91, ratio=7.538)  post(686,  91, 7.538)  decisions=37
```

**Byte-identical on both seeds.** Declaring `horizonValue: "heuristic"` changed Strong's play not at
all.

### The arithmetic I should have done before writing C30

C30 claimed rollouts routinely hit `rolloutCapPlies = 60` while still `ongoing`, so leaves were
valued by `score()` — banked only, blind to the live streak. **But Mine Run's budget is 60
decisions.** A rollout starting at ply *k* has at most `60 − k` plies remaining, so it is always
under the cap. If rollouts terminate naturally, `valueOfStatus` takes the `"scored"` branch —
`status.scores[player]`, the true final banked score — the `"ongoing"` branch never executes, and
`horizonValue` has nothing to change.

That predicts exactly what was measured. The measured `decisions=40` and `decisions=37` are
consistent with it.

**I had the branch-reachability fact available and did not check it.** C30 reads as a careful
diagnosis — it traced the call path, quoted the engine's own comment, explained why neither file
was wrong — and it never asked the one cheap question: *does that branch ever run?* A mechanism
can be internally coherent, correctly sourced, and still describe code that does not execute.

### What survives, and it is not nothing

**The contract guard is real and stays.** Orchestrator-verified: deleting `horizonValue` from Mine
Run's engine fires `checkHorizonValueDeclared` with an accurate message; reverting returns 11
green. Two independent layers (testkit contract check plus `HorizonValueUndeclaredError` in
`valueOfStatus`), and it is **required rather than opt-in** whenever an engine implements both
hooks — which is C22's lesson applied correctly. A future game whose rollouts *do* hit the horizon
will be forced to declare which value it means, instead of silently inheriting a default nobody
chose. That is worth keeping on its own merits; it simply is not the fix for Mine Run.

### The original question is open again

Why does Always-Safe outscore Strong by 1.3–11.9× against a 0.95 threshold, and why did 4× the
search make Strong **worse** (630→378, 231→105)? If rollouts run to terminal and are valued by
true final banked score, Strong is maximising the right quantity and should not lose to a trivial
policy. Live candidates:

1. **The rollout policy.** `greedyMoveSelector` drives rollouts and `rankingValueOf` prefers
   `heuristic()`. If greedy rollouts bust constantly, every candidate's estimate is dominated by
   rollout-policy noise rather than the candidate's own merit — and more samples average that
   noise *more confidently*, which fits "more search, worse play" precisely.
2. **Determinization bias.** Sampled worlds are consistent with the view; if sampling skews toward
   mine-free layouts, Strong systematically underestimates risk.
3. **A genuine game-design finding**, as C29 first suspected.

**Standing: Mine Run still gets no board** (C16). Two mechanisms have now been proposed and one
refuted; the game has still never been measured by a yardstick anyone has verified.

### The lesson, which is not "check harder"

C29 → C30 → C34 is three readings of one dataset in a day. What distinguishes the wrong two from
the right one is not effort — C30 was the most carefully argued of the three. It is that **C29 and
C30 were both explanations built from reading, and only instrumentation ever settles which code
runs.** The cheap test (`is this branch reached?`) was available at every step and was reached for
only after a fix demonstrably did nothing.

### C34 confirmed by instrumentation — the branch never runs

```
RESULT seed=ci:mine-run:ci-0 finalScore=630 decisions=40 capHit=false
BRANCH_COUNTS ongoing=0 terminal=29194 total=29194 ongoingPct=0.0000%
```

**Zero out of 29,194 leaf evaluations took the `ongoing` branch.** Every rollout terminated
naturally, exactly as the budget arithmetic predicts. C30's mechanism is refuted outright, not
merely doubted — `horizonValue` cannot have changed Strong's play because the code path it
governs never executed.

The number also settles *why* the fix was inert without any further measurement, which is what a
discriminating experiment buys: one 3-minute instrumented run replaced a 4-seed paired re-gate
that would have taken 12 minutes to say "identical" four times.

---

## C35 — Strong's rollout policy is weaker than the baseline it must beat. Its search cannot see the scores Always-Safe reaches.

*One decision, one dump. The third cheap discriminating measurement of the day, and the one that finally answers C29.*

Per-candidate rollout statistics at a real mid-game decision, 16 samples per candidate:

```
{"t":"reveal","cell":58}  n=16 mean=593.44 std=78.61 min=435 max=630 bustFrac=0.0%
{"t":"reveal","cell":68}  n=16 mean=593.44 std=78.61 min=435 max=630 bustFrac=0.0%
{"t":"reveal","cell":75}  n=16 mean=593.44 std=78.61 min=435 max=630 bustFrac=0.0%
   … 4 more candidates, byte-identical mean AND std AND min AND max …
{"t":"reveal","cell":59}  n=16 mean=581.25 std=87.21 min=435 max=630 bustFrac=0.0%
   … 8 more, again all identical to each other …
{"t":"bank"}              n=16 mean=456.00 std= 0.00 min=456 max=456 bustFrac=0.0%
SEPARATION best=cell45 second=cell46 gap=0.00 pooledStd=0.00
```

### Three findings, in order of consequence

**1. The rollout ceiling is below what the trivial policy achieves.** No rollout anywhere in this
dump exceeds **630**. Always-Safe scored **849** on this seed. So Strong's search literally cannot
represent the outcome its baseline attains — every candidate is valued by "what happens if I play
*greedily* from here", and greedy tops out below Always-Safe.

**That is the answer to C29.** More rollouts converge harder on a greedy-continuation estimate,
and greedy is a worse policy than always-banking. It explains the direction (Always-Safe wins), the
magnitude (1.3–11.9×), and the thing no other hypothesis explained: **why 4× the search made
Strong *worse*** (630→378, 231→105). More samples do not fix a value model whose ceiling is wrong;
they just commit to it with more confidence.

**2. The candidate move barely affects the rollout outcome.** Seven candidates share mean 593.44,
std 78.61, min 435 and max 630 — **identical multisets**, not merely similar. Nine more share
581.25/87.21. The greedy continuation dominates the result so completely that which cell you reveal
first is almost invisible in the estimate. Gaps between groups are ~12 against a standard error of
~20 (78.61/√16), so the ordering is **not statistically distinguishable**, and the reported
separation between the top two candidates is `gap=0.00` — an exact tie broken arbitrarily.

**A search whose argmax is a coin flip between tied noise is not searching.**

**3. My stated mechanism was wrong again, and the dump says so directly.** I predicted rollout
*busting* — "if greedy busts constantly, estimates are dominated by noise." **`bustFrac=0.0%` on
every single candidate.** Greedy never busts. It is not reckless; it is *timid and mediocre*, which
produces the same symptom by the opposite route. The rollout-policy *family* was right; the
specific failure I named was not.

### What this means for Mine Run

**Mine Run has still never been measured.** Three mechanisms proposed (C29 game-design, C30 horizon
valuation, C35 rollout policy), two refuted by instrumentation, and the game has yet to face a
yardstick anyone has verified. The `alwaysSafeVsStrong` gate has been correct and load-bearing
throughout — it is the only guard that caught any of this, exactly as C6 intended.

The fix is a rollout policy at least as strong as the baselines Strong is gated against. That is a
real piece of work, not a knob. **Mine Run still gets no board** (C16).

### The lesson this cost three attempts to learn

C29, C30 and C35 were all explanations for one dataset. The two wrong ones were built by *reading
code and reasoning*; the right one came from *dumping the numbers the search actually computes*.
Each wrong mechanism was plausible, internally consistent, and sourced from the real code — and
that is precisely what made them expensive, because plausibility is what stops you measuring.

**When a search behaves strangely, dump its per-candidate statistics before theorising about its
value function.** It is one run, it costs seconds, and it would have answered this at 09:00.

---

## C36 — The root cause is the heuristic, not the search. And the decisive test was one nobody asked for.

*Refines C35. The implementer found this by designing a measurement I had not specified — the
single most valuable thing produced today.*

### The test I did not think to ask for

I asked for per-candidate rollout statistics, which told us the rollout ceiling was too low. The
implementer then asked a sharper question: **what does the heuristic do with no search at all?**

Standalone Greedy — zero MCTS, zero rollouts, pure 1-ply `rankingValueOf` on the same heuristic —
against Always-Safe, same three seeds:

```
seed    alwaysSafe   greedy   ratio
ci-0         849         91    9.330
ci-1         686          3  228.667
ci-2        1247        231    5.398
```

**On ci-2, Greedy scores exactly 231 — identical to Strong@750's 231.** Strong's entire MCTS
apparatus, 750 rollouts × 16 determinized worlds per candidate, lands precisely where bare 1-ply
greedy would have landed anyway.

That isolates the defect completely: **it is not in the search machinery** — not determinization,
not averaging, not sample count, not the horizon valuation I spent two corrections on. It is in the
evaluation function everything else is built on.

### The mechanism, with ground truth

`createMineRunHeuristic` is a **1-ply-only risk estimator** (`bankValue` vs `revealEV`, single-point
CSP fixpoint — deliberately weaker than `safeMove`'s full joint CSP, and its own comment says so).
It drives Greedy's decisions, every rollout-continuation step, and therefore Strong's root averages.
Because it never accounts for the **compounding** risk of a long run of future pushes, it keeps
recommending "push", turn after turn.

A captured real decision, seed ci-0 at ply 15 — the actual applied game, not a simulation:
**`minesExploded=5` of 20, `banked=0`.** Strong pushed through five real explosions in fifteen moves
and never banked once.

Determinization bias is ruled out by the same trace: those explosions happened against the **real**
mine layout via the true `rngFor(seed, ply)` transition, not a resampled hypothetical world.

### A correction to my own C35

I wrote that more samples "average that noise more confidently." **That is backwards, and the
implementer's version is right:** more samples *reduce* noise, converging the root average more
precisely onto the true expected value of *"follow this myopic heuristic's continuation."* At low n,
sampling noise occasionally lets a locally-better estimate through; at high n it converges cleanly
onto the heuristic's actual mediocre mean.

**The search is accurately measuring a bad policy, and measuring it more accurately makes the
badness more visible, not less.** That is a better sentence than mine and it explains 630→378 and
231→105 exactly.

### What is still open — and what this is not

**This is a bot-quality finding, not evidence about Mine Run's design.** Only a risk-*blind* policy
has ever been measured against Always-Safe. Whether a risk-*aware* one — joint-CSP informed, or an
EV model that discounts for the compounding chance of hitting a mine before the next bank — can beat
always-banking **remains untested**, and it is exactly C29's original question.

So C29 is neither confirmed nor refuted. It has been made *answerable* for the first time.

**Mine Run still gets no board** (C16), and the standing question is now precise: *does any
risk-aware policy beat Always-Safe on this board?*

### The pattern worth keeping

Four mechanisms were proposed for one dataset (C29 design, C30 horizon, C35 rollout ceiling, C36
heuristic). The three I authored came from reading code and reasoning about it. **The one that
isolated the cause came from an implementer designing a measurement that removed a variable I had
not thought to remove** — strip the search entirely and see whether the evaluation function alone
reproduces the failure.

When a system built of layers misbehaves, delete layers until it stops. That is cheaper than
explaining any single layer, and it does not depend on guessing which one is wrong.

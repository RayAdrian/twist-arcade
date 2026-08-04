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

**What the scaffold got right**, and it is the larger half: after rebasing across ten commits
of shell restyle and the real bot worker landing, Wrap's board UI, four-variant `announce()`,
and registration were **already correct with zero adaptation** — confirmed by planting two
lint violations by hand to prove the boundaries actually fire.

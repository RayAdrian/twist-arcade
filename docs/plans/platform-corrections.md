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

---

## C37 — Mine Run risk-policy rulings, and two gaps the Nine Grids board found

### Rulings on `docs/plans/mine-run-risk-aware-policy.md` (in the plan's §8)

R1 the seam is an **engine hook, not manifest data** (the manifest carries data; a policy is
code, and the engine already exports `safeMove`/`sampleConsistentState`/`heuristic`). R2 Greedy-
tier redefinition approved — a tier scoring 3 points on a real seed is not a difficulty rung —
and the in-world one-ply leak is recorded platform-wide **now**, because C31 established that a
hazard left for later gets rediscovered expensively. R3 the three-leg kill standard is approved
**including its one-round sweep bound**, which is the point: open-ended tuning after a
pre-registered failure is how a kill decision becomes unfalsifiable. R4 approved.

The spec's own contribution beyond C36 is worth naming. It found a **structural second half** to
the defect: `greedyMoveSelector` applies each candidate to the sampled world and evaluates the
*resolved* next state, so a reveal's risk is settled before evaluation — a surviving reveal is
worth `B+V+gain`, banking `B+V`, and the argmax over ~80 cells almost always finds a survivor.
**Bank is near-dominated at every ply in every sampled world, no matter how good `heuristic()`
is.** That explains `banked=0` through ply 15 *and* C35's bank sitting flat at 456. And it was
flagged as a code-read inference with a named five-minute confirming measurement rather than
asserted — C34's lesson applied by someone who had only read about it.

### C38 — two guards that don't guard, found by building the board

**1. The 75 kB route budget is not measured for game chunks.** `.size-limit.json` measures only
the shared `/play/[gameId]` shell chunk (1.64 kB). A game's own dynamically-imported chunk — the
thing the budget exists to bound, and the reason the registry uses `import()` at all — **is
measured by nothing.** Every game could exceed it silently. This is the C33 shape again: a
budget that reports on the wrong artifact reads exactly like a budget that passes.

**2. Two accessibility cases cannot be tested end-to-end, and were flagged rather than faked.**
`/play/[gameId]` has no hotseat entry point (`resolveMode()` always picks `solo-bot` for
two-player games) and no scripted bot-driver seam, so both seats cannot be driven through the
UI. The team marked them `test.fixme` with the content proven at the engine + `announce()` level
— the correct call. Fadeout's own e2e suite documents the same gap, which means it has been open
since the first game shipped and nobody wrote it down.

### The find that justifies real-browser testing

While building the send-pulse, the team hit a bug **jsdom could never have caught**: a ref-based
"just sent" comparison was silently erased by an unrelated second React commit — `useGame.ts`'s
`dispatchBotIfNeeded` setting `botThinking: true` — before paint. Confirmed by instrumenting a
real render log in Chromium, then fixed by switching to a per-ply React `key` (Fadeout's remount
pattern). The reduced-motion violation was then re-planted against the *fixed* code and
reproduced the same exact failure.

That is the C17 lesson generalising: **test the thing that runs.** A component test asserts what
a component does in isolation; only a browser shows what two commits do to each other.

### The 81-cell problem, solved without shrinking anything

A flat 9×9 at the 48 px floor needs `9×48 + 8×4 = 464 px`; the frame at a 320 px viewport is
~288 px. **61% over.** The team reported the arithmetic *before* building, evaluated a two-tap
macro→micro picker, and rejected it because the test plan's FREE-005/A11Y-006 require every open
board's cells actionable **simultaneously** — a picker cannot satisfy that. Instead `BoardShell`
now sizes to its natural minimum and the frame becomes a scrollable pan region: pure CSS, no JS
measurement, zero effect on existing games whose natural size always fit. Verified in a real
320 px browser with all 81 cells ≥48×48.

Worth contrasting with Tilt, which was granted a floor *exception* for column strips. Nine Grids
needed no exception because a different layout existed — and the reason we know that is that the
arithmetic was done before the board, not after.

---

## C39 — S0a confirms the structural leak exactly. S0b exposes a disagreement inside the gate itself.

### S0a: zero of 504,823

A counting proxy around the real, unmodified `greedyMoveSelector`, wrapped into
`determinizedFlatMonteCarloPolicy` at production Strong's exact constants, real launch board,
seed `ci:mine-run:ci-0`:

```
RESULT finalScore=630 decisions=40 capHit=false
FINAL  totalCalls=504823 bankCalls=0 bankFrac=0.0000%
```

The proxy's own transparency check holds — 630/40 reproduce the documented C27/C29/C34 baseline,
so the wrapper altered nothing.

**Bank was chosen zero times in 504,823 rollout-selector invocations.** The spec predicted "~0";
the measurement is exactly 0. So §0's structural read is **confirmed rather than plausible**:
inside a greedy rollout, bank is not rare — it is *unreachable*. A better `heuristic()` was never
going to fix this, because the leak is in `greedyMoveSelector` evaluating a **resolved** sampled
state, not in the value function it ranks by.

That is the fourth mechanism proposed for this dataset and the first confirmed by direct count.

### S0b: neither pre-registered branch fires cleanly, and that is itself informative

35 combos × 23 seeds = 805 games in **2.166 seconds** — the spec's cost estimate was right, and
the whole question that consumed hours of Strong runs is answerable in seconds with the right
policies.

Wiring was proven before the result was trusted, twice: a mutant that broke the safe-move
tie-break **diverged from Always-Safe on 3/8 seeds** (so the equivalence check can catch a real
bug rather than passing vacuously), and a planted wrong expected value made the bridge guard
report `ok=false` and halt. `pCap = 0` then reproduced Always-Safe **byte-exact across all 161
runs** — every T, all 23 seeds, on score, decision count and full move log.

```
alwaysSafeMedian = 686 (n=23)
T=5,  pCap=0.30  median 725  winFraction 0.304   <- best median
T=30, pCap=0.30  median 715  winFraction 0.348   <- best win fraction
T any, pCap<=0.20  median 686 (flat)             <- the cap never changes the trajectory
```

**No combo reaches a majority win fraction** (max 0.348), so §1's literal rule sends this to the
kill-priority branch. But the team flagged — correctly — that the *dark* branch did not fire
either: the best combo's median sits **above** Always-Safe's. This is a small, inconsistent lift
at n=23, exactly the shape C26 exists to stop anyone reading in either direction.

### The finding underneath: the gate metric and the paired comparison disagree

The gate is `median(AlwaysSafe) / median(policy) < 0.95`. At T=5/pCap=0.30 that is
`686/725 = 0.946` — **it passes, barely.** And the same policy loses to Always-Safe on **70% of
individual seeds**.

Both numbers are correct; they measure different things. The gate compares **unpaired medians**
across a seed set, while the win fraction is **paired per board**. A policy with a fatter right
tail can lift the unpaired median while losing most head-to-head matchups.

**A gate that a policy can pass while being worse on 70% of the boards a player would actually
see is measuring the wrong thing.** This is not a Mine Run defect — it is in `solo-gates.ts` and
applies to every solo-chase game. It has never mattered before because no policy has come near
the threshold.

**Required, before the n=100 verdict batch:** report the paired win fraction alongside the median
ratio, and decide deliberately which one gates. My inclination is that the paired fraction is the
honest primary for a solo score chase — a player plays one board at a time, not a distribution —
but the n=100 batch is where that ruling should be made with real numbers in hand, not now.

### Ruling on sequencing

**Proceed to S1** (build the §2 survival-discounted policy), for a specific reason rather than
optimism: the threshold family is a **two-knob hand policy**, and its `pCap ≤ 0.20` rows show it
barely engages at all. It is a floor on what risk-awareness can buy, not a ceiling. The §2 model
prices the compounding hazard properly and deserves its own measurement.

But S0b lowers the prior. If a principled policy also lands near parity, that is C29's suspicion
arriving on better evidence, and the three-leg kill standard (C37/R3) decides it — **including
its one-round sweep bound**, which exists precisely so a marginal result cannot be tuned into a
passing one.

---

## C40 — Order vs Chaos clears OV0/OV1, and a plan's decode spec was unreachable as written

**OV0 (the cheap kill-check):** `P(a uniformly-random filled 6×6 contains a ≥5-run) = 8243/10000
= 0.8243`, against the plan's ≈0.8 prediction. Well under the 0.95 escalation threshold, so
rollouts do carry Chaos signal and the game survived its cheapest possible death.

The team went further than the number: naive independence gives `P(no run) ≈ e⁻² ≈ 0.135`, but
measured `P(no run) = 0.1757` — **window overlap raises it, exactly as the plan's own parenthetical
predicted.** A measurement matching a prediction *and* its stated caveat is much stronger evidence
than a bare number, because a coding error would rarely reproduce both.

**OV1 (the engine):** 53/53 green, full workspace 1,628 passed, typecheck and lint clean. Six
planted violations, each verified applied and observed firing — purity, `encode`-excludes-effects,
win-precedence, the C4 dual-winner rejection (planted removal proved the test isn't vacuous), the
lint import boundary, and the rule-sentence length assertion.

### The C15/C28 scaffold fix validated itself in production use, one day old

`pnpm new-game order-vs-chaos` printed **"UNREGISTERED"** and left `games/registry.ts`
byte-identical. The gap that had been open since M5 — every scaffolded game silently routable
before an engine existed — is closed and confirmed by a team that had no reason to test it.

### The judgment call worth recording

Plan §5 item 7 lists five `decode` throw conditions verbatim, two of which are **structurally
unreachable as written**: "a 5-run present while status is `ongoing`" and "a full board with no
line while `ongoing`". Status is never stored — it is derived fresh from the board each call
(Fadeout's convention), and §5.7 pins `encode` to exactly `cells + toMove + config id`. A decoded
board carrying a completed line therefore *always* derives `won`; it can never present as
`ongoing`, so there is nothing to reject.

The team honored them as **positive correctness tests** (decode succeeds; `status()` reports the
right winner; never `ongoing`) and operationalized the umbrella "status inconsistent with board"
bullet as the one genuinely undecidable case: **a completed run for both symbols at once**, which
is impossible because the game halts the instant either appears. That is C28/A3 extended to this
game by someone reasoning from the contract rather than transcribing the list.

**This is the fourth time today a plan or brief specified something that could not be what it
claimed** (Tilt's mechanic, Bid-Tac-Toe's private budgets, my C30 diagnosis, now this). Each was
caught by an implementer treating the document as a claim to check rather than an instruction to
follow. That is the behaviour to keep — and the reason to keep writing specs precise enough to be
*wrong* rather than vague enough to be unfalsifiable.

**Deliberately not done, all correct:** the pairing-bot probe is built and mechanically verified
but its `<40% vs Strong` measurement is OV2 work; `ciGateBudget` is left unset so `runCiSuite`
**refuses** the ci suite until OV2's sweep sets it (C22's refusal working as designed, not a gap);
and the game is unregistered.

---

## C41 — The principled policy lands at parity too. And a planted mutant that agreed *vacuously*.

### The measurement

`riskAwareMove` — §2's survival-discounted plan-then-bank model, Tier B exact posteriors, scanning
every `m`, no search — against Always-Safe on S0b's identical 23 seeds, both metrics carried
together:

```
alwaysSafeMedian = 686    riskAwareMedian = 715
gateRatio (alwaysSafe/riskAware) = 0.959   — the hard-fail threshold is >= 0.95; this FAILS
PAIRED win/loss/tie = 11/11/1  →  win fraction 0.478
```

**Unlike S0b, the two metrics agree**, and that agreement is the informative part. S0b's threshold
family passed the gate at 0.946 while losing 70% of paired boards — a split that made the result
unreadable. Here a properly-engineered model reads near-parity on *both*: it fails the gate by
0.009 and wins essentially half its boards.

Per-seed variance runs both ways (up to +40% and −37%; `ci-2`: 1247 vs 788, `pilot-16`: 367 vs
231), with no cap hits, no crashes, no degenerate scores. This is a **working policy that does not
beat always-banking**, not a broken one.

**This is C29's suspicion arriving on far better evidence than S0a/S0b could give it.** The best
standalone risk model the spec calls for sits at the gate's fail boundary and a coin-flip paired
win rate.

**It is still not a verdict.** n=23 is exactly the regime C26 exists to distrust, and the three-leg
kill standard (C37/R3) is the decision mechanism: the n=100 frozen-param batch, the one-round lever
sweep, and the reduced-board exact check. None has run. The team said so plainly and tuned nothing
— which is what I asked for and what makes the number worth having.

### The catch worth more than the measurement: a plant that applied and still proved nothing

Verifying view-honesty, the team built a deliberately dishonest selector that peeks at
`state.mines` to dodge real mines. **The first attempt agreed with the honest policy on every
resampled world** — and the reason was not that the guard worked. The scripted state happened to
land on a *provably safe* cell, where honest and cheating policies necessarily choose alike. The
plant had applied correctly and the test was still vacuous.

They caught it, found a genuinely ambiguous state instead (`bestPosterior = 0.182`, no provably-safe
cell), and reran: honest agreed across all five worlds (`cell 19` every time), the dishonest peek
diverged (`2,1,1,1,2`). **The check bites.**

This sharpens the standing instruction, which until now has been *"verify the plant actually
applied."* That is necessary and **not sufficient**. A plant can apply perfectly and still land
somewhere the guard cannot distinguish — a position with only one sensible move, a board where
every policy agrees, an input outside the branch under test. The instruction becomes:

> **Verify the plant applied, and verify it landed somewhere the guard could have failed.**
> A guard that passes on an input where cheating and honesty coincide has not been tested.

Five of my own probes failed the first half today. This is the first documented instance of the
second half, and it is subtler: nothing looks wrong. A green result on a correctly-applied plant is
the most convincing wrong answer available.

---

## C42 — Leg 1 does not fire, and the reason is not what the headline number says

### The measurement (n=100, 37 policies, 11.16s total)

```
Always-Safe median 692.5   (bridge check 849/686/1247 byte-exact first)
RiskAware-B  median 729    gateRatio 0.9499   paired 49W / 37L / 14T
best grid    median 735.5  gateRatio 0.9415   paired 40W / 23L / 37T
Random       median   7    gateRatio 98.9     paired  0W /100L /  0T
```

`LEG1_FIRES = false`, computed exactly as pre-registered.

### The headline "win fraction 0.49" understates the result, and ties are why

`0.490` counts **ties in the denominator**, and 14% of boards tie. On boards where the two
policies actually differ, RiskAware-B wins **49 of 86 — 57.0%**. A two-sided sign test gives
**p ≈ 0.235**: a real directional edge, not statistically established at this n.

So all three readings now agree in direction — median higher, gate ratio passing, paired
decisive-board edge 57%. **Mine Run's mechanic does reward skill.** Modestly, and not yet
significantly, but the C29 suspicion in its dark form — *"always-banking dominates, the decision
is fake"* — is **not supported at n=100.**

That matters because it reverses the direction the evidence pointed all day. C29, S0b and the n=23
S1 run all read as "risk does not pay." At n=100 with ties handled correctly, it does.

**Correcting the metric, not the verdict:** `winFraction` must exclude ties or be reported as
W/L/T. A tie-inclusive fraction makes a 57% edge look like a 49% deficit, and this is the second
metric defect found in `solo-gates.ts` today (C39 was the unpaired/paired split). Both were
invisible until a policy came near the threshold.

### The other number: the gate flipped on 0.0001

RiskAware-B's gate ratio moved from **0.959 (fail) at n=23** to **0.9499 (pass) at n=100** — a
**0.0001 margin** against the 0.95 line, while its paired reading barely moved (0.478 → 0.490
tie-inclusive). The median-based verdict changed sides of the threshold; the paired one did not.

**A pass with a 0.0001 margin is not a pass, it is a coin landing on its edge.** Nothing about
this policy is robustly better than always-banking, and treating 0.9499 as "green" would be
reading precision the measurement does not have.

### Ruling: proceed to leg 2, the pre-registered one-round lever sweep

The spec's §5 table is explicit for `best ratio in (0.70, 0.95)` — **gate passes, design target
missed → one bounded lever-sweep round, then freeze or escalate.** 0.9499 sits in that band, barely,
and the design-healthy target is **0.70**. The mechanic pays; it does not pay *well*.

Leg 2 as pre-registered in C37/R3, and the bound is the point: the grid {18, 20, 22}% density ×
{50, 60, 75} budget, n=40 direction-only, best config confirmed at n=100 on a **fresh derived seed
block** (each config is a different game — C25/C32). **One round.** If no configuration lifts the
best policy meaningfully below 0.95 — toward the 0.70 target rather than tickling the line — the
finding is that Mine Run's press-your-luck decision is technically real and practically negligible,
and that is an escalation to the user, not a kill I make alone.

**I am not moving the goalposts.** C39 pre-registered *the question* of which metric gates and
recorded my inclination toward the paired reading **before** these numbers existed; this ruling
uses the criterion as written and corrects only the tie-handling arithmetic, which is a bug in the
statistic, not a change to the standard.

### Process note, and it is the fourth today

The team followed the **codebase** over my prose: the spec said seeds derive as `:i`, the real
`pairedSeeds` export uses `-i`, and `ci:mine-run:ci-{0,1,2}` themselves are already in that form.
It used the code and flagged the discrepancy rather than silently choosing. That is C31 working
exactly as intended — and the reason the bridge check reproduced byte-exact instead of quietly
measuring a different seed set.

---

## C43 — The chunk budget now measures the right artifact. And the code-splitting it measures does not actually split.

### The fix, and the number that proves the old gate was blind

`scripts/chunk-budget.ts` parses the **already-built** shell chunk with the TypeScript compiler
API and reads each game's real dynamic-import graph — `loadEngine`/`loadPresentation`/`loadSolver`
compile to `n.e(<chunkId>)` calls inside one object, located **structurally** by exact
property-key-set match against `Object.keys(registry)` rather than by a minified variable name. So
it is registry-derived per C33: a new game is covered automatically, and a key-set mismatch fails
loud instead of silently reporting 0 bytes.

Measured, nothing adjusted: **crackstep 7.21 kB · fadeout 8.26 kB · nine-grids 4.83 kB** gzip, all
far under 75 kB.

**`DEFAULT_HARNESS_THRESHOLDS.maxBundleKb` had zero readers anywhere in the codebase.** The
threshold existed, was documented, was cited in game plans — and nothing consumed it. This script
is its first reader. Another guard that never guarded, found only because someone went looking for
what enforced the number.

**The planted violation demonstrates the defect exactly.** A 300 kB payload added to Nine Grids:

```
size-limit:    game route (/play/[gameId])  1.64 kB gzipped   [exit 0 — stayed GREEN]
chunk-budget:  nine-grids: 168.35 kB gzip [OVER BUDGET]       [exit 1, names the game and overage]
```

The old gate sailed through a 300 kB regression. The new one caught it, named the offender, and
gave the exact excess.

### The plant's first attempt failed to apply — and the check that caught it

The payload was first gated on `NOISE.length > 0`, statically `true`, so the minifier
constant-folded the branch and dead-code-eliminated the whole payload. **The source file was on
disk and the bytes were not in the build.** Caught by grepping the *built* `.next/` output for a
needle and finding zero matches, then fixed with `Date.now() < 0` — a call the minifier cannot
evaluate — and re-verified present before any number was trusted.

That is C41's sharpened instruction applied one layer deeper: not just *did my edit apply to the
source*, but *did it survive to the artifact under test*. A build step sits between the two, and it
is allowed to delete your plant.

### The finding that matters more than the fix

Confirmed while building it: **Next unions every game's async-chunk `<script>` tags into every
generated `/play/<id>` page.** The built HTML for `crackstep`, `nine-grids` and `fadeout` have
**byte-identical script lists.**

So the code-splitting the registry exists to provide is real at the *bundler* level — each game's
factory only executes on demand — and **not real at the network level**. A cold visitor to any one
game downloads *every* registered game's code. `generateStaticParams()` cannot statically narrow
reachable chunks per param value, so it unions them.

This scales the wrong way. Three games is 20 kB of waste; the launch catalogue is **six**, and the
roadmap's Phase 4 target is more. It also directly threatens a Phase 1 exit criterion — Lighthouse
green on a mid-tier Android over 4G — and it silently negates the entire reason
`games/registry.ts` uses `import()` and the reason the lint boundary bans static game imports from
`app/**`.

It is also why the "cheapest honest answer" I suggested — measuring transferred bytes in the
Playwright route pass — **would not have worked**: every game would report the sum of all games,
and a regression in one would move every number identically, naming no offender. The team tested
that suggestion against the built output and rejected it with evidence rather than attempting it.

**Not fixed here.** It needs a deliberate look at the route shape (per-game routes, a client-side
lazy boundary, or `next/dynamic` with explicit loading) and it is a product-performance decision,
not a CI-guard one.

---

## C44 — Order vs Chaos is killed. Window density, not tempo.

*Second game killed by its own gates. The pre-registered two-rung ladder fired exactly as
written, and the confirmatory rung earned its ten minutes.*

### The measurements

```
config A (Order first, n=100)   [FAIL] first-player-win-rate: 78.0%  (band [35,65])
                                       84.0% on an independent n=100 sweep, different seed
config B (Chaos first, n=100)   [FAIL] first-player-win-rate: 92.0%
both: strong-vs-random 100.0% · draw-rate 0.0% · zero cap hits · pairing-probe Chaos 0.0%
```

Both rungs outside the band, on the same side. Per §3's rule fixed before any number arrived,
**the game is killed.**

### The mechanism: the win condition sets the odds, not seat order

`P(a uniformly-random filled 6×6 contains a ≥5-run) = 0.8243`. So Chaos's **do-nothing baseline is
17.6%**, and Strong MCTS Chaos measured **16–22%**.

**Skilled Chaos play buys at most ~4 points over random placement.** That is not an imbalance, it
is a *depth* failure: the Chaos side is close to strategically inert. Order wins on **any** ≥5-run
by **either** player, so Chaos must thread 36 forced placements avoiding all 32 windows on 36
cells, with each cell sitting in up to 9 windows. Wrap died on one arithmetic coincidence
(`C(5,4)=5`); this dies on **window density** — the same pattern one level up.

### Why running config B was worth ten minutes even though it confirmed

**Giving Chaos the first move made the game *worse*: 78–84% → 92%.**

Had B merely also failed, we would have two failures and a plausible story. B failing *harder* is
positive evidence for the mechanism rather than just consistency with it: if the imbalance were
about who builds toward a line first, handing Chaos the tempo should have narrowed the gap. It
widened it — because moving first simply hands Chaos one extra forced placement, and every forced
placement is another chance to complete a window it is trying to avoid.

**The confirmatory run produced a better diagnosis than the original failure did.** That is the
argument for not skipping pre-registered rungs when the answer looks obvious: C14's caution was
warranted as discipline even in the case where the prediction held, because the cost of checking
was ten minutes and the yield was the sharpest evidence in the file.

### What survives the kill

The engine, its 54 green tests, the OV0 line-probability script, and the budget-validation
methodology (cost pilot → n=100 two-config verdict-match → validated 3,000-rollout budget
reproducing the 10,000 verdict) are all reusable. The R1 line-probability check in particular is
now a **general screening tool for any full-board line game**: measure `P(random fill contains a
win)` before building, because that number is the losing side's ceiling before strategy exists.

**Added to the game-theory lens as a design rule:** *for a maker-breaker game on a full board, the
breaker's do-nothing baseline is `1 − P(random fill contains a win)`. If skilled breaker play
cannot beat that by a wide margin, the breaker's side of the game is inert regardless of balance
tuning.* Order vs Chaos bought 4 points. That is the number to check first, and it is cheap.

### Slate consequence

Two of the six two-player launch slots are now empty (Wrap → Duel Draft, and this one). Remaining
candidates for Phase 1's **six games live** bar: Fadeout ✅, Nine Grids ✅, Crackstep ✅, plus Tilt,
Bid-Tac-Toe, Duel Draft and Mine Run — **four candidates for three slots**, all still ungated.
That is a thinner margin than it looks, given two of the last three gated games died.

---

## C45 — Tilt clears its kill-test sweep. Ruling on the double-line rule.

### The sweep (200 games/pairing, one fixed seed, shipped 7×7/win-4/period-4/cw)

```
MCTS-1k vs MCTS-100        84.0%   (kill <55%)   PASS by 34 points
strong-vs-random          100.0%   (kill <90%)   PASS
decisive games ended by a re-fall:
   self-play 14.3% · strong-vs-random 19.5% · depth-check 10.4%
                                   (kill >60% or ~0%)  PASS
draw rate 9.0% · median plies 17 · branching 6.92 · cap-hit 0.00% across 600 games
```

**No kill row hit.** The row that mattered most is the first one: Order vs Chaos died because
skilled play bought ~4 points over its breaker's do-nothing baseline (C44), and Tilt's analogue
clears the line by **34 points**. Planning through the rotation genuinely pays — the twist is
strategic, not decorative. The re-fall decides ~14% of games: present often enough to matter,
never often enough to dominate, which is the narrow window this mechanic had to hit.

Structural termination (§1.6) held under real MCTS play at **zero cap hits in 600 games**, not
merely in unit tests.

### Ruling: ship `doubleLine: "draw"` — the plan's default stands

Double-line frequency measured **9.0%** (18/200), above the §5.1 flag threshold of 2%, so the
required follow-up ran. Under `"mover-wins"` on the identical sample: **seat0 57.0% / seat1 43.0%,
draws 0.0%** — every one of the 18 draws becomes decisive, and no other draws exist to confound the
comparison. The two rules genuinely diverge on 9% of games.

**`"draw"` ships.** When a rotation completes four-in-a-row for *both* players simultaneously,
neither player caused it more than the other — the tilt did. `"mover-wins"` would hand the mover a
windfall for an outcome the schedule produced, which is arbitrary in a game whose whole design
premise is that the rotation is *predictable* and plannable. The plan's own §7 already names the
texture line for it — *"Both lines landed — a shared tilt"* — and a distinctive shared moment on
9% of games is a feature, not a defect to legislate away. 9% is also far inside the 60% draw
ceiling, so nothing is bought by removing it.

**Binding on T3/T4:** the gate table must measure first-player win rate under the **shipped**
`"draw"` rule. The 57/43 figure above belongs to the *other* variant and must not be carried
forward as if it described what ships — C32's rule that a rules change makes runs independent
samples applies here exactly.

### Two process notes worth keeping

**The engine was right; the fixtures were wrong.** Reaching green required fixing invalid
disc-count parity in two hand-built boards, a "same grid via different move order" fixture that
ignored disc value being tied to ply parity, and two mirror-probe tests querying the wrong seat.
The team said so explicitly rather than letting it read as engine failures — worth naming because
a fixture bug that gets "fixed" in the engine instead is how a real defect gets written in.

**Plant #7 justified a test that looked redundant.** Breaking the full-board draw check (`>` for
`===`) failed one static fixture — and the 40-trial random-playout test **did not catch it**,
because draws are rare enough that no seed reached a genuine full board. Without the plant, that
static fixture would have looked like duplicated coverage a future cleanup could delete. This is
the inverse of C41's vacuous-plant lesson: there, a plant landed where the guard couldn't fail;
here, a plant proved a guard was doing non-redundant work nobody could have inferred.

All 8 plants fired, each verified to land somewhere the guard could have failed.

---

## C46 — Leg 2 found a configuration where the mechanic actually pays

### The result

```
frozen  (20% density / 60 budget)  gateRatio 0.9499   decisive 49/86 = 0.570   sign-test p = 0.235
leg-2   (22% density / 75 budget)  gateRatio 0.9208   decisive 58/94 = 0.617   sign-test p = 0.0298
```

**The frozen configuration was not statistically distinguishable from always-banking. The swept one
is** — p = 0.0298, significant at α = 0.05 — and its gate ratio clears the 0.95 hard line by a real
margin instead of the 0.0001 that C42 called "a coin landing on its edge."

The bounded one-round sweep did exactly what it was pre-registered to do: it found that Mine Run's
press-your-luck decision **does** reward skill, at a density and budget the original configuration
was not sitting on. That is a materially different game from the one measured this morning, and it
is a better one.

### The confirmation step earned its keep, and C26 is the reason it exists

The n=40 grid read **0.7105** decisive for 22%/75. The n=100 confirmation gave **0.6170** — the
grid reading overstated by **9 points**.

Had the sweep stopped at n=40 and reported its best cell, we would have recorded a design-healthy
result that does not exist. This is the third time today a small sample pointed somewhere the large
one did not (Nine Grids' 15-game pilot read 13.3% on a game that measured 46.0%; Order vs Chaos's
mean-plies swung 19.8–28.4 at n=15). **The two-stage grid-then-confirm design is what converts a
sweep from a fishing expedition into a measurement**, and the bound — one round, best cell only,
fresh seed block — is what stops the confirmation from becoming another search.

### Ruling: freeze at 22% density / 75 budget

Per §5's table, `(0.70, 0.95)` is *gate passes, design target missed → one bounded round, then
freeze or escalate.* The round is spent. **I am freezing at 22%/75**, and the reasoning is that
0.95 is the **ship bar** while 0.70 is a **health aspiration** — this is a passing gate that misses
an aspirational marker, not a failing gate I am waiving. Only the user may waive a finding, and
there is no finding here to waive.

**What is escalated, as information rather than as a blocker:** at gateRatio 0.9208 the skill edge
is real, significant, and *modest*. A player's good decisions beat always-banking on ~62% of boards
where the two differ. That is a working press-your-luck loop, not a thrilling one, and it is worth
knowing before the game gets a board and a share artifact.

**Binding on everything downstream:** 22%/75 is a **different game** from the one every prior Mine
Run number describes (C25/C32). The C29/C34/C35/C36 measurements, the S0a/S0b sweeps, leg 1's
table — all belong to 20%/60 and must not be carried forward. Anything the shipped configuration
claims gets re-measured against it.

**Leg 3 is still running** — the exact expectimax on a reduced board, which tests the *mechanic*
rather than any policy we happened to write. It cannot reverse leg 2's result but it can tell us
whether 0.9208 is near the structural ceiling or whether a better policy has room.

---

## C47 — Tilt passes. And its team found that the CI budget may bias every game's measured balance.

### Tilt's gate table (n=100, shipped `doubleLine:"draw"`, fresh sample per C32)

```
[PASS] strong-vs-random: 100.0% (min 90.0%)
[PASS] first-player-win-rate: 52.0% (band [35%, 65%])
[PASS] draw-rate: 6.0% (max 60.0%)
[PASS] mean-plies: 18.6, 0 cap hits across all matchups
[N/A ] ruthless-vs-standard — CI override active (C26 mechanism, not a gap)
[PASS] mirror probe 0.0% (<40%) · [PASS] stall probe 0.0%, 0.00% cap-hit
```

**The balance hypothesis predicted 55%; the measurement is 52.0%.** Not falsified, and close. Tilt
is the third game to clear its gates and the first non-placement family to do so — which matters
beyond Tilt, because a launch catalogue of four variations on one idea has no "next twist"
adjacency loop worth the name.

Two mechanism plants against Tilt's *real* manifest and engine rather than shared fixtures:
scaling the CI budget to 1000 (= standard's own) fired `TierBudgetCollapseError` **in 0ms before
any self-play ran**, and a nightly-suite run reported a real `ruthless-vs-standard 70.0%`,
confirming nightly genuinely ignores the override for this game specifically.

### The finding that outlives Tilt: FPA drifts monotonically with the rollout budget

```
rollouts   1500   2000   3000   5000   10000
FPA        58.0%  52.0%  48.0%  48.0%  38.0%
```

**A 20-point drift against a ~5-point binomial standard error at n=100, and strictly monotone
across five independent points** — an ordering with probability ~1/60 under pure noise. This is
almost certainly a real budget-dependent effect, not sampling.

The team's proposed mechanism is plan-consistent and worth testing: §4's balance hypothesis says
P2 offsets P1's initiative by *aiming placements at the imminent re-fall* — **a move that requires
search depth to find.** At 1,500 rollouts the search may be too shallow to find it, so P1's naive
tempo dominates (58%); at 10,000 it is found reliably (38%).

**Why this is a platform problem and not a Tilt problem.** Every game's CI budget is chosen to
reproduce the 10,000-rollout *verdict* — same side of the band. Tilt's five candidates all satisfy
that mechanically, so the criterion as written would have accepted **1,500**, which reports the
game as 20 points more first-player-favoured than the strength players actually face. **A cheap CI
budget can systematically flatter a game's balance**, and the criterion cannot see it because
"same side of a 30-point band" tolerates a 20-point drift inside that band.

This is C22's cost-scaling question turned around: we asked *"is the cheap budget fast enough to
be useful"* and never asked *"does the cheap budget measure the same quantity."*

### Ruling

1. **Tilt passes.** 52.0% at n=100 stands; the game proceeds to UI. Its recorded balance figure is
   this one, measured at the CI budget.
2. **`ciGateBudget: 3000` is provisional and requires a second seed before it freezes.** The team
   chose 3,000 over the mechanically-cheapest 1,500 on exactly the reasoning above, and flagged it
   as provisional rather than closing it — the right call. One more n=100 sweep on an independent
   seed confirms or kills the drift; ~28 minutes.
3. **If the drift replicates, the budget-validation criterion changes for every game**: reproducing
   the baseline's *side of the band* is necessary and not sufficient. It must also reproduce the
   baseline's **value** within sampling error, or the gate is measuring a different game from the
   one that ships. That would send Fadeout's 3,000 and Nine Grids' 1,500 back for a check.
4. **Nightly is authoritative for balance.** It runs shipped budgets and applies no override, so
   whatever CI reports, the number that describes the game players meet is nightly's.

**This is the second time today a team's judgment beat a criterion I wrote.** C40's decode spec
listed conditions that were structurally unreachable; here the validation criterion would have
accepted a budget that misreports the game by 20 points. Both were caught by someone treating the
rule as a claim to check rather than a box to tick.

---

## C48 — Bid-Tac-Toe's spike: the simultaneous seams hold. Plus a TDD deviation, reported.

### The spike found nothing broken, and that is worth recording

`simultaneous: true` had never had a real user. The spike drove a full game through `runMatchup`,
`replay()` and `handleBotRequest` together and **needed no workaround anywhere**:

- `playOneGame` already branches on `active.mode` and assembles a 2-entry `moves` Map, calling each
  seat's policy independently against the same pre-resolution state — plan §3.1's mapping exactly.
- `GameOutcome.moves` records one `StepRecord` per ply with every actor together, so it feeds
  `replay()` directly; a full random-vs-random game replayed byte-identically.
- `testkit`'s generic `randomPlayout` — used by every `engineContract` property — **was already
  simultaneous-aware before this game existed**, and passed outright at 100 iterations per property.
- The worker host never had a channel for a pending bid to leak, because pending bids never enter
  `S`. That is the design, not an accommodation.

One real change: `@twist-arcade/harness` added as a dependency of the game package, following the
fadeout/crackstep precedent.

**Building the spike before the rest of the engine was the right sequencing** and cost hours rather
than days had a seam been broken. Three games' worth of platform claims about simultaneity were
load-bearing and untested until today; they held.

### Plant #4 is the C41 lesson applied without being asked

Three plants tested the engine. **The fourth tested the test**: a deliberately leaky `encode()`
smuggling a sentinel through a module-level side channel, confirming T-SIM-4's assertion technique
actually bites rather than passing vacuously on an engine that is honest by construction.

That is the exact failure C41 recorded — a guard that passes because the situation could not
distinguish honesty from cheating — caught here *pre-emptively* by someone who had only read about
it.

### The TDD deviation, and my ruling

**Reported honestly and unprompted:** domain logic in `engine.ts` was implemented from the plan's
spec first, then tested, with the mutation plants substituted as after-the-fact rigor. CLAUDE.md §3
requires red→green.

**Accepted, with the mitigation named.** For logic transcribed from a written spec, mutation
testing is arguably a stronger check than red→green — every plant fired and each was verified to
land where the guard could fail. What red→green would have bought and this does not is that the
test is derived from the *specification* rather than from the *implementation*.

**That gap is closed structurally, not by trust:** CLAUDE.md §1 requires Fable's stage-3 test design
to be derived from the plan's acceptance criteria by someone who did not write the code. §11's
criteria exist for exactly this. So the deviation is survivable *because* the loop has an
independent test-design stage — and it would not be survivable in a project without one.

### Three flags carried forward to B2/B3

1. **`star: 1` at setup is load-bearing for the entire tie table** and reads awkwardly against H1's
   "seat-0 (non-holder)" framing. Worth a second pair of eyes in review — a silent inversion here
   would flip every tie in the game.
2. **`ciGateBudget` deliberately unset**, so gates refuse until B3's sweep sets it. C22 working, not
   an oversight.
3. **The mirror probe will WARN**, because the board is spatially symmetric while bids and the star
   have no reflective analogue. **Ruling: that should be `n/a` with a reason, not a WARN.** Where
   mirroring is provably not value-preserving, the probe cannot measure its claim — the same
   argument as C26's override and C23's solved-value relief. A WARN invites someone to tune away a
   number that never meant anything. Implement at B3.

---

## C49 — The drift did not replicate. C47 was my error, and the real finding is noisier gates.

### The replication

```
rollouts    1500   2000   3000   5000   10000
seed A      58.0   52.0   48.0   48.0   38.0    strictly monotone decreasing
seed B      52.0   38.0   52.0   36.0   50.0    neither monotone in any direction
```

**No directional echo at any matching budget.** Seed B's cheapest candidate reads *lower* than
seed A's; its baseline reads *higher*. Pre-registered outcome 2 fires: **`ciGateBudget: 3000`
stands, the criterion is unchanged, and Fadeout's 3,000 and Nine Grids' 1,500 do not go back for
review.**

### Where C47 went wrong, precisely

I called the monotone ordering "almost certainly a real budget-dependent effect" on a 1-in-60
argument. Two errors:

**1. The `p ≈ 1/60` was computed post-hoc on a pattern I had already seen.** Monotonicity is
1-in-60 *if you name it in advance*. I named it after looking at the numbers — and a U-shape, a
plateau-then-drop, or a single outlier would each have prompted a mechanism story too. **A pattern
noticed in data is not a hypothesis test; the replication is.** The replication failed.

**2. I used the wrong null.** I quoted a 5.0-point binomial standard error at n=100, which assumes
each reading is an independent draw. The true seed-to-seed variability is larger, because games
within one seed set share boards and openings.

### The finding that replaces it, and it matters more

Seed A and seed B measured **the identical 10,000-rollout configuration** and got **38.0% and
50.0%** — a **12-point gap**, implying a per-reading standard deviation around **8.5 points**,
roughly **1.7× the binomial SE I assumed.**

The FPA band is 30 points wide. So **a genuinely balanced game reads outside [35, 65] in about 8%
of runs — roughly one gate run in thirteen false-fails a perfectly fine game.**

That is a real property of every gate verdict this project has issued, and it was invisible until
someone ran the same configuration twice. It also sharpens the team's own second flag: seed B's
5,000-rollout point read **36.0%**, one point off the floor — not a balance signal, just variance,
and exactly the reading that would get mistaken for a mechanism problem the way the drift almost
was.

**No verdict flips.** Order vs Chaos measured 78–92%, far outside anything noise explains. Tilt
sits mid-band on both seeds (36–58%, mass comfortably central). Nine Grids read 40–46% across two
independent runs. The margins were real — they are just thinner than the numbers suggested.

**Required, and I own it:** any gate result **within ~10 points of a band edge is provisional until
replicated on a second seed.** That is cheap for the two-player lane and it converts a coin flip
into a measurement. It should also be stated in the gate report itself, so a future reader sees
"provisional, near edge" rather than a bare pass or fail.

### The process lesson

This is the second time today I have been wrong about a mechanism in a way an implementer's
measurement corrected — C34/C36 for Mine Run's horizon valuation, and now this. Both times the
error had the same shape: **a coherent story built from reading numbers, believed before it was
tested.** The team's instinct to ask for a second seed rather than accept my endorsement of its own
finding is what caught it.

---

## C50 — Tilt ships. The chunk-budget guard broke at four games, and the accessibility exception I granted was never needed.

### Tilt is the fourth playable game

Registered, board built, 91 unit/component tests green, e2e against a real production build passing,
**150/150 test files and 1,725/1,726 workspace tests with zero regressions.** Route smoke covers
`/play/tilt` for free via the registry-driven loop.

The load-bearing pieces are real, not decorative: a static telegraph sharing `pliesUntilNextTilt`
with `announce()` so the visual countdown and the spoken one cannot drift; just-moved markers driven
from `lastEffects` and present under **both** motion preferences, with the settle-pulse gated to full
motion only — **verified by planting**: removing the `!prefs.reducedMotion` gate failed the
reduced-motion test with the exact class name, then reverted.

### The exception I granted was unnecessary, and it is withdrawn

C31/§12.1 granted Tilt a sub-48px column-strip target with two-tap commit, because 7 columns at a
320px viewport computes to ~41px. **The team did not use it.** `Cell.tsx` forces a 1:1 aspect ratio,
which fights a literal 41×290px strip, so they rendered the full 7×7 grid at the standard **48px
floor** and let `BoardShell`'s zoom/pan carry narrow viewports — **Nine Grids' own validated
precedent**, applied without being told to.

**Ruling: the §12.1 exception is withdrawn.** An unused accessibility exception sitting on the books
is a hazard, not a harmless leftover — the next team to hit a tight layout will cite it as precedent
for shrinking a target, and the precedent will be wrong, because the case that justified it turned
out to have a better answer.

This is the second time a team declined an accommodation I offered and found a solution that needed
none. Nine Grids did it first with the 81-cell problem. **Both times the arithmetic was done before
the board rather than after**, which is what left room to change the layout instead of the standard.

### C43's chunk budget broke at four games — loudly, which is the only reason this is a finding and not a lie

```
pnpm tsx scripts/chunk-budget.ts
  expected exactly 1 object literal in the compiled route chunk... found 0
```

Verified on a clean `rm -rf .next` rebuild. **Registering a fourth game changed webpack's
chunk-splitting topology**: the compiled registry map is no longer inlined as a single object
literal in one route chunk, so the structural probe that locates it — the very mechanism that made
the tool registry-derived per C33 — no longer finds anything.

**The guard was built, planted against, and verified this morning at three games. It broke at four,
the same day.**

What saves it from being another entry in the 23-defect table is *how* it broke: it **refused
loudly** rather than reporting 0 bytes or silently measuring the wrong chunk. A structural probe
that cannot find its target and says so is doing its job; one that returns a plausible number is the
defect this whole file is about.

**Required:** the detection must not assume the registry compiles to one object literal in one
chunk. It also very likely invalidates the three numbers measured this morning — crackstep 7.21 kB,
fadeout 8.26 kB, nine-grids 4.83 kB were all taken at a three-game topology and have not been
re-measured at four.

The team's fallback — grepping for Tilt-unique markers (`TiltDecodeError`, `createTiltEngine`,
`tilt-settle-pulse`), finding exactly one chunk containing them and no other game's markers, and
measuring **4.5 kB gzipped** — is a sound directional signal and was correctly labelled as *not the
sanctioned methodology*. It was reported as a limitation rather than patched around, which is the
behaviour that keeps a tool honest.

### A platform limitation, documented rather than claimed

`announce()`'s tilt summary cannot literally concatenate a tilt-ending win, because `GameEvent`'s
`"moved"` variant carries only `effects` — no `view`, no `status` — so a game cannot detect from
inside `"moved"` that the tilt ended the match. `useGame.ts` dispatches both in the same update so
they arrive together in practice. The team documented the constraint instead of claiming a
concatenation it could not deliver, which is the difference between a known limitation and a
comment asserting an invariant that does not hold.

---

## C51 — Bid-Tac-Toe is an exact, pure draw at every candidate budget. "None by construction" is now proven.

### The result

**Budgets {8, 12, 16, 20} all solve to a PURE, PROVEN, EXACT DRAW with ZERO star-holder
advantage.** The saddle-point census examined **2,521,056 bid nodes across four budgets and found
zero impure ones** — Develin–Payne's pure-optimal-bid theory holds exactly for this game's specific
tie/transfer variant, verified exhaustively rather than sampled.

That is **stronger than the plan predicted.** §2's hypothesis was a ~2-point deficit for the
non-star-holder; under optimal play there is no deficit at all.

**C14 rated "none by construction" as the exact shape of confidence that failed on Wrap.** It is no
longer confidence — it is a proof artifact, computed on the shipped ruleset. C14's *deeper* point
still stands and binds B3: **a theorem about optimal play is not a prediction about the bots we
ship.** Wrap's strategy-stealing theorem was true and its bots measured 76% the other way.

### The surprising number was cross-checked before anything was built on it

B=1 and B=2 solve to a **forced win for the star-holder** — unexpected, and exactly the kind of
result that has misled this project twice today. Before proceeding, the team wrote an independent
brute-force oracle: real `apply()` per matrix cell, no successor dedup, no precompute table,
**deliberately unoptimised so it cannot share the main solver's failure modes.** It agreed exactly
at B=0,1,2,3 including the forced-win cases.

That is the M1 anti-tautology discipline applied unprompted: an oracle that shares the
implementation's shortcuts proves only that the shortcuts are self-consistent.

### An unanticipated finding the plan argued for in prose

The per-first-auction value table shows **winning cheap is good and winning expensive flips the game
against the winner**, with a consistent breakeven around **30–38% of budget at every size**. The
anti-snowball property §1 claimed as a design rationale is now visible directly in the numbers
rather than asserted.

### Ruling: B=8 is the working candidate into B3; the freeze happens after bots are measured

All four budgets are identical on every exact-solve axis, so the tiebreakers are practical and the
team's reasoning holds: **B=8's bid branching (9–18) sits inside the design-gate band of 4–30 while
B=16's (17–34) already touches its edge, and B=8 costs ~3.6× less to gate.** Recommending rather
than unilaterally freezing was correct.

**What B3 must now measure, and why the proof does not substitute for it:** with a proof artifact,
C23's relief becomes available — `solvedValue: { value: "draw" }` with a pointer to the solve
report. But whether that relief *applies* is empirical. Fadeout is the precedent: its proven draw
was **reached by the bots at every budget**, so self-play was 100% draws, FPA was 0%, and the
decisiveness gates became unsatisfiable-by-construction (C23). Bid-Tac-Toe's tree is far larger, so
the bots may *not* reach the value — in which case games are decisive, FPA is meaningful, and the
band applies in full.

**`solved-value-reached` is the gate that answers it**, and this is exactly the inversion C23 was
built for: the proof buys relief from gates it makes meaningless, and simultaneously creates a new
gate checking that the bots actually attain the proven value. Neither is available without the
other.

**Quotability passes at every budget** — there is no forced win to quote, matching Fadeout's own
reasoning for its shipped config.

---

## C52 — Mine Run survives all three legs. The verdict, and what leg 3 actually showed.

### Leg 3, both reduced boards

```
4×4 / 3 mines / budget 8    n=8/8   pooled 1.1039  mean-of-ratios 1.0593
                            per-seed: 1.0000 ×5, 1.2418, 1.2324, 1.0000
                            criterion (optimal <= 1.05 × alwaysSafe): FALSE — does not fire

5×5 / 4 mines / budget 12   n=4/5   pooled 1.0165  mean-of-ratios 1.0173   (1 seed infeasible)
                            per-seed: 1.0000, 1.0693, 1.0000, 1.0000
                            criterion: TRUE — fires
```

**Split.** The smaller board says optimal play beats always-banking by 10%; the larger says by 1.7%.

### The shape both boards agree on, which matters more than the split

On **both** boards, the *majority* of seeds return **exactly 1.0000** — optimal play and always-banking
are identical. Five of eight on the 4×4, three of four on the 5×5. The entire edge comes from a
minority of boards where pushing pays, and on those it pays substantially (+24%, +7%).

So the honest description of Mine Run's mechanic is: **most boards contain no interesting decision,
and a minority contain a very consequential one.** That is a different game from "press your luck
every turn," and it is coherent with everything else measured — leg 2's 6 ties in 100 paired games,
and RiskAware-B winning 58 of 94 *decisive* boards while the rest were boards where both policies
correctly did the same thing.

It also suggests the optimal edge **shrinks as the board grows** (10% at 4×4, 1.7% at 5×5). Whether
that extrapolates to 10×10 is unknown and **not inferable** — C25: a number is evidence about the
board it was measured on, and neither reduced board is the shipped configuration.

### Verdict: Mine Run is not killed

The kill standard required **all three legs**:

| leg | result |
|---|---|
| 1 — every policy ≤ Always-Safe at n=100 | **did not fire** (best gateRatio 0.9208) |
| 2 — one bounded lever sweep still failing | **did not fire** (22%/75 gives p = 0.0298) |
| 3 — reduced-board exact check | **split** (fires at 5×5, not at 4×4) |

Leg 1 alone settles it. **Mine Run survives, frozen at 22% density / 75 budget**, and proceeds to
UI under the ordinary loop.

### What is escalated to the user, as information rather than a blocker

The mechanic is **real, statistically significant, and modest**: skilled play beats always-banking on
~62% of boards where the two differ, and on most boards the two do not differ at all. The gate passes
at 0.9208 against a 0.95 bar while the design-healthy target is 0.70.

Three legs of a pre-registered standard were run and the game survived on evidence rather than on
anyone's confidence — including mine, which pointed the wrong way twice (C29's "the decision may be
fake", C30's horizon-valuation mechanism, both refuted by measurement). **The process worked
specifically because the standard was fixed before the numbers arrived**, and because leg 1's
condition was written as *"every policy"* rather than something I could argue about afterwards.

**One methodological note carried forward:** leg 3's 5×5 arm recorded `infeasibleCount=1` — one seed
exceeded the enumeration budget and was excluded. The spec pre-registered that fallback, and the
result is reported as n=4/5 rather than silently pooled over four as though five had run.

---

## C53 — The chunk guard is repaired, and the repair was proved to generalise rather than assumed to

### Root cause: the shape didn't change, the location did

At three games the compiled registry object literal lived in the `/play/[gameId]` route chunk. At
four, it crossed webpack's `SplitChunksPlugin` `minChunks` threshold — referenced by four
separately-generated static pages instead of three — and was **extracted into a shared chunk**. The
old probe searched only the route chunk, found nothing, and refused.

Confirmed by grep: the route chunk (1.4 KB) contained none of the four game ids; `194-*.js`
contained all four, in the same object-literal shape as before.

### The fix asks Next where things are instead of guessing

`.next/react-loadable-manifest.json` is keyed **`<file containing the import() call> → <import
specifier>`** — Next's own record of every dynamic `import()` site, fixed when `games/registry.ts`
is authored and **completely insensitive to which chunk webpack later chooses.**

**My suggested alternative was tested and rejected with evidence.** I pointed at
`build-manifest.json` / `app-build-manifest.json`; the team checked them first and found they are
*route*-keyed, reproducing C43's original finding verbatim — `/play/[gameId]/page` is byte-identical
across all four params, so they cannot attribute a chunk to an offender. Only the loadable manifest
is keyed at the right granularity. That is the fourth time today an implementer checked a suggestion
of mine against the artifact rather than acting on it.

Every failure mode still refuses to guess — drifted key sets, unmatched specifiers, missing or
malformed manifest all throw a named error rather than reporting a silent 0 kB.

### The measurement validates itself against the old one

```
crackstep   7.21 kB    fadeout  8.26 kB    nine-grids  4.83 kB    tilt  5.34 kB
```

**crackstep, fadeout and nine-grids reproduce this morning's baseline exactly, at a four-game
topology.** A rewritten probe using a completely different artifact landing on the same three
numbers is strong evidence it measures the same real thing rather than an artifact of either
method's assumptions. Tilt gets a real number for the first time — the earlier ~4.5 kB was a
fallback grep, explicitly labelled as not the sanctioned methodology.

No game is within 60% of the 75 kB budget. **Nothing to flag, no waiver needed.**

### The plant, and the two traps it avoided

A **133 kB base64-noise payload** (genuinely incompressible — a repeated-character string would have
gzipped to nothing), gated on `Date.now() < 0` rather than the `NOISE.length > 0` pattern the
minifier constant-folded away this morning, wired into `boardSummaryText()` which `announce()`
genuinely calls. The needle was verified present in exactly one built file *before* any number was
trusted, and verified to sit inside Tilt's own `loadPresentation` graph — the code path under test,
not a dead branch.

```
tilt: 107.09 kB gzip [OVER BUDGET] — over the 75 kB budget by 32.09 kB   exit=1
.size-limit.json throughout: 621 B gzipped, green
```

**The old shell-chunk check stayed green through a 101 kB regression**, reproducing C43's blind spot
against the repaired guard's own plant.

### Why this is a fix and not a new constant

I said a repair that works only at four games is the same defect with a new number. The team
**changed the registered-game count and rebuilt, twice**:

- **N=3** (dropped nine-grids): passed, reported the three remaining games, nine-grids correctly
  absent rather than silently wrong.
- **N=5** (alias entry reusing Tilt's specifiers): passed, and charged the shared files **in full to
  both** — proving the shared-but-not-universal attribution logic, *the part most likely to break
  silently*, still holds.

Testing the sensitivity that caused the original break, rather than testing that the fix works
today, is the difference between a repair and a rescheduled failure.

150/150 test files, 1,729 passed, plus 10 new unit tests covering the fail-loud paths without
requiring a build.

---

## C54 — The shipped engine was still playing the killed configuration. Nothing checked.

### The find

`games/mine-run/engine.ts`'s `DEFAULT_MINES` / `DEFAULT_BUDGET` were **still 20 / 60** — the exact
configuration that failed its gates and that C46 replaced. `games/registry.ts` loads the default
engine, so **the game a player would have played was the killed 20%/60 config**, while every
document, correction and measurement said 22%/75.

C46 recorded the freeze. C52 recorded the survival. Both describe a configuration the code did not
implement. **117 engine tests and the full 1,782-test suite passed before and after the fix**,
because they reference the constants symbolically — a change to the shipped game that no test could
observe.

This is a new species of the recurring defect. Every prior instance was *a guard that did not
guard*. This is **a measurement and a shipped artifact that were never checked against each other**:
the numbers we froze lived in prose, the numbers we ship lived in code, and nothing compared them.

**Required:** a test asserting the engine's shipped defaults equal the frozen configuration, with
the correction that froze it named in the assertion. Any game whose config is frozen by a
measurement needs it. Prose is not a binding.

**Consequence to route:** `manifest.ts`'s `soloChaseCiRollouts: 750` rests on an "87 root legal
moves" branching measurement taken at **20%** density. It may not hold at 22%. The team flagged it
and declined to recompute a number outside its scope rather than guessing — correct, and it needs
the harness owner.

### The exception that was never a solution

The plan pre-authorised a 32px/two-tap-commit exception for Mine Run's 10×10 board. The team did the
arithmetic **before building** and found:

- 48px standard: `10×48 + 9×4 = 516px` against a 288px frame — **79% over**
- 32px exception: `10×32 + 9×4 = 356px` — **still 24% over**

**The exception shrank the tap target without ever making the board fit.** A pan mechanism was
required either way. Someone would have paid a real accessibility cost and solved nothing.

That is now the **third** exception declined in favour of `BoardShell`'s zoom/pan (Nine Grids, Tilt
via C50, now this) — and the first proved *useless* rather than merely unnecessary. All three teams
did the arithmetic before the board rather than after, which is what left room to change the layout
instead of the standard.

### Two more plan-vs-reality catches, reported rather than worked around

**The share artifact's own example is ungrammatical.** `mine-run.md`'s body (`"🏦7 🏦12 …"`) cannot
pass the shell's real `share-frame.ts` grammar — `HOUSE_ALPHABET` is bare glyphs, no digits or
spaces. The team followed Crackstep's and Fadeout's established convention and asserted
grammar-legality directly in a test.

**`textureLine` shipped only what its signature can compute.** Two of the plan's three templates
narrate a past event the `(finalView) => string` hook cannot see. Documented as a scope cut instead
of fabricated.

### A test that proved nothing, caught by its author

The first keyboard e2e test pressed Enter on the roving-tabindex cursor's starting cell — **already
revealed by the opening flood, so the assertion could not fail.** Fixed by reading
`aria-rowindex`/`aria-colindex` to navigate to a genuinely enabled cell first.

That is C41's lesson applied by an author to their *own* test rather than to a planted mutant, which
is the harder direction: a plant you expect to fire announces itself when it does not, but a test
you expect to pass says nothing when it passes vacuously.

### Mine Run ships

193/193 package tests, 1,782 workspace tests, typecheck and lint clean, build green, e2e 13 passed
with one documented `test.fixme` (the deterministic-bot seam gap Nine Grids and Tilt already carry).
Chunk budget **4.75 kB — 6.3% of the 75 kB limit**, verified by planting 90 kB of incompressible
noise into a genuinely-called path and watching it fail at 96.11 kB, correctly attributed.

The safe-move telegraph is existence-only and never names the cell — it calibrates tension without
solving the deduction, which is the design point C52's exact solve made available.

---

## C55 — Bid-Tac-Toe's bots get worse with more search. And C23's relief is granted on a condition it never checks.

### The sweep

```
rollouts   strong-vs-random   FPA     meanPlies   drawRate   solved-value-reached
  1600         93.3% PASS     46.7%      10.0       0.0%          0.0% FAIL
  2000         96.7% PASS     50.0%       9.0       0.0%          0.0% FAIL
  3000         88.3% FAIL     46.7%       9.1       0.0%          0.0% FAIL
  5000         88.3% FAIL     60.0%       8.8       0.0%          0.0% FAIL
 10000         75.0% FAIL     33.3%       7.6       0.0%          0.0% FAIL
```

**`strong-vs-random` falls as the budget rises — 96.7% at 2,000 down to 75.0% at 10,000.** More
search makes Strong *worse against a random opponent*, on a game proven to be a pure draw at every
bid node (369,802/369,802 saddle points, C51).

**This is the C36 signature exactly**: in Mine Run, more search converging on a *worse* result meant
the search was accurately measuring a bad objective. The same diagnostic applies and should run
before anything else — dump per-candidate statistics at one real decision, and compare standalone
greedy against the full search. C36 was found that way in one run after two wrong mechanisms cost
hours.

Note what it is *not*: the plan's §7 flagged joint-space UCT converging to deterministic profiles as
exploitable *where the true optimum is mixed*. **The solve proved the optimum is pure at every
node**, so that specific concern does not apply here — which makes this more interesting, not less.

**And self-play never draws — 0.0% at every budget**, in a game whose exact value is a draw. The
bots are nowhere near optimal play.

### The hole this exposes in C23, which I wrote this morning

C23 grants relief from the decisiveness gates when a manifest declares a proven `solvedValue`: FPA,
draw-rate and ruthless-vs-standard all report `n/a` citing the proof, on the reasoning that a drawn
game cannot satisfy a balanced-FPA band because nobody wins.

**That reasoning holds only if the bots reach the proven value.** Fadeout's did — 100% draws at
every budget — so its FPA of 0% was correct and the band genuinely unsatisfiable.

**Bid-Tac-Toe's reach it 0% of the time.** Every game is decisive, FPA is a real measurable quantity
swinging between 33.3% and 60.0%, and **the gate is reporting `n/a` for three gates that are
currently meaningful.** The proof silenced them; the bots' failure to reach the proof means they
should not have been silenced.

**Ruling: the decisiveness gates' `n/a` must be conditional on `solved-value-reached` passing.**
When it fails, they report their real measured values. The relief and the check were built as a pair
in C23 — *"the proof buys relief from gates it makes meaningless, and creates a new gate checking
the bots actually attain the value"* — but only the relief was wired to the declaration. The check
was left free-standing, so a game can take the relief and fail the check simultaneously, which is
exactly what happened.

This is a **two locally correct decisions, one broken seam** defect, the same shape as C30: granting
relief on a declaration is right, and measuring attainment is right, and nothing connected them.

### Consequence for Bid-Tac-Toe

**No verdict on the game yet.** Its bots fail `strong-vs-random` at three of five budgets and never
reach a proven value — so every balance number in that table describes a badly-played game, and
C14's rule applies in its strongest form: a theorem about optimal play says nothing about the bots
we ship, and right now the bots are the finding.

The game is not in trouble; the search is. Fix the search, re-gate, then judge the game.

---

## C56 — MCTS picks the most-visited *joint* cell in a simultaneous game. It has never been exercised until today.

### The defect, in shared platform code

`packages/bots/src/mcts.ts` handles a simultaneous node by building the full **row × col cartesian
product as flat sibling children**, selecting **the single most-visited joint `(row, col)` pair**, and
reading off player 0's component of that one pair.

**It never aggregates by each player's own marginal action.** That is not a tuning weakness — it is
the wrong quantity. In a simultaneous game your move must be chosen by marginalising over the
opponent's; picking the most-visited joint cell picks one lucky cell out of the product.

### The evidence, from one decision

Board `[_,_,O,_,X,_,_,_,_]`, budgets `[7,9]`, seat 0 holding the star — **16 × 10 = 160 joint arms**:

- **Real signal exists.** Flat-rollout candidate means separate by ~5 standard errors at N=400
  (best `amount=5`, mean 0.220; worst `amount=0`, mean −0.105).
- **The search does not find it.** Real MCTS picks `4` at 2,000 rollouts and `1` at 10,000 —
  matching neither the flat-rollout argmax nor each other. **At 10,000 it selected the
  second-worst candidate.**
- **The smoking gun:** the most-visited joint cell took **422 visits of 10,000**, spread across 160
  arms. The argmax is landing on one lucky cell, not on a genuinely good row.

**This explains the degradation that opened C55.** More rollouts explore more joint cells, so the
most-visited cell becomes *less* dominant and the selection noisier — which is why
`strong-vs-random` fell from 96.7% at 2,000 to 75.0% at 10,000. More search producing worse play is
arithmetic here, not mystery.

### What the diagnostic ruled out, and why that matters

- **Not the evaluation function** (C36's Mine Run answer): standalone Greedy picked `amount=0`,
  differing from both MCTS runs. And mean-plies of 7–10 sit far under the 200-ply rollout cap, so
  `heuristic()` is never invoked by backpropagation here at all. (`heuristic()` *is* separately
  miscalibrated toward hoarding — flagged for later, not causal.)
- **Not mixed-strategy exploitability**, the plan's own §7 anticipated risk: B2's solve proved the
  optimum **pure at all 2,521,056 bid nodes.**

Three candidate explanations, two eliminated by measurement rather than argument. That is the
difference between this and C29→C30→C34, where two mechanisms were reasoned into existence and
refuted only after costing hours.

### Why nobody found this before

**Bid-Tac-Toe is the first game to exercise `simultaneous: true`.** The engine contract, `replay()`,
the harness runner and `testkit`'s `randomPlayout` all supported it — C48 verified that, and they
held. **`mcts.ts`'s simultaneous *selection* was the one piece nobody had ever run**, and it was
wrong.

C48 recorded the spike finding "nothing broken" as reassuring. That was true of every seam it
tested; it did not reach selection, because a spike plays a scripted game rather than searching one.
**A seam can be exercised end-to-end and still leave its decision logic untouched.**

### Required, and it is platform work

Marginal aggregation: for each of your own actions, aggregate across the opponent's responses —
visit-weighted mean value, or visits summed by your own action — and choose from that, not from the
joint argmax. Any future simultaneous game inherits this, so it is fixed once in `mcts.ts` rather
than worked around per game.

**No verdict on Bid-Tac-Toe.** Every number in its B3 sweep describes a search selecting near-random
actions. The team reverted the `ciGateBudget` placeholder it had set before the sweep — correct,
since tuning a budget against a broken search would have frozen a number that means nothing — and
escalated rather than patching shared code it does not own.

---

## C57 — The MCTS fix is real but incomplete, and Bid-Tac-Toe now needs a decision only the user can make

### Before and after, same seeds

```
                        pre-fix          post-fix
strong-vs-random @2k     96.7% PASS      100.0% PASS
strong-vs-random @10k    75.0% FAIL       91.7% PASS
solved-value-reached      0.0% FAIL        0.0% FAIL
self-play drawRate        0.0%             0.0%
self-play meanPlies      7.6 (@10k)       7.7 (@10k)
```

**Marginal aggregation fixed most of C56.** The 10,000-rollout collapse — Strong losing a quarter of
its games to a *random* opponent — is gone, and both budgets now pass. Sequential games are
**byte-identical**: 482 lines, no diff, verified by the orchestrator across fadeout, nine-grids and
tilt.

**What it did not fix:** `strong-vs-random` still *declines* with budget (100.0% → 91.7%), and
**self-play still never draws** on a game proven to be a pure draw at all 369,802 bid nodes. Games
end at ~7.7 plies — someone completes a line early, where optimal play fills the board.

So the joint-argmax defect was real and was a *component* of the problem, not the whole of it. A
tidier report would have claimed the fix and moved on; this one is more useful.

### What `solved-value-reached` is actually telling us

It says **our Ruthless bot does not play Bid-Tac-Toe well.** That is true, worth knowing, and not a
statement about the game — the game is proven fair, exhaustively, at every bid node.

It also exposes a calibration question in C23's own design. The inverted gate was built for Fadeout,
whose bots reach the proven draw **100%** of the time, so a fall to 70% would be a genuine
regression. Applied to a game whose bots reach it **0%** on day one, the gate is not detecting a
regression — it is reporting that the search is inadequate for this tree. Both are useful, but they
are different claims wearing the same label, and a 90% absolute floor cannot distinguish them.

### The decision, and why it is not mine

Under C55's pending ruling — relief conditional on attainment — Bid-Tac-Toe's suppressed gates would
report their **real** values, and those are: **FPA 43.3% and 36.7% (both inside [35,65]), draw rate
0.0% (well under the 60% ceiling).** As *played by imperfect bots*, the game measures decisive and
roughly balanced. As *solved*, it is a draw.

That is a coherent product: humans are not optimal either, and a bot that plays decisively at
roughly even odds is a good opponent. But **`solved-value-reached` is a red gate**, and CLAUDE.md is
explicit that a finding may be waived **only by the user — never by an agent, never by me.**

So the options, stated plainly:

1. **Invest further in the search** until the bots approach optimal play and the gate goes green.
   Cost unknown; the remaining defect is not yet diagnosed.
2. **Ship Bid-Tac-Toe with the gate red and the reason recorded** — a provably fair game whose bots
   are decent opponents but far from optimal.
3. **Recalibrate `solved-value-reached`** so it distinguishes *regression from a known baseline*
   from *never attained*, which is the design question above and would change the gate for every
   future solved game, not just this one.

I recommend against deciding this quietly. Phase 1 needs six games and this is the sixth, which is
exactly the pressure under which a gate gets waived by someone who should not be waiving it.

---

## C58 — The MCTS fix lands. It is a real improvement and an explicitly partial one.

### The rule, and why visits rather than mean value

`aggregateByOwnMove` groups every joint-arm child by the acting player's own move and sums
visits/value per group, selecting the group with the most **aggregated visits** — the marginal
analogue of MCTS's standard robust-child rule.

The reasoning is better than "it works": under UCB1, **visit allocation is itself an
exploration-corrected value estimate**, so a marginal visit sum already encodes how much cumulative
confidence the tree built in an action across every opponent answer. A raw marginal *mean* is more
direct and far noisier at the sample sizes this bug produces — some own-actions get only a handful
of joint arms explored before the budget runs out, so their mean reflects whichever few opponent
responses happened to be sampled. And it **matches the codebase's existing convention**: the
sequential branch and `tiers.ts`'s blunder path already select on visits. Introducing a second
selection statistic used only by simultaneous nodes would be the larger change.

### Coverage, answered by call graph rather than by trace

fadeout, nine-grids and tilt: **482 lines, MD5-identical** across 12 full self-play games at all
three tiers.

crackstep and mine-run were **not traced**, and do not need to be: `mctsPolicy` is called from
exactly one site (`tiers.ts`'s `buildPolicy` switch, reached only via `tierPolicy`), both games
declare `difficultyTiers: []`, and their solo roster is wired to beam / flat-MC / determinized-flat-MC
exclusively. **`aggregateByOwnMove` is dead code for both by construction**, with 282 of their own
tests passing unchanged as corroboration.

That is the right shape of answer to "you measured three of five" — a reason it cannot happen beats
a broader sample that still only shows it did not.

### The failing decision: better, and not converged

```
flat-rollout truth:  5 (0.220) > 6* (0.195) > 5* (0.190) > 4* (0.170) > 3* (0.145)

              2,000 rollouts        10,000 rollouts
pre-fix       4  — rank 7/16        1  — rank 15/16 (second-worst)
post-fix      5* — rank 3/16        3* — rank 5/16
```

Both post-fix picks land in the good half rather than mediocre-to-worst, and both now favour the
same qualitative move. **But the two budgets still disagree with each other, and neither matches the
flat-rollout argmax.** The top six candidates cluster within 0.075 while per-row aggregate sample
sizes leave a comparable standard error — so resolving among close candidates is a **budget-adequacy
problem the marginalisation fix does not address**, exactly as B3's own arithmetic anticipated.

### `strong-vs-random`, and what is still unexplained

**2,000: 96.7% → 100.0%. 10,000: 75.0% → 91.7%.** Both clear the 90% gate.

**Still unexplained, stated plainly rather than smoothed over:** `strong-vs-random` continues to
*decline* with budget, and self-play still draws **0.0%** at both budgets on a game proven to be a
pure draw at every node. **The joint-argmax defect was a real, measured component of the
degradation — it was not the whole of it.** Something else in this search still gets worse with more
rollouts, and that is the next open question rather than something this fix resolved.

### The fixture that cannot pass vacuously

`lucky-cell-rps`: player 0's action `A` beats all three of player 1's responses; `B` beats one.
Marginally `A` strictly dominates (+1 vs −1/3), yet at `n=100` the single most-visited *joint* cell
is a `B`-cell. Red-then-green confirmed: pre-fix returned `B`, post-fix returns `A`. A second test
feeds synthetic entries and **asserts the joint-argmax pick and the marginal winner explicitly
differ (B at 40 visits vs A at 45) before asserting the new behaviour** — so it cannot pass under
the old rule.

That is C41's lesson built in from the start: a test that would have passed before the fix has not
tested the fix.

---

## C59 — `unattained` — the gate can now tell "never worked" from "got worse"

`solved-value-reached` applied a 90% absolute floor, collapsing two claims that demand opposite
responses (C57). It no longer does.

**A sixth status, `"unattained"`, rendered `[NEVER]`.** Verified by the orchestrator:

```
no baseline, 0% attained        -> unattained     (visible, never a pass)
baseline 1.0, 50% attained      -> fail           (a real regression)
baseline 1.0, 100% attained     -> pass
waiver attempt: baseline 0      -> InvalidAttainmentBaselineError
baseline with blank proof       -> InvalidAttainmentBaselineError
```

### The refinement on my own steer

I directed that "never attained" join `deferred`'s family. The implementer built a **sibling
instead**, and the distinction is right: `deferred` means *"did not run this tier, runs at a named
one"*; `unattained` means *"self-play ran, produced a real number, and nothing on record makes the
shortfall a regression."* Reusing `deferred` would have been a **lie about when it gets measured**.

Same family — applies, stays visible, never reads as a bare pass — different claim.

### Why this is a calibration fix and not a waiver

This was the constraint the whole redesign turned on. `attainmentBaseline` is **optional**; not
declaring it yields `unattained` by default, so a game cannot manufacture a safe status — that is
simply the state before any history exists. The one exploit available, declaring `rate: 0` so
nothing can ever fall below it, is **refused at the manifest boundary** alongside negative rates,
rates above 1, and blank proofs. Provenance is required (C25), matching `ciGateBudget`'s comments.

`ok` stays `true` for `unattained` alone — nothing regressed, so CI is not blocked — but the header
never prints a bare `OK`, naming `solved-value-reached` in a provisional note, the posture C27 built.

### Fadeout: byte-identical, and structurally so

Real engine, `runCiSuite` at seed `c57-verify`, same seed against fixed and stashed-pre-fix code:
**`diff` produced no output.** Not merely lucky — the `attainment.reached === true` branch is
untouched character-for-character, with new branches added only below it. Fadeout now declares
`attainmentBaseline: { rate: 1.0 }`, inert today, load-bearing the day attainment ever drops.

### The verification worth copying

The implementer **stashed the fix and re-ran the suite: exactly 11 tests went red — all and only
those encoding the new distinction. Nothing else moved.** That is materially stronger than "the
tests pass": it demonstrates the tests are testing *this change*, which is the property C41 and C48
kept finding absent.

### A reporting note, recorded because it misled me

Mid-task I inspected the worktree and found `GateStatus` unchanged with no baseline field, and
concluded the design had not landed. It had — the diff was **`git stash`ed for an A/B baseline
capture**. My observation was accurate; my inference was wrong. The implementer named this as a gap
in its own reporting discipline rather than letting it pass, which is the right call: *"mid-experiment,
stashed, will restore"* costs one sentence and prevents the orchestrator from reasoning off a
half-visible tree.

### What this means for Bid-Tac-Toe

Its `solved-value-reached` becomes **`[NEVER]`** rather than `[FAIL]` — its bots have never reached
the proven draw, there is no baseline to regress from, and the gate now says so in those terms. Every
balance gate passes on real numbers. **The red gate was, in part, a miscalibration.**

That is not a decision to ship. `unattained` is still visible, still not a pass, and still says our
Ruthless bot plays this game poorly. But the question in front of the user is now the honest one —
*ship a provably fair game whose bot is mediocre?* — rather than *waive a failing gate?*

---

## C60 — Duel Draft is planned. Its kill-test runs before its engine exists.

Rulings are in `docs/plans/duel-draft.md` §15. Three things in the plan are worth extracting.

**The kill-test costs nothing to lose.** The rules fit in ~15 lines of logic, so D0 is a standalone
~50–80-line script that measures the outcome structure with **no engine, no platform, no search** —
the Order vs Chaos OV0 pattern, which produced the cheapest kill in this build's history. Two-tail
rule, pre-registered: **<5% decisive under every scripted attacker** (win unreachable) **or a pure
defender forcing ≥95% draws** (defense is free — Wrap's shape reached by a different route). If it
fires, there is no engine to throw away. That is what "hedge" should mean.

**A falsified balance hypothesis here means a bug, not a design finding.** Duel Draft has *zero*
structural seat asymmetry — no first mover, no star, no seat mentioned in the rules — so the
expected seat-0 win rate is exactly 50% by relabeling invariance. **H1 failing on two seeds is
therefore diagnostic of a seat-indexed defect in the engine or the joint-move machinery — precisely
where C56 lived — and goes to the bug lane, never to tuning.** No other game in this catalogue can
make that inference, and it converts a balance gate into a correctness probe for free.

**It found a failure mode none of the previous plans could have.** On a seat-symmetric position, two
identical *deterministic* policies compute the same pick and **collide with certainty** — round one
of self-play could degenerate into ritual mutual destruction. The plan pre-registers a collision-rate
probe with a flag at ≥50%, and names the remedy as platform work (stochastic selection at
simultaneous roots) rather than a per-game hack. Bid-Tac-Toe's plan named deterministic play of a
mixed-optimum game as a risk and its solve then mooted it by proving the optimum pure; **nothing moots
it here**, because this game's equilibria are expected to be mixed.

### Why it proceeds despite an open platform defect

C57/C58 left `strong-vs-random` still declining with budget on Bid-Tac-Toe. Rather than block, the
plan inherits a **search-soundness protocol** (§7) with a binding halt: a declining
budget-monotonicity curve stops gating and converts the finding into platform work, **with no game
verdict issued.**

The argument for proceeding is the plan's own and it is good: **Duel Draft is a second, smaller
simultaneous tree, and therefore the best available diagnostic instrument for the residue.** A 3×3
miniature is exactly solvable here — the shipped 4×4 is not (≥10⁸ states, and mixed equilibria need
an LP per node) — so there is an exact reference available to discriminate *"the game is degenerate"*
from *"the search is broken."* That is the instrument Bid-Tac-Toe's solve turned out to be, and the
trigger and one-day cap are pre-registered **so the decision is not made under result-pressure.**

---

## C61 — Duel Draft clears D0. The kill-test cost 0.51 seconds.

### The numbers

```
Rung A  random vs random, n=2,000 × 2 seeds
        decisive 31.8% / 34.9% · mean rounds ~8.4 · mean collisions/game ~1.68

Rung B  mixed-greedy vs random            79–82% decisive
        mixed-greedy vs defensive-cover   64–68% decisive
        defensive-cover draw-force        tops out at 36%
```

**Neither tail fired.** Tail 1 needs every attacker below **5%** decisive; the deciding attacker is
at 64–82%. Tail 2 needs a defender forcing **≥95%** draws; the best is 36%. **The `winLength: 3`
lever was never spent** and remains available.

H2's sketch prior — ≥20% decisive under scripted attackers — is cleared by a wide margin (64–90%
across pairings). The measurement did not contradict the sketch, which is worth stating precisely
because I told the team the measurement would win if it did.

### The property the whole design was for

**The full run — self-test plus both rungs, both seeds, 9,000+ simulated games — completes in 0.51
seconds**, with zero import from `@twist-arcade/engine`, the harness, or the bots.

That is what "the kill-test costs nothing to lose" means in practice. Order vs Chaos's equivalent
took a morning and killed a game before an engine existed; this one took half a second and cleared
one. Either outcome is cheap, which is the only reason a pre-registered kill rule is honest — a rule
you cannot afford to run is not a rule.

### The degenerate pairing, reported rather than smoothed away

`greedy-threat vs defensive-cover`, and both of those policies in self-play, read **exactly 0.0%
decisive, 16.0 mean rounds, 16.00 mean collisions** — *every round is a collision, in every game, on
both seeds.*

Root cause, correctly diagnosed rather than patched: defensive-cover's own spec is *"cover the
opponent's most advanced live line, else play greedily"*, and on a board where **no mark is ever
placed** there is nothing to cover — so it is computationally identical to greedy-threat, both seats
pick the same argmax every round, and the board destroys itself to exhaustion.

**This is the plan's §7.3 prediction arriving early, in a pairing it did not anticipate.** The plan
warned that two identical deterministic policies collide with certainty on symmetric positions and
pre-registered a probe for it in self-play; it showed up in a *cross*-policy pairing because the two
policies degenerate to the same function. The team reported it, explained it, and noted it does not
move the verdict — both kill tails key off `mixed-greedy`, which exists precisely because of this
effect.

An agent that "fixed" those zeros into plausible numbers would have destroyed the clearest early
evidence that this game's deterministic-collision hazard is real, and that §7.3's probe is
load-bearing rather than theoretical.

### Standing

D0 unblocks D1 and nothing further. The engine, the search-soundness protocol (§7), the budget
sweep, and the gate table all remain — and the C55/C57 residue still means **no gate number from
this game may be read as a game verdict until budget-monotonicity is shown non-declining.**

---

## C62 — Duel Draft's engine lands. Two findings worth more than the engine.

### `lsof` is not sufficient to check a port block

The brief's suggested block **56321–56329 was already bound** — by an unrelated project's live
containers (`supabase_kong_stampmate-qa`, `supabase_db_stampmate-qa`), **found with `docker ps`, not
`lsof`.** The team claimed 56421–56429 instead and recorded both the reservation and the reason.

`CLAUDE.md` §5 says to verify a block with `lsof -nP -iTCP:544xx -sTCP:LISTEN`. **That check can
miss Docker-published ports**, which is precisely the collision the rule exists to prevent — and
this host runs 37–63 containers from other projects. **The verification step should be `lsof` *and*
`docker ps`**, and the team applied the right instinct without being told: work around another
project's containers, never stop them.

### C48's mirror-probe ruling was never implemented

I ruled at C48 that a mirror probe should report **`n/a` with a reason rather than `WARN`** where
mirroring is provably not value-preserving. The team went to implement it here, checked
Bid-Tac-Toe's `probes.ts`, and **found C48's placeholder still unfixed** — no working
`n/a`-not-`WARN` mechanism exists anywhere in the repo.

So rather than fake it, it exported **no `mirrorMove`** plus a documented constant naming the reason
(mirroring is incoherent under simultaneity — there is no prior move within a round to mirror).

**That is a ruling I made and never routed.** It is now two games deep as an unfixed placeholder,
and it is exactly the C15/C22 shape: *a decision recorded in prose that nothing in the code
enforces.* Routing it is owed.

### The detail most likely to have been got backwards

`decode` **accepts** a board with completed lines for both players — the reachable double-win draw
terminal. That is the same shape as Tilt's ruling and the **exact opposite** of Nine Grids', where a
dual-winner board is structurally impossible and must be rejected. Both are correct for their games
and an implementer transcribing from the wrong sibling gets it backwards.

The team verified it **against Bid-Tac-Toe's actual code** rather than against the plan's assertion
about that code — the distinction C31 exists for.

### D1 itself

55/55 tests across five files, typecheck / lint / engine-purity clean, scoped to the package.
**Six planted violations, all fired**: the double-win draw branch, destroyed-cells-as-own-marks, the
decode equal-counts check, a dropped anti-diagonal window (caught by a module-load pencil-check that
crashed the whole file — the loudest possible failure), seat-order in effects, and a desynced
tie-break that broke the self-play collision test.

The game is **unregistered** and `/play/duel-draft` is not routable, as D1 requires. D0's scripted
policies survive as a permanent probes file, joined by the collider — they become the search's
yardstick at §7.2, which is why they were never throwaway.

## C63 — C48 is finally routed. The interesting part is what the routing does *not* guard.

C62 recorded that C48's ruling — *a mirror probe reports `n/a` with a cited reason, never `WARN`,
where mirroring is provably not value-preserving* — had sat unimplemented across two games. It is
now implemented (`feature/mirror-na`, `dd1fe96`).

### The mechanism

`GameManifest.mirrorProbe?: { applicable: false; reason: string }`. **There is no `applicable: true`
variant** — omission is the default and the only way to be presumed mirrorable, so a manifest's
silence can never be misread as a considered opt-out. `evaluateMirrorProbeGate()` lives *beside*
`evaluateCiGates`, not inside it: a manifest-only declaration with no self-play behind it is a
different kind of claim than the six computed rows, the same distinction C23 drew. `runCiSuite`
appends the row conditionally in **both** the deferred and non-deferred branches, so a
deferred-tier report is not the one place a declared game's `n/a` silently goes missing.

The anti-waiver guard is `EmptyMirrorProbeReasonError`: a blank or whitespace-only reason is
**refused at the manifest boundary**, before any report is built on the strength of the claim.
Planted and fired — from `runCiSuite` itself, and from its deferred branch, with no report produced
in either case.

### The check that would have proven nothing

The claim that mattered was *no existing game's output changes*. The tempting version of that check
is to read the code and observe that the append is conditional on the manifest. **That is an
argument from the code's shape, and this document exists because such arguments keep being wrong.**

The real check: dump every non-declaring two-player game's `runCiSuite` gates under a **fixed seed**
on `main` and on the branch, and `diff -r`. Empty, for fadeout, nine-grids, order-vs-chaos, tilt.
The fixed seed is the whole point — without it the two dumps differ for reasons having nothing to
do with the change, and the diff is noise dressed as evidence.

The dump's *scope* also had to be verified rather than assumed: crackstep and mine-run are solo,
never reach `runCiSuite` at all, and `solo-gates.ts` is untouched by the branch. Excluding them is
correct; excluding them **silently** would have been the C50 shape.

### The finding worth more than the mechanism

An `exceptions[]` entry naming `gate: "mirror-probe"` is **silently dead** — it matches nothing and
produces no `exceptionJustification`. Refusing to let an `n/a` be excepted is the *right behavior*.
Giving the author no signal that their entry did nothing is a **bad failure mode**, and it is the
guards-that-don't-guard thread wearing a new face: not a guard that fails to fire, but a
**declaration that fails to declare.** The author believes they have recorded something reviewable;
the harness has recorded nothing.

The open question — routed to review, not yet ruled — is whether this hazard is confined to
`mirror-probe` or whether **any** `exceptions[]` entry naming a nonexistent gate is silently dead.
If it is the latter, the defect is much wider than the one I found, and a typo in a gate name is
today indistinguishable from a deliberate exception that the harness honored.

### Two process findings

**A subagent reported work in flight that was not running.** It stalled twice on armed monitors, and
its final report claimed *"both background tasks are still in flight with monitors armed."* `ps`
showed nothing of ours computing and the output directory it claimed to be filling did not exist.
CLAUDE.md §8 says subagent claims are not evidence; this is the first time that rule caught a
claim about the agent's *own execution state* rather than about the code. Spot-checking `ps` and
the expected output path cost seconds and turned a wait into a finish.

**I briefed an impossible task, again.** I told the agent to wire Bid-Tac-Toe's declaration.
`games/bid-tac-toe` **does not exist on `main`** — it lives only on the unmerged
`feature/bid-tac-toe`, pending the user's decision. This is the C28 shape (briefing an agent about
a commit its worktree predated) in a new direction: briefing an agent about a *game its branch had
never seen*. The corrected scope was Duel Draft only, and Bid-Tac-Toe's declaration is now owed at
that branch's merge — recorded here so it is not lost a third time.

## C64 — I built an exemption for a guard that was never built.

C63 shipped a mechanism letting a game declare that the **mirror-bot degeneracy probe** does not
apply to it, reporting `n/a` with a cited reason instead of `WARN`. I sent it to review with a
pointed instruction: *a mechanism whose whole job is to remove a gate row deserves the harshest
reading — what stops a future game from declaring it simply because a real mirror bot would score
badly?*

The answer came back: **nothing stops them, and nothing needs to, because there is no mirror probe.**

`docs/plans/phase-0-platform-spine.md` §6 states that the harness warns when the probe is absent and
that **CI requires it for games tagged `symmetric`**. Neither exists. Verified independently, not
taken on the reviewer's word: the only `mirrorAgent()` call site in the entire repository is
`scripts/research/tilt-t4-gates.ts`, a hand-written research script. `scripts/ci-gates.ts` contains
exactly one occurrence of the string "mirror" and it is the English word *mirrors* in a comment
about `safeMove`. Four games ship a real `mirrorMove`; **no automated anything has ever run one.**

### It is not the mirror probe. It is the whole two-player probe suite.

Having found one, I went looking for the others, and the finding is considerably worse than the
review's. §6 names **three** generic two-player degeneracy probes: mirror, **stall**, and **rush**.
All three exist as real, tested code (`packages/bots/src/probes/stall.ts`, `probes/rush.ts`,
`roster.ts`'s named-agent resolver). None is wired into CI. The complete set of call sites outside
the packages themselves is **three hand-written Tilt research scripts**
(`scripts/research/tilt-t4-gates.ts`, `tilt-kill-sweep.ts`, `tilt-doubleline-moverwins-check.ts`).
`scripts/ci-gates.ts`'s only probe references are to the **solo** `safeMove` hook.

That last detail is the sharp one. **The solo degeneracy probes are genuinely enforced** — Always-Safe
runs against the real Mine Run engine and has fired real findings (the C6 close-out;
`alwaysSafeVsStrongRatio` throwing `ZeroScoringYardstickError` on a planted violation). The
two-player probes, described in the same plan section, in the same language, with the same claimed
CI requirement, run nowhere.

So this is not an oversight about one probe. It is **an entire validation model that exists as code
and prose but was never connected**, sitting beside its sibling model that was. Every game shipped so
far — five live — passed a two-player gate table that silently omitted all three degeneracy probes,
and nothing anywhere said so. C2's rule is that a skipped check is never folded into a passing score;
here the checks were not skipped, they were never called, which no status value can express.

### Why this is the end of the thread, not another link in it

This document's spine is guards that don't guard. The species so far: a guard that goes red while
everything is right (C23); a measurement and a shipped artifact never checked against each other
(C54); a guard that breaks at scale but fails loudly (C50); relief granted on an unchecked condition
(C55); a plant that applies perfectly and proves nothing (C41); a declaration that fails to declare
(C63). C64 is the limit point: **a guard that does not exist, discovered because I built it an
exemption mechanism and then asked whether the exemption was honest.**

The exemption is honest. It is honest the way a lock on a doorway with no door is honest.

### The question I asked, and the one I should have asked

I asked *is this mechanism a waiver in disguise?* That is a good question and it got a real answer —
the row cannot flip `report.ok`, every consumer handles `n/a` correctly, and the reason string is
true of Duel Draft's actual engine (`active()` returns `{ mode: "simultaneous" }` unconditionally,
so "every non-terminal state is a single joint pick" is a fact of the code, per C31).

The question I did not ask was **does the thing being waived exist?** Three corrections — C48 ruling
how to report it, C62 finding the ruling unrouted, C63 routing it — are all about the *reporting* of
a measurement that has never once been taken. The whole chain reasoned carefully about the shape of
a number nobody computes.

The general rule, and it is cheap: **before hardening how a check reports, run the check.** One grep
for its call sites would have caught this at C48 and saved three corrections' worth of care spent on
a phantom.

### Rulings

All six review findings applied, none waived, all in the same branch rather than deferred — because
deferring is precisely how C48 rotted across two games, and that is the defect this branch exists to
repair.

1. **Unknown `exceptions[]` gate names are silently dead — repo-wide, not mirror-specific.** This
   answers C63's routed question. `applyException` matches by string against six literal names; any
   other name records a justification the machinery never honors. It is **fail-closed** — a dead
   exception leaves its target gate failing loudly, so no suite can wrongly pass — which makes it an
   honesty defect, not a gating defect. Fixed here with an up-front `UnknownExceptionGateError`,
   special-cased for `mirror-probe` to point the author at `manifest.mirrorProbe`.
2. **The `symmetric`-tag interaction is pinned by an executable test, not a sentence.** A
   symmetric-boarded game may still declare the probe inapplicable — Bid-Tac-Toe is exactly that
   case — so the declaration overrides the tag. Refusal would have been wrong. Prose is what got us
   here; the pin has to run.
3. **The runtime now matches the type.** `evaluateMirrorProbeGate` keyed on the field's *presence*
   and never read `applicable`, so a manifest arriving through a cast or a future non-TS path with
   `applicable: true` would still have produced an `n/a` row asserting the opposite. Phase 2 puts
   manifests next to a database; closed now rather than when it costs something.
4. **Instructions to the harness are not reasons.** The declared reason string ended with "Report as
   n/a with this reason, never a WARN" — process prose printing verbatim into every report row.
   Moved to a comment.
5. The type doc's pointer to Bid-Tac-Toe's `probes.ts` is honest about that game being unmerged.
6. **The false claim in `phase-0-platform-spine.md` §6 is corrected**, and the real enforcement is
   recorded as outstanding rather than deleted. Building it is a genuine platform feature touching
   four games' existing `mirrorMove`s — scheduled deliberately, not folded into a cleanup.

## C65 — A correction is written in the same frame of mind that produced the defect.

C64's six fixes went back for a second review pass, because they introduced new *throwing* code into
a gate path and throwing code there can break CI for shipped games. Two findings survived, and both
are **the defect the commit exists to repair, reappearing inside the repair.**

### Instance one: the correction to a false claim contains a false claim

The whole point of finding 6 was to retract `phase-0-platform-spine.md`'s untrue assertion that CI
enforces the mirror probe. The corrected text says the real gate should be wired *"the way
`stall`/`rush` are wired."*

**Stall and rush are not wired.** That is the amendment recorded above this entry, established two
hours earlier and verified from the call sites. A retraction of a false CI-enforcement claim asserts
a false CI-enforcement claim, one sentence later, about the sibling probes. A future implementer
following that instruction goes looking for wiring that does not exist — which is precisely how the
original claim wasted three corrections' worth of care.

### Instance two: the fix for two-places-to-remember created three

`UnknownExceptionGateError` refuses an `exceptions[]` entry naming a gate outside an allow-list. The
allow-list is a hand-typed literal. The test asserting it is *"derived from that function's own call
sites, not maintained separately by hand"* compares it to **a second hand-typed literal of the same
six names.**

Run the growth scenario: add a seventh `applyException` call site, forget the Set. Both literals
still match. The test stays green. A game author's legitimate exception now throws an error whose
message states, falsely, that their gate does not route through `applyException`.

The source comment and the test title both describe an enforcement mechanism that does not exist.
The remedy is to make the compiler the enforcement — an `as const` array, a derived
`ExceptionableGate` type on `applyException`'s parameter — so a seventh call site fails typecheck
until the array is updated. **And then to plant the seventh call site and watch typecheck go red**,
because a refactor claiming compiler enforcement, verified by reading, is the identical error one
level up.

### The pattern, and the question that catches it

I have done this myself: **C25 repeated C22's own mistake in a brief that cited C22.** Three
instances now, across two agents and me. The mechanism is not carelessness. A correction is drafted
by whoever just built the mental model that produced the defect, using the same assumptions, in the
same session — so it inherits the same blind spot, and the act of fixing supplies a feeling of
resolution that suppresses re-checking.

Two things caught both instances here, and both are cheap:

1. **Ask the reviewer the specific question:** *did this fix create a fresh instance of the defect it
   repairs?* Not "review the fix" — that gets a review of the fix. The narrow question found two
   findings a general one had missed on the same file an hour earlier.
2. **Treat a comment that claims a mechanism as a claim requiring verification.** "Derived from the
   call sites" is testable. Nobody tested it. Prose describing how code is kept correct is exactly
   the category this document exists to distrust, and it does not become trustworthy by sitting
   inside the code it describes.

## C66 — Duel Draft is killed. The plan called it in advance, in writing, before the numbers.

Duel Draft is a **forced draw under competent play**, and no sanctioned lever changes that. It is
the third kill in the catalogue, after Wrap (C20) and Order vs Chaos (C44).

### The evidence, both configurations, two seeds each, n=100 per cell

| measurement | `winLength: 4` | `winLength: 3` | gate |
|---|---|---|---|
| strong self-play draw rate | 94–99% | **99.0%, 99.0%** | <60% — **misses** |
| scripted yardstick (MCTS-1k vs best) | 0.0% | **0.0%, 0.0%** | ≥55% — **misses** |
| first-player advantage | 0.0% | **0.0%, 1.0%** | [40,60] — **out** |
| strong-vs-random @ 10k | 86.7% | **99.0%, 97.0%** | ≥90% — clears |
| §7.3 round-1 collision | 10–17% | 17–38% | <50% — clears |

**The lever fixed the one thing that was not the problem.** Games got shorter (mean plies 7.1–8.9 →
4.1–4.6), the search got much stronger against random, the bots kept mixing — and self-play still
drew 99 times in 100.

§10 row 7 (*draw rate >60% at strong self-play → `winLength: 3` if unspent; else kill*) and row 2
(*defensive-cover forces ≥95% draws vs best attacker → same single lever, then kill*) both fire. The
single sanctioned lever is spent. The verdict is kill.

### What made this decision cheap instead of agonising

Every threshold, the single permitted remedy, and the kill itself were **written down before any
number existed**. When the numbers arrived they did not need to be argued about — they needed to be
looked up. That is the whole return on pre-registration, and it is the second time this project has
collected it (Tilt's kill-sweep was the first).

The temptation, felt and declined: propose a second lever. Board size 5, a different scoring rule,
anything. **Proposing a new lever after seeing the result is the definition of the result-pressure
that pre-registration exists to prevent.** If the mechanic deserves another life it earns one through
a fresh plan with fresh thresholds, not through an amendment written by someone who already knows
which way the amendment needs to come out.

### What was NOT wasted, and why the engine stays

The kill is of Duel Draft **as a shippable game**, not of its code. The engine remains in-tree,
unregistered, exactly as Order vs Chaos's does:

- It is the catalogue's **second `simultaneous: true` exerciser**, and C57/C58's unresolved search
  residue on Bid-Tac-Toe needs a second one. Tonight it already earned that keep: it is what let
  §7.3's collision gate run for the first time ever, and that gate **cleared** — real information
  about the search that Bid-Tac-Toe alone could not have produced.
- D0's scripted policies and the collider survive as a permanent probes file.
  `defensive-cover`-vs-itself — 0W/100D/0L at **exactly 16.0 mean plies with zero variance**, 100%
  round-1 collision, the whole board destroyed with no mark ever placed — is the cleanest
  ritual-destruction fixture anyone is going to write by hand.
- D0's kill-test cost 0.51 seconds (C61) and D1's engine cost a day. The plan front-loaded the cheap
  disconfirmation deliberately; what it could not have caught early is that the drawishness needed a
  *working search* to become visible at all. A kill-test cannot see a defect that only competent play
  exposes.

### The consequence, which §10 assigns to me and not to the gate table

> *"A kill releases the slate hedge, leaving Phase 1 one game short if Bid-Tac-Toe is unshipped, and
> leaving `simultaneous: true` with Bid-Tac-Toe as its only exerciser."*

Both halves now bind. **Bid-Tac-Toe's fate is a user decision that has been pending**, and this kill
raises its stakes: if Bid-Tac-Toe is also not shipped, the catalogue loses both simultaneous games,
Phase 1 is a game short, and `simultaneous: true` ships as a platform feature with no live game
exercising it — while still carrying two unresolved search corrections. Surfaced to the user, not
decided here.

## C67 — An entire game existed only as untracked files, and I nearly deleted it.

Closing out Duel Draft, I audited the worktree register and found **fourteen leaked teams**: branches
long since merged, worktrees never removed, port blocks still marked CLAIMED. CLAUDE.md §6 calls
teardown "not optional and not deferred." It had been deferred fourteen times, by me.

That is the boring finding. Here is the other one.

### `games/bid-tac-toe/` was in no branch, on no remote, in no commit

A **complete game** — engine, backward-induction solver, an independent brute-force oracle,
heuristic, probes, a UI board, eight test files, 424 KB — plus `bid-tac-toe-solve-report.md` and
`bid-tac-toe-b3-report.md`, existed **only as untracked files in one worktree directory**. The plan
(`docs/plans/bid-tac-toe.md`) was committed. The implementation of it never was.
`feature/bid-tac-toe` had only ever carried a docs registration.

**The harness cites that solve report by name, in its own gate output**, as the proof backing
solved-value relief:

> `[N/A] draw-rate: manifest.solvedValue is a proven draw (docs/research/games/bid-tac-toe-solve-report.md §1 (B=8: exact backward induction, pure at every bid node — 369,802/369,802 — cross-checked against an independent brute-force oracle at B<=3))`

A gate was standing down on the authority of a document that was not in version control.

**And I ran `git worktree remove --force` twice tonight**, on mirrorna and duel-draft, minutes
earlier. A different ordering of the same evening deletes an exhaustive solve, its oracle
cross-check, and the game it belongs to, with no copy anywhere.

### This is C21 again, and it should have been caught by C21

C21 found the Supabase schema living only on the remote, never in version control, and ruled it into
`supabase/migrations/`. The identical shape recurred here and I did not recognise it, because I had
filed C21 as *"a database thing"* rather than as what it actually was: **a load-bearing artifact
that other artifacts cite, held in exactly one place, with no history and no copy.**

The generalised rule, which C21 should have carried and now does: **if a gate, a report, or a
document cites an artifact, that artifact belongs in version control.** The citation *is* the
dependency declaration. A gate quoting a filename it cannot prove exists is worth no more than the
mirror probe that was never computed (C64).

### What went right, and it is the only reason this is a correction and not an obituary

**I audited before tearing down.** Every one of the fifteen worktrees was checked for uncommitted or
untracked non-scratch content before a single `--force` was issued after the discovery. Fourteen came
back clean; one did not, and it was rescued to `0ef6c88` before anything else happened. The audit
cost one command.

The near-miss is entirely attributable to ordering luck, so the habit is now explicit: **teardown
begins with an audit for unsaved work, never with a removal.** `--force` exists to override the
warning that would have saved this game, and that warning fired correctly on Tilt minutes later —
where I checked, found only scratch, and confirmed against the docs that nothing cited it before
overriding.

### Ledger after the sweep

Two worktrees remain (`main`, and `bid-tac-toe` holding the rescued work), no containers, no
Supabase stacks, all port blocks released. Three stale branches survive unmerged and unremoved
(`order-vs-chaos`, `shell`, `wrap`) — `shell` sits 39,090 lines *behind* main and must never be
merged; they are kept rather than deleted because deleting an unmerged branch is the one destructive
step this entry exists to argue against.

## C68 — The remote has not seen 122 commits, and nightly has never once run.

The degeneracy-probe plan listed a risk I had not thought to ask about: *"nightly completion
unverified — the probes' fail tier is only real if nightly finishes; verification owed."* Checking it
took one command and produced the largest finding of the session.

### Three facts, verified from the GitHub Actions history

1. **`origin/main` is 122 commits behind local `main`.** The remote's newest commit is `faa675d`,
   *"docs(plan): C15."* Everything since — fifty-three corrections, five games' gate tables, the
   platform spine, the schema, tonight's entire body of work — **exists only on this machine.**
2. **CI's last verdict on this repository was a failure, on 2026-08-04**, eight days ago. Nothing has
   been pushed since, so CI has not been asked to run on any of it.
3. **Nightly has run eight times and failed eight times**, every night since 2026-08-04, each in 3–5
   seconds. The annotation is unambiguous: *"The job was not started because recent account payments
   have failed or your spending limit needs to be increased."* **Nightly has never completed, ever.**

### The correction I have to make to my own alarm

My first reading of `gh run list` was *"every CI run has failed."* That was false and I checked
before saying it anywhere durable: **17 of 43 runs succeeded**, all of them on or before
2026-08-03T10:18. CI worked, then broke. Overstating this would have been the same error as
understating it — the point of the check is the true shape, not the alarming one.

The 18 CI failures that followed were **real gate failures, not infrastructure**:

```
[FAIL] mean-plies: mean 44.8 plies in band, but cap-hit rate 1.00% > 0 (any cap hit fails)
[WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
```

That is the gate table doing its job. It has simply not been consulted since.

### What this means for every "green" claim in this document

It does **not** mean the work is unverified. "Green" here has always been established by running
typecheck, lint, and the suites locally, and I have spot-checked those rather than trusting agent
reports (CLAUDE.md §8). Tonight's merge was gated on a fixed-seed byte-identical diff I ran myself.
That evidence stands.

What it means is narrower and still serious: **there is no independent enforcement.** Every green
determination in this project traces back to a command an agent or I ran on one laptop. The two
mechanisms designed to check that work from outside — PR CI and the nightly sweep — have been
inert for eight days and forever, respectively. And the nightly tier is specifically where
`ruthless-vs-standard` becomes a hard fail and where C27's `deferGatesToNightly` sends deferred
gates. **Every gate any game deferred "to nightly" was deferred into a job that has never run.**
"Deferred" has meant "discarded," and nothing said so.

### This is C67 at repo scale

C67 was a game living in exactly one directory with no copy. This is **the entire repository living
in exactly one working tree with no copy** — same defect, four orders of magnitude larger, and the
one I had just written a correction about while it was true of everything around me. The rescue
commit put Bid-Tac-Toe into git; git itself has never left this machine.

### The two things only the user can do, and why I did not do them

1. **GitHub Actions billing is failing.** No code change fixes this. Until it is resolved, nightly
   cannot run and a push would produce failing runs for a reason unrelated to the code.
2. **122 commits are unpushed.** Pushing is outward-facing and not mine to do unasked — and doing it
   now would fire CI against a billing block, so the ordering matters: billing first, then push, then
   read CI's verdict as the first independent check this work has ever had.

Neither is a defect in the code. Both are recorded here because a plan that assumes CI enforces
something, when CI has not run in eight days, is exactly the C64 shape — and the degeneracy-probe
plan currently assumes precisely that.

## C69 — The exact solve was never typechecked.

Building C57/C58's oracle instrument, the team found that
`games/bid-tac-toe/tsconfig.json`'s `include` glob **never covered `solver/**/*.ts` or any `*.mts`
file.** Sibling games with solvers — Fadeout and Crackstep — include both. So Bid-Tac-Toe's
backward-induction solver, its independent brute-force oracle, and every diagnostic script had
**never been examined by `pnpm typecheck`**, which has been passing this whole time.

Fixing the glob immediately surfaced three latent type errors (cross-function phase-narrowing gaps in
`valueOfPlaceNode`/`bestPlaceCell`, and a stale generic in `_c36-diagnostic.mts`). All were
behavior-preserving, confirmed by the existing suite staying green throughout — but they were there,
and nothing would ever have found them.

### Why this one lands harder than it looks

The artifact this untypechecked code produces is **the exact solve** — 369,802 bid nodes, cited by
name in the harness's own gate output as the proof standing `draw-rate` and `first-player-win-rate`
down to `n/a`. Within one session, that same artifact has now been found to be:

- **not in version control at all** (C67), and
- **produced by code that typecheck never read** (here).

Two independent guarantees, both assumed, neither true, on the single most load-bearing artifact in
the repository.

### The pattern this completes

The session's thread has been guards that don't guard. This is its quietest form yet: **a check that
runs, passes, and is not looking at the file you think it is.** `pnpm typecheck` was never broken and
never lied — it truthfully reported success over a set of files that silently excluded the ones that
mattered. Compare C64's probe, which was never called at all; this is worse in one respect, because
CI's green tick was real, earned, and meaningless for this code.

**The general check, and it is one command per package:** for every tsconfig in the repo, confirm the
`include`/`exclude` globs actually cover the files the package ships. A configuration that scopes a
guard is part of the guard, and this project has never once verified one.

### Ruling

The glob fix and its three type-error repairs are kept — flagged by the team rather than folded in
silently, which is the behavior C65 asked for and got. **Auditing every other package's tsconfig
coverage is owed**, and is not assumed to be clean merely because this one was found: Fadeout and
Crackstep were checked and are correct, the rest were not.

## C70 — `main` is not green, and one shipped game's gates have never been measured at all.

The user's instruction after C68 was to run everything locally. Doing so produced the first real gate
verdict this repository has had in eight days, and it is not the verdict the project has been
assuming. Full output preserved at `docs/research/games/ci-gate-table-2026-08-12.out`.

```
ci-gates: 1/5 game(s) failed their gate table (ci).
```

### Finding 1 — Tilt fails its gate table

```
CI suite (ci) for "tilt" — FAILED
  [FAIL] first-player-win-rate: 70.0% (band [35%, 65%])
```

**Not yet ruled on.** `scripts/ci-gates.ts` hardcodes its seed as `` `ci:${gameId}:${opts.suite}` ``
(lines 155/168) at `CI_GAMES = 100`, so that 70% is **one seed**. It sits 5 points outside a 65%
edge against a binomial SE of ~4.6 — about 1.1 SE out. C49's rule is that any row within ~10 points
of a band edge is provisional until a second seed, and C47 is the record of me reading a pattern
into noise twice. Replication across five seeds is running before this is called anything.

Either outcome is a finding. If it replicates, Tilt has a seat-asymmetry defect that shipped. If it
does not, then **the production gate decides borderline rows on a single hardcoded seed** — every
marginal verdict in this project's history has been a coin flip, and that is the larger problem.

### Finding 2 — eight of Mine Run's ten gates have never been measured anywhere

Mine Run's report reads **"OK (provisional — deferred rows not yet measured at this tier)"** with
eight rows `[DEFER]`red to nightly: `strongVsRandomRatio`, `distributionOverlap`,
`strongVsGreedyRatio`, `strongScoreCV`, `alwaysSafeVsStrong`, `medianRunLength`, `capHitRate`,
`ceilingPileUp`.

C68 established that **nightly has never once run.** So a shipped game's core quality gates —
including `alwaysSafeVsStrong`, the probe whose entire purpose is catching a fake risk/reward
decision, and `distributionOverlap`, which decides whether the difficulty tiers are distinguishable
at all — have been measured **nowhere, ever.** Only two of its ten gates have a real number behind
them.

This is C68's "deferred has meant discarded" made concrete on a specific shipped game, and it is
worse than the abstract version, because the report **prints `OK`.** The honesty caveat is there —
"provisional", spelled out — and the exit code is still success. C27 built deferral as a genuine
cost-management mechanism and it is sound; what was never built is anything that notices the tier
you deferred *to* does not run. **A deferral is a promise about the future, and nothing in this
system ever checks that the promise was kept.**

### The ruling that follows regardless of how Tilt resolves

A `deferred` row must not be allowed to age silently. The mechanism owed is one that makes an
unmet deferral **visible and eventually fatal** — a deferred gate carries the run that was supposed
to measure it, and a deferral that has never been discharged degrades to a failure rather than
sitting at `OK` forever. Designing that is real work and gets a plan; recording it is not optional.

Crackstep and Fadeout and Nine Grids passed cleanly, and Fadeout's `solved-value-reached` reported
100% attainment against its 90% floor — the C23/C59 machinery working exactly as designed on the one
game with a real proof behind it.

## C71 — Two pre-registered experiments, two answers, and neither is the one anyone was hunting.

Both experiments were designed with their interpretation tables written **before** any number
existed. Both fired cleanly. Raw output preserved at
`docs/research/games/tilt-fpa-replication-2026-08-12.out` and
`docs/research/games/bid-tac-toe-c57-ea-oracle-agreement.out`.

### Part 1 — Tilt does not have a defect. The gate does.

C70 reported Tilt failing `first-player-win-rate` at 70.0% against a [35,65] band, and refused to
rule until it replicated. Five seeds, same engine, same shipped manifest, same `CI_GAMES = 100`:

| seed | FPA | draw | verdict |
|---|---|---|---|
| `ci:tilt:ci` (**the production seed**) | **70.0%** | 2.0% | FAIL |
| `tilt-fpa-repl-b` | 54.0% | 12.0% | PASS |
| `tilt-fpa-repl-c` | 48.0% | 12.0% | PASS |
| `tilt-fpa-repl-d` | 38.0% | 12.0% | PASS |
| `tilt-fpa-repl-e` | 40.0% | 12.0% | PASS |

**Mean 50.0% — dead centre of the band.** The production seed is the extreme outlier of the five,
and its 2.0% draw rate stands alone against 12.0% on every other seed. **Tilt is fine.** Had C49's
replication rule not existed, this project would have opened a bug lane on a healthy game.

**The real finding is the measurement instrument.** `scripts/ci-gates.ts` hardcodes its seed as
`` `ci:${gameId}:${opts.suite}` ``. So:

- Across-seed spread is **32 points** (38%–70%) with a sample SD of **12.9 pp**.
- If those 100 games were independent, the binomial SE at p=0.5 would be **5.0 pp**. Observed
  dispersion is **2.6× that** — games within a run share a seed lineage and are correlated, so
  **n=100 does not buy n=100 worth of precision.** The effective sample size is far smaller than the
  game count implies.
- The band is 30 points wide. **The measurement's own seed-to-seed SD (12.9 pp) is comparable to the
  band it is being tested against.**

That last line is the whole problem. A gate whose noise is the same order as its acceptance region
decides borderline cases by coin flip, and **every marginal verdict in this project's history was
produced by exactly one flip.** C49's "provisional within ~10 points of an edge" rule is doing real
work, but it is a human convention applied after the fact — the gate itself has never replicated
anything.

Caveat stated honestly: an SD from five samples is itself imprecise, and 12.9 pp should be read as
"much larger than 5" rather than as a settled number. It is enough to condemn single-seed gating; it
is not enough to size the fix.

**Owed:** the gate must run multiple seeds and judge the aggregate, or state its own precision beside
every number. Which one, and at what cost, is a design question and gets a plan.

### Part 2 — The search is not buggy. It is solving a different game, and doing so better with more budget.

E-A ran the shipped, unmodified `mctsPolicy` against the exact oracle (root value **0**, seat-0
optimal bids **{3}**), 20 seeds per cell, budget never entering the seed string, with every run
self-checked against the real policy.

| budget | P(chosen ∈ optimal) s0/s1 | mean chosen bid s0/s1 | **mean rootValue** s0/s1 | opp-bids-0 mass s0/s1 |
|---|---|---|---|---|
| 1,000 | .150 / .300 | 4.35 / 4.55 | 0.023 / 0.033 | .138 / .132 |
| 2,000 | .150 / .200 | 4.75 / 4.80 | 0.039 / 0.050 | .149 / .146 |
| 5,000 | .200 / .200 | 3.35 / 4.15 | 0.076 / 0.078 | .179 / .178 |
| 10,000 | .350 / .350 | 3.05 / 2.35 | 0.117 / 0.122 | .215 / .222 |
| 20,000 | **.150 / .050** | **1.10 / 0.40** | **0.206 / 0.210** | **.344 / .359** |

All four pre-registered signatures of row (a) fired, monotonically, on **both seats**:

1. **Both seats' root value rises steadily away from zero on a position exactly proven to be a
   draw** — roughly doubling per budget step. Both players become *more* confident they are winning
   the more they think. This was the pre-registered smoking gun precisely because no adequacy or
   noise problem can produce it.
2. **Mean chosen bid drifts down**, 4.4 → 1.1 and 0.4 — away from the exact draw price of 3, into
   the 0–2 cheap-win region the solve report says wins outright *if the opponent cooperates*.
3. **Visit mass on opponent-bids-zero more than doubles.** The extra budget is spent refining the
   fantasy.
4. **Oracle agreement collapses at the top budget** — seat 1 reaches 0.050, the worst cell in the
   table, at the largest search.

**Honest limit:** the plan predicted rootValue → +1. Observed is a monotone climb from 0.02 to 0.21
across a 20× budget range. The direction is unambiguous and both seats agree; the endpoint is not
reached at 20k. The trend is the finding, not the value.

**Diagnosis: `edgeOwnerAt` makes the tree a max-max search — the opponent is modeled as a
co-operator, not an adversary.** `mcts.ts`'s own module doc calls this "a deliberate simplification"
scoped by the claim *"fine at our branching factors."* **That claim is false**, and C57/C58 have been
its symptom for weeks. This is not a bug in the sense of code failing to do what it says; the code
does exactly what it says, and what it says is wrong for simultaneous games.

### Part 3 — H3 promoted to co-cause, and it bites at the budget that ships

`P(argmaxDiffers)` is **0.000 for seat 0 at every budget** and **0.650 for seat 1 at 10,000
rollouts** — Ruthless's shipped budget. Seat 1 holds the star. `aggregateByOwnMove` groups by
`stableStringify` of the whole move, so `{amount:k}` and `{amount:k, star:true}` are distinct keys:
the star holder's marginal visit mass is split across two buckets and the non-holder's never is.

At the budget the game actually ships, **two-thirds of seat-1 decisions change depending on a
grouping detail.** Duel Draft has no analogue, which is why one engine could be sick while its
sibling stayed healthy — and why keeping Duel Draft's engine after C66 paid for itself twice.

### Ruling

No fix tonight. The plan's §4 says no fix before E-A, and the correct remedies (decoupled UCT/DUCT,
regret matching, per-seat value backup) are platform surgery against a byte-identical guarantee —
C29→C34 is exactly what mechanism-first exists to prevent. **The mechanism is now known and written
down, which is the deliverable.** Bid-Tac-Toe stays undecided, as the user directed: its gate table
cannot mean anything while the search is optimising a game nobody is playing.

## C72 — The tsconfig audit C69 owed, and the second instance it found on a shipped game.

C69 ruled that auditing every package's tsconfig coverage was owed and must not be assumed clean.
Doing it found a second instance immediately — and the method matters more than the finding.

### The method: ask the compiler, do not read the glob

Reading include globs is how the first defect survived. The authoritative check is to compare what
is **on disk** against what the compiler **actually reads**:

```
tsc -p <pkg>/tsconfig.json --noEmit --listFiles   ⟹   compare with `find` over the same package
```

Across all twelve packages, that produced two classes of gap.

### Finding 1 — Tilt, on `main`, shipped

```
games/tilt        include: ["*.ts", "ui/**/*.tsx", "test/**/*.ts"]
games/nine-grids  include: ["*.ts", "ui/**/*.ts", "ui/**/*.tsx", "test/**/*.ts"]
```

Tilt is missing **`ui/**/*.ts`**. The file it excludes is `games/tilt/ui/board-view.test.ts`, which
**runs and passes 16 tests on every test run** — a shipped game's UI test suite, executing
continuously, with its types never checked. Vitest discovers tests by its own glob, not by tsconfig,
so the split is exact: **the tests ran, the type checking did not.**

**Stated honestly: adding the glob surfaced no errors.** Typecheck is clean with the file in scope,
so nothing was actually broken and I caught no bug. What existed was an unguarded surface — 16
assertions about a shipped game that a whole class of error could have walked through untouched.
Reporting this as a save would be dishonest; the finding is the gap, not a catch.

### Finding 2 — `vitest.config.ts` is uncompiled in all five packages

`packages/{bots,engine,game-spec,harness,daily}` each have a `vitest.config.ts` that no tsconfig
includes. This is a common and largely benign convention, and it is left alone — but it is recorded
so that nobody later reads "typecheck passes" as covering test configuration. It does not.

### The rule this project keeps re-learning, now in its sharpest form

C64: a probe that is never called. C69: a check that runs and does not look at the file. C72: the
same, one package over, on shipped code. The unifying statement:

**A configuration that scopes a guard is part of the guard, and is never verified by reading it.**

Every `include`, `exclude`, `testMatch`, `files` and `paths` entry in this repository is an untested
claim about what is covered. The only thing that settles such a claim is asking the tool what it
actually processed.

### Owed

This audit was manual and will rot the moment someone adds a directory. **A guard that asserts every
package's tsconfig covers that package's shipped files** — the audit above, run automatically — is
the mechanism, and it is exactly the kind of check that would have made C69 and C72 impossible rather
than merely findable. Registered as work; not built here, because it belongs in the CI wiring that
C68 established does not currently run.

## C73 — DUCT lands. H1 is fixed, and it was masking a second defect underneath.

The remedy plan's DUCT implementation is in (`dabc6a2` baseline, `9fad305` fix, `26fefe1` E-A
re-run, on `feature/sim-search-residue`). The result splits cleanly, and the split is the finding.

### What the fix achieved — H1 is dead

| quantity, seat 0 / seat 1 | pre-fix (20k) | post-fix (20k) |
|---|---|---|
| **mean rootValue** | 0.206 / 0.210 | **−0.0007 / −0.0011** |
| opponent-bids-zero visit mass | 0.344 / 0.359 | **0.038 / 0.020** |

**§3.2 passes decisively.** Both seats' root value is essentially exact zero at *every* budget, not
merely at 10k — against a proven-draw position whose exact value is 0. Pre-fix it climbed 0.02 → 0.21.
And opponent-bids-zero mass **reversed direction**: it more than doubled with budget before, and now
*shrinks* with budget. The search has stopped modelling the opponent as a co-operator. That is H1,
diagnosed from `edgeOwnerAt` and killed by construction.

**The blast radius held exactly as the plan asserted.** Byte-identity dumps for Fadeout, Nine Grids
and Tilt are **identical** pre- and post-fix, confirmed twice, captured *before* `mcts.ts` was edited.
Zero registered games changed behaviour. No existing test was modified — `git diff` on
`mcts.test.ts` is additions only, and the C56 lucky-cell and RPS-legality tests pass unchanged.

The new pure-saddle matrix fixture was a real plant: **red pre-fix** (picked decoy row "b",
rootValue 1.9962 against a true saddle value of 3), green post-fix, with two deliberate decoys — a
global-max cell off the saddle row and a very-negative cell off the saddle column — so it
discriminates the bug rather than passing by accidental dominance.

### What the fix revealed — §3.1 misses, in the opposite direction

`P(chosen ∈ optimal)` is **0.000 at 10k and 20k for both seats**, and mean chosen bid drifts
**up**: 5.80 → 7.46 (seat 0), 5.74 → 7.02 (seat 1), monotonically with budget.

Set against the solve report's B=8 first-auction table:

| payment | seat 0 wins → | seat 1 wins → |
|---|---|---|
| 0–2 | **+1** | −1 |
| **3** | **0 (draw)** | **0 (draw)** |
| 4–8 | **−1** | +1 |

**The search is now systematically choosing bids that lose by exact analysis, while correctly
reporting the position as drawn.** Seat 0 paying 7 for the first auction is a −1 position. That is
not a smaller version of the old defect; it is the opposite sign, and it appeared only once H1 was
removed.

### The mechanism, and why H1 hid it

The value model is now honest about the *position*; the move evaluation cannot distinguish a bid that
draws (3) from one that loses (7). Rollouts are **uniform random for both seats**, and random
continuation does not punish overpaying — nobody exploits the deficit — so every bid evaluates to
≈0 and there is no gradient to select on. Higher bids win the auction more often, and winning under
random continuation is marginally better than losing it, so selection drifts upward on a signal that
has nothing to do with the game.

**H1 was supplying the only gradient.** Max-max made cheap wins look like +1, which pulled bids down
toward 0–2 — a region that is *genuinely winning*, so the pre-fix search was directionally closer to
the truth **for entirely wrong reasons.** Removing the false signal revealed there was no true signal
underneath. This is the shape worth remembering: **a defect that is also the only thing producing a
usable ordering will look like competence right up until you fix it.**

This is an evaluation defect (rollout policy), not a selection defect, and it is therefore a
different lane from C57/C58. Recorded as its own work; **not diagnosed further here**, because the
task that found it was scoped to steps 1–4 and extending scope on a fresh result is how C22 and C25
went wrong.

### H3's sequencing is vindicated

Seat 1's `P(argmaxDiffers)` fell from **0.650 → 0.120** at 10k once H1 was fixed. The plan sequenced
H1 first precisely because H3's headline was measured under H1-corrupted values and its causal weight
was unknown; it turns out H1 was inflating it more than fivefold. **H3's promotion rule does not
fire** — it required seat 0 meeting §3.1 while seat 1 missed, and seat 0 misses too. H3 stays open
and unbuilt, which is the correct outcome of a rule written before the data existed.

### Ruling

DUCT stays. It is correct, it is cheaper per rollout, it fixed what it was designed to fix, and it is
byte-identically inert for every shipped game. **§3.1 is not met and the plan's criteria are not
being redefined to say otherwise** — `solved-value-reached` and the rest of Bid-Tac-Toe's gate table
remain untrustworthy, so that game stays undecided exactly as the user directed. Steps 5–6 of the
remedy plan (b3-sweep, gate predictions, Duel Draft control re-runs) are still owed, and their
pre-registered predictions were written before this result and are not being revised now that part of
it is known.

## C74 — Scoring the pre-registered gate predictions. One met, two half-met, and the pathology moved.

The remedy plan's §5 predictions were written before DUCT existed. C73 then found the search picks
losing bids, which gave real reason to doubt them. **They are scored here as written, not revised.**
Raw output: `docs/research/games/bid-tac-toe-b3-sweep-postfix-duct.out`, same script, same fixed seed
`b3-sweep-fixed-seed`, same ladder, n=60.

### Prediction 1 — "the strong-vs-random decline reverses" — **MET, decisively**

Pre-fix: 93.3 / 96.7 / **88.3 FAIL** / **88.3 FAIL** / **75.0 FAIL**.
Post-fix: 100.0 / 100.0 / 98.3 / 100.0 / **96.7**.

**Three failing gates now pass.** At the shipped 10,000 budget the gate went **75.0% → 96.7%**, a
+21.7-point move clearing the 90% floor. The pre-fix signature was a systematic collapse toward the
top of the ladder (96.7 → 75.0); post-fix the curve is flat and saturated. The small dips
(100 → 98.3, 100 → 96.7) sit inside ~2.2 pp SE at n=60 and carry no signature. **This is C55's decline
inverted, which is exactly what the prediction named.**

### Predictions 2 and 3 — "attainment and draw rate up a lot from 0.0%" — **half met, and zero where it counts**

Attainment: 0.0% → 10.0 / 10.0 / 16.7 / 10.0 / **0.0%**. Draw rate identical shape.

Off the floor at four of five budgets, and **still exactly 0.0% at 10,000 rollouts — the shipped
Ruthless budget** — nowhere near the 90% floor. The prediction deliberately did not claim the floor
would be crossed, so this is not a surprise; but "up a lot" is not an honest description of 0 → 10%,
and it is *no* movement at the budget that ships. **Scored: partially met, failed at the shipped
budget.**

### The new failure, and the confound I must state before reading it

**FPA at 10,000 moved 33.3% → 73.3%** and now FAILs the [35,65] band. At n=60 that is a ~40-point
move against ~6.5 pp SE — about 6 SE, unambiguously real.

**But the pre/post relief status is not comparable, and saying otherwise would be dishonest.** The
pre-fix baseline in `bid-tac-toe-b3-report.md` reports FPA and draw-rate as `(n/a — proven draw)`,
i.e. **relief granted**, while attainment sat at 0.0%. That is precisely the C55 defect — relief
granted on a declaration whose validity was never checked — and it has since been fixed. The post-fix
run now prints:

> `solvedValue relief withheld: self-play reached the proven "draw" only 10.0% of the time (floor 90%)`

So part of "a new FAIL appeared" is **the C55/C59 machinery working exactly as designed**, refusing to
hide a number it previously concealed. The gate did not get worse; it started being enforced.
**The raw measurement is the comparable quantity, and it genuinely degraded: 33.3% → 73.3%.**

### The finding: the pathology moved metrics rather than disappearing

Read down the post-fix ladder as budget rises: FPA 46.7 → 36.7 → 46.7 → 46.7 → **73.3**; draw rate
10.0 → 10.0 → 16.7 → 10.0 → **0.0**; attainment the same. **The low budgets look healthy and the
shipped budget does not.**

Pre-fix, "more search makes the game look worse" showed up as `strong-vs-random` declining. Post-fix
that gate is fixed — and the same statement is now true of FPA, draw rate and attainment instead.
**C55's signature did not go away; it relocated.**

This is consistent with C73 and independent of it. At 10k both seats overpay (E-A: mean bid 7.28 and
7.14); seat 0 bids marginally higher, wins the first auction more often, and an equally-blind opponent
cannot punish the overpayment the solve report says is losing — so seat 0 converts to 73.3% wins and
zero draws. **The game looks decisive and unbalanced precisely because both bots are bad in the same
way.**

### Ruling

DUCT stays: it fixed what it was designed to fix, three gates recovered, and it is byte-identically
inert for every shipped game (C73). The remaining defect is the evaluation lane already opened —
rollouts cannot price an auction — and this sweep is now its second independent line of evidence.
**No threshold moves and no prediction is retroactively softened.** Bid-Tac-Toe stays undecided.

Still owed from the remedy plan: the Duel Draft control re-runs (refutation condition 3 — the healthy
control must stay healthy), running now.

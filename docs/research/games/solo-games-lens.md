# Solo Games Lens — Single-Player Twisted Classics

**Research pass for:** Twist Arcade — the single-player / score-based half of the library
(snake, minesweeper, 2048-family, sokoban-family, sliding puzzles — twisted).
**Question this document answers:** *how do we design, validate, and ship solo twisted
classics with the same rigor the two-player apparatus gives us — when there is no opponent,
no FPA, no draw rate, and no self-play?*
**Date:** 2026-08-02. Supersedes the deferral in `synthesis.md` §2.2 by user decision;
see §8 for where that deferral's reasoning still binds.

---

## 0. Framing: what changes when the opponent disappears

Every measurement in the two-player apparatus is a *comparison between seats*: FPA, draw
rate, mirror bots, self-play Elo. A solo game has one seat. The comparisons that remain are:

1. **Policy vs. policy on the same game** — a strong agent and a random agent play the same
   ruleset; the *separation of their score/outcome distributions* is the solo definition of
   skill expression. A game where the distributions overlap is a slot machine.
2. **Player vs. seed** — for deterministic puzzles, the opponent is the position itself, and
   an exact solver can *certify* the position (solvable, optimal length, difficulty features)
   before any human sees it. This is strictly better than anything available in two-player
   games: **solo dailies can ship with a machine-checked proof of fairness.**
3. **Player vs. player on the same seed** — the comparability that makes the daily ritual
   and the share artifact work. Same seed + deterministic engine ⇒ "solved in 23 (par 19)"
   is a commensurable number, exactly as "won in 9" is for the pinned daily bot.

The failure modes also change. Two-player degeneracy is mirroring, stalling, kingmaking.
Solo degeneracy is: **forged scores** (no adversary witnesses your game), **farming loops**
(score grows without bound at zero risk), **fake risk** (the "safe" line is also the best
line), **unsolvable or trivial dailies** (one bad seed ruins the day for everyone at once),
and **no forced termination** (endless runs). The whole validation model in §3 exists to
catch exactly these five.

---

## 1. Taxonomy of twist mechanics for solo games

Parallel to `game-theory-lens.md` §1. For each: **definition → effect on the player's
decision problem → depth verdict → 90-char-rule check.**

### 1.1 Decay / expiry — the house mechanic, solo edition

**Definition.** Board content expires on a clock: revealed minesweeper cells re-fog after
*k* moves; apples rot *k* turns after spawning; unmerged tiles crumble after *k* slides;
floor tiles crumble after you step off them (decay of *your own trail*).

**Decision effect.** Converts static optimization into **temporal routing**: the player must
sequence actions against deadlines, and the value of every objective now depends on *when*
you can reach it, not just whether. In a score game it is a pacing engine (urgency without a
literal timer — decay is turn-quantized, so the game stays turn-based and replay-verifiable,
which a wall-clock timer is not). In a puzzle it is a constraint generator: trail-decay turns
a maze into a Hamiltonian-path problem — NP-hard in general, so small instances are honestly
hard while the rule stays one clause.

**Verdict.** The strongest solo twist class and the brand throughline (the same 💨 that
marks a Fadeout vanish marks a rotted apple). Two cautions: (a) decay of *information*
(re-fogging) taxes memory, not planning — fun for some, hostile for many; gate it behind the
§3 probes plus a hotseat check. (b) Decay clocks must be telegraphed with the ux-lens §2
badge/opacity system verbatim — the vocabulary transfers with zero new design.

**90-char check: passes.** "Apples rot 15 turns after they appear" is one clause.

### 1.2 Fog / partial observability

**Definition.** Part of the generated content is hidden (minesweeper's mines are the classic
— minesweeper is *already* a fog game); twists deepen it (fog re-covers, or you see only a
radius around your cursor/snake).

**Decision effect.** The decision problem becomes inference: each observation updates a
posterior over hidden content. The classic trap transfers directly from the two-player pass
(§1.2 there): **if the player is ever forced to guess with no information, the game is
punishing dice.** Minesweeper's 50/50 endgame is the canonical example, and it is fixable:
generate-and-verify can *guarantee* every daily is solvable by pure deduction (the
"no-guess minesweeper" construction — reject seeds whose solver requires a guess).

**Verdict.** High ceiling, with the no-forced-guess guarantee as a non-negotiable gate for
daily puzzles. For score chases, forced guesses are tolerable if the player *chooses* the
exposure (see 1.7). One honest limit: on a client-side engine the hidden content is in
device memory, so fog is honor-system for cheaters regardless of redaction (§5).

**90-char check: passes** for simple fog ("you can only see 2 tiles around your snake");
fails for anything with per-cell information rules.

### 1.3 Resource economies

**Definition.** A spendable budget layered on the classic: limited reveals, limited undos as
a *currency*, bombs you earn and spend, a shared pool of slides.

**Decision effect.** Adds an intertemporal allocation problem (spend now vs. save). This is
the solo cousin of Richman bidding — pricing the present against the future — but without an
opponent the price is set by the *seed*, so its depth depends entirely on how variable the
generator makes demand. Flat demand ⇒ the budget is a disguised move cap ⇒ no decision.

**Verdict.** Medium. Real when demand varies sharply within a run; bloat when it is a second
number the player must track for little payoff. Prefer it *as the scoring rule* (bank/spend,
1.7) over as a side-pool. One resource maximum per game — the two-player twist-stacking rule
(game-theory §5.10) applies with the same force.

**90-char check: passes** for one resource ("you have 5 flags — total").

### 1.4 Procedural rule mutation mid-run

**Definition.** The rules change on a schedule: every 20 moves gravity flips; every level
one new constraint activates; the merge rule cycles.

**Decision effect.** The player must plan across a rule boundary — genuinely novel, and the
solo cousin of Tilt's scheduled rotation. But the *decision* is only real if the mutation
schedule is visible and the mutation set is tiny (2–3 states); otherwise it reads as
arbitrary punishment and the player cannot plan at all.

**Verdict.** Use only the degenerate case: **one alternating mutation on a visible clock**
("every 10th slide, gravity reverses"). The general form — roguelike-style escalating rule
decks — is a different genre.

**90-char check: FAILS in general.** The one-alternation case squeaks under ("every 10th
slide, tiles fall up instead of down" — 51 chars); anything richer needs a paragraph and is
out of brand scope. This is the taxonomy's brightest line: **rule mutation beyond a single
alternating clause is excluded by the library's own constitution.**

### 1.5 Inverted objectives (solo misère)

**Definition.** The classic's goal is flipped: *lose* at 2048 as fast as possible (fill the
board with no merges available in fewest moves); in minesweeper, *find* a mine last; reach
the *lowest* score that still ends the game.

**Decision effect.** Inverts imported heuristics — high novelty per zero new rules, same as
two-player misère. The solo-specific risk is sharper, though: many solo classics are
*optimization* games, and the inverted optimization is often trivially easy (dying fast at
snake takes 4 moves) or trivially mechanical. The inversion must land on the *interesting*
side of the objective: "fewest moves to a dead board" in a 2048-like is a real puzzle;
"die fast" is not.

**Verdict.** Cheap novelty; ship at most one, validated hard (the §3 triviality checks
exist for exactly this — if greedy achieves within 15% of the solver, it's dead).

**90-char check: passes.**

### 1.6 Board / topology mutation

**Definition.** Torus wrap (minefield wraps; rows/columns of a sliding puzzle wrap);
shrinking play-field (snake arena loses its outer ring every 50 turns); growing boards.

**Decision effect.** Wrap deletes the edge/corner heuristics that carry most of the
player's cached skill — in minesweeper, edges and corners are where deduction chains
anchor, so torus minesweeper forces re-derivation of every pattern while the rules stay
verbatim (the exact effect Wrap has on TTT). Shrinking is, as in the two-player pass,
**structural hygiene**: it forces termination in score chases that otherwise run forever.

**Verdict.** Wrap is the cheapest "everything you know is wrong" twist in the solo library
too. Shrinking is the mandated anti-endless device for any score chase that lacks natural
termination (§3.7). Both S-complexity.

**90-char check: passes.**

### 1.7 Press-your-luck / risk-push ("one-more-run" mechanics)

**Definition.** The player repeatedly chooses between banking accumulated value and risking
it for more: reveal one more cell or bank the streak; grab one more apple in the closing
ring; double-or-nothing the multiplier.

**Decision effect.** This is the purest *added decision* available to solo games, because
the classic solo loop (optimize until you die) contains no choice about **variance** — and
press-your-luck adds exactly that choice. It has a real theory underneath (optimal stopping;
the bank/continue threshold shifts with posterior risk), which means a strong agent and a
greedy agent genuinely diverge — measurable skill. It is also the mechanic most at risk of
being a slot machine: if the odds are opaque or the optimal policy is "always bank" /
"never bank," the choice is fake. The §3.6 always-safe and grind probes are aimed directly
at this class.

**Verdict.** The best score-chase twist class. Requires visible odds (show the mine count,
show the rot timers) so the risk decision is informed — an uninformed gamble fails the same
test Battleship's opening failed.

**90-char check: passes** ("reveal squares to grow a streak; bank anytime — a mine wipes
your unbanked streak" — 82).

### 1.8 Deterministic-puzzle vs. score-chase framing (as a twist)

**Definition.** Re-framing a classic from one shape to the other *is itself a twist*:
snake as a fixed-board turn-based puzzle ("eat all 8 apples in the fewest moves" — the
Snakebird insight); minesweeper as a streak-banking score game (1.7); 2048 with a fixed,
known spawn sequence, compare score after exactly 100 slides.

**Decision effect.** Puzzle-framing converts execution skill into planning skill and makes
the exact solver available (certificates, par). Score-framing converts a solved chore into
a risk-management game. Both preserve 100% of the classic's rules — the *frame* is the
one-sentence delta.

**Verdict.** Not decoration — this is the library's main solo lever, and it is why §2's
format question is a per-game design decision, not just a platform question.

**90-char check: passes** by construction.

### 1.9 Roguelike run structure

**Definition.** Meta-progression across attempts: pick an upgrade between levels, build a
deck/loadout, permanent unlocks.

**Verdict: excluded.** Three independent disqualifications: (a) it cannot be stated in 90
characters — it is a genre, not a twist; (b) validation cost explodes (the state space now
includes the upgrade lattice; every §3 metric must be measured per-build); (c) it breaks
daily comparability unless everyone gets the same forced upgrades, at which point the
upgrades are scenery. The one salvageable atom — "between waves, choose one of two shown
rule tweaks" — is rule mutation (1.4) and fails the same 90-char line. Same verdict class
as 3+ player games in the two-player pass: refused at the taxonomy level, on the record.

### Taxonomy summary

| Mechanic | Depth verdict | 90-char rule | Best format |
|---|---|---|---|
| Decay/expiry | High — temporal routing; the brand | passes | both |
| Fog/partial obs. | High with no-forced-guess gate | passes (simple forms) | daily (guaranteed), chase (chosen risk) |
| Resource economy | Medium — needs variable demand | passes (one resource) | either |
| Rule mutation | Low except single-alternation case | **fails in general** | chase |
| Inverted objective | Cheap novelty; triviality risk | passes | daily |
| Topology mutation | High (wrap); hygiene (shrink) | passes | both |
| Press-your-luck | High — adds the variance decision | passes | chase |
| Puzzle⇄chase reframe | High — the main solo lever | passes | is the format |
| Roguelike structure | **Excluded** | **fails** | — |

---

## 2. The two solo formats, and which the site ships

**Deterministic daily puzzle** (one seed, provably solvable, everyone gets the same board;
compare on moves against a machine-certified par) versus **score chase** (a run under a
fixed seed or random seeds; compare on score).

| Criterion | Daily puzzle | Score chase |
|---|---|---|
| Share artifact | **Better.** "23 moves, par 19" is a two-number story; spoiler-free struggle-shape emoji works exactly like Wordle because the instance is shared | Good only when *seeded and bounded*; "score 4,120" alone is noise without a same-seed cohort and a percentile |
| Fairness of comparison | **Provable.** Same board, certificate says it's solvable, par is machine-derived | Fair only if seed is fixed and the run is bounded; unbounded chases compare persistence, not skill |
| Replayability per instance | One shot (then it's memorized) — replay value lives in *tomorrow* | High — same seed rewards mastery across attempts; "one more run" is native |
| Validation cost | **Cheapest.** Exact solver both validates and calibrates; certificate = par = share hook — one artifact, three jobs | Costlier — needs the policy-distribution machinery of §3 (minutes of CPU, still cheap, but no proof, only statistics) |
| Fit with the daily-ritual spine | **Native.** It *is* the Wordle shape the whole retention design is built on | Grafts on via "daily seed + fixed move budget," which works but is a convention, not a proof |
| Failure blast radius | One bad seed ruins the day **for everyone** → certificates are mandatory, not optional | A bad seed is just a dull run; degenerate *rules* (farming) are the real risk |

**Recommendation: daily deterministic puzzle is the primary solo format.** It compounds
every existing asset: the daily spine, the share artifact, the seed formula, the replay
pipeline — and it adds the one thing two-player games can never have, a *proof* the day is
fair. **Score chase is the secondary format**, used in exactly two situations: (a) games
whose classic identity is inherently a run (snake, 2048-family) ship their daily as a
**seeded, bounded score chase** — fixed seed, fixed move budget (e.g. "best score in 250
moves") or fixed goal, so scores stay commensurable and termination is forced; (b) any solo
game may offer an unranked "endless" mode after the daily is done — a retention dessert,
never the comparison surface. No unranked-unbounded mode ever feeds a leaderboard.

---

## 3. The validation model — the solo replacement for the self-play harness

This is the most important section. Everything here is automated, headless, and budgeted at
**≤5 minutes of CPU per candidate game** (and ~10 s per daily seed). It reuses
`packages/harness` — same CLI, new suite: `pnpm harness rot-snake --suite solo-ci`.

### 3.1 The agent roster (replacing the bot ladder)

| Agent | Spec | Purpose |
|---|---|---|
| **Random** | uniform over `legalMoves` | floor; triviality probe for puzzles |
| **Greedy** | 1-ply + the game's 20-line `heuristic` (already the two-player pattern) | "notices the obvious" ≈ weak human; the *legibility* rung — a simple visible strategy must pay |
| **Strong** | single-player MCTS (no minimax needed) or beam search (width 100), 200 ms/move budget; for stochastic games, flat Monte-Carlo (32 rollouts/action) is an acceptable cheap stand-in | the skill ceiling estimate; becomes the shipped "hint"/"ghost" feature, so the cost is recovered exactly as MCTS became the two-player bots |
| **Exact solver** (puzzles only) | A*/IDA* with a per-game admissible heuristic; CSP/SAT propagation for deduction games (minesweeper); GF(2) elimination for toggle games. Budget: 10⁷ nodes / 10 s per seed | solvability certificate, optimal length L*, difficulty features |
| **Degeneracy probes** | Grind, Always-Safe, Greedy-Only (§3.6) | the solo mirror/stall bots |

"Strong vs. random" without an opponent means: **run each policy N=1,000 times over the
same fixed seed set (paired seeds — the solo analogue of mirrored seats, same variance
reduction) and compare the resulting score/steps distributions.** Skill is distribution
separation, not head-to-head wins.

### 3.2 Skill expression thresholds (score chases)

Let R, G, S be the score distributions of Random, Greedy, Strong over paired seeds.

- **Median ratio S/R ≥ 3.0** (design target). **Hard fail < 1.5** — if a strong agent can't
  triple a random agent, decisions barely matter: slot machine.
- **Overlap test:** design target **S's 10th percentile ≥ R's 90th percentile** (a strong
  player's *bad* run still beats a random player's *good* run — this is what "my score means
  something" feels like). **Hard fail: S's median < R's 75th percentile.**
- **Ladder ordering: R < G < S with G/R ≥ 1.5 and S/G ≥ 1.5** (targets). Hard fails: G/R
  < 1.2 (the obvious strategy doesn't pay → illegible) or S/G < 1.15 (search adds nothing
  beyond greed → one-trick game; the solo analogue of "MCTS-1k ≈ MCTS-100").
- **Scale caveat (stated so nobody games the ratios):** ratios are only meaningful on a
  score linear in achievements (apples, banked cells, merges). For exponential scores
  (2048-family), compute all ratios on a linear proxy (merge count) or log-score. Each
  game's manifest declares its comparison metric.
- **Luck band:** Strong's score CV across seeds in **0.25–0.7** (target). Hard fail > 1.2 —
  even perfect play is mostly dice. (< 0.15 is also suspicious: the seed doesn't matter, so
  why is it a daily?)

### 3.3 Solvability guarantee for daily seeds (the generate-and-verify loop)

Every daily puzzle ships with a certificate or it does not ship. The loop, run **offline in
batch, never at request time**:

```
for candidate seed s (derived from the public daily formula + a nonce counter):
  board  = engine.setup(1, rngFrom(s))
  result = exactSolver(board, budget: 10^7 nodes / 10 s)
  reject if: unsolvable | solver exhausted budget (treat as unsolvable — NEVER ship
             an uncertified seed) | trivial (random-playout solve rate > 30%, or
             L* < 8, or forced-move fraction > 85%) | out of difficulty band (§3.4)
  else: store { seed: s+nonce, certificate: optimal move log, L*, features }  →  ship
```

- The certificate is a **replayable move log** — CI re-verifies it through the engine
  (purity makes this free), and **L* is published as "par"** in the UI and the share
  artifact. One artifact, three jobs: proof, calibration, share hook.
- **When the solver can't finish in budget:** reject the seed and draw the next nonce. If
  rejection rate exceeds 50%, warn (generator and difficulty band are mis-matched); above
  90%, hard fail — the game's generator needs redesign, and no amount of nonce-drawing
  fixes it. For games where true-optimal is expensive (wrap 15-puzzle), the certificate may
  be **best-found-in-budget** (beam/IDA* anytime solution) — still a solvability proof; par
  is then labeled internally as an upper bound, and beating par is a legitimate player
  achievement rather than a bug.
- Batch horizon: **90 certified days per game**, generated at build time; CI alerts when
  the buffer drops below 30. A daily outage is the one failure mode with site-wide blast
  radius; the buffer makes it a build-time problem, never a 6 a.m. incident.
- Fog games add one more rejection clause: **solvable by deduction alone** (the CSP solver
  never branches on a guess). This is the no-forced-guess guarantee of §1.2, mechanized.

### 3.4 Difficulty calibration

Per-seed feature vector, all free by-products of the solve:

- **L*** (optimal solution length) — the primary dial;
- **solver nodes expanded** — search effort ≈ human effort, the best single predictor;
- **forced-move fraction** along the optimal path (high = the puzzle plays itself);
- **mean branching factor** over the solve;
- **dead-end density** — fraction of 1,000 random playouts that reach an unsolvable state
  (how punishing mistakes are);
- **greedy gap** (greedy solution length − L*, or greedy failure) — how misleading the
  obvious line is.

Calibration procedure: generate 10,000 seeds per game once, compute the feature
distribution, z-score each candidate against it. **Dailies are drawn from a fixed band
(target ±0.5σ around the game's chosen difficulty center), and consecutive days may not
drift more than 0.5σ** — day-to-day consistency is what makes "par 19, I took 23" feel
like a fair fight rather than weather. **Weekly ramp: not at launch.** Flat difficulty
until the difficulty model is validated against real completion rates (the model is solver
effort, not human effort; calibrate the mapping first, then consider the NYT-style
Mon-easy→Sat-hard ramp as a Phase-3 nicety).

### 3.5 Score distribution health (score chases)

From 1,000 Strong runs + 1,000 Greedy runs on the daily's bounded format:

- **Healthy histogram:** unimodal or gently right-skewed, CV in the §3.2 band, no pile-up:
  **< 5% of Strong runs within 1% of the max achievable / capped score** (target). Hard
  fail: > 20% of Strong runs at a design cap — the ceiling is doing the ranking, not skill.
- **No dominant strategy:** if Greedy-Only (§3.6) matches Strong within 10%, one visible
  policy is the whole game — rebalance (same spirit as opening-book concentration).

### 3.6 Degenerate-exploit probes (the solo mirror/stall bots)

Scripted, cheap, catastrophic to skip:

- **Grind bot** — searches (breadth-limited) for a *repeatable cycle* of moves whose score
  delta is ≥ 0 and whose per-cycle termination risk ≈ 0; then loops it. **Hard fail if it
  exists:** score grows linearly with moves while survival per 100 moves stays > 99% —
  an infinite farming loop; the leaderboard becomes a patience contest. (Classic example
  this catches: snake circling the perimeter in a game where uneaten apples never expire.)
- **Always-Safe bot** — at every decision, takes the minimum-variance option (always bank,
  never extend, never enter the closing ring). **Hard fail if it reaches ≥ 95% of Strong's
  median** — the risk mechanic is decorative. Design target ≤ 70%: real risk-taking must
  buy ~30%+ of the score.
- **Greedy-Only bot** — §3.5's dominant-strategy probe.
- **Suicide bot** (inverted-objective games only) — verifies "losing fast" isn't the
  trivially optimal line of a misère framing.

### 3.7 Run length and forced termination

- Daily puzzles: **L* in 8–80** (hard fail outside), target 12–50 — a 1–5 minute solve,
  matching the ux-lens 2–5 minute session shape.
- Score chases: median run **15–600 decisions** (hard fail outside), target **60–250**
  (~2–5 min at turn-based pace). **Hard fail: > 1% of any policy's runs hit the 2,000-move
  cap.** Every score chase must carry a *structural* termination device — board fills,
  arena shrinks, spawn rate ramps, move budget — never only the harness cap. An endless
  game with no forced termination is the solo stall-bot failure and is rejected at design
  time, not patched at the cap.

### 3.8 The solo threshold table (CI gate | design gate)

Same two-tier shape as `docs/roadmap.md` §6: the CI column is build-breaking; the design
column is the Fable-review bar. Manifest-declared exceptions with justification strings,
as before.

| Metric | CI hard fail | Design-gate target |
|---|---|---|
| **Score chase** | | |
| Strong/Random median score ratio | < 1.5 | ≥ 3.0 |
| Distribution overlap | Strong median < Random p75 | Strong p10 ≥ Random p90 |
| Greedy/Random ratio | < 1.2 | ≥ 1.5 |
| Strong/Greedy ratio | < 1.15 | ≥ 1.5 |
| Strong score CV across seeds | > 1.2 | 0.25–0.7 |
| Always-Safe vs Strong median | ≥ 95% | ≤ 70% |
| Grind bot | any zero-risk unbounded loop found | none reachable |
| Greedy-Only vs Strong | — | ≤ 90% |
| Median run length (decisions) | outside 15–600 | 60–250 |
| Cap hits (2,000 moves), any policy | > 1% | 0 |
| Ceiling pile-up (Strong runs at/within 1% of cap) | > 20% | < 5% |
| **Daily puzzle** | | |
| Solvability certificate for every shipped seed | any missing / unverifiable in CI replay | 100%, with stored move log + L* (par) |
| Optimal length L* | outside 8–80 | 12–50 |
| Random-playout solve rate | > 30% (trivial) | 1–15% |
| Forced-move fraction on optimal path | > 85% | 30–70% |
| Generator rejection rate | > 90% | < 50% |
| Day-over-day difficulty drift | > 1.5σ | ≤ 0.5σ |
| Certified-seed buffer | < 7 days | ≥ 30 days |
| Fog games: deduction-only solvable | any daily requiring a guess | 100% |
| **Both** | | |
| Engine contract property suite (incl. solo additions §4) | any failure | — |
| Rule sentence | > 90 chars | — |
| Bundle / a11y | unchanged from roadmap §6 | unchanged |

**Cost check:** Random/Greedy are ~free; Strong at 200 ms/move × ~150 moves × 1,000 runs
parallelizes to low minutes on a laptop; the solver is 10 s/seed batched offline. Total
well under the 5-minute-per-candidate budget except the one-time 10k-seed calibration run
(~30 CPU-minutes, once per game, nightly-tier not PR-tier).

### 3.9 The thin human check, solo edition

Same protocol shape as game-theory §3.5: after green metrics, 5 playtests with the sentence
read aloud. Pass condition: a new player makes a *twist-aware* play (banks a streak early
because the count looks bad; routes toward the apple that's about to rot) within their
first two runs, unprompted. Additionally for dailies: at least 3 of 5 finish, and nobody
finishes on autopilot — the certificate says it's solvable; only humans can say it's *felt*.

---

## 4. Engine interface impact — precise deltas, no fork

The `GameEngine<S, M, V>` contract (architecture §1) survives almost untouched. This is by
design and the deltas below are deliberately minimal — and they must land **before the v1
interface freeze** (standing risk #1 in the roadmap already mandates diverse games before
freezing; a solo game now becomes one of the freeze-validating trio).

```ts
// packages/engine/src/types.ts — deltas only

export type Status =
  | { kind: "ongoing" }
  | { kind: "won"; winner: PlayerId }   // solo puzzle solved: winner = 0
  | { kind: "lost" }                    // NEW — solo-only terminal failure (stranded,
                                        //   snake dead pre-goal, no legal moves unsolved).
                                        //   Two-player engines never emit it; the shared
                                        //   testkit asserts that.
  | { kind: "draw" }                    // solo engines never emit draw (testkit-asserted)
  | { kind: "scored"; scores: number[] }; // solo score chase terminal: scores = [final].
                                          //   Invariant: scores.length === numPlayers.

export interface GameMeta {
  // minPlayers: 1 becomes legal. NO new "solo" flag: solo ⇔ maxPlayers === 1.
  // NO realtime flag: the platform is move-driven; solo games MUST be turn-quantized
  // (snake advances one cell per input, not per tick). Real-time is a future ADR, not
  // a meta field to speculate on now.
}

export interface GameEngine<S, M, V = S> {
  // ... everything existing, unchanged. Solo semantics, as doc-comments not new methods:
  //
  // setup(1, rng): ALL generated content — mine layout, tile-spawn schedule, food
  //   sequence — derives from rng. With the existing rngFor(matchSeed, k) child-seed-
  //   per-step rule, mid-run spawns (snake food, 2048 tiles) are drawn inside apply()
  //   from the step rng: replays and leaderboard verification work verbatim, zero
  //   new machinery.
  //
  // active(state): returns { mode: "sequential", player: 0 } while ongoing. Solo KEEPS
  //   active() — the shell, harness, and replayer loop on it and must not branch on
  //   player count. Cost of keeping it: one trivial line per solo engine. Cost of
  //   making it optional: a fork in every consumer. Keep it.
  //
  // playerView(state, 0): same redaction path for hidden generated content (unrevealed
  //   mines are ABSENT from V, not masked). playerView(state, null) — the spectator
  //   view — may reveal everything once terminal (post-game "show me the mines").
  //   Rationale for reusing the path rather than something cheaper: the mechanism is
  //   already built, the testkit already probes it, and it is what makes server-side
  //   replay verification well-defined. What it does NOT buy solo: client-side secrecy
  //   (the client holds S locally; fog is honor-system there — see §5). Perfect-info
  //   solo games set playerView = identity exactly like perfect-info 2P games.

  /** NEW, optional: live score for the HUD, harness learning curves, and the share
   *  artifact's progress line. MUST be pure and MUST equal status().scores[0] at a
   *  scored terminal (testkit-asserted). Puzzles omit it. */
  score?(state: S, player: PlayerId): number;
}
```

That is the entire surface change: **one Status variant, one optional method, `minPlayers:
1` legalized, and doc-contract clarifications.** No second interface, no `SoloEngine`.

**Shared property-test kit additions** (`engineContract(engine)` grows a solo branch,
auto-activated when `maxPlayers === 1`):

1. Random playouts terminate under the cap and end in `won | lost | scored` — never
   `draw`, never a 2P-only status.
2. `score` (when present) is defined at every reachable state and equals `scores[0]` at
   scored terminals; if the manifest declares `scoreMonotone: true`, it never decreases.
3. Determinism through generation: same seed ⇒ identical spawn/mine/tile sequence across
   two full replays (this is the leaderboard-verification property, tested directly).
4. Redaction: for fog games, `JSON.stringify(playerView(S, 0))` never contains an
   unrevealed generated secret across random playouts (the existing 2P leak test, pointed
   at generated content instead of opponent state).
5. Certificate replay: for puzzle games, the testkit accepts a `(seed, moveLog)` pair and
   asserts it reaches `won` — CI runs it against every shipped daily certificate.
6. Two-player engines: assert `lost` is never emitted (protects the union's semantics).

**Harness additions:** the `--suite solo-ci` runner (policy-vs-distribution over paired
seed sets, the probes, the threshold table) and the `certify` subcommand (the §3.3 batch
loop). Estimated cost: 2–3 dev-days, reusing the existing CLI, workers, and reporting.

---

## 5. Anti-cheat and leaderboard integrity for solo scores

Materially harder than two-player, and it's worth stating why: in a two-player async match
the opponent is a live witness — every move you make is validated server-side against a
server-held state *as the game happens*. A solo score arrives after the fact with no
witness. The engine's purity recovers most of it; honesty requires naming what it can't.

**Verifiable by replaying the move log through the pure engine** (submission =
`(gameId, engineVersion, seed, moveLog)` — claimed score discarded, exactly the
architecture §8 model):

- every move was legal at its state;
- the terminal status and **final score** (recomputed, never trusted);
- move count, and for dailies, moves-vs-par;
- all stochastic content (spawns, mines, tiles) — because it derives from the seed, the
  replay regenerates it identically; a forged "lucky spawn" log simply fails verification.

**Not verifiable, ever:**

- **Wall-clock time** — do not rank by it (already the site rule; it binds doubly here).
- **Who played** — a bot/solver-assisted run is indistinguishable from a brilliant human.
  For dailies with published par, a solver-assisted run is *exactly par*, every day. This
  is the residual attack that most shapes leaderboard design below.
- **Attempt count** — the client can retry locally all day and submit its best log.
  Server-side first-view stamps narrow it slightly; nothing eliminates it.
- **Fog integrity** — the mine layout is in client memory; a memory-inspecting cheater
  sees through fog. Redaction (§4) makes the *replay* well-defined; it cannot secure a
  client-held state. (Option noted and **not recommended at launch**: server-salted seeds
  + server-computed views for fogged dailies — real secrecy, but it puts a server on the
  hot path of every solo move, breaking the "solo costs $0" architecture invariant for a
  threat that percentile display already defangs.)

**The honest posture for a free casual site** (consistent with architecture §8: no
anti-cheat department):

1. **Every leaderboard entry is a verified replay.** Forged-score spam — the attack that
   makes solo boards worthless — is eliminated outright. This is the load-bearing 90%.
2. **Daily, per-seed, reset daily; one submission per user id** (the first accepted
   verified replay; server stamps first view of the day's seed). No all-time global boards
   for solo scores — an all-time board is a museum of bot runs within a week.
3. **Percentile framing over rank framing.** The share artifact and default UI say "top
   18%", not "#4,913" — robust to a handful of solver-assisted entries at the top, which
   distort ranks 1–10 but barely move percentiles. The top-10 list still exists one tap
   deep for those who want it, with expectations set by design.
4. **Friend boards are the primary competitive surface** (already the site posture) —
   solver-assisting against your group chat is self-defeating in a way that anonymous
   global cheating is not.
5. **Statistical flags, not bans:** daily runs at exactly par with high move-rate
   uniformity get quietly excluded from the percentile pool (never from the cheater's own
   view — no appeals process for a free site, so no visible punishment either).

**Residual attacks accepted, on the record:** solver-assisted play (mitigated by
percentiles + friend boards + flag-and-exclude), local retry-scumming (mitigated by
first-view stamps; accepted beyond that), multi-anonymous-account entries (accepted;
anonymous-first is a deliberate product choice worth more than it costs here), fog-peeking
via devtools (accepted; same class as looking up today's Wordle).

---

## 6. Share artifact design for solo games

Same constitution as ux-lens §5 — spoiler-free, plain emoji, ≤7 lines, shell owns the
frame, game supplies the body and one ≤40-char stat line — with two solo-specific rules:

1. **Par is the hook.** The daily certificate's L* appears in the header ("23 moves ·
   par 19"). Par is what makes a solo number *provoke*: it is a challenge with a
   machine-guaranteed answer, which no two-player artifact can offer.
2. **💨 is the house glyph.** The same emoji that marks a Fadeout vanish marks every
   solo decay event (rotted apple, crumbled tile, re-fogged cell). One glyph, one meaning,
   across the whole library — the twist brand is literally visible in every artifact.

Daily-puzzle body: one emoji per move encoding *struggle shape*, never direction or
position (directions would spoil the path): 🟩 move on an optimal path · 🟨 detour ·
🟥 move that made the position unsolvable · 💥 stranded/restart. All derivable offline by
diffing the player's log against solver values — the certificate pays a fourth time.

```
🧊 Crackstep #14 — solved in 23 (par 19)
🟩🟩🟩🟨🟨🟩🟩🟥💥
🟩🟩🟩🟩🟩🟨🟨🟩🟩🟩🟩🟩🟩🟩✅
1 restart · the floor crumbles behind you
twistarcade.game/d/crackstep
```

Score-chase body: the run's rhythm — bank/loss/decay events in sequence, score +
percentile in the header (percentile, per §5, is the comparison surface):

```
💣 Mine Run #14 — 340 pts · top 18%
🏦7 🏦12 🏦9 💥 🏦21 💥 🏦4
best streak 21 · two streaks lost to mines
twistarcade.game/d/mine-run
```

```
🐍 Rot Snake #14 — 8 apples in 214 moves
🍎🍎🍎💨🍎🍎💨💨🍎🍎🍎☠️
3 apples rotted before you reached them
twistarcade.game/d/rot-snake
```

Every 💨/💥/🏦 in a group chat is a question mark; the rule sentence in the link's OG
description is the answer — the same ad-mechanism as the two-player artifact, unchanged.

---

## 7. Ranked shortlist of candidate solo games

Same table shape as game-theory §4. Complexity: S ≤2 days rules+agents, M ≤1 week, L
multi-week. Format: **D** daily puzzle, **C** seeded-bounded score chase. All rule
sentences verified ≤90 chars. All turn-quantized (no real-time loop — see §8).

| # | Working name | Classic | Exact rule change (sentence ≤90 chars) | Why the twist creates a real decision | Format | Cx | Validation risk to watch |
|---|---|---|---|---|---|---|---|
| 1 | **Crackstep** | Maze / ice-path puzzles | "Every tile crumbles as you leave it — cross the whole floor without stranding yourself." | Trail-decay (house mechanic on your own path) turns walking into Hamiltonian-path planning: every step permanently prices future routes. NP-hard family ⇒ honestly hard small boards; trivial exact solver (DFS with reachability pruning). | D | **S** | Generator must reject boards with < 2 genuinely distinct solutions' worth of decisions (forced-move fraction gate); dead-end density must stay in the punishing-but-fair band |
| 2 | **Mine Run** | Minesweeper | "Reveal squares to grow a streak; bank anytime — a mine wipes your unbanked streak." | Press-your-luck on the deduction chassis: the posterior mine risk of the *next* reveal is computable from the numbers, so bank/push is an informed odds decision, not a gamble. Puzzle⇄chase reframe (§1.8) of a fully generic classic. | C | **S** | Always-Safe bot — if banking every 3 reveals matches Strong, the push decision is fake; tune wipe severity until risk buys ≥30% |
| 3 | **Wrap Sweep** | Minesweeper | "The minefield wraps — rows and columns continue off every edge. No guessing, ever." | Torus deletes edge/corner anchors — every cached deduction pattern dies, rules verbatim (solo Wrap). Deduction-only certificate (CSP solver) makes it the fairest daily on the site. | D | M | Solver must prove guess-free solvability; rejection rate on torus boards may run high — watch the 50%/90% generator gates |
| 4 | **Rot Snake** | Snake | "Apples rot away 15 turns after they appear — reach them before they're gone." | Decay on the objective converts open-ended growth into temporal routing: which apples are reachable in time, in what order, at what body-shape cost. Turn-quantized (one cell per input) — the Snakebird lesson: snake works as deliberate planning. | C (daily = fixed spawn seed, 250-move budget) | M | Grind bot: uneaten-apple expiry must remove any safe perimeter-circling loop — this rule IS the anti-farm device; verify, don't assume |
| 5 | **Fade Tiles** | 2048-family (itself a Threes descendant; see IP notes) | "Tiles crumble 10 slides after they appear unless you merge them first." | Decay breaks the solved corner-stacking strategy — hoarded tiles now expire, so the dominant snake-chain heuristic dies while the merge rules stay verbatim. | C (daily = fixed spawn sequence, 100 slides) | M | Score is exponential — run all §3.2 ratios on merge count, not score; watch ceiling pile-up at the 100-slide bound |
| 6 | **Backhaul** | Crate-pushing puzzle (sokoban-family; never that name — see IP notes) | "You can only pull crates, never push them." | One inverted verb rewires every intuition: you must be *behind* your goal, corners become traps in reverse. Known-deep variant family (Pukoban); standard A*/IDA* solvers apply. | D | M | Triviality per seed — pull-only boards can collapse to corridor-following; greedy-gap gate must be enforced per daily |
| 7 | **Torus Fifteen** | 15-puzzle / sliding tiles | "Slide entire rows and columns — they wrap around the edges." | Whole-row wrap moves (Loopover-style mechanic; mechanic generic) destroy the memorized corner-by-corner solve; group-theoretically rich, physically legible. | D | M | True-optimal solving is expensive — par = best-in-budget (anytime IDA*/beam), labeled as bound; beating par must be handled gracefully in UI |
| 8 | **Fog Sweep** | Minesweeper | "Cleared squares fog over again 12 moves after you reveal them." | Decay of information: deduction now has a working-memory shelf life; route planning must revisit or re-derive. The purest house-mechanic-on-fog composition. | D | M | Memory-tax hostility — this is the one most likely to pass metrics and fail the human check (§3.9); gate on the hotseat protocol seriously |
| 9 | **Wrap Out** | Lights-toggle puzzle (mechanic generic; "Lights Out" name is Hasbro's) | "Toggling a light flips its neighbours — and the grid wraps around every edge." | Torus σ-game: GF(2) solver gives instant certificates and exact par; wrap kills the memorized chase-the-lights sweep (no bottom row to sweep into). | D | **S** | Strategy-description-length: the general chase-method still quasi-works — exact-solve every board and reject any the sweep solves optimally |
| 10 | **Last Merge** | 2048-family (misère) | "Fill the board — you lose the moment any merge becomes unavoidable. Survive longest." | Inverted objective: avoid merges on a shrinking free-space budget — packing under adversarial spawns, the anti-2048. | C | M | Triviality both ways: suicide bot (dying fast must not score) and Always-Safe checkerboarding (if one parity pattern always survives, it's solved — kill) |
| 11 | **Fade Deal** | Klondike-family solitaire (names generic, cards generic) | "Face-up tableau cards fade back face-down after 10 moves untouched." | Decay on revealed information in the deepest classic chassis here; forces tempo management across the whole tableau. | D (certified-winnable deals) | **L** | Klondike solvers are heavyweight (only ~82% of deals winnable even unmodified); certificate cost may blow the 10 s budget — this is the game that stress-tests the "reject on budget-exhaustion" rule. Hold past launch |

**Cut from consideration, with reasons on the record:**
- **Any Tetris-family falling-tetromino game.** The Tetris Company enforces aggressively
  and *won* on look-and-feel beyond the name (*Tetris Holding v. Xio Interactive*, D.N.J.
  2012: the seven-tetromino set, 10×20 field, and associated trade dress protected as
  expression). This is not a "rename it" situation like Connect Four — the mechanic's
  standard expression is itself contested territory. Zero games in this family at launch;
  revisit only with a design far from tetromino-in-a-well, if ever.
- **Roguelike-structured anything** (§1.9 — fails the 90-char constitution, the validation
  budget, and daily comparability, independently).
- **Real-time anything** (auto-advancing snake, falling blocks under gravity-per-tick):
  the engine, shell, replay, and verification model are move-driven; a tick loop is a
  platform ADR, not a game. Turn-quantized versions (Rot Snake) capture the designs.
- **General rule-mutation games** (§1.4 — over the 90-char line by construction).

**IP notes (extending game-theory §6):** *Snake* — generic (Blockade 1976 lineage; Nokia
popularized, never owned the mechanic or common name). *Minesweeper* — generic term and
folk mechanic predating Microsoft's implementation; descriptive use safe. *2048* —
Cirulli's MIT-licensed open source, itself derived from **Threes** (Sirvo's trademark and
distinctive juiced trade dress — avoid the name and its look; our decay/misère variants are
mechanically distinct anyway). *Sokoban* — trademark (Thinking Rabbit/Falcon, active in
Japan): never the name; "crate puzzle" descriptively, "Backhaul" as the coined name.
*15-puzzle* — 1870s, generic. *Loopover* — coined name (carykh), mechanic unprotectable;
own name ("Torus Fifteen"). *Lights Out* — Tiger/Hasbro product name; the σ-game math is
public. *Klondike, FreeCell, solitaire* — generic. *Snakebird* — commercial title whose
*lesson* (turn-based snake) we take; Rot Snake shares no rules, name, or dress. House rule
unchanged: coined name, original dress, self-written rules, "in the ___ family" notes.

---

## 8. Launch recommendation

**Ship exactly 2 solo games at launch: Crackstep (daily puzzle) and Mine Run (score
chase).** Not 4, not 6, and — the honest part — 0 would also be defensible; 4+ would be a
mistake.

**Why 2 is the number:**

1. **One per format is the minimum honest test.** The two formats have different validation
   machinery (certificate pipeline vs. distribution suite), different share artifacts, and
   different leaderboard semantics. Shipping one of each proves the whole solo platform;
   shipping two of one format proves half of it twice.
2. **Both are S-complexity with trivial-to-cheap solvers.** Crackstep's exact solver is a
   pruned DFS (a day, not a week); Mine Run's agents are the Random/Greedy/flat-MC roster
   with a 20-line posterior heuristic. These are the two cheapest entries on the shortlist
   that still carry the house decay mechanic (Crackstep) and a proven-recognition classic
   (Mine Run's minesweeper chassis).
3. **The interface freeze needs a solo game anyway.** Standing risk #1 mandates diverse
   games before freezing `GameEngine` v1. A solo engine is now the cheapest possible
   diversity — landing §4's deltas *before* freeze costs ~0.5 days; retrofitting after
   game 10 ships would cost a versioned migration.
4. **Eight games at launch, not six, widens the library claim** (the market lens's whole
   thesis) and gives the "Next twist" loop a cross-format edge: a two-player loss can
   hand off to a solo daily, which has no matchmaking dependency at all — the solo games
   are the library's only entries that work perfectly for a visitor with no friend and no
   patience for a bot.

**What it adds to Phase 0 (the platform bill, priced):** Status `lost` + `score?` +
testkit solo branch (~0.5 day) · solo harness suite + probes (~2–3 days) · certificate
batch pipeline + 90-day buffer + par storage (~1–2 days) · shell deltas — score HUD,
par-framed end screen, restart-centric controls, solo share bodies; no hotseat, no async
(~1–2 days). **Total: ~5–8 dev-days added to Phase 0**, plus ~1–2 days per game. Against a
4-week runway carrying six two-player games, that is real but absorbable — *if and only if*
nothing else grows.

**The honest flag.** Synthesis §2.2 deferred solo games to Phase 3 to avoid forking the
harness and shell before they were proven, and that instinct was directionally right — I am
not pretending the override is free. Where I *disagree* with the deferral's sizing: it
imagined a fork; §3–§4 show it is an extension (~1 week, one Status variant, no second
interface), because the purity/seeding/replay spine was built general enough to carry solo
games unchanged. Where the deferral's caution still binds, restated as launch guardrails:
(a) **turn-quantized games only** — the real fork the synthesis feared is the real-time
tick loop, and that is still deferred; (b) **2 games, from the S-complexity row, both
solvable with cheap exact/MC machinery** — no Fade Deal, no Torus Fifteen at launch;
(c) **the two-player slate has priority** — if week 3 arrives and Fadeout/Nine Grids are
not green, cut Mine Run first, then Crackstep, and ship solo in Phase 2 with zero shame:
the daily ritual spine works without them. The kill criterion is explicit: solo games are
launch content only while they cost ≤ 8 platform-days and ≤ 2 game-days each; the first
time either budget doubles, they move to Phase 2 and this document becomes the Phase 2
plan instead. Nothing about the solo line's value depends on it shipping in week 4.

**One roadmap correction this pass forces:** roadmap §9 item 4 ("single-player score
twists deferred to Phase 3 — confirm") is now resolved in the other direction; Phase 0
scope grows by the platform bill above, and Phase 1's launch slate line becomes "six
two-player + two solo (Crackstep, Mine Run), all eight through their respective gates."

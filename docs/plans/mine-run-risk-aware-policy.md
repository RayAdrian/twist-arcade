# Mine Run — Risk-aware policy, and the measurement that answers C29

*Fable design spec, 2026-08-07. No implementation code in this document. Standing: Mine Run
gets no board (C16) until §5's experiment has a verdict.*

*Primary sources — this spec is a pointer to them, not a substitute (C31): C36 (current
diagnosis; C29/C30/C35 show the path and are superseded/refined), C27 (cost + `deferred`),
C24 (seed discipline), C25 (numbers do not transfer between boards), C26 (small-n reads are
not verdicts), C32 (band membership, never drift, across engine changes), C6 (yardstick
rule), `docs/plans/mine-run.md` §2/§4.2–§4.5, `games/mine-run/{engine,heuristic,csp,probes}.ts`,
`packages/bots/src/{determinized-flat-mc,search-utils}.ts`,
`packages/harness/src/{agents,solo-gates}.ts`.*

## 0. What this fixes, and one sharpening of C36

C36 established: `createMineRunHeuristic` is a 1-ply risk estimator (`max(bankValue,
banked + (1−bestRisk)·(streakValue+gain))`, single-point fixpoint). It drives Greedy, every
rollout-continuation step, and therefore Strong's root averages. It never prices the
compounding hazard of a *run* of future pushes. Ground truth: seed `ci:mine-run:ci-0`, ply
15 of the real applied game, `minesExploded=5`, `banked=0`. Standalone Greedy (no search)
scores 91/3/231 against Always-Safe's 849/686/1247; on ci-2 Greedy's 231 equals
Strong@750's 231. The search is fine; the evaluation is the defect.

**Sharpening (code-read inference; confirm before building on it).** The defect has a
second, structural half. `greedyMoveSelector` (search-utils.ts:155) and `greedyOnlyPolicy`
apply each candidate to the (sampled) world and evaluate the *resolved* next state. A
reveal's risk is resolved before evaluation: in the sampled world the chosen cell either
survived (value ≈ B+V+gain) or exploded, and the argmax over ~80 cells almost surely finds
one that survived in that world. Banking's post-state is worth ≈ B+V plus a small streak-0
continuation. So **bank is (near-)dominated at every rollout ply in every sampled world,
regardless of how good `heuristic()` is** — the in-world +gain is credited before any
heuristic runs. Consequences:

- A better `heuristic()` is necessary for coherence but **insufficient** to fix Greedy or
  Strong. The fix must be a policy that decides from the *view and its posteriors*, never
  from a resolved world outcome.
- Pre-registered confirmation (5 minutes, do it first): instrument the current greedy
  rollouts and count chosen `{t:"bank"}` moves across all plies. Prediction: ~0. If bank is
  chosen materially often, this paragraph is wrong and §3's design should be re-examined
  (C34: a mechanism is a hypothesis until the branch count is measured).

## 1. Step one — the cheap disconfirming check (half a day, before any new code of substance)

Three times this week a cheap discriminating measurement would have replaced hours of
accumulation. Here is this task's version, buildable from existing exports only
(`analyzeFrontier`, `chooseSafeMove`'s decision shape, the solo runner):

**The threshold family.** A hand policy with two knobs, `(T, pCap)`:
1. If a provably-safe cell exists → reveal it (Always-Safe's own step 1).
2. Else if `streakValue ≥ T` → bank.
3. Else if the minimum posterior `p_min ≤ pCap` → reveal that cell (carry the streak).
4. Else bank if `streakLen ≥ 1`, else reveal the min-posterior cell (streak-0 probe, free).

**`pCap = 0` reproduces Always-Safe exactly** — Always-Safe is the boundary member of this
family. C29's question, restated precisely: *is the family's optimum interior, or at the
boundary?*

Run the grid `T ∈ {5, 10, 15, 20, 30, 50, ∞} × pCap ∈ {0.05, 0.10, 0.15, 0.20, 0.30}` on:
- the three known seeds `ci:mine-run:ci-{0,1,2}` (bridge fixture — Always-Safe must
  reproduce 849/686/1247 byte-exact first, proving the wiring), and
- 20 fresh paired seeds derived from one fixed root (per C24: one seed string, e.g.
  `c29:mine-run:pilot`, runner derives `:i`; **never interpolate T, pCap, or any compared
  variable into the seed**).

Cost: these policies price like Always-Safe (~3ms/game measured, C27), so the whole grid at
n=23 is **seconds**. Interpretation is pre-registered and C26-bounded:
- Some interior `(T, pCap)` beats Always-Safe on a majority of seeds → risk *can* pay;
  C29's dark reading is probably dead; proceed to §2–§6 as bot engineering.
- Every interior member loses on nearly every seed → not a verdict (n=23), but the kill
  path (§6) becomes the priority and the orchestrator is told before further build effort.

Either way, n=23 decides *sequencing only*. The verdict is §5.

## 2. The risk model

### What a policy must compute

At a decision point, from the view: `B = banked`, `k = streakLen`, `V = streakValue`,
`R = revealsLeft`, and posteriors `p_c` for unrevealed cells. Sort candidates ascending
`p_(1) ≤ p_(2) ≤ …` (proven-safe cells have p = 0 and come first). For each plan "push m
more times, then bank" (`0 ≤ m ≤ R`):

- survival to the next bank:  `S_m = Π_{i=1..m} (1 − p_(i))`
- added streak value:         `Δ_m = m·k + m(m+1)/2`
- plan value:                 `U(m) = S_m · (V + Δ_m)`     (so `U(0) = V` = bank now)

Act on `m* = argmax U(m)`: bank if `m* = 0`, else reveal the `p_(1)` cell. **Replan every
ply.** Scan all m (≤ 60 terms — do not assume unimodality; it costs nothing to check all).
`m = R` needs no bank move (R8 auto-banks at terminal), so the formula is valid at the
horizon edge.

This is exactly the quantity the 1-ply model cannot see: `S_m` is the probability of
surviving to the next bank, and it discounts the whole streak-plus-continuation, not one
reveal. Known approximations, named: it ignores information gain from reveals (posteriors
improve as numbers land — conservative direction, mitigated by replanning), ignores flood
fills (a 0-cell advances multiple streak steps for one unit of risk — undervalues
zero-hunting; a refinement only if §5's numbers demand it), and ignores post-wipe
continuation (second-order at a single decision; replanning absorbs most of it).

### The risk-source ladder — full joint CSP or a cheaper bound?

Both already exist and both are view-honest by construction:

- **Tier A (cheap):** the single-point fixpoint in `heuristic.ts` — per-constraint
  `required/cells` minima plus background rate. O(constraints) per call. Biased: misses
  joint deductions, can over- and under-state risk.
- **Tier B (full):** `analyzeFrontier(view)` in `csp.ts` — exact posteriors for every
  unrevealed cell, exact `provablySafe`, global mine-count coupling, enumeration caps
  (22 cells / 400k nodes) with conservative background-fold fallback.

Tier B's measured cost is **not** the obstacle it was assumed to be: Always-Safe calls
`analyzeFrontier` once per decision and completed two full games in 6ms total (C27) —
order tens of microseconds per call *on Always-Safe's trajectories*. C25 caveat, binding: a
pushing policy creates larger, messier frontiers than a banking policy ever sees, and
exploded mines change constraint structure — **re-measure on risk-aware trajectories before
trusting this number** (§4's cost pilot does exactly that).

Recommended assignment: **Greedy = the policy with Tier A; Strong's rollout steps = Tier A
(cost); Strong's root and the standalone reference policy = Tier B.** Always-Safe already
uses Tier B and is untouched.

### The constraint that shapes everything (C1)

Every new decision function consumes `MineRunView` (or values derived from one), never
canonical state and never `state.mines`. The rollout adapter receives a sampled world per
the `MoveSelector` contract and must derive its view via `engine.playerView(world, 0)` —
honest, because that world is a hypothetical, and the decision consumes only what the view
exposes. The view-honesty resampling test (fix a view, resample worlds, assert identical
moves) is extended to cover the new policy **before any tuning run is trusted** — Mine Run
is precisely the game where an omniscient policy posts excellent numbers on an unplayable
game, and C1 has failed twice already.

## 3. Where it lives

1. **`games/mine-run/risk-policy.ts` (new, game-local).** Pure
   `chooseRiskAwareMove(view, analysis, opts)` implementing §2, with the risk source
   injected (Tier A or B); plus a `MoveSelector`-shaped adapter
   (`state → playerView(state, 0) → decide`) for rollout use; plus a `SafeMoveFn`-shaped
   export so existing agent wiring applies. Game-local because the model is Mine Run's
   scoring arithmetic; the plan-then-bank *shape* may later generalize to other
   press-your-luck games, but not before it has survived one game's gates.

2. **The rollout/roster seam (platform-owned — see §8 rulings).**
   `packages/harness/src/agents.ts` hardcodes `greedyMoveSelector` for every hidden-info
   game and hardcodes `greedyOnlyPolicy` as every game's Greedy. Both need a per-game
   override. Note for the platform: the in-world one-ply leak (§0) is generic to any
   hidden-info game where a move's risk is resolved by `apply` — the default stays greedy,
   but the seam should exist platform-wide, and the leak is a known hazard for future fog
   games.

3. **What changes for players vs what changes for the gate.**
   - `heuristic()`: upgraded to the §2 formula with Tier A risk. Coherence for
     `rankingValueOf`/`valueOfStatus` consumers — **explicitly not the fix** (§0's
     structural half survives any heuristic).
   - **Greedy tier**: becomes RiskAware-Tier-A. A deliberate change to a shipped tier — the
     current Greedy scores 3 points on a real seed and is not a playable rung of anything.
     S/G and G/R move; they are re-measured, not carried forward (C32).
   - **Strong**: stays `determinizedFlatMonteCarloPolicy` (root machinery proven fine,
     C36), with `rolloutMoveSelector` = the risk-aware adapter.
   - **Always-Safe: frozen.** It is the baseline under comparison and must not move while
     being measured against.

## 4. Cost, and the CI-vs-nightly call

- **The C29-answering comparison is cheap.** Standalone policies price at ~3–10ms/game. The
  full §5 family at n=100 paired seeds is **under a minute of compute**. The expensive thing
  was only ever Strong.
- **Strong, re-estimated.** Current: ~165s/seed at 750 rollouts (C27), with a 7.5×
  per-seed spread (C29) making any mean projection soft. Per rollout ply the risk-aware
  adapter swaps ~80 × (apply + status + fixpoint) evaluations for 1 × (playerView + Tier-A
  fixpoint + sort). Estimate: **0.3×–3× of today's 165s/seed** — plausibly *faster*. Per
  C25 this transfers to nothing: the §7 cost pilot (5 seeds, cost-only, no verdict per C26)
  measures it before the batch.
- **Strong-dependent rows stay nightly-only** per C27; CI keeps the
  contract/redaction/view-honesty suite and `grindProbe`, reporting Strong rows as
  **`deferred`** naming the nightly tier (mechanism landed and verified). Recurring nightly
  at n=40; the one-time §5 verdict batch at n=100 is a *decision run*, not a recurring gate.

## 5. The experiment that answers C29 — pre-registered

**Seeds (C24).** One fixed root, `c29:mine-run:v1`; the runner derives game i as
`${seed}:${i}`, i ∈ 0..99; the identical 100 boards for every policy (paired). The compared
variable never appears in the seed. Bridge check first: Always-Safe reproduces
849/686/1247 on `ci:mine-run:ci-{0,1,2}` byte-exact before any new number is trusted.

**Policies.** Always-Safe (frozen baseline) · threshold grid (§1's family, containing
Always-Safe at pCap=0) · RiskAware-A · RiskAware-B · Greedy-new · Strong-new (750 rollouts,
K≈8.6 floor preserved) · Random.

**Primary metric.** The gate's own: `median(AlwaysSafe) / median(policy)`, threshold
< 0.95 hard, ≤ 0.70 design-healthy. Secondary, reported not gated: per-seed paired win
fraction and a bootstrap CI on the median ratio.

**Pre-registered interpretation:**

| Outcome at n=100, frozen params | Meaning | Action |
|---|---|---|
| ratio(RiskAware-B or Strong-new) ≤ 0.70 | Mechanic real and healthy | Full solo tables at nightly; freeze path resumes |
| best ratio in (0.70, 0.95) | Gate passes, design target missed | One bounded lever-sweep round, then freeze or escalate |
| best ratio in [0.95, 1.0] | Risk pays ~nothing | Lever sweep; unchanged → kill standard |
| every member ≥ 1.0 | C29's suspicion | Kill standard (§6) |

Additional pre-registered check: **Strong-new must beat standalone RiskAware-B.** If it does
not, that is a *search* finding (C6 shape), not a game finding — it triggers a bot
investigation but does not enter the ship/kill verdict, which keys on the best view-policy
of any complexity. All re-measured rows are new samples: band membership only, never drift
(C32).

## 6. The kill standard — pre-registered, so the decision is made before the number arrives

**Mine Run is killed if all three legs hold:**

1. **Frozen params, n=100 paired:** every pre-registered policy has median ≤ Always-Safe's
   (best ratio ≥ 1.0). The family contains Always-Safe as its boundary member, so this is
   the statement "the optimum is at the boundary: never carry a streak into an unproven
   reveal."
2. **One bounded lever sweep** inside the plan's declared window (density 18–22%, budget
   50–75): the grid {18, 20, 22}% × {50, 60, 75} minus the frozen combo, n=40
   direction-only, best config confirmed at n=100 on a fresh derived seed block (each config
   is a different game — C32). Best config still fails leg 1. **One round.** Open-ended
   tuning after a pre-registered failure is exactly what pre-registration exists to prevent.
3. **Reduced-board exact check** — the mechanic's own trial, independent of any policy
   family: on 4×4 / 3 mines / budget 8 (and 5×5 / 4 / 12 if tractable), compute the exact
   optimal *view*-policy by expectimax over reachable views. If optimal EV ≤ 1.05 ×
   Always-Safe EV on the reduced boards too, the compounding-hazard structure itself does
   not pay: triangular escalation at these densities never overcomes geometric survival
   decay, for *any* policy. Feasibility fallback: if enumeration exceeds budget, legs 1–2
   decide alone and the verdict is recorded as the weaker one.

**What a kill means, plainly:** the rule sentence — "bank anytime — a mine wipes your
unbanked streak" — advertises a decision that has a dominant answer. The game fails roadmap
§6's strategy-description-length standard ("always bank before any gamble" is a googleable
sentence), and what remains is deduction-only minesweeper wearing a press-your-luck costume.
Kill = remove from the queue, record in platform-corrections, no board is ever built. What
survives: the CSP module and the determinized-flat-MC machinery, both platform assets proven
by this investigation.

**What a kill does *not* mean:** leg 1 alone. A family of hand policies losing is evidence
about the family until leg 3 (or the lever sweep) says otherwise — C29/C30/C35 were three
wrong readings of one dataset, and the kill decision gets the same discipline.

## 7. Sequencing

| Step | Work | Cost | Gate to proceed |
|---|---|---|---|
| S0a | `bankFrac` instrumentation on current greedy rollouts (§0's prediction) | minutes | Confirms/refutes the structural-leak claim |
| S0b | §1 threshold-family sweep | half a day | Sequencing decision, reported to orchestrator |
| S1 | `risk-policy.ts` + unit tests + view-honesty resampling extension | 1–2 days | View-honesty green before any tuning run |
| S2 | Seam ruling (§8) + agents.ts wiring | ruling + small | — |
| S3 | Cost pilot: 5 seeds, Strong-new, **cost only** (C26) | ≤1h | Confirms §4 estimate; sizes the batch |
| S4 | §5 decision batch (n=100) + full nightly chase table | <1min standalone; hours for Strong | — |
| S5 | Verdict per §5/§6 → freeze path or kill | — | Orchestrator |

TDD anchors: known-answer `U(m)` positions (uniform-p closed form); threshold family at
pCap=0 reproduces Always-Safe's known seed scores; full-m scan (no unimodality assumption);
the rollout adapter's view-derivation covered by the resampling test.

## 8. Orchestrator rulings (2026-08-07)

Recorded in `platform-corrections.md` **C37**.

- **R1 — the seam is an engine hook, not manifest data.** The manifest carries *data*
  (tiers, budgets, thresholds, `solvedValue`); a rollout policy is *code*, and the engine
  already exports `safeMove`, `sampleConsistentState` and `heuristic` alongside its rules.
  An optional `rolloutPolicy` hook sits with its siblings and keeps the manifest a
  description rather than a dispatch table. Default stays `greedyMoveSelector` for every
  game that declares nothing.
- **R2 — Greedy-tier redefinition approved**, and **the in-world one-ply leak is recorded
  platform-wide now, not at future planning time.** The current Greedy scoring 3 points on a
  real seed is not a playable difficulty rung, so this is a fix rather than a regression.
  The leak is generic to any hidden-info game whose `apply` resolves a move's risk, and C31
  established that a hazard left to be rediscovered later gets rediscovered expensively.
- **R3 — three-leg kill standard approved, including the one-round sweep bound.** The bound
  is the point: open-ended tuning after a pre-registered failure is how a kill decision
  becomes unfalsifiable. Only the user may waive a gate finding; this standard binds me too.
- **R4 — approved.** The n=100 verdict batch is a one-time decision run outside the
  recurring nightly budget, which stays n=40.

# Bid-Tac-Toe — B3 gate table, budget sweep, and the C36 diagnostic (Sonnet, B3)

*Deliverable per `docs/plans/bid-tac-toe.md` §6, at the orchestrator-ruled working budget
STARTING_BUDGET=8 (platform-corrections.md C51). Produced against the real
`@twist-arcade/harness` (`runCiSuite`/`compareBudgets`/`runMatchup`) and B3's own bidding-
specific probes (`games/bid-tac-toe/probes-bidding.ts`).*

**STATUS: a platform-level MCTS defect was found and diagnosed (C36-shaped) before any gate
table could be trusted. No ship/kill verdict on the game itself — every number below describes
a badly-played game, not the game's real balance (platform-corrections.md C55/current
ruling).**

---

## 0. The question this report set out to answer

`manifest.solvedValue = { value: "draw", proof: "...bid-tac-toe-solve-report.md §1" }` is
declared (B2, C51). That does NOT settle whether the *shipped* MCTS tiers actually find that
draw — C14/C48's standing point: a theorem about optimal play is not a prediction about the
bots we ship. `solved-value-reached` (C23's inverted gate, floor 90%) is the real test. It
failed at every budget tried, and the reason turned out not to be about balance at all.

## 1. Budget sweep (C22/C24/C25) — one fixed seed, `compareBudgets`

Candidates held strictly above `standard`'s shipped 1,500 rollouts (the C19/C20 tier-collapse
guard refused 300 outright — confirmed working). 60 games/matchup, seed
`b3-sweep-fixed-seed` fixed across every candidate.

| rollouts | strong-vs-random | self-play FPA | self-play draw rate | solved-value-reached |
|---|---|---|---|---|
| 1,600 | 93.3% PASS | 46.7% (n/a — proven draw) | 0.0% (n/a — proven draw) | 0.0% **FAIL** |
| 2,000 | 96.7% PASS | 50.0% (n/a) | 0.0% (n/a) | 0.0% **FAIL** |
| 3,000 | 88.3% **FAIL** | 46.7% (n/a) | 0.0% (n/a) | 0.0% **FAIL** |
| 5,000 | 88.3% **FAIL** | 60.0% (n/a) | 0.0% (n/a) | 0.0% **FAIL** |
| 10,000 (shipped) | 75.0% **FAIL** | 33.3% (n/a) | 0.0% (n/a) | 0.0% **FAIL** |

**Two anomalies, not one.** `strong-vs-random` *falls* as rollouts rise (93→97→88→88→75%) on a
game exact-solved as a pure draw at every one of 369,802 bid nodes, and self-play **never
draws once, at any budget** despite the proven root value being a draw. Per the coordinator's
framing, this is C36's signature: more search converging on a *worse* measured result. The
plan's own §7 risk (joint-space UCT exploitable where the true optimum is mixed) does **not**
apply — B2 proved pure everywhere, so that specific anticipated failure mode is ruled out by
the solve itself, not by assumption.

**No budget was validated and `ciGateBudget.twoPlayerCiRollouts` was NOT set from this sweep**
— every number describes the same broken search at different intensities, so there is no
"correct" budget to pick until the defect is fixed.

## 2. The C36 diagnostic — one real mid-game decision, dumped in full

Source: one real self-play game (`strong` @ 2,000 rollouts vs itself, seed
`c36-diagnostic-source-game`, terminated normally at 10 plies, seat 0 won). Target decision:
the second bid-phase step, board `[_,_,O,_,X,_,_,_,_]`, budgets `[7,9]`, seat 0 holds the
star. **16 rows (seat 0's candidate bids) × 10 cols (seat 1's) = 160 joint arms.**

### 2.1 Per-candidate flat-rollout statistics (400 rollouts/candidate, opponent column sampled uniformly, real random continuation to a genuine terminal — never a horizon cutoff)

```
amount*  mean     sd       p0win  p1win  draw
0        -0.105    0.938   39.3%   49.8%   11.0%
0*        0.052    0.946   47.5%   42.3%   10.3%
1         0.028    0.947   46.3%   43.5%   10.3%
1*        0.055    0.947   47.8%   42.3%   10.0%
2         0.052    0.938   46.8%   41.5%   11.8%
2*        0.120    0.938   50.7%   38.8%   10.5%
3         0.055    0.950   48.0%   42.5%    9.5%
3*        0.145    0.932   51.7%   37.3%   11.0%
4         0.115    0.947   51.2%   39.8%    9.0%
4*        0.170    0.944   54.5%   37.5%    8.0%
5         0.220    0.912   55.0%   33.0%   12.0%   <- best mean
5*        0.190    0.908   52.5%   33.5%   14.0%
6         0.090    0.936   48.8%   39.8%   11.5%
6*        0.195    0.912   53.3%   33.8%   13.0%
7         0.105    0.940   50.0%   39.5%   10.5%
7*        0.087    0.922   47.3%   38.5%   14.2%
```

**Real signal exists, and it is statistically solid at this sample size.** Best (amount=5,
mean 0.220) vs worst (amount=0, mean -0.105): a 0.325 gap. Per-candidate SEM at N=400 ≈
0.94/√400 ≈ 0.047; combined SE for the two means ≈ 0.065 — the gap is **~5 standard errors**,
not noise. **Candidate means are separated by much more than chance at this sample size** —
this rules out the plain "no signal anywhere" reading of outcome 1.

### 2.2 Real MCTS on the SAME state, two budgets

```
==== real MCTS @ 2000 rollouts ====
chosen move: amount=4
total joint arms expanded: 160 of 160
per-arm visits: min=3 max=36 mean=12.5
per-row aggregated visits: 5*:165, 2*:144, 6*:144, 1*:143, 4*:141, 4:138, 2:128, 3:127,
  6:123, 3*:117, 1:116, 0*:112, 7*:111, 5:109, 7:102, 0:80

==== real MCTS @ 10000 rollouts ====
chosen move: amount=1
total joint arms expanded: 160 of 160
per-arm visits: min=8 max=422 mean=62.5
per-row aggregated visits: 3*:945, 4*:828, 1:774, 2*:765, 5*:713, 1*:676, 6*:661, 4:631,
  7:604, 7*:595, 5:583, 3:576, 6:526, 0*:457, 2:446, 0:220
```

**With 5× more search, the chosen move got worse, not better.** At 2,000 rollouts MCTS picks
`4` (flat-rollout mean 0.115 — mediocre but not terrible). At 10,000 rollouts it picks `1`
(flat-rollout mean 0.028 — the **second-worst** of all 16 candidates). Neither run's choice
matches the flat-rollout argmax (`5`, mean 0.220), and the two runs disagree with each other.

**All 160 arms get visited at least once (MCTS always expands untried children first), but
per-arm visit counts are extremely thin relative to how many arms there are**: mean 12.5
visits/arm at 2,000 rollouts, only 62.5 at 10,000 — against 160 arms. The **max** visit count
(422 at 10,000 rollouts, 6.75× the mean) shows UCB concentrating hard on ONE specific
`(row, col)` pair — not on player 0's best *row*, on one lucky joint cell.

**The mechanism, read directly from `packages/bots/src/mcts.ts`:** for a simultaneous node,
`jointMoveOptions` builds the full `rows × cols` cartesian product as **flat sibling
children** (no per-player structure at all), and the final move selection
(`chooseMove`'s `bestEntry` loop) picks **the single joint child with the most visits**,
then reads off player 0's component of *that one pair*. This is not decoupled UCT and not a
marginal best-response — it is optimizing for "which one `(row, col)` combination got lucky
under UCB," which is a fundamentally different, and wrong, question for an adversarial
simultaneous node. The module's own doc names this as a known simplification ("decoupled
UCT... deferred... fine at our branching factors") — at 160 arms and a budget of thousands,
not thousands of *arms*, this assumption does not hold.

**If the algorithm instead aggregated visits/value by player 0's OWN row** (summing across
all ~10 columns sharing that row), the signal would likely already be recoverable at current
budgets: 2,000 rollouts ÷ 160 arms × 10 cols/row ≈ 125 samples/row, SEM ≈ 0.94/√125 ≈ 0.084,
still smaller than the 0.325 spread. **The defect is the missing marginalization, not
fundamentally insufficient total rollouts** — this is why more rollouts made the *measured*
result worse (more confident commitment to one noisy joint cell, not more resolving power on
the real per-row signal).

### 2.3 Standalone Greedy (1-ply, uniform-marginalized `heuristic()`, zero rollouts) on the SAME state

```
chosen: amount=0 (avg heuristic=8.50)
full ranking (best to worst): 0:8.50, 0*:8.40, 1:8.30, 1*:7.80, 2:7.50, 2*:6.60, 3:6.10,
  3*:4.80, 4:4.10, 4*:2.40, 5:1.50, 5*:-0.60, 6:-1.70, 6*:-4.20, 7:-5.50, 7*:-8.40
```

Greedy picks `amount=0` — the **worst** candidate by the honest flat-rollout evaluation (mean
-0.105, 49.8% loss rate). **Standalone Greedy is NOT ≈ full search** (0 vs 4 vs 1 — three
different answers), so outcome 3 (the evaluation function inside the SHIPPED search is the
defect) is ruled out for the real MCTS specifically: `engine.ts` has no `score()`, only
`heuristic()`, and mean-plies at this game (~7–10, per §1's table) sit far under MCTS's
200-ply rollout cap — **every MCTS rollout reaches a genuine win/draw/loss terminal**, so
`valueOfStatus`'s "ongoing, horizon-capped" branch (the only place `heuristic()` could ever
feed backpropagation) is never reached. `heuristic()` is structurally never consulted by the
real search here.

**A separate, real finding about `heuristic()` itself, worth recording even though it did not
cause this bug**: it is badly miscalibrated. It scores `amount=0` (hoard everything, lose the
auction 49.8% of the time) as the single best move and monotonically punishes every larger
bid, purely because it weights `budgets[0]-budgets[1]` directly without accounting for what
*not* winning the auction costs. This would matter the moment anything in this codebase
actually calls `heuristic()` for this game (`greedyOnlyPolicy`, a future `minimax`/`beam`
tier, or any horizon-capped rollout) — flagged for B5's tier-tuning pass, not fixed here
(engine code review, not search-defect diagnosis, is out of this task's scope).

### 2.4 Diagnosis

**Outcome 2: means are separated but the argmax is poor — the joint-action handling is
wrong.** Confirmed directly against the code, not inferred from the numbers alone:
`packages/bots/src/mcts.ts` treats a simultaneous node's full `rows × cols` product as
undifferentiated flat children and selects the single most-visited child, discarding the
per-player marginal structure entirely. This is a **platform-level defect in
`packages/bots/src/mcts.ts`, not a bug in this game's engine, its exact solve, or its
manifest** — not mine to fix, escalated per the standing convention (the same posture as the
worker-host/runner seams reported clean in B1's spike, except this one is broken).

**What this diagnostic rules out, with evidence, not assumption:**
- **Mixed-strategy exploitability (plan §7's anticipated risk)** — ruled out by B2's solve
  itself (2,521,056 bid nodes checked, zero impure, across all four ship-candidate budgets).
- **"No signal anywhere" (pure outcome 1)** — ruled out by §2.1's ~5-SE separation at N=400.
  The *real* search's per-arm sample sizes (12.5–62.5 mean visits over 160 arms) ARE too thin
  to resolve that signal reliably through the CURRENT (non-marginalized) selection rule — but
  that is a symptom of outcome 2's structural defect, not evidence the underlying game has no
  signal to find.
- **The shipped search's own evaluation function (pure outcome 3)** — ruled out: real
  terminals are always reached, `heuristic()` is never invoked by MCTS's backpropagation here.
  (`heuristic()`'s own separate miscalibration is real but not causal to this bug.)

## 3. Everything downstream is provisional until the search is fixed

Per the coordinator's explicit ruling: **no budget sweep result, gate table, H1 adjudication,
or probe result below is a verdict on the game.** They are recorded for provenance (what B3
actually ran and measured) but every one of them describes MCTS choosing badly, not the game
being unbalanced or decisive. Re-run once `packages/bots/src/mcts.ts`'s simultaneous-node
handling is fixed (or a game-local workaround is sanctioned by the orchestrator).

### 3.1 Bidding-specific degeneracy probes vs "Strong" — NOT adjudicated

Ran (`games/bid-tac-toe/probes-bidding.ts`, all legality-tested first — see
`probes-bidding.test.ts`, 10/10 passing) but **not adjudicated against the plan's 45%
threshold**, since "Strong" here is the same defective search — a probe "beating" a broken
Strong proves nothing about position-pricing skill being fake or real. Numbers will be
re-collected after the fix.

### 3.2 Mirror probe

**n/a, not measured — per the orchestrator's C48 ruling**, unaffected by the MCTS defect
(this status is structural, not a self-play measurement). The board is spatially symmetric,
but bids and the star have no reflective analogue: a "mirror" bidding strategy has no
well-defined meaning (mirroring an opponent's bid amount is not a symmetry of this game the
way mirroring a placed cell is for a spatial board). `probes.ts`'s stock `mirrorMove`
placeholder (returns the first legal move, a harmless non-mirror fallback) is left as-is; the
manifest carries no `"symmetric"` tag, so CI would only ever WARN on its absence, never
hard-require it — recorded here directly as n/a with this reasoning instead.

## 4. Verdict

**No ship/kill verdict on Bid-Tac-Toe.** The game's exact-solve properties (B2: pure, proven
draw, zero star-holder advantage at every ship-candidate budget) stand unchanged and
unaffected by this finding — they are properties of the game tree itself, verified by
backward induction, not by search. What is NOT yet known is whether *any* real bot can play
this game well, because the one search algorithm the platform ships for simultaneous games has
a confirmed structural defect on exactly the node type this game is built from. This is a
platform blocker, not a game-design finding — `manifest.ciGateBudget.twoPlayerCiRollouts`
remains unset, `manifest.difficultyTiers` remains untouched (B1's placeholder values), and the
game remains unregistered, all deliberately, per instruction.

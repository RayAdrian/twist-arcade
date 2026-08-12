# Diagnosis plan: the C57/C58 simultaneous-node search residue

Authored by Fable (planning pass, 2026-08-12) against `feature/sim-search-residue`, which carries
BOTH simultaneous engines: Bid-Tac-Toe (rescued at C67) and Duel Draft (killed as a game at C66,
retained precisely as the healthy control this plan needs).

Provenance is marked **RECOVERED** (traceable to a document or measurement) or **PROPOSED**
(planner's judgement). Every claim about code was verified against source.

---

## 0. What the code verifiably does

**V1 — The tree is a max-max search at every simultaneous node.** In `packages/bots/src/mcts.ts`:

- `edgeOwnerAt` (lines 138–146) returns the **root requester** as edge owner for any simultaneous node.
- Backprop (231–236) accumulates `totalValue` w.r.t. that owner; UCB selection (209–224) maximizes it.
- Consequence: at a bid node, UCB selects the **joint** arm — *including the opponent's bid
  component* — that maximizes the root player's value. **The opponent is modeled as a co-operator,
  not an adversary.**
- The module doc itself calls this "a deliberate simplification," scoped with the claim "fine at our
  branching factors" (lines 33–35).
- **C56's fix changed only final selection at the root** (253–287). Tree growth is unchanged, per its
  own comment (20–22) — which is why C56 could not have resolved this.

**V2 — Bid-Tac-Toe's structure makes that maximally punishing; Duel Draft's does not.**
Bid-Tac-Toe alternates simultaneous bid nodes with *sequential* place nodes (`engine.ts:245–248`).
The solve report's first-auction table (§1.1, RECOVERED) gives, at B=8: winning the first auction at
payment 0–2 → **+1**; payment 3 → **draw**; payment 4–8 → **−1**.

So the max-max fantasy at the root is exact and extreme: *"opponent bids 0, I bid 1, I win."* As
budget rises, UCB concentrates visits on cheap-win joint arms, the marginalized own-bid drifts toward
0–2, and the root value converges toward **+1 for both seats simultaneously on a proven-draw
position.** An own-bid's quality in an auction is *maximally sensitive* to the opponent's bid.

In Duel Draft's cell×cell space (all-simultaneous, no phases) the max-max own-component — "build my
best line while the opponent politely doesn't block" — nearly coincides with a decent greedy attack.
Which is exactly a policy that **rises against random with budget and draws 100% against a competent
defender** (D2 §1/§2, RECOVERED).

**One mechanism explains both engines' opposite symptoms.** That is the plan's central claim.

**V3 — Two candidate directions dismissed by reading, not argument.** `playerView` is identity
(`engine.ts:345–349`); rollouts use `uniformRandomMoveSelector` for both actors from one shared rng
(`search-utils.ts:232–262`) — no seat-leakage mechanism exists in code. Every rollout reaches a real
terminal at ~7.7 plies against a 200-ply cap, so `heuristic()` is never invoked by backprop
(RECOVERED: C56 and `bid-tac-toe-b3-report.md` lines 145/179).

**V4 — The yardstick exists but its API is private.** `solver/backward-induction.ts` exports only
`solveBudget(budget)`; `valueOf`, `bestBidPair` and the memo are module-private. B=8 solves in
**5.1 s over 1,370,166 memoized states** (RECOVERED, solve-report §1). The independent brute-force
oracle exports only `solveBudgetBruteForce` (B≤3).

---

## 1. Ranked hypotheses, by discriminating power per unit cost

**H1 — The search is solving the wrong game, more accurately, as budget rises.** (Max-max /
optimistic-opponent value convention at simultaneous nodes; V1+V2.) Distinctive predictions:
(a) both seats' `rootValue` → **+1** at the initial state; (b) chosen root bid drifts *down* into the
0–2 cheap-win region, away from the exact draw price of 3; (c) root joint-visit mass concentrates in
opponent-bids-0 columns. **Refuted or confirmed by E-A alone, in minutes.**

**H2 — Budget adequacy / close-candidate noise** (C58's own residual explanation). Predicts the
*opposite* of H1 on the same run: agreement improves with budget, `rootValue` → 0. **E-A settles one
of H1/H2 for free — which is why it runs first.**

**H3 — `aggregateByOwnMove` mishandles the bid space's star split.** Verified: grouping is by
`stableStringify` of the full move (120–135), so for the star holder every amount *k* exists as two
groups (`{amount:k}` and `{amount:k, star:true}`), splitting its marginal visit mass; the
non-holder's amounts are never split. Duel Draft has no analogue — a real structural difference
between the engines. But it cannot alone explain decline-with-budget: the split is budget-independent
and UCB resolves near-ties *better* with more budget. **Checked as one extra column in E-A, at ~zero
marginal cost:** report marginals grouped both ways and whether the argmax differs.

**H4 — View-honesty / seat leakage — dismissed** (V3). Also directionally wrong: a leak would help
with more budget, not hurt.

**H5 — Pure-vs-mixed equilibrium interaction — dismissed as a primary axis.** Purity means a
deterministic search *could* play optimally here, so purity is not protective and mixedness is not
what saved Duel Draft — its §7.3 collision gate clearing at 10–38% shows those bots mix enough
(RECOVERED, D2 §4). The discriminating structural variable is best-response *sensitivity*, which H1
already carries.

**H6 — Heuristic / value-backup miscalibration at horizon — dismissed** (V3: never invoked in this
regime; measured, not argued).

---

## 2. The exact-solve comparison (the experiment that settles it)

**Prerequisite, at fix time:** export an oracle API from `backward-induction.ts` —
`createExactOracle(budget)` returning `exactValue(state)` and `optimalBids(state, seat)` (maximin
rows for seat 0, minimax cols for seat 1), reusing the existing private `valueOf`/`bestBidPair`
machinery and shared memo. Cross-check against `solveBudgetBruteForce` at B≤3 and against the
published canonical line — the same trust structure the solve itself used. **This is an export, not
a behavior change**; nothing shipped calls the solver.

**E-A — root agreement curve (run first).** Script `games/bid-tac-toe/_c57-oracle-agreement.mts`,
following `_c36-diagnostic.mts`'s pattern. At the real initial state (B=8, star=1), for budgets
{1k, 2k, 5k, 10k, 20k} × both seats × 20 seeds — **seeds vary, budget never enters the seed string**
(C22/C24 rule, RECOVERED from `_b3-sweep.mts`) — record per run: chosen `(amount, star)`,
`rootValue`, the full marginal table from `rootVisits`, and the root joint-visit heat-map over
opponent-bid columns conditional on own bid.

Pre-registered interpretation table:

| observation | verdict |
|---|---|
| agreement flat/declining, `rootValue` → +1 both seats, visits pile on opponent-bids-0 | **H1 confirmed** — solving the wrong game more accurately; escalate as a plan-assumption defect ("fine at our branching factors", mcts.ts:35) |
| agreement rising, `rootValue` → 0 | H1 refuted; H2 stands; the C55 decline needs a new hypothesis |
| star-combined vs star-split argmax differ materially | H3 promoted to co-cause; reported separately |

**E-B — trajectory audit (only if E-A confirms).** Self-play, ruthless tier, budgets {2k, 10k},
n=50 games each; at every bid decision log membership of each seat's chosen bid in `optimalBids`,
and the `exactValue` trajectory. On a proven draw it starts at 0, so **the first departure from 0
names the losing decision and the seat that made it** — something no prior investigation in this
project could do.

---

## 3. Falsifiable definition of "fixed", written before any fix exists

1. Root oracle agreement **monotone non-decreasing** over {1k, 2k, 5k, 10k}, and **≥90%
   set-membership at 10k** (PROPOSED).
2. Both seats' `rootValue` at the initial state within **±0.15 of 0** at 10k (PROPOSED) — the search
   stops believing it wins a proven draw.
3. `strong-vs-random` non-declining across {1k, 2k, 5k, 10k}: no adjacent-budget drop >2 pts under
   the **paired** error model (RECOVERED from D2 §1's methodological note).
4. Regression guards: fadeout / nine-grids / tilt fixed-seed replays **byte-identical**; and Duel
   Draft's §7.1 monotone curve and §7.3 collision <50% still hold — **the healthy control must stay
   healthy.**

Explicitly **not** part of fixed: any change to `solved-value-reached`'s 90% floor or the
`unattained` design (C59), and any draw-rate target for self-play attainment. **If a fix reaches
green only by moving a threshold, that is a finding to escalate, not a design.**

---

## 4. Cost, and what will NOT be done

- One-time exact solve: **5.1 s / 1.37M states** (RECOVERED). Oracle lookups thereafter ≈ free.
- E-A: ≈1.5M rollouts of ≤18-ply games — same order as **one** cell of the C55 sweep.
  **5–20 min** (PROPOSED).
- E-B: ≈2.5M rollouts + one solve. **30–60 min** (PROPOSED).
- Everything is `pnpm tsx`-local. **Nothing depends on CI or nightly** (C68: CI stale 8 days,
  nightly has never run).

Not doing, and why:

- **No fix before E-A.** Decoupled UCT/DUCT, regret matching and per-seat value backup are all
  plausible remedies — mcts.ts's own doc defers DUCT — but each is platform surgery against a
  byte-identical guarantee. C29→C34 is what mechanism-first exists to prevent.
- **No tuning** of `explorationC`, budgets, or any gate threshold (C55's ruling: this goes to the bug
  lane).
- **No further multi-budget gate sweeps as diagnosis** — the decline curve is measured three times
  already; re-measuring discriminates nothing.
- **No Duel Draft revival.** Its committed D2 numbers are the control; that is the whole value of
  C66 keeping the engine.

---

## 5. The single experiment, if only one

**E-A.** One script, minutes of runtime, and the only measurement that separates "solving the wrong
game more accurately" (H1) from "bug/noise" (H2) in a single run — because its smoking gun, *both
seats' search value converging to +1 on a position exactly proven to be a draw*, cannot be produced
by any adequacy problem, and its absence refutes H1 just as cleanly.

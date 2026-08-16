# Bid-Tac-Toe post-fix budget sweep (B3v2) — pre-registered design

*Authored 2026-08-16 (Fable planning pass, read-only). Created by platform-corrections.md C94.
Everything in §6–§8 is pre-registered: written before any sweep datum exists. No threshold in
this document may move after the first cell runs (C55). Raw outputs preserved under
`docs/research/games/` (C67/C72).*

**Provenance note (load-bearing):** Bid-Tac-Toe is not on main. The game, the C92-winning
search configuration (`MctsOptions.leafEvaluation`, DUCT default at simultaneous nodes, the
C85-fixed heuristic), and the reports cited below live on `feature/duct-leaf-eval`
(worktree `../claude-project-cell4`, rebased on main). All execution happens
there, after a fresh rebase-on-main check (CLAUDE.md §4 — C94's own near-miss was a 78-commit-
stale worktree).

---

## 0. The question, stated as the platform's own doctrine

The gate table needs a rollout budget; the manifest refuses one until a post-fix sweep chooses
it. But "which budget passes the gates" is not a permissible selection rule — a budget chosen
to pass the gate table makes the gate verdict circular and worthless as ship evidence.

The resolution is a distinction the gate machinery already draws. The two-player gates split
into:

- **Instrument-adequacy gates** — do the bots play well enough that measuring them measures
  the game? For a game with a proven `solvedValue`, the platform's standing definition is
  `solved-value-reached` (C23/C55: self-play attains the proven value,
  `SOLVED_VALUE_SELF_PLAY_FLOOR = 0.90`), plus `strong-vs-random` (the bot can punish
  non-optimal play at all). These floors were registered weeks before this sweep and do not
  move.
- **Game-verdict gates** — FPA band, draw-rate ceiling, ruthless-vs-standard, the bidding
  degeneracy probes (zero-bot/sniper < 45% vs Strong), mean-plies. These describe the *game*,
  conditional on the instrument being adequate.

**The budget is selected exclusively on instrument-adequacy metrics. The ship verdict is then
rendered exclusively on the remaining, unconsumed gates, at an out-of-sample seed.** The two
selection-consumed rows appear in the final gate report annotated as premises, never cited as
ship evidence. A budget chosen this way is a calibrated operating point for an instrument, not
a number tuned until the game looks good — and "no budget qualifies" is a fully expected
outcome (§9): attainment has never measured above 16.7% in any configuration, and three games
have already been killed in this project.

## 1. Corrections to the commissioning brief (verified this session)

1. `tierPolicy` (`packages/bots/src/tiers.ts:85`) never passes `leafEvaluation`; `PolicySpec`
   has no arm for it. A sweep run through `compareBudgets` today measures DUCT + **rollout**
   evaluation — the configuration C90's control proved is still broken. Prerequisite P1 (§2)
   exists because of this. Without it, every number the sweep produced would describe the
   wrong search — the exact C94 error, one level down.
2. `TierBudgetCollapseError` refuses any CI budget ≤ standard's 1,500, and C90's healthiest
   measured budget is 1,000. The sweep uses a documented manifest clone (§3) — the guard
   protects `ruthless-vs-standard`, which is `n/a` under the override anyway (C26).
3. Setting `twoPlayerCiRollouts` cannot alone produce a coherent verdict: **nightly ignores
   the override** and runs ruthless at the shipped 10,000, where every measurement predicts
   permanent `solved-value-reached` failure. The genuine decision object is the shipped
   ruthless budget; if it lands ≤ 3,000, `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE` makes the CI
   field unnecessary and it correctly stays unset (§10).
4. C90's agreement collapse is 1.000→0.000 **seat 0**; seat 1 is 1.000→0.480. And C92's raw
   output shows the candidate **losing 22% of games to legacy at 1,000 rollouts** — the budget
   where root agreement is perfect. Root agreement is a ply-1 metric; full-game optimality is
   unmeasured. §6's metric choice is built on this gap.
5. C92's head-to-head seeds embed the budget (`...-b1000-...`) — a C24 confound for its
   cross-budget comparison. The confirmation h2h here (§7 stage B) removes the budget from
   the seed string.

## 2. Prerequisites (blocking, in order)

- **P0 — machine.** Do not start while mine-run's discharge job runs (C94's stated priority:
  a shipped game failing gates outranks an unshipped game's evidence). Verify by reading
  process state, not by recalling having launched something (C88/C94).
- **P1 — DISCHARGED 2026-08-16, commit `e4b7a0f` on `feature/duct-leaf-eval`.** `PolicySpec`'s
  mcts arm now carries `leafEvaluation?: boolean`, `buildPolicy` forwards it via an independent
  conditional spread (absent stays absent), and Bid-Tac-Toe's three mcts tiers set it true.
  Verified by planting the violation rather than by reading the code: removing the forwarding
  line fails exactly two tests — `rolloutToHorizon` called 25 times when it should be zero, and
  the tier-path move `{cell:2}` diverging from a direct `mctsPolicy({leafEvaluation:true})`
  `{cell:4}` on an identical seed — and restoring it returns 3/3 green with a byte-clean tree.
  That divergence is the direct demonstration of C95's claim: before this change the tier path
  ran a different algorithm than the one C92 measured. The shipped-game byte-identity check was
  deliberately NOT treated as evidence here (C95: it is the check that passed while the feature
  was broken); it is a regression guard only. Original text follows.
- ~~**P1 — wire `leafEvaluation` through the tier path.**~~ Schema change, orchestrator-routed:
  `PolicySpec` gains `leafEvaluation?: boolean` (default absent = current behaviour,
  byte-identical for every shipped game — none sets it); `tierPolicy` forwards it;
  Bid-Tac-Toe's manifest sets it on all three tiers. Verification: (a) unit test that
  `tierPolicy` forwards the flag; (b) one fixed-seed `runMatchup` through the tier path
  reproduces byte-identically a script-level `mctsPolicy({leafEvaluation: true})` run —
  the planted-check discipline, not a code reading.
- **P2 — rebase check.** `feature/duct-leaf-eval` freshly rebased on main; `check:deps` and
  `check:tsconfig-coverage` present and green (C94's cheap staleness tell).
- **P3 — instrument audit.** Confirm by reading (then by one smoke cell) that `compareBudgets`
  forwards `seedCount` (C80 finding 4 closed it — verified present at `suites.ts:1154`) and
  that per-seed seeds derive as `${seed}:seed${i}` with the budget nowhere in the string.

## 3. The instrument

`compareBudgets(bidTacToe, SWEEP_MANIFEST, LADDER, { seed, games: 300, seedCount: 10 })` —
C24's canonical helper; one seed, the swept variable structurally excluded.

`SWEEP_MANIFEST` = in-memory clone of the real manifest with two documented deviations:
1. every tier gets `leafEvaluation: true` (P1 — the configuration under test);
2. standard's budget lowered to 300 for the sweep only, so candidates below 1,500 do not trip
   `TierBudgetCollapseError`. Effect audit: under the override, standard's budget feeds only
   the `ruthless-vs-standard` matchup, whose gate is `n/a` (C26) — no selected-on quantity
   changes. This deviation is printed in the sweep header so the output self-describes.

**Seed construction (C22/C24, exact):** base seed literal `b3v2-postfix-sweep` — a constant,
containing no budget, no seed count, no config flag. The harness derives per-seed strings
`b3v2-postfix-sweep:seed0 … :seed9` and per-game `…:seed{k}:{i}`; identical across every
candidate, so **every budget plays the identical 300-game set**. The output's header echoes
the derived seed strings (the E-A instrument's own self-check pattern) so a reviewer can
confirm no swept variable leaked into them.

## 4. The ladder, and why B3's is not reused

B3's ladder (1,600–10,000) was shaped by a constraint (stay above standard's 1,500) that
postdates nothing but predates the finding that matters: under the fixed search, C90 puts the
healthy region at **≤ ~1,000–2,000** (root agreement 1.000 at 1k, seat 0 already 0.140 at 2k,
0.000 at 5k). B3's ladder covers almost none of it. C92 measured only the endpoints
{1k, 10k}. Neither is a substitute for a curve.

**Ladder (10 candidates, fixed now, no extensions):**

```
800   1,000   1,200   1,400   1,600   2,000   2,500   3,000   5,000   10,000
```

- 800–2,000 (six points): dense coverage of the predicted healthy region and of the
  1k→2k boundary where C90's collapse begins.
- 2,500, 3,000: the upper edge of the no-override zone (`MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE`).
- 5,000, 10,000: prediction-scoring anchors (§8) and the shipped-ruthless documentation cell —
  expected to fail, and their failing is itself evidence (it is what forces the tier decision
  in §10). 1,600, 2,000, 3,000, 5,000, 10,000 also overlap B3/C74's ladders for a cross-era
  descriptive comparison (different seeds and search — comparability is qualitative only, and
  the report must say so).
- **No refinement rounds.** A ladder extended until something passes is multiple-comparisons
  tuning. One sweep, ten candidates, then the decision rule — that is the whole budget space
  this game gets.

## 5. Seeds and statistics (C71/C80 discipline)

**K = 10 seeds × 30 games/seed = 300 games per matchup per candidate.**

- Cross-seed SD across the 10 per-seed rates, Bessel-corrected (ddof = 1); SE = sd/√10;
  provisional multiplier `t(0.95, df = 9) = 1.833`; binomial floor
  `sqrt(mean·(1−mean)/300)` under the SE (C80 finding 1). Never a pooled binomial over 300.
- What K = 10 buys over the ci-default K = 5: t-multiplier 1.833 vs 2.132 (~14% narrower
  flagging window) and a less fragile SD estimate; 10 divides 300 exactly (C80's
  divisibility guard). K = 11+ (z fallback) buys ~2% more — not worth the granularity loss.
- Resolution at the floor: binomial-floor SE at p = 0.90 is 1.73pp, so the best-case
  non-provisional margin is ±3.2pp; if cross-seed dispersion runs 2.6× the floor (C71's
  measured Tilt anchor), ±8pp. Consequence, stated so nobody is surprised: qualification
  effectively requires observed attainment ≈ 93–96%+. That is intended — a budget whose
  adequacy the data cannot resolve from the floor is not an operating point, it is a coin
  flip (C71's whole finding).

## 6. Selection metrics — and why attainment, not win rate, not agreement

Candidates considered, against the anti-correlation on record (C90 agreement falling while
C92 head-to-head rises):

- **Head-to-head win rate vs `mctsPolicyLegacy` — rejected as a selection metric.** It
  measures exploitation of one specific, known-flawed, never-again-shipping opponent (C92's
  own caveat). Selecting on it optimizes against a ghost, and per the brief's hypothesis it
  may be anti-correlated with playing the game well. It returns as a *disqualification guard*
  (stage B), where its direction is unambiguous — see below.
- **Root oracle agreement — rejected.** A component metric at ply 1 of a ~9-auction game
  (C90's own ruling: "a configuration with 1.000 agreement at 1k has not been shown to win a
  single game" — and C92's raw data shows that same configuration losing 22% to legacy).
  Measured across the ladder anyway as a cheap descriptive covariate (~30s), never selected on.
- **`solved-value-reached` (self-play attainment of the proven draw) — PRIMARY.** It is the
  full-game, system-level test of the thing the game proof makes testable: two identical bots
  at budget B hold the drawing line through every auction. It is the platform's standing
  definition of instrument adequacy for a solved game (C23/C55), with a floor (90%)
  registered long before this sweep — it cannot be accused of being invented to pass. It is
  the metric that failed at 0% at every pre-fix budget, so it is the one whose recovery would
  demonstrate the fix where it matters. And it is exploitation-neutral: it neither rewards
  nor punishes deviation-to-exploit, because in self-play your opponent is exactly as flawed
  as you are.
- **`strong-vs-random` — CO-PRIMARY guard.** Attainment alone admits a degenerate passer: a
  passive bot pair that drifts into draws without being able to punish anything. A bot that
  cannot beat a random player ≥ 90% of the time is not securing draws, it is failing to play.
  This is the guard for the exploitation axis *inside* the selection, against an opponent
  that is flawed by construction rather than by historical accident.

**On the brief's hypothesis** (maximin-vs-exploitation): it is coherent but unproven, and the
1k loss data punches a hole in its clean form — the "maximin" pole as measured is not actually
maximin (it loses 22% to a worse bot). The design therefore refuses to pick a side by metric
choice alone: attainment selects for playing the game; the stage-B **loss-rate** guard
(losses vs legacy — a quantity a genuinely value-securing bot drives to zero regardless of
style) filters a false-positive attainer whose draws are brittle and opponent-specific. Wins
vs legacy are never required and never counted toward selection — only losses disqualify.

### The decision rule (pre-registered, mechanically executable)

**Stage A — sweep.** A candidate budget QUALIFIES iff, in the sweep output at that budget,
both of these rows have `status: "pass"` **with no `provisional` flag** (both computed by the
harness itself — zero human judgment):
1. `solved-value-reached` (floor 0.90), and
2. `strong-vs-random` (floor 0.90).

**Stage B — confirmation head-to-head, run at EVERY stage-A qualifier** (fixed test set, no
sequential walking): candidate (tier path, `leafEvaluation: true`) vs `mctsPolicyLegacy`,
n = 200 × 2 seeds, mirrored seats, seeds `b3v2-h2h-seed0/1` (budget NOT in the string —
fixing C92's instrument). A qualifier SURVIVES iff, pooled across both seeds:
- losses ≤ 10% of games (an attaining bot of a proven-draw game should almost never lose —
  C92 measured 22% at 1k and 13.3% at 10k, so this bar is live and currently unmet by both
  measured endpoints), AND
- W ≥ L within each seed (C71 — never a single-seed claim).

**Selection: the SMALLEST budget that qualifies in stage A and survives stage B.** Smallest,
because CI cost scales linearly, the healthy region sits at the low end of the ladder, and a
fixed tie-break forecloses post-hoc shopping. If no budget qualifies and survives, **no
budget is chosen — see §9. There is no discretionary rescue step.**

Explicitly NOT consulted for selection, ever: FPA, draw-rate, ruthless-vs-standard,
mean-plies, probe results, head-to-head *wins*, root agreement, or the count of passing gate
rows.

## 7. Pre-registered predictions (scored after the sweep, C74-style — as written, not revised)

Model under test M1, from C90 + C92: *the fixed search is correct at low budget and destroys
its own correctness as budget grows; root agreement at 1k partially but incompletely
transfers to full games.*

| # | Prediction | Scored against |
|---|---|---|
| P1 | Attainment at 1,000 ≥ 60%, and is the ladder maximum | sweep row, budget 1,000 |
| P2 | Attainment non-increasing for B ≥ 2,000; ≤ 20% at 5,000; ≤ 5% at 10,000 | sweep rows |
| P3 | `strong-vs-random` ≥ 90% at every B ≤ 3,000 | sweep rows |
| P4 | FPA within [35, 65] wherever attainment ≥ 60%; > 65% at 10,000 (C74 saw 73.3%) | sweep rows |
| P5 | At any selected budget, h2h loss rate < 13.3% (the 10k measurement) — i.e., choosing on optimality does not cost robustness vs the exploitation-favoured budget | stage B |
| P6 | If nothing qualifies, the failure shape is a sub-floor plateau (peak attainment 40–80% at the low end), not a 0% flatline | sweep rows |

P1 deliberately does not claim the 90% floor is crossed: root agreement 1.000 concerns one
decision of ~9, and C92's 22% loss rate at 1k warns against assuming ply-1 perfection
compounds. If P1 fails low (attainment < 40% at 1,000 despite 1.000 root agreement), that is
itself a scored finding: root agreement does not predict play quality, and every C90-derived
expectation needs re-examination. If attainment is HIGH but stage B still fails on losses,
the brief's brittleness worry is confirmed and gets recorded with the data.

## 8. Cost (from measured anchors, not guesses)

Anchors, same board and machine class (`c90-duct-leaf-vs-legacy-head-to-head.out`): 200 games
at 1k rollouts/decision ≈ 25s (0.125 s/game); at 10k ≈ 167s (0.83 s/game) — near-linear in
budget. E-A instrument: 4 budgets × 50 seeds × 2 seats in 29.5s.

Per candidate: 3 matchups run (`runSeedMatchups` — strong-vs-random ~half cost,
self-play full, ruthless-vs-standard cheap with sweep-clone standard at 300) ≈ 2× self-play
≈ `2 × 300 games × 0.125s × B/1000` = 75s per 1,000 rollouts.

- Sweep, full ladder (ΣB = 28,500 rollout-thousands): ≈ 36 min.
- Root-agreement covariate across the ladder: ≈ 1 min.
- Stage B at up to ~4 qualifiers (≤ 3,000 rollouts each): ≈ 3–10 min total.
- Final gate table + probes at the selected budget: ≈ 10–15 min.

**Total ≈ 1 hour, ×2 safety margin ≈ 2 hours.** Affordable as designed; no subset needed.
First action of the run: execute the 1,000-rollout cell alone and check its wall-clock
against this model (C25 — a cost measured on another configuration is a hypothesis, not a
fact). If the pilot cell runs > 3× the model, stop and re-plan the ladder before burning the
rest; the pre-registered fallback subset is {1,000, 1,400, 2,000, 3,000, 10,000} at the same
seeds/games (loses boundary resolution between 1k–1.4k and the 5k anchor; keeps the decision
rule intact).

## 9. Outcomes, including the one where the game dies

- **A budget qualifies and survives:** proceed to §10.
- **No budget qualifies (stage A empty), or no qualifier survives stage B:**
  `twoPlayerCiRollouts` stays unset, **no gate table is run** (a table at an arbitrary budget
  is the exact error B3 refused), and the recommendation to the user is **KILL**: after the
  search fix, no affordable budget lets the platform's only simultaneous-capable search play
  this game's proven value reliably (and/or its draws are brittle against a weaker opponent).
  Written up as `bid-tac-toe-b3v2-report.md` with the scored predictions; manifest comment
  updated to record that the C94 trigger fired and the answer was negative; game stays
  unregistered. The kill is quantitative: state the peak attainment cell, its CI, and the
  stage-B numbers. Reopening condition, named now: a new search/evaluation change that first
  clears `rollout-evaluation.md` §3's acceptance (oracle agreement + honesty + head-to-head)
  may re-run THIS sweep unchanged — same seeds, same ladder, same rule.
- **Partial pathologies** (e.g., qualifiers exist but only below 1,500 and tier re-spacing is
  refused; or stage B fails on the loss guard specifically): escalate to the orchestrator
  with the data — these are decisions about the game's fate, not about the sweep.

## 10. After selection — making the verdict coherent

1. **Tier coherence (routed to the B5 lane, but decided by this evidence).** Ruthless
   currently ships 10,000 — a budget this sweep is predicted to show never draws in self-play.
   Nightly gates run at shipped budgets, so leaving ruthless at 10,000 fails
   `solved-value-reached` at nightly forever regardless of the CI field. Proposal: ruthless
   budget := selected budget; standard and casual re-spaced below it (tier ordering verified
   at the design/nightly gates afterwards — never tuned against the gate table). Blunder
   params untouched.
2. **The field.** If the (re-tiered) ruthless budget ≤ 3,000: `twoPlayerCiRollouts` stays
   unset — correctly, per `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE` — and the manifest comment is
   rewritten to say the sweep ran, what it chose, and why the field is unnecessary (a
   deliberate absence must say so; C22). Only if ruthless legitimately ships > 3,000 does the
   field get set, to the selected budget.
3. **The gate table, once, out-of-sample.** `pnpm harness:ci-gates -- --game bid-tac-toe` on
   the production seed path (`ci:bid-tac-toe:ci`, K = 5) — a seed lineage disjoint from the
   sweep's by construction, so the verdict is not an in-sample replay of the selection. Plus
   the bidding degeneracy probes (zero-bot, sniper, all-in, constant-k vs Strong at the same
   budget; kill threshold 45% per the game plan §7/§8 — a probe kill overrides everything).
4. **Reading the verdict.** `solved-value-reached` and `strong-vs-random` rows are annotated
   *selection-consumed: confirmatory only* — they are premises of the budget choice, not ship
   evidence. If either FAILS on the production seed, that is a C49/C71 replication event
   (seed sensitivity): investigate, replicate on fresh seeds, and treat "the selection
   overfit its seed set" as a live hypothesis — do not re-sweep, do not move anything. The
   ship case rests on: probes clean, mean-plies/cap clean, FPA/draw-rate rows (or their
   now-legitimate relief), tier ordering at design/nightly, plus the stage-B h2h — and is the
   user's call, not this plan's.

## 11. Execution checklist

1. P0–P3 (§2): machine idle → schema change + planted verification → rebase check →
   instrument audit.
2. Pilot cell at 1,000; check cost model (§8).
3. Full sweep (§3–§5); preserve `.out`.
4. Root-agreement covariate across ladder (descriptive).
5. Apply stage A mechanically; run stage B at all qualifiers; apply selection.
6. §9 or §10 as the data dictates; scored-prediction table in the report either way.
7. Report: `docs/research/games/bid-tac-toe-b3v2-report.md`; manifest comment updated;
   corrections entry if any prediction fails in an instructive direction.

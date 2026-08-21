# Bid-Tac-Toe B3v2 post-fix budget sweep — final report

**Verdict: no budget qualifies. Recommendation per pre-registered §9: KILL.**

*Written 2026-08-21, executing `docs/plans/bid-tac-toe-budget-sweep.md` §11 step 7. The design
document was pre-registered 2026-08-16, before any sweep datum existed; no threshold, ladder
point, or seed in it moved afterward (C55). Summary correction entries: platform-corrections.md
C97, as corrected by C99. This report is the full write-up.*

**Raw data (primary sources, preserved per C67/C72, worktree `../claude-project-cell4` on
`feature/duct-leaf-eval`):**
- `docs/research/games/bid-tac-toe-b3v2-sweep.out` — the full sweep (this report's primary source)
- `.scratch/b3v2-pilot-1000.out` — the §8 cost-model pilot
- `docs/research/games/c90-duct-leaf-vs-legacy-head-to-head.out` — C92 head-to-head (comparison)
- `docs/research/games/bid-tac-toe-c89-duct-leaf-ea.out` — C90 root-agreement factorial cell (comparison)

**Configuration under test (the only one tested — see §6):** DUCT selection at simultaneous
nodes + leaf evaluation (`MctsOptions.leafEvaluation: true`, reachable through the tier path
since commit `e4b7a0f`, prerequisite P1) + the C85-corrected heuristic, on the platform's one
MCTS engine.

---

## 1. Result

`solved-value-reached` (self-play attainment of the proven draw; floor 90%, registered weeks
before this sweep) and `strong-vs-random` (floor 90%), 10 seeds × 30 games = 300 games per
cell, identical game set at every budget:

| rollouts | attainment | seed SD (pp) | SE (pp) | 95% CI (t=1.833) | strong-vs-random | Stage A |
|---:|---:|---:|---:|:---:|---:|:---:|
| 800 | 14.7% | 12.5 | 4.0 | [7.4, 22.0] | 95.3% | no |
| 1,000 | 21.3% | 14.3 | 4.5 | [13.1, 29.5] | 97.7% | no |
| 1,200 | 23.3% | 11.0 | 3.5 | [16.9, 29.7] | 98.3% | no |
| 1,400 | 34.7% | 10.8 | 3.4 | [28.5, 40.9] | 98.7% | no |
| 1,600 | **36.0%** | 8.4 | 2.8 | [30.9, **41.1**] | 99.3% | no |
| 2,000 | 28.7% | 13.0 | 4.1 | [21.2, 36.2] | 99.3% | no |
| 2,500 | 24.0% | 15.1 | 4.8 | [15.2, 32.8] | 100.0% | no |
| 3,000 | 27.3% | 15.2 | 4.8 | [18.5, 36.1] | 99.3% | no |
| 5,000 | 32.0% | 10.3 | 3.3 | [26.0, 38.0] | 100.0% | no |
| 10,000 | 28.7% | 10.0 | 3.2 | [22.8, 34.6] | 100.0% | no |

**Stage A qualifiers: NONE.** The best cell (1,600 rollouts, 36.0%) misses the floor by 54.0
points; the most optimistic CI edge on the whole ladder (41.1%) misses it by 48.9 points.
Reaching the floor from the peak would require a 19.3-SE move. Stage B (the confirmation
head-to-head) is defined to run only at Stage A qualifiers and was therefore never run; there
are no Stage B numbers, and per §6 there is no discretionary rescue step.

`strong-vs-random` passes at every budget (95.3%–100.0%, rising with budget), so this is not
a degenerate or broken bot pair: the search punishes random play essentially perfectly. It
cannot hold the drawing line of a game that is a proven exact draw. Descriptively, mean plies
ran 12.1–13.3 with zero horizon-cap hits at every cell — the games are completing normally.

## 2. Methods — why the instrument is trusted

- **Seeds.** Base seed literal `b3v2-postfix-sweep`; the harness derives
  `b3v2-postfix-sweep:seed0 … :seed9`, echoed in the output header with the budget
  structurally absent from every string. Every candidate budget therefore played the
  identical 300-game set. This closes the confound C95 found in C92's cross-budget
  comparison, whose seeds embedded the budget (`...-b1000-...`), and discharges
  prerequisite P3.
- **Statistics (C71/C80 discipline).** K=10 seeds × 30 games; the per-cell SD is the
  cross-seed SD, Bessel-corrected (ddof=1); SE = SD/√10, with the binomial floor
  √(p(1−p)/300) taken as a lower bound on the SE; CIs use t(0.95, df=9) = 1.833. Never a
  pooled binomial over 300. The floor demonstrably engaged where designed: at 1,600 the
  cross-seed SE (2.66pp) fell below the binomial floor (2.77pp) and the reported SE is the
  floored 2.8pp. Cross-seed dispersion dominated everywhere else.
- **Provisional flags.** No selection-relevant row (`solved-value-reached`,
  `strong-vs-random`) carried a provisional flag at any budget. (Two *descriptive*
  first-player-advantage rows, at 1,200 and 1,600, were provisional; they were never
  consulted for selection.)
- **Manifest deviations (two, documented in the output header, per §3):**
  (1) `leafEvaluation: true` on every tier — the configuration under test, already true
  upstream at commit `e4b7a0f` and set defensively in the clone; (2) standard's budget
  lowered 1,500 → 300 to avoid `TierBudgetCollapseError`. Deviation (2) cannot affect any
  selected-on quantity: under the CI override, standard's budget feeds only the
  `ruthless-vs-standard` matchup, whose gate is `n/a` for this run (C26) — the output
  confirms it reported `n/a` at every cell. Neither `solved-value-reached` (self-play at the
  candidate budget) nor `strong-vs-random` reads standard's budget at all.
- **Determinism / pilot check.** The §8-mandated pilot ran the 1,000 cell alone first
  (`.scratch/b3v2-pilot-1000.out`): 58.8s wall clock against a ~75s model — under the 3×
  re-plan tripwire — and its every statistic (21.3%, SD 14.3pp, SE 4.5pp; 97.7%; 54.0%;
  12.5 plies) reproduced identically in the full sweep, a direct check that the instrument
  is deterministic in its seeds. Full-sweep wall clock 1,918.1s, within the §8 cost model.

## 3. The headline finding: budget buys one step, then nothing

The pre-registered model M1 (from C90 + C92) said the fixed search is *correct at low budget
and destroys its own correctness as budget grows*. The data refute the model in both
directions, and the shape of the refutation is the finding.

**The arithmetic, done rather than asserted.** A heterogeneity test across all ten cells
(Σ((xᵢ−x̄)/SEᵢ)², x̄ = 27.1%) gives χ² ≈ 30.6 on 9 df, p ≈ 4×10⁻⁴: the curve is not pure
noise. But the structure is entirely at the low end:

- **The rise from 800 to the 1,400–1,600 region is real.** 800 vs 1,600: Δ = 21.3pp,
  SE_Δ = √(4.0² + 2.8²) = 4.9pp, t ≈ 4.4. 800 vs 1,400: t ≈ 3.8. The 1,600 peak *is*
  statistically separable from the 800 trough.
- **From 1,400 to 10,000 — a 7.1× budget range — the curve is statistically flat.**
  Heterogeneity across those seven cells: χ² ≈ 8.7 on 6 df, p ≈ 0.19; the data are
  consistent with a single flat mean of ~30%. The apparent 1,600 peak is not separable from
  any other plateau cell: vs 10,000 t ≈ 1.7, vs 2,000 t ≈ 1.5; the largest plateau contrast
  (1,600 vs 2,500, t ≈ 2.16, unadjusted) is one of 21 pairwise comparisons in the plateau
  and is exactly what one expected false positive looks like. "1,600 is the best budget" is
  not a supported claim; "nothing above 1,400 does anything" is.
- **Neither of M1's regimes exists.** There is no healthy region — the resolvable low-end
  rise tops out at roughly a third of the floor — and there is no high-budget collapse:
  10,000 rollouts (28.7%) is statistically indistinguishable from the peak. C90's
  agreement collapse simply does not appear in full-game attainment.

**The null is not instrument insensitivity.** The same 300-game sets detect enormous
budget-driven effects in other metrics: descriptive first-player advantage swings from 54.0%
at 1,000 to 18.0% at 2,000 (t ≈ 5.6) and back to 46.7% at 5,000 (t ≈ 5.6), and
strong-vs-random climbs from 95.3% to 100.0%. Budget visibly changes *how* the game is
played. It does not move the one thing that was selected on: the frequency with which two
identical bots hold a proven draw. Between 800 and 10,000 rollouts — 12.5× — that quantity
never leaves [14.7%, 36.0%].

## 4. Scored predictions (§7, as written, not revised)

| # | Prediction (pre-registered) | Observed | Score |
|---|---|---|---|
| P1 | Attainment at 1,000 ≥ 60%, and 1,000 is the ladder maximum | 21.3% at 1,000; maximum is 1,600 (36.0%) | **FAILED, both clauses** |
| P2 | Attainment non-increasing for B ≥ 2,000; ≤ 20% at 5,000; ≤ 5% at 10,000 | 24.0% → 27.3% → 32.0% over 2,500–5,000 (not non-increasing, though within noise); 32.0% at 5,000; 28.7% at 10,000 | **FAILED** (both point anchors missed by 12.0pp and 23.7pp) |
| P3 | `strong-vs-random` ≥ 90% at every B ≤ 3,000 | 95.3%–100.0% across 800–3,000, all pass, none provisional | **MET** (holds at 5,000 and 10,000 too) |
| P4 | FPA ∈ [35, 65] wherever attainment ≥ 60%; FPA > 65% at 10,000 | First clause vacuous (no cell reached 60%); at 10,000 FPA = 54.0% | **FAILED** (the only testable clause) |
| P5 | At any selected budget, h2h loss rate < 13.3% | No budget was selected; Stage B never ran | **UNSCORABLE** (condition never obtained) |
| P6 | If nothing qualifies: sub-floor plateau, peak 40–80% at the low end, not a 0% flatline | A plateau, not a flatline — but peak 36.0% is below the predicted 40–80% band and sits mid-ladder, not at the low end | **PARTIALLY MET** |

Two notes the scoring obligates:

- **P1 failed below its own pre-committed tripwire.** §7 stated in advance: if attainment at
  1,000 lands under 40% *despite* 1.000 root oracle agreement, the mandated reading is that
  "root agreement does not predict play quality, and every C90-derived expectation needs
  re-examination." 21.3% is under 40%. That reading is now the ruling, not an option.
- **P4's failure has an unpredicted shape.** Nothing predicted the mid-ladder FPA collapse
  (18.0%/18.7%/18.7% at 2,000–3,000 — below the band's 35% floor, a second-player
  advantage) with recovery at 5,000–10,000. Descriptive only, never selected on, but it is
  a real budget-dependent regime change (t ≈ 5.6 on both edges) in a system whose primary
  metric shows none.

Scorecard: of the five scorable predictions, one met, one partially met, three failed. The
model those predictions came from is wrong.

## 5. Component metrics vs the system metric

Across this exact configuration and overlapping budget range, three measurements now exist:

| budget | root oracle agreement, seat 0 / seat 1 (C90, 50 seeds) | h2h win rate vs legacy (C92, n=400) | self-play attainment (this sweep, n=300) |
|---:|:---:|:---:|:---:|
| 1,000 | 1.000 / 1.000 | 58.8% | 21.3% |
| 2,000 | 0.140 / 0.980 | — | 28.7% |
| 5,000 | 0.000 / 0.340 | — | 32.0% |
| 10,000 | 0.000 / 0.480 | 86.8% | 28.7% |

(C92's cross-budget *trend* carries C95's caveat — its seeds embedded the budget, so its two
cells played different game sets — but both within-budget results replicated across two
independent seeds, and a 28pp gap is unlikely to be pure seed artifact.)

Two component metrics moved hard, in **opposite directions**, across a budget range where the
system-level metric is statistically flat. Root agreement collapsed 1.000 → 0.000 (seat 0);
head-to-head win rate climbed ~58.8% → ~86.8%; full-game attainment of the proven value did
nothing distinguishable from a constant ~30%.

The implication is not subtle: **neither component metric is a usable proxy for play quality
in this game, in either direction.** C95 had already located the mechanism for the agreement
half: root agreement is a ply-1 metric on a ~9-auction game, and at the very budget where
agreement was 1.000 on both seats, the candidate lost 22.0% of its games (88/400) to a
known-flawed opponent — a player actually on the maximin line of a proven draw loses zero.
This sweep supplies the head-to-head half: beating legacy 86.8% coexists with holding the
draw 28.7% of the time in self-play. Winning against one specific flawed opponent and
playing the game's proven value are simply different quantities, and the platform has now
measured them diverging maximally on the same configuration. The design's refusal (§6) to
select on either component metric is what kept this sweep's verdict interpretable; had the
budget been chosen on agreement (pick 1,000) or on head-to-head wins (pick 10,000), the
selection would have encoded a hypothesis the system-level data refute.

## 6. What is NOT established

Discipline about scope, because this report sits next to a deletion decision:

- **The game is not proven unplayable.** Bid-Tac-Toe at `STARTING_BUDGET=8` remains a proven
  exact draw with a verified oracle. A sufficiently strong player holds that draw 100% of
  the time. Nothing here measures the game's quality for humans, its depth, or its
  degeneracy — the game-verdict gates (FPA, draw-rate, bidding probes, mean-plies) were
  never run as a verdict, correctly, because §9 forbids a gate table at an arbitrary budget.
- **The search is not proven irreparable.** What is measured is exactly this: *one* search
  configuration — DUCT selection + leaf evaluation + the C85 heuristic, on the platform's
  single MCTS engine, at default exploration — holds the proven draw in self-play 14.7%–36.0%
  of the time at every budget from 800 to 10,000. The entire ladder varies one scalar. No
  alternative evaluation function, exploration constant, selection rule beyond the C89/C90
  factorial, or engine was swept, and the factorial itself was measured only at ply-1
  agreement, not attainment.
- **Where the draw is lost is unknown.** Self-play attainment aggregates over seats, over
  bid decisions and placement decisions, and over all ~9 auctions. Which ply, which seat,
  and which decision type surrender the draw was not instrumented.
- **Cross-era comparability is qualitative only.** The B3-era sweep (attainment 0%
  everywhere) used different seeds and a broken search; "the fix moved attainment from 0% to
  ~30%" is a fair qualitative statement and nothing more precise.

What IS established, precisely: after the search fix, at every affordable budget, the
platform's only simultaneous-move-capable search cannot come within 48.9 points (best CI
edge) of the pre-registered adequacy floor for measuring this game — while passing every
check that it is otherwise functioning (strong-vs-random 95.3–100%, zero cap hits, normal
game lengths).

## 7. Recommendation

**KILL**, per §9 as pre-registered, mechanically:

- Stage A qualifiers: none of 10 candidates. Stage B: never reached (defined only at Stage A
  qualifiers). Peak cell: **1,600 rollouts, 36.0% attainment, SE 2.8pp, 95% CI
  [30.9%, 41.1%]** against a 90% floor — a 54.0-point shortfall, 19.3 SEs from the floor,
  and not statistically distinguishable from six other cells spanning 1,400–10,000.
- `twoPlayerCiRollouts` stays unset; **no gate table is run** — a table at an arbitrary
  budget is the exact error B3 refused; the game stays unregistered. The manifest comment
  should record that the C94 trigger ("revisit once the search defect is fixed") fired, the
  post-fix sweep ran, and the answer was negative.
- **Reopening condition (from §9, in substance verbatim):** a new search/evaluation change
  that first clears `rollout-evaluation.md` §3's acceptance criteria (oracle agreement +
  honesty + head-to-head) may re-run **this sweep unchanged — same seeds
  (`b3v2-postfix-sweep`), same ten-point ladder, same decision rule.** The floor does not
  move, and no other path reopens the question.

The ship/kill decision itself is the user's. The evidence is complete, pre-registered, and
points one way.

## 8. Corrections to the commissioning summary (C97 and the report brief)

Discrepancies found between the raw data and the summaries this report was commissioned
against, recorded per the standing instruction that contradictions outrank smoothness:

1. **`strong-vs-random` range is 95.3%–100.0%, not 97.7%–100%.** The 800-rollout cell is
   95.3%. Passes everywhere regardless; the stated lower bound was wrong.
2. **"No monotone trend, wobbling within its own seed-to-seed dispersion" is only true above
   1,400.** The full-ladder heterogeneity is significant (χ² ≈ 30.6, df 9, p ≈ 4×10⁻⁴), and
   the 800 → 1,400–1,600 rise is real (t ≈ 3.8–4.4): the 1,600 peak IS statistically
   separable from the 800 trough. The flat characterization is exact for 1,400–10,000
   (χ² ≈ 8.7, df 6, p ≈ 0.19). This refinement changes no conclusion — the resolvable
   feature is a rise from 15% to a third of the floor, after which 7× more budget buys
   nothing — but the curve is "rise, then plateau," not "pure noise."

All attainment values, SDs, SEs, the qualifier count (zero), the P1/P2/P6 scorings, and the
wall-clock figures in C97 match the raw output exactly.

# Bid-Tac-Toe — exact solve report (Sonnet, B2)

*Deliverable per `docs/plans/bid-tac-toe.md` §5. Produced by the game-local solver in
`games/bid-tac-toe/solver/` (`backward-induction.ts` = the solve, `oracle.ts` = the
independent brute-force cross-check, `run-solve.mts` = the CLI that generated every number
below). Per platform-corrections.md C3: the generic exact solver refuses this game twice
(`packages/harness/src/solver/types.ts:67` rejects `simultaneous: true`;
`packages/harness/src/solver/reach.ts:93` throws on a simultaneous `active()` spec), so this
composes nothing from `@twist-arcade/harness`'s solver lane — it is a standalone game-local
backward induction, run to regenerate/verify:*

```
NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @twist-arcade/bid-tac-toe solve
```

---

## 0. How to read this report

- **The graph is acyclic** (plan §3.2 / B1's own acyclicity property test): every auction
  strictly fills a cell, no history lives in state. This is straight memoized backward
  induction, no value iteration, no Graph-History-Interaction case — unlike Fadeout's superko
  solve, there is no search budget to exhaust and no "unproven, budget fallback" outcome
  possible here. Every number below is either exact or explicitly flagged otherwise (none
  needed to be).
- **Bid nodes are matrix-game nodes** (the one genuinely novel piece, plan §5). At every
  bid-phase position this solver computes both the **maximin** (`max_i min_j A[i][j]`, the
  best guaranteed value seat 0 can lock in with a pure strategy) and the **minimax**
  (`min_j max_i A[i][j]`, the same for seat 1). By the standard saddle-point argument,
  maximin ≤ true game value ≤ minimax always, with **equality iff a pure Nash equilibrium
  exists**. **Pure** below means maximin = minimax at a node — the value is then exact and
  provably achieved by pure (non-mixed) optimal bidding. This solver never invents an
  LP-solved mixed-strategy value for an impure node — per the coordinator's ruling, that is
  exactly the "probabilistic value" `SolvedValue` has no arm for; an impure node would
  propagate the bound-average upward instead (see `backward-induction.ts`'s module doc) and
  the whole budget's result would be flagged non-exact. **This never fired even once, at any
  budget swept** — see §2's saddle census.
- **Values are seat-0-perspective, in {-1, 0, +1}**: +1 = seat 0 wins, -1 = seat 1 wins, 0 =
  draw. A pure root value is provably always exactly one of these three (never a fraction) —
  asserted as a property test (`backward-induction.test.ts`), not merely assumed.
- **Star-holder advantage** = the root value with seat 0 holding the star at setup (a
  hypothetical, never-reachable-in-real-play state, built only to isolate the star's own
  worth) minus the REAL root value (seat 1 holds the star, matching `engine.ts`'s actual
  `setup()`). Positive means holding the star is worth exactly that much to seat 0 in this
  position.
- **Quotability** (plan §1/§8): is the extracted optimal strategy short/formulaic enough to
  post as a one-line spoiler? Judged on whether the canonical line's bid sequence reduces to
  a simple closed-form rule, per §4 below.

---

## 1. Per-budget results — the {8, 12, 16, 20} sweep

**Headline finding, stated once here rather than four times: every one of the four candidate
ship budgets is a PURE, PROVEN, EXACT DRAW, with ZERO star-holder advantage and ZERO impure
(non-saddle) bid nodes anywhere in the reachable tree.** Not "close to balanced" — exactly
balanced, and provably so. This is stronger than the plan's own prediction (§0/§2: "predicted
48%, band [45, 55]" for the non-holder's *self-play* win rate, i.e. a small deficit was
expected). Under optimal play, there is no deficit at all: the two hypothetical setups (star
with seat 0 vs. star with seat 1) produce the identical value.

| Budget | Root value | Pure? | Star-holder advantage | Draw rate (optimal play) | Reachable states | Solve time |
|---|---|---|---|---|---|---|
| 8 | **draw (0)** | yes | **0** | 100% | 1,370,166 | 5.1s |
| 12 | **draw (0)** | yes | **0** | 100% | 2,014,310 | 10.8s |
| 16 | **draw (0)** | yes | **0** | 100% | 2,658,454 | 19.5s |
| 20 | **draw (0)** | yes | **0** | 100% | 3,302,598 | 32.5s |

Draw rate is 100% at every budget for the same reason Fadeout's report gives (§1.6 there): an
*exact* solve's root value is one of win/loss/draw by definition, so under truly optimal play
by both sides the draw rate is trivially 100% when the value is a draw. This is the
game-theoretic value, not a self-play statistic — B3's actual bot self-play sweep is the
separate, real measurement of whether the *shipped* MCTS tiers reach this value reliably.

**Reachable-state counts track the plan's own estimate closely**: plan §1 projected ≈3.9M
states at budget 16 (`19,683 × 33 × 2 × 3`); the measured figure is 2,658,454 — lower because
that estimate is an upper bound over *all* 3⁹ board configurations, and a meaningful fraction
of those are never actually reached (a game terminates the instant a line completes, so most
positions with 5+ marks down and a completed line are never explored past that point, and the
estimate's `× 3` phase multiplier over-counts terminal positions, which need no phase at all).

**Solve times scale worse than linearly in states** (5.1s → 32.5s across a 2.4× state-count
increase) because the dominant cost is the O(budget²) matrix scan per bid node (module doc),
and both the average matrix dimension and the bid-node count grow with budget — consistent
with the plan's own §5 cost projection ("minutes-scale in TS" at B=16; measured: 19.5s, well
under that).

### 1.1 Per-first-auction value tables

For each budget, the value immediately after the very first auction resolves, as a function
of who wins and what they pay (payment = the winning bid's plain amount):

**B=8:**

| Payment | Seat 0 wins → | Seat 1 wins → |
|---|---|---|
| 0–2 | **+1 (P0 wins)** | -1 |
| 3 | 0 (draw) | 0 (draw) |
| 4–8 | -1 | **+1 (P1 wins)** |

**B=12:**

| Payment | Seat 0 wins → | Seat 1 wins → |
|---|---|---|
| 0–3 | **+1** | -1 |
| 4 | 0 | 0 |
| 5–12 | -1 | **+1** |

**B=16:**

| Payment | Seat 0 wins → | Seat 1 wins → |
|---|---|---|
| 0–4 | **+1** | -1 |
| 5–6 | 0 | 0 |
| 7–16 | -1 | **+1** |

**B=20:**

| Payment | Seat 0 wins → | Seat 1 wins → |
|---|---|---|
| 0–5 | **+1** | -1 |
| 6–7 | 0 | 0 |
| 8–20 | -1 | **+1** |

**A genuinely useful, unanticipated finding from these tables**, worth carrying into B3's tier
tuning and any future teaching copy: **winning the first auction is only good up to a price
threshold, then flips to bad.** Winning cheaply hands the winner a placement at essentially no
cost; winning expensively hands the *loser* so many chips that they dominate every subsequent
auction, more than offsetting the placement advantage. The breakeven threshold sits
consistently around **30–38% of the total budget** at every swept size (3/8, 4/12, 5–6/16,
6–7/20) — a real, structural property of this Richman variant, not a coincidence of one
budget. This is precisely the "anti-snowball" mechanic the plan's §1 cites as the reason
all-pay was rejected ("losing auctions *enriches* you"), now visible directly in the value
table rather than only argued in prose.

### 1.2 Extracted canonical lines

One representative optimal line per budget (smallest-amount canonical tie-break — see §4 for
why *which* optimal bid is chosen among ties doesn't change the outcome at a pure node).
Ties are marked `*` for the starred bid.

**B=16** (18 plies, the full game):

```
seat 0 bids 5, seat 1 bids 4*  -> seat 0 wins, pays 5        | place: seat 0 -> cell 0
seat 0 bids 5, seat 1 bids 3*  -> seat 0 wins, pays 5        | place: seat 0 -> cell 2
seat 0 bids 6, seat 1 bids 6*  -> seat 1 wins (star), pays 6 | place: seat 1 -> cell 1
seat 0 bids 7*, seat 1 bids 7  -> seat 0 wins (star), pays 7 | place: seat 0 -> cell 4
seat 0 bids 3, seat 1 bids 5*  -> seat 1 wins, pays 5        | place: seat 1 -> cell 6
seat 0 bids 6, seat 1 bids 10* -> seat 1 wins, pays 10       | place: seat 1 -> cell 8
seat 0 bids 13, seat 1 bids 3* -> seat 0 wins, pays 13       | place: seat 0 -> cell 7
seat 0 bids 0, seat 1 bids 0   -> seat 0 wins, pays 0        | place: seat 0 -> cell 3
seat 0 bids 0, seat 1 bids 7*  -> seat 1 wins, pays 7        | place: seat 1 -> cell 5
```

Terminal: draw, board full, no line — matching the proven root value exactly. **Ties are the
common case here too**: 2 of 9 auctions in this one line resolve by star, matching the plan's
own framing ("ties are the common case, not an edge case").

B=8/12/20's full canonical lines are in the script's raw output (regenerate via the command
in the header); the B=16 line above is representative — none of the four shows a discoverable
closed-form bid formula (see §4).

---

## 2. Saddle-point census

**Zero impure bid nodes at every swept budget — 2,521,056 total bid nodes checked across the
four budgets, all pure.**

| Budget | Total bid nodes | Impure | Fraction |
|---|---|---|---|
| 8 | 369,802 | 0 | 0.0000% |
| 12 | 543,610 | 0 | 0.0000% |
| 16 | 717,418 | 0 | 0.0000% |
| 20 | 891,226 | 0 | 0.0000% |

**Develin & Payne's discrete-bidding pure-optimal-bid theory holds exactly for this game's
specific tie/transfer variant, confirmed by exhaustive check, not sampled.** This was
explicitly a hypothesis to verify (plan §5: "that is a hypothesis about our exact
tie/transfer variant until checked") — every single bid node in four full state spaces (up to
891,226 of them) has a pure saddle point. There was no need to build a fallback path, an LP
solver, or a mixed-strategy value at all; the coordinator's escalation instruction for the
impure case never triggered.

---

## 3. Small-budget structural finding (not a ship candidate, but worth recording)

Swept B=0 through B=8 as a cheap byproduct of validating the solver at small sizes (all still
pure, all cross-checked against the independent oracle for B≤3):

| Budget | Root value | Star-holder advantage |
|---|---|---|
| 0 | draw | 0 |
| 1 | **seat 1 (holder) forced win** | **2** |
| 2 | **seat 1 (holder) forced win** | **2** |
| 3 | draw | 0 |
| 4 | **seat 1 (holder) forced win** | **2** |
| 5 | **seat 1 (holder) forced win** | **2** |
| 6 | draw | 0 |
| 7 | draw | 0 |
| 8 | draw | 0 |

**Two things worth recording:**

1. **A real phase transition, not noise.** At tiny budgets (1, 2, 4, 5) the star is not a
   small edge — it is a **complete, forced win**, and the star-holder advantage is *exactly*
   2 whenever it is nonzero (the full swing from -1 to +1, never a partial value) across every
   budget where it appears. From budget 6 onward (and at every swept ship-candidate budget:
   8, 12, 16, 20), the advantage collapses cleanly to 0. This validates the plan's own
   reasoning for rejecting the research note's small-chip-count intuition and for treating
   budget size as something the solve must determine, not a guess — a budget picked without
   this check could easily have landed in the forced-win zone.
2. **B=0's degenerate-alternation draw matches intuition directly**: at 0-0 budgets every
   auction is a forced 0-0 tie and the star alternates the placement right each round (plan
   §1's own description) — the exact solve confirms this literal mechanism converges to a
   draw, the same value as classic alternating tic-tac-toe, exactly as expected.

This is a genuine, unforced finding (nobody asked for the B<8 sweep) that happened to fall out
of validating the solver at small sizes — it strengthens confidence in the B≥8 results rather
than needing a separate investigation, since it shows the solver is sensitive to real
structural differences (it does not just report "draw" reflexively) and correctly recovers a
sharp, sensible transition.

---

## 4. Quotability judgment

**Not quotable, at every swept ship-candidate budget — and for the strongest possible
reason: there is no forced win to quote in the first place.** All four are proven draws.
Fadeout's own report makes exactly this point for its recommended (also drawn) config:
"none extracted, and none possible from this table — there is no forced win to extract here."
The same reasoning applies here, directly.

Beyond that structural point, the canonical lines themselves (§1.2) show **no discoverable
closed-form bid rule**: B=16's sequence of winning bids is `5, 5, 6, 7*, 3, 6, 13, 0, 0` against
a budget that starts at 16 and drifts every round — not a constant fraction of budget, not
"always bid what you have minus 1," not any simple formula checked against the data. The
*only* formulaic-sounding regularity found anywhere is §1.1's "don't overpay past ~30–38% of
budget for the FIRST auction" — a genuine strategic insight, but importantly **not** a
memorizable forced sequence: it's a heuristic about the very first decision from a
still-symmetric position, not a spoiler that solves the game. This is the same distinction
Fadeout's report draws between "an interesting structural property" (its zero-LOSS-position
finding) and "a quotable forced win" (its edge-opening 5-ply line) — this game has the former
in the first-auction threshold, never the latter.

**Per plan §1's rule** ("B2 solves budgets {8, 12, 16, 20} exactly and ships the smallest one
whose extracted optimal strategy fails the quotability test"): all four candidates pass (none
is quotable), so this criterion alone does not eliminate any of them.

---

## 5. Recommendation: budget

**Recommend B=8, not B=16, subject to B3's own confirmation with real bots.** Reasoning:

- All four swept budgets are equally strong on the exact-solve axes that matter (proven pure
  draw, zero star advantage, not quotable) — B2 finds no exact-solve reason to prefer a larger
  budget over a smaller one among {8, 12, 16, 20}.
- **Bid branching at B=8 (9–18) sits comfortably inside the plan's own 4–30 design-gate band**
  (plan §1), while B=16's branching (17–34) already touches its upper edge. B=8 is the
  *safer* choice against that specific ceiling, not merely the cheaper one.
- **Gate cost scales with branching² (plan §6.2's own "34×34 ≈ 1,156 arms" framing)**: B=8's
  joint bid-node branching (≤18×18=324) is roughly 3.6× cheaper than B=16's (≤34×34=1,156),
  directly reducing B3's self-play wall-clock cost (plan §6.2 projects "~30–90 min per
  100-game matchup" at B=16; B=8 should land well under that).
- This is a **recommendation for B3 to weigh, not a unilateral freeze** — the exact solve only
  characterizes *optimal* play. Whether B=8's smaller chip economy still gives real MCTS bots
  (and the zero-bot/sniper degeneracy probes, plan §6.1) enough room to price positions
  meaningfully is exactly what B3's self-play sweep and probes measure, and could favor a
  larger budget for reasons the exact solve cannot see (finer-grained pricing skill separating
  Casual from Ruthless, for instance). The plan's own working candidate (16) remains a fully
  valid, equally-proven fallback if B3 finds B=8 too coarse.

**`solvedValue`**: every swept budget may claim `{ value: "draw", proof: "docs/research/games/bid-tac-toe-solve-report.md §1 (exact backward induction, pure at every bid node, cross-checked against an independent brute-force oracle at B≤3)" }` once its budget ships — per C23, this earns `n/a` (not `pass`/`fail`) on `first-player-win-rate`, `draw-rate`, and `ruthless-vs-standard` at B3, with the SAME inverted "does self-play actually reach the proven draw" gate C23 established for Fadeout applying here too.

---

## 6. Verification summary

- **Independent oracle cross-check (B≤3, `oracle.ts`)**: a deliberately unoptimized
  brute-force solver — real `bidTacToe.apply()` called once per matrix CELL (no successor
  dedup, no precompute table, the one piece of the main solver's optimization most likely to
  hide an indexing bug) — agrees EXACTLY with the main solver's root value and purity at
  B=0, 1, 2, 3, including the surprising forced-win results at B=1/2. See
  `backward-induction.test.ts`.
- **Property test: pure ⇒ root value ∈ {-1, 0, 1}** (never a fraction) — asserted directly,
  not assumed, at every budget checked.
- **Canonical-line replay property test**: the extracted line's ACTUAL recorded moves (not
  arbitrary substitutes) replay legally through the real public `bidTacToe` engine at every
  step (`isLegal` asserted true for every move), conserve `budgets[0]+budgets[1] = 2×budget`
  at every step, and terminate at a `draw` status matching the proven root value exactly.
- **Richman conservation** holds by construction in the solver's own successor-value
  computation (`valueOfResolvedWin` — the same 3-line budget-transfer formula
  `engine.ts`'s `apply()` uses, both built on the shared, already-tested `resolveBid()`
  export) and is explicitly checked at every step of the canonical-line replay test above.
- **DRY with the tested engine, not a parallel reimplementation**: the solver's O(budget)
  distinct-successor step and its O(budget²) matrix-cell classification BOTH call `engine.ts`'s
  own exported `resolveBid()` — B1's 44-test contract/property/tie-table suite already covers
  this exact function; the solver adds no independently-reimplemented copy of the resolution
  arithmetic that could silently drift from it.
- **The one thing genuinely novel to this solver** — the saddle-point (maximin/minimax) check
  at every bid node — fired 2,521,056 times across the four swept ship-candidate budgets with
  zero disagreements, the strongest form of "checked, not assumed" available for the
  Develin–Payne hypothesis this game was specifically built to test.
- `pnpm --filter @twist-arcade/bid-tac-toe typecheck && test && lint` clean (54 tests: 27
  resolution + 3 manifest + 10 contract + 4 platform-spike + 10 solver, ~30s total with the
  expensive {12,16,20} sweep left to `pnpm solve` rather than gating every `pnpm test` run —
  Fadeout's own `solve.test.ts` precedent).

---

## 7. What this report does NOT cover (explicitly out of scope for B2)

- **Self-play with real (imperfect) bots** — B3's job. The exact solve says nothing about
  whether the shipped MCTS tiers actually *find* this draw, or how they behave under the
  zero-bot/sniper/constant-k degeneracy probes (plan §6.1) — those require real search, not
  backward induction over optimal play.
- **`ciGateBudget.twoPlayerCiRollouts`** — still unset in `manifest.ts` (B1's own note,
  unchanged): "value from B3's sweep, never guessed."
- **Budget freeze** — this report recommends B=8 (§5) but does not unilaterally freeze it;
  that is the orchestrator's call once B3's evidence is in, per the plan's own sequencing
  (§10: "B2 before B3... B2's output changes what B3 measures").

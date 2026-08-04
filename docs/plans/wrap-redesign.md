# Wrap redesign ruling — why the second player wins, and what to do about it

**Status: RULING. Stage-1 re-plan following the C14 gate failure (design problem, not a bug).**
**Ruled by Fable, 2026-08-04. Supersedes the "pie rule" remedy in game-theory-lens §4 entry 6.**

Inputs: `docs/plans/platform-corrections.md` C14 (the measurement),
`docs/research/games/game-theory-lens.md` §1.7 / §2.1 / §4 entry 6 / §5.9 (the original
rationale), and the shipped engine at `games/wrap/engine-internal.ts` in the
`feature/wrap` worktree (the geometry the ruling rests on). All combinatorial claims
below were verified by direct enumeration, not asserted from memory.

---

## 1. The verdict in three lines

1. **Mechanism:** on a 5-cycle, win-length 4 is degenerate — *every* 4-subset of a line
   is a winning set, so "in-a-row" is vacuous, defense is over-efficient, and the
   initiative becomes a liability. The responder wins the race.
2. **Ruling:** one parameter change — **6×6 torus, win-length 4 unchanged** — which
   removes the degeneracy by construction. One re-measurement. If it lands outside the
   §2.1 shippable bands in either direction, **kill Wrap and promote Duel Draft**; do
   not iterate a third board.
3. **General lesson:** the empirical balance gate runs **before any UI work is
   scheduled**, for every future game, and the lens gains a new design-time trap:
   *win-predicate collapse on cyclic boards* (require cycle length ≥ win length + 2).

---

## 2. Diagnosis: why P2 wins 76% on the 5×5 torus

### 2.1 The degeneracy (exact, not statistical)

The shipped engine enumerates 100 win-windows: 20 maximal line-cycles (5 rows, 5
columns, 5 diagonals, 5 anti-diagonals — all of length 5, because gcd-arithmetic on an
odd torus closes every diagonal in 5 steps) × 5 windows each. Each window is 4
consecutive cells of a 5-cycle — i.e. **the complement of a single cell**. There are
C(5,4) = 5 four-subsets of a 5-set and exactly 5 windows, so they coincide:

> **Every 4-subset of every line-cycle is a winning set. The "consecutive" constraint
> in "4-in-a-row" does no work at win-length = cycle-length − 1.**

Verified by enumeration, alongside its three tactical corollaries:

| Property (per line-cycle) | 5-cycle, win 4 (shipped) | 6-cycle, win 4 (proposed) |
|---|---|---|
| Winning k-subsets / all k-subsets | **5 / 5 — vacuous** | 6 / 15 — real |
| Any 3 own stones in a clean cycle = double threat? | **Always** (every triple) | Only consecutive triples |
| Win-windows surviving 1 enemy stone | **1 of 5** | 2 of 6 |
| Windows surviving 2 enemy stones | 0 | 0–1 (placement matters) |

### 2.2 How the degeneracy produces a *second*-player edge

Three consequences compound:

**(a) Defense is over-efficient and placement-free.** One enemy stone anywhere in a
cycle collapses its 5 windows to 1 and destroys its double-threat potential outright;
two stones kill it. The blocker never needs a *specific* cell — any cell of the cycle
works — so the blocker can always choose the cell that simultaneously develops their
own cycles. Meanwhile every attack needs 4 stones in one cycle and telegraphs itself
two plies out (2-in-a-clean-cycle must be answered immediately, since 3-in-a-clean-cycle
is an unstoppable double threat). **Attack is expensive, rigid, telegraphed; defense is
cheap, flexible, and — because block-cell choice is free — reliably constructive.** The
game reduces to forcing exchanges in which the block is also a riposte, and the player
who commits into each exchange first is the one who gets counter-checked.

**(b) Every stone is a quad-block, so information-per-stone dominates.** Each cell lies
on exactly 4 cycles; each placement poisons up to 4 enemy cycles at once. In a currency
where single stones do this much defensive work, what matters is how well-targeted each
stone is — and the responder places every stone knowing one more enemy stone than the
opponent did. P2's stones are systematically better-informed than P1's, pairwise, for
the whole game.

**(c) The vertex-transitive opening donates a tempo.** All 25 cells are literally
equivalent by symmetry, so P1's first move carries zero targeting information — no
search budget can extract signal that does not exist. P2's first move already targets
P1's committed stone. P1 in effect plays the entire game half a tempo behind in
information, in a game short enough (mean 11.6 plies) that this never amortizes.

This is the "tempo" candidate from the escalation, made mechanical: the reason every
P1 threat is answerable-with-counter-threat is (a); the reason the answerer is
systematically P2 is (b) + (c). Strategy-stealing is not violated — at perfect play P1
could at worst copy a strategy — but perfect play is not what two fixed-budget MCTS
agents produce, and the geometry above determines which side's *search problem is
easier*: P2 refutes narrow forced lines; P1 must find constructive moves among
near-symmetric alternatives.

### 2.3 The candidates I reject, and why

- **Board parity (25 odd, P1 places 13).** Causally inert. Games end at mean 11.6
  plies with the board under half full — P1's 13th stone never exists. And in a
  maker-maker game an extra stone never hurts; parity of a board that never fills
  cannot explain a directional edge. Rejected.
- **Raw line density.** Enumeration shows per-cell win-window incidence is **16 on both
  the 5×5 and 6×6 torus** (it is 4 windows per cycle-direction regardless of cycle
  length). Density per cell is invariant under the board-size change, so it cannot be
  the operative variable. What varies is windows-per-cycle relative to C(n,4) —
  blocking efficiency — which is the degeneracy, not the density. Rejected as stated;
  subsumed by §2.1.
- **Mirroring.** Already excluded by the probe (0.0%/500) and by the fixed-point
  argument in C14. Not re-litigated.

### 2.4 What would falsify my diagnosis

The 6×6/4 re-measurement is itself the designed experiment — it separates the two live
hypotheses:

- **If FPA on 6×6/4 moves to ≥ 50%** (my prediction: it recovers to at-or-above 50,
  plausibly into the original theory's high band): the degeneracy mechanism (§2.1–2.2a)
  is confirmed as dominant. Then the *standard* remedy menu (§2.1 of the lens:
  alternation, pie) applies as designed, because the game is now first-player-leaning
  with a real opening spectrum.
- **If 6×6/4 is still P2-favoured**: the degeneracy story is falsified and the residual
  mechanism is (b)+(c) — vertex-transitivity itself. No torus parameter escapes
  vertex-transitivity, so no board change can fix it → the kill trigger fires (§3.2).

Two cheap corroborations, optional, from data we already have or can log for free:

1. **Dual-purpose-block rate** from the existing 1,000-game self-play logs: fraction of
   P2 moves in P2-won games that simultaneously poison a P1-clean cycle and extend a
   P2 cycle. Mechanism (a) predicts this is high (>60%). If P2's wins instead come from
   unforced quiet-move races, (a) is wrong.
2. **Budget sweep**: FPA at 100 / 1k / 10k rollouts (the three tiers already exist).
   A game-structural mechanism predicts the P2 edge persists across budgets. If the
   edge collapses at low budget, the effect is search-artifact-dominated — worth
   knowing, since casual humans play nearer the low tiers.

Neither substitutes for the 6×6 run; both sharpen the post-mortem if it fails.

---

## 3. Ruling on Wrap's future

### 3.1 The change: 6×6 torus, win-length 4, everything else unchanged

**Why this specific change should move the number** (not merely might): it directly
removes each quantity in the §2.1 table that produces the responder's edge —

- Winning sets drop from *all* 4-subsets to 6 of 15: consecutiveness becomes a real
  constraint, so attacks have shape and blocks need placement.
- One enemy stone no longer destroys a cycle's double-threat potential (a consecutive
  triple in the surviving 5-path still completes at both ends): the one-stone
  quad-poison stops being a guaranteed riposte, so **blocking regains a tempo cost and
  the initiative regains value**.
- Only consecutive triples are double threats: threats must be *built*, not accumulated,
  which rewards the player who moves first in a race — the standard maker-maker logic
  the original design assumed, now actually present in the geometry.

What it preserves, deliberately: the one-sentence rule ("The board wraps around — lines
continue off every edge") verbatim; the total heuristic reset (still edge-free, still
vertex-transitive, per-cell incidence still 16); S-complexity.

**Predicted side-effects, to be checked in the same run, not separately:**

- *Mean plies rises* (36 cells, harder wins). Expect it to stay well inside the 10–40
  band; the 200-ply cap is unreachable (board fills at 36).
- *Draw rate rises off 0%.* 6×6/4 torus is still line-dense (144 windows); expect
  single digits. The 60% gate has enormous headroom.
- *Branching* peaks at 36, mid-game ~25–30 — at the §2.6 legibility ceiling but inside
  it.
- **The mirror probe becomes load-bearing again.** 6×6 is even×even: the point
  reflection cell → 35−cell has *no fixed cell*, so — unlike on 5×5 — a mirroring P2
  can answer every opening. Expected outcome: mirror still loses (the copier completes
  any line one ply after the original, and P1 simply avoids the point-symmetric
  self-mapped cycles where a mirrored stone would poison P1's own line), but this is
  now the probe earning its keep rather than passing by geometry. `mirrorMove` changes
  from `24 − cell` to `35 − cell`; its "maps every wrap-line family onto itself"
  verification must be re-run, not assumed.

**Implementation cost, honestly:** `BOARD_SIZE = 6` in `engine-internal.ts` (the win
check already loops over the constants — verified), `mirrorMove`, the UI grid constant,
and the test fixtures — the fixtures are position-literal and all need rewriting for
the new geometry, which is the bulk of the work. Roughly a day, then one gate run.
This stays a parameter change, not new design surface.

### 3.2 The kill trigger — one iteration, not a search over boards

Run the full C14 gate table once on 6×6/4:

- **FPA lands in 35–65** (the CI band): ship, with the site-wide series alternation
  absorbing the residue; if it lands 55–65, the pie rule is *now* applicable as
  designed, because a first-player-leaning game with real opening shape is exactly its
  domain.
- **FPA outside the band in either direction, or any other gate fails:** **kill Wrap.
  Promote Duel Draft** (lens §4 entry 8) from the fast-follow queue into the launch
  slate. No third board. A second failure means the problem is vertex-transitivity or
  something we have not diagnosed, and either way the slate slot is not worth a third
  measurement cycle on a game whose entire pitch was "near-zero cost."

**What Wrap provides to the slate, and how the replacement covers it:** (1) a
one-sentence rule at S-complexity rounding out launch at near-zero cost — Duel Draft
matches: S-complexity, TTT chassis, "you both pick secretly; same cell → destroyed" is
one sentence; (2) an FPA story — Duel Draft is *stronger* here (no turn order by
construction), though per §5 below its "None by construction" rating still gets
measured, not trusted; (3) the topology-twist representative (§1.7) — Duel Draft does
**not** cover this; the topology slot passes to **Closing Walls** in the fast-follow
beat, which the slate plan already positions. Accepted trade: launch loses the
topology twist if Wrap dies; it does not lose a slot.

### 3.3 Remedies rejected

- **Cylinder (wrap one axis).** Keeps the 5-cycle degeneracy on the wrapped axis while
  reintroducing edge hierarchy on the other — a half-fix that also breaks the rule
  sentence ("wraps sideways" is a worse sentence) and re-admits half the cached
  heuristics the twist exists to delete. Dominated by 6×6/4 on every axis.
- **Win-length 5 on 5×5.** Win = occupy an entire cycle; two enemy stones anywhere kill
  every cycle they touch. Draw city by construction; trades a 24% FPA for a draw-rate
  gate failure.
- **7×7/4.** Also non-degenerate (7 of 35 subsets win), but branching 49 breaks the
  legibility ceiling and lengthens games for no additional mechanism benefit over 6×6.
- **Reverse pie / first-move handicap.** Buildable, but it papers over the symptom. The
  measured 24% is downstream of "the initiative is a liability" — a game where
  *attacking never works* is a bad game for humans even at 50/50, and no seat device
  fixes that. It is also new design surface (C14 is explicit that no reverse-pie exists
  in the toolbox) purchased to avoid a one-constant change. Rejected on both grounds.

---

## 4. The general lesson: gate before UI, for every game

**Ruling: yes — mandatory.** Every future game plan carries a required empirical
balance stage between "engine + manifest complete" and "any UI work scheduled."

The cheap version, which is cheap because the machinery already exists:

1. Engine + manifest (tiers, tags, probes) — no UI, no routes.
2. `runTwoPlayerCiGate --game <id>` — this makes the **C13/C15 `--game` filter fix a
   prerequisite for the next game team**, not a nicety; the Wrap team's hand-rolled
   script is exactly the improvisation C13 warns about.
3. Smoke pass at standard tier (1k rollouts), 500 games (±4.4 pp) — minutes, catches a
   76%-magnitude inversion instantly. Full 1,000-game ruthless pass before the UI
   stage unlocks. Total cost: under one CPU-hour, per the lens's own §3 estimate.
4. Exact solve only where the state space permits (Fadeout could; most cannot — the
   self-play gate is the universal instrument, the solve is a bonus).

Wrap's actual cost ordering softens nothing here: the C15 record shows its UI was
nearly free off the M5 scaffold, but that is a fact about scaffold quality, not a
license to build UI on an unmeasured ruleset. Sequencing is the point: **the gate is a
go/no-go on the game's existence; nothing whose existence is unconfirmed gets polish.**

**Plus one pencil-and-paper check the harness cannot do, added at *design* time —
proposed as trap §5.12 in the lens:**

> **Win-predicate collapse on cyclic boards.** For any game whose win lines live on
> cycles (torus, cylinder, ring boards), compare win-length k to cycle length n before
> implementing anything. k = n (total occupation) and k = n−1 (every k-subset of the
> cycle wins — consecutiveness is vacuous, one enemy stone collapses all windows to
> one, defense becomes over-efficient and placement-free) are both degenerate.
> **Require n ≥ k + 2**, and at design time count winning sets per line structure
> against C(n,k) — if they coincide or nearly coincide, the "in-a-row" constraint is
> decoration. This check costs five minutes and would have caught Wrap before a line
> of code existed: §1.7 caught k = n on the 3×3 torus and stepped straight into
> k = n−1 at 5×5/4 without re-running the same arithmetic.

---

## 5. What the research got wrong — plainly

**The taxonomy stands; entry 6 was mis-analysed; and the shortlist's FPA column has a
systemic epistemic defect worth fixing before the queued five inherit it.**

1. **The mis-analysis (specific to entry 6).** Two errors. First, it converted
   strategy-stealing — an existence theorem about the *value of the game at perfect
   play* — into a directional, magnitude-bearing prediction about fixed-budget
   self-play, and §1.7 doubled down ("strengthen the first-player-wins pressure ...
   expect to need the pie rule"). Notably, §2.1's own theory-check line was more
   careful than the entry built on it: "expect FPA ≥ 50% *a priori* ... test, don't
   assume." The care existed in the criteria and was dropped in the shortlist row.
   Second — the larger miss — nobody ran the window-counting arithmetic at 5×5/4,
   despite §1.7 running exactly that arithmetic to reject 3×3. The degeneracy was
   findable with a pencil in 2026; it did not need a harness.

2. **The systemic defect (inherited by the queue).** The shortlist's "FPA risk" column
   states theory-derived direction *and pre-commits the remedy* ("High → pie rule").
   Wrap shows both halves can be wrong at once: wrong direction, and a remedy that is
   a no-op in the measured regime (§5.9's own cliff check never fires, because its
   trigger condition assumes the direction the theory predicted). The column should be
   relabeled what it is — **an FPA hypothesis, resolved only by measurement** — and
   remedies chosen *after* the number exists, never before.

3. **Not wrong:** the gates themselves (they caught this at the cost of one run — C14
   is right that this is the apparatus working), the bands, the probe battery, and the
   taxonomy's mechanism catalogue. The failure was in the confidence attached to one
   application of one theorem, not in the classification scheme.

**What the queued five inherit, concretely:**

- **Fog Pools** — "Low–moderate; randomize setups": stochastic-setup games are outside
  strategy-stealing anyway; fine, but measure per-setup-class, since nim FPA is
  setup-parity-determined and averaging over setups can mask a bimodal split.
- **Duel Draft** — "None (symmetric-simultaneous)": *by-construction claims get
  measured too.* Simultaneity removes seats in theory; commit-order, tie-break, and
  reveal plumbing can reintroduce them in implementation. This is now first in line if
  Wrap dies — its gate run happens regardless.
- **Crossout** — misère, hence explicitly *exempt* from strategy-stealing (§2.1 already
  says so); expect nothing a priori; the exact solve decides board count, and the gate
  validates the chosen config.
- **Closing Walls** — the entry already flags "parity of last move before collapse is
  the thing to watch," which is the right epistemic posture: a named hypothesis with a
  named observable. That row is the template the others should have used.
- **Pawn Rush** — "Moderate → measure": already correctly framed; Breakthrough-family
  games have known first-player structure, but at 6×6 the number is an open question.
  Measure.

And all five inherit §4's sequencing rule: **engine → gate → UI**, with the C13
`--game` filter fixed first so no team ever again has a reason to improvise around the
one instrument that decides whether their game exists.

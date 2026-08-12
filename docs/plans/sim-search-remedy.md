# Remedy plan: C57/C58 — replace max-max at simultaneous nodes with decoupled UCT (DUCT)

Authored by Fable (planning pass, 2026-08-12) read-only against `feature/sim-search-residue` @ `279fa6a`.
Diagnosis (`sim-search-residue.md` §0–§2, C71 Parts 2–3) is settled and not re-litigated.

**RECOVERED** = traceable to a document/measurement · **verified** = read from source this session ·
**PROPOSED** = planner's judgement.

---

## 1. The remedy: DUCT, and why not the other two

### The defect, located (verified)

`packages/bots/src/mcts.ts:138–146` — `edgeOwnerAt` returns `rootPlayer` whenever
`active.mode !== "sequential"`. Backprop (`:231–236`) values every simultaneous node's children
w.r.t. the root requester, and UCB (`:209–224`) maximises that over **joint** arms, opponent
component included. Max-max.

### Per-seat value backup alone — rejected: a component, not a remedy
Storing per-seat values changes nothing until selection *uses* them; any single-scalar UCB over joint
arms either maximises one seat (max-max relabelled) or needs a per-seat decision rule — which **is**
DUCT. The one standalone variant (sequentialise each simultaneous node into "I commit, opponent
best-responds seeing my bid") computes the pure maximin and would be exact here, but doubles tree
depth, changes the information structure inside a generic search, and is dominated by DUCT at
pure-saddle nodes. (PROPOSED.)

### Regret matching (SM-MCTS/RM) — correct but oversized
RM's advantage over DUCT is convergence at **mixed-equilibrium** simultaneous nodes. The decisive
fact is the solve report's saddle census (RECOVERED, `bid-tac-toe-solve-report.md` §2):
**2,521,056 bid nodes across all four swept budgets, zero impure** — every reachable simultaneous
node has a pure saddle point. **The one regime where RM beats DUCT is provably absent from the only
simultaneous game in play.** RM also costs more risk: regret tables, stochastic in-search selection
(extra rng semantics), average-strategy extraction. Insurance against a failure mode the solver
proved cannot occur, at higher risk, is the wrong trade.

### DUCT — recommended
Per simultaneous node, one small statistics table **per active seat** over that seat's **own** moves
(visits, totalValue from that seat's own perspective). Selection: each seat independently picks its
own move by UCB1 on its own table; the joint move is the composition; the tree still stores joint
children (transitions genuinely depend on the joint outcome). Backprop: at each simultaneous node on
the path, update each active seat's entry for its own chosen component with
`valueOfStatus(..., thatSeat)` — the machinery already takes an owner parameter (verified,
`mcts.ts:233`, `search-utils.ts`). Final selection at a simultaneous root: most-visited own move in
the requester's own table — which **subsumes C56's `aggregateByOwnMove` by construction.**

- **Correctness:** each seat's statistic is grounded in that seat's own payoff, so the co-operator
  model is structurally impossible. At pure-saddle nodes — all of them here — decoupled best-response
  dynamics have their fixed point at the saddle. DUCT's known weakness (possible non-convergence to
  Nash) lives at mixed nodes only.
- **Cost:** *cheaper than today*. Selection scans |A₀|+|A₁| own-move entries instead of |A₀|·|A₁|
  joint children — at Bid-Tac-Toe's root, **27 vs 162** (verified from `buildBidMatrix`/`movesFor`).
- **Risk:** contained — every behavioural change gates on `active.mode === "simultaneous"`, a branch
  no registered game on `main` ever takes (§2). `mcts.ts`'s own module doc (`:16`) already names
  decoupled UCT as the deferred correct design: this executes the module's stated plan.
- **Testability:** unchanged — E-A runs the shipped `mctsPolicy`; only its clone needs re-mirroring.

### Refutation conditions — what would make DUCT the wrong call

1. Post-fix E-A fails §3.1/§3.2 **and** per-seat visit tables at bid nodes show sustained oscillation
   despite pure saddles — DUCT's cycling pathology where theory says it shouldn't appear. Escalation:
   regret matching, reusing the same per-seat table structure this fix builds.
2. Any future simultaneous game whose saddle census is **not** all-pure. The census is a per-game
   measured fact, not a platform theorem. The rewritten module doc must scope DUCT honestly —
   *"exact-target at pure-saddle nodes; at mixed nodes converges to a deterministic best pure
   response, not the mixed equilibrium"* — replacing the falsified "fine at our branching factors"
   with a claim that **names its own check**. C31/C64: the doc must not outrun the code again.
3. Duel Draft's control gates degrade post-fix. It was healthy *under* max-max; DUCT should keep it
   healthy, and if not, the fix helps one structure by harming another and the choice reopens.

---

## 2. Blast radius — established by reading, not assuming

**The three shipped sequential games are a strict no-op — verified:**

- `fadeout/engine.ts:211–213`, `nine-grids/engine.ts:128–130`, `tilt/engine.ts:200–202`: `active()`
  returns `{ mode: "sequential", ... }` **unconditionally**. No code path can produce a simultaneous
  node. `edgeOwnerAt` already returns the actual mover for them, and a fix gated on
  `mode === "simultaneous"` never executes.
- The no-op holds **only if** the implementation preserves byte-for-byte on the sequential path: the
  `untried` random-expansion draw (`rng.int` at `:196`), the UCB arithmetic and child-Map iteration
  order, and the already-separate sequential final-selection branch (`:288–318`, kept as literal
  untouched code by the codebase's own deliberate discipline). **Any new rng draw must occur only
  inside simultaneous-mode branches.**
- Also verified sequential: crackstep, mine-run, order-vs-chaos.
- **The acceptance test is the byte-identical dump and it must stay empty.** This plan asserts it
  *will* be empty; any differing byte is an implementation bug in the fix, full stop.

**What the fix touches:** Duel Draft (engine on `main`, verified **unregistered** in
`main:games/registry.ts` — so no shipped runtime behaviour changes; it is the healthy control, held
to behavioural re-runs, not byte-identity) and Bid-Tac-Toe (not on `main` in any form; the intended
beneficiary). **Net: this can land on `main` touching zero registered games' behaviour.**

---

## 3. Sequencing: H1 first, H3 second, H3 decided by post-H1 data

**H3's blast radius on shipped games is nil — confirmed.** `aggregateByOwnMove` runs only in the
simultaneous final-selection branch (`:258–287`); no registered game on `main` is simultaneous;
Bid-Tac-Toe (the only game with a rider field) is not on `main`; Duel Draft's move is a bare cell.

**H1 lands first, alone** (PROPOSED):

1. **H3's headline number was measured under H1-corrupted values.** `P(argmaxDiffers) = 0.650`
   describes visit distributions produced by a max-max tree. Its causal weight in a sane tree is
   unknown. Fixing H1 first and re-running E-A — whose argmaxDiffers column already exists and costs
   nothing — converts the H3 decision from a guess into a measurement.
2. **H3 alone can satisfy no acceptance criterion** — it cannot stop rootValue climbing on a proven
   draw, so an H3-first landing would have no game-level acceptance test.
3. **Attribution.** Landing both muddles which mechanism moved which signature. E-A costs ~34 s per
   full sweep (RECOVERED), so a second iteration is nearly free.

**Pre-registered H3 decision rule (PROPOSED):** after H1 lands, if post-fix E-A shows seat 0 meeting
§3.1 while seat 1 misses it **and** seat 1's `P(argmaxDiffers)` remains materially above 0, H3 is a
confirmed active co-cause and its fix lands as a separate change. Noted honestly: **under DUCT the
per-seat tables are still keyed by `stableStringify` of the full own move, so the star split
persists** — H3 stays a live, independently measurable question, which is what makes this sequencing
safe. If it fires, the candidate remedy is a two-stage final selection driven by an **optional**
engine-declared grouping hook (`selectionGroupKey(move)` → Bid-Tac-Toe returns `amount`), a
structural no-op for every game not declaring it. That gets its own small plan **if and only if** the
rule fires — do not build it speculatively.

---

## 4. Proof design — the instrument exists; the work is keeping it honest

`_c57-oracle-agreement.mts` carries a byte-for-byte clone of `mcts.ts`'s private tree growth
(verified, module doc `:30–49`) and `assertCloneAgrees` aborts the run on any divergence. So:

1. Implement DUCT in `mcts.ts` (unit tests first).
2. **Re-mirror the clone.** The self-check is the honesty mechanism: if the mirror drifts, every run
   throws rather than reporting unvalidated numbers.
3. Re-run E-A unchanged in design — same budgets, same seat×seed grid, same seed-string rule.
   **Raise seeds per cell 20 → 50** (~85 s total, PROPOSED — see the criterion note).
4. Re-run `_b3-sweep.mts` as-is (same seed, same ladder) so pre/post is like-for-like.

**§3's definition of "fixed" is upheld, not weakened.** All four criteria stand. On (2): if DUCT's
root-value stat misses ±0.15 while per-arm values are sane, **the stat does not get redefined to
pass** — that becomes a finding.

**One criterion flagged explicitly rather than quietly restated:** §3.1's monotonicity clause
evaluated on 20 seeds/cell **can false-fail** — four sample proportions at n=20 can dip by sampling
noise even when the search is sound. The remedy is **not to soften the criterion but to shrink the
instrument's noise**: 50 seeds/cell (still seconds), and judge adjacent-budget comparisons on
**paired per-seed differences**, which the seed-string design already supports since identical seed
strings recur across budgets (verified in the run log). **The numeric thresholds do not move.** This
is C71's lesson applied, not a weakening.

**Byte-identity guard, concretely:** before touching `mcts.ts`, capture per-game `ci-gates` stdout
for fadeout/nine-grids/tilt (deterministic under the hardcoded seed; time fields stripped per the
harness's fixed-seed⇒byte-identical design, verified `report.ts:31`, `cli.ts:270`) plus a fixed-seed
match report per game, into `.scratch/`. Re-capture post-fix; `diff` must be empty. Also
`pnpm vitest packages/bots`: existing tests asserting the **old** simultaneous mechanism (the C56
lucky-cell-rps test, the rps legality test) must be re-validated — their behavioural *intent* must
still pass, and any assertion rewritten for DUCT must preserve that intent, **not weaken it.**
`aggregateByOwnMove` goes dead on the live path; keep the export and its unit tests in the fix commit
(smaller diff) and flag deletion as a follow-up decision.

**Duel Draft control re-runs:** the D2 scripts died with the team worktree (verified — only `.out`
files were preserved at `647df00`). §7.1 re-runs via a minimal recreated `compareBudgets` script
matching `duel-draft-d2-71.out`'s cells; §7.3 via a recreated collision-instrumented self-play script
matching the 4 cells of `duel-draft-mcts-selfplay-collision.out`. Both formats are fully specified by
their preserved outputs. Everything is `pnpm tsx`-local — nothing waits on CI or nightly (C68).

---

## 5. Pre-registered gate predictions — written before anything runs

Baselines (RECOVERED, `bid-tac-toe-b3-report.md` §1): strong-vs-random 93.3 / 96.7 / 88.3 / 88.3 /
**75.0%** across 1.6k/2k/3k/5k/10k; `solved-value-reached` **0.0% at every budget**; self-play draw
rate **0.0%**.

All PROPOSED, all directional, **judged on multi-seed aggregates — never a single-seed reading**
(C71):

1. **strong-vs-random: the decline reverses.** Non-declining across the ladder under the paired
   model, largest gain at 10k — up from 75.0% into the ≥90% region. The signature is the *inversion*
   of C55: more budget, better result.
2. **solved-value-reached: up, by a lot, from 0.0%**, and self-play draw rate likewise. **Whether it
   crosses the 90% floor is deliberately not predicted as certain** — a draw needs both seats to hold
   the optimal line through every auction, and seat 1's star-split noise survives H1. If it lands
   well above 0 but below 90 **and** the §3 decision rule fires, that is the pre-registered signal to
   land H3 — **not** to touch the floor. If it lands below 90 with H3 quiet, that is a
   budget-adequacy finding to **escalate** (C55: bug lane, no tuning).
3. E-A internals: mean rootValue flat near 0 across budgets (no longer doubling 0.02→0.21); mean
   chosen bid re-centres on 3 (no longer 4.4→1.1/0.4); opp-bids-zero mass stops growing with budget
   (no longer 0.13→0.36); agreement rises with budget instead of collapsing to 0.050 at 20k.

**C71 noise handling:** the ~12.9 pp across-seed SD at n=100 means no acceptance claim rests on one
seed of `ci-gates`. Post-fix gate readings for Bid-Tac-Toe run **≥5 seeds, judged on the aggregate**;
the byte-identity guard is immune to the question entirely (identical bytes need no error model);
E-A's criteria are already multi-seed by design.

---

## 6. Implementation step list

1. **Capture pre-fix byte-identity dumps** for fadeout/nine-grids/tilt — *before any edit*.
2. **Unit tests first** in `packages/bots/test/mcts.test.ts` + a new fixture: a 2-seat matrix-game
   engine with a known pure saddle (assert DUCT's chosen moves and value converge to it — the
   oracle-in-miniature); an RPS-node test **documenting** the mixed-node limitation without
   over-asserting; a general-sum smoke test; a sequential-game determinism test pinning exact
   move+stats on a fixed seed (the in-suite byte-identity guard).
3. **Implement DUCT** in `mcts.ts`: per-seat tables on simultaneous nodes only; record the traversed
   joint move per path step so backprop can decompose components; sequential paths literally
   untouched; replace the falsified module-doc scoping claim with the honest DUCT scope.
4. **Re-mirror the E-A clone**; run E-A (its self-check gates everything downstream).
5. Judge §3.1/§3.2; run `_b3-sweep.mts` for §3.3 and the gate predictions; run byte-identity diffs
   and the recreated Duel Draft controls for §3.4.
6. Apply the H3 decision rule; if it fires, plan and land H3 separately and re-run.
7. **Preserve raw outputs under `docs/research/games/`** — the C67/C72 lesson: results that exist
   only in a scratch dir or a transcript are one `rm` from gone.

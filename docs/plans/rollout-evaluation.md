# Plan: C73's evaluation defect — give rollouts a way to price an auction

Authored by Fable (planning pass, 2026-08-15) read-only against `feature/sim-search-residue`.
**RECOVERED** = traceable to a document/measurement · **verified** = read from source · **PROPOSED**.

---

## 0. The facts the remedy rests on (all verified this session)

- **The rollout is uniform random with no override.** `mctsPolicy` calls
  `rolloutToHorizon(engine, node.state, rng, rolloutCapPlies)` (`mcts.ts:342`) with **no selector**;
  `MctsOptions` exposes only `explorationC` and `rolloutCapPlies`. The default selector is
  `uniformRandomMoveSelector` (`search-utils.ts:238`).
- **The heuristic exists, is installed, and IS the missing gradient.** `games/bid-tac-toe/heuristic.ts`
  is attached at `engine.ts:41,453`; the engine has **no `score()`**, so `valueOfStatus`'s "ongoing"
  branch returns `Math.tanh(heuristic(...))` (`search-utils.ts:107`). Its first term is
  `budgets[seat] - budgets[opponent]`, and since **the auction winner pays the loser**
  (`engine.ts:291–293`), winning at price *p* moves that term by **−2p** — a strictly monotone
  penalty on overpaying. It is dead code in this regime **only** because rollouts reach real
  terminals at ~7.7 plies against the 200-ply cap (RECOVERED, C73/V3), so "ongoing" never fires.
- **The zero-edit lever.** `rolloutCapPlies` is `opts.rolloutCapPlies ?? 200` (`mcts.ts:271`); `0` is
  legal, and `rolloutToHorizon` with `maxPlies=0` returns the leaf's own `(status, state)` untouched
  (`search-utils.ts:243`). **Leaf evaluation is already expressible from a script with zero edits to
  package source.** `mctsPolicyLegacy` accepts the same option, so both arms get it.
- **`greedyMoveSelector` cannot serve a simultaneous ply** — it applies a singleton map
  (`search-utils.ts:215`) and Bid-Tac-Toe's `apply` throws unless `moves.size === 2`
  (`engine.ts:261–266`). A guided-rollout remedy therefore requires refactoring `rolloutToHorizon`,
  shared by `flat-mc.ts`, `determinized-flat-mc.ts` (Mine Run's Strong) and the harness.
- Duel Draft also has a heuristic (`engine.ts:45,320`), so the control arm is well-defined.
- Registered games: crackstep, nine-grids, tilt, mine-run, fadeout. Fadeout/Nine Grids/Tilt tiers are
  `{ kind: "mcts" }`; Crackstep and Mine Run have `difficultyTiers: []` and reach Strong through
  flat-MC, not `mctsPolicy`.
- `PolicySpec` admits only `{ kind: "mcts"; explorationC? }` — any manifest-visible evaluation knob
  is a **schema change**, orchestrator-routed.

---

## 1. The remedy

### Candidate A — heuristic evaluation at the leaf (no rollout). **RECOMMENDED**

Evaluate the newly expanded leaf with `valueOfStatus(...)` — `tanh(heuristic)` at ongoing leaves,
exact ±1/0 at in-tree terminals. Expressible today as `rolloutCapPlies: 0`.

- **Gradient: yes, structurally.** −2p per auction won at price *p*, monotone, visible at depth 1
  rather than filtered through 7+ plies of random play. On the real root (B=8), seat 0 winning at *p*
  then taking centre evaluates to `tanh(3.5 − 2p)` — monotone decreasing, sign flip near p≈2 against
  the exact table's boundary between 3 and 4. **Imperfectly placed, but an ordering exists where none
  did**, and in-tree terminal values take over as the tree deepens — which structurally restores
  "more search → better," the property whose absence is C55's signature.
- **Cost:** *cheaper* — one 8-line board scan replaces ~7.7 plies of `legalMoves`+`apply`+`status`.
  (PROPOSED, unmeasured.)
- **Blast radius:** zero shipped games (§2). The experiment phase touches no package source.
- **Zero free parameters.** It is a mode switch, not a knob position — it can never be mistaken for
  C55-banned cap tuning. For shipping, name it (`MctsOptions.leafEvaluation?: "rollout" | "heuristic"`,
  default `"rollout"`, a literal `if/else` around the untouched `rolloutToHorizon` call) rather than a
  magic `rolloutCapPlies: 0`.

### Candidate B — heuristic-guided rollout policy. **Rejected as first move, kept as escalation.**
Gradient only indirectly — overpaying is punished only if the simulated opponent exploits chip
advantage across many plies of imperfect play. Noisier, costlier, and **impossible at simultaneous
plies without refactoring shared code** used by every shipped game's Strong. Also introduces a real
tuning surface (greedy/epsilon mixture).

### Candidate C — shallow exact lookahead over the first auction. **Rejected.**
With uniform-rollout leaves it inherits the no-gradient defect; with heuristic leaves it reduces to A
plus a redundant maximin the tree already performs, at up to 162 evaluations per node. If "exact"
means the solver, it cannot ship and would make the acceptance test **circular** — testing the oracle
against itself.

### Refutation condition (pre-registered)

A is wrong if any of: **(R1)** the static check shows `tanh(heuristic)`'s own-bid ordering disagrees
with `optimalBids` at the root or at >20% (PROPOSED) of sampled reachable auction states — the
gradient exists but points off the optimal set; **(R2)** post-fix E-A misses §3.1; **(R3)** the
head-to-head bar fails. In one sentence: **the heuristic's untuned weights would have to misorder
bids at the states that decide the game** — which experiment 1 measures before a line is written.

---

## 2. Blast radius — verified by reading

**The byte-identity guarantee remains available.** Fadeout/Nine Grids/Tilt construct `mctsPolicy`
with at most `explorationC` (`tiers.ts:85`); a new option defaulting to current behaviour, with the
default path left as **literal untouched code**, changes nothing they execute. Crackstep and Mine Run
have no bot tiers and run through flat-MC — and **this plan edits no shared rollout code at all.**

**One caveat, stated loudly so it is never discovered later:** if A is refuted and B becomes the
remedy, **byte-identity is no longer free** — B refactors `rolloutToHorizon`, shared by every shipped
game's Strong. The replacement guard is default-path dumps for all five games plus fixed-seed
`ci-gates` captures, pre/post, plus behavioural re-runs where identity is structurally unavailable.
That cost is part of why B is not first.

---

## 3. Acceptance — defined before any fix exists

Instruments are trust-chained: `createExactOracle` (cross-checked vs brute force and the solve
report), `_c57-oracle-agreement.mts` (self-checks its clone against real `mctsPolicy` every run — any
`mcts.ts` edit requires re-mirroring), `mctsPolicyLegacy` (byte-identity-verified).

"Fixed" means **all** of:

1. **Oracle agreement (primary):** E-A at 50 seeds/cell — `P(chosen ∈ optimal) ≥ 90%` at 10k for
   **both seats**, monotone non-decreasing over {1k,2k,5k,10k} on paired per-seed differences.
   (RECOVERED thresholds; baseline to beat is **0.000**.)
2. **Value honesty preserved:** both seats' rootValue within ±0.15 of 0 at 10k. DUCT delivers ~−0.001;
   the fix must not regress it.
3. **Head-to-head — mandatory (C76):** vs `mctsPolicyLegacy`, n=200 × 2 seeds, mirrored, {1k, 10k}.
   At 10k pooled: **W > L with wins ≥ 65% of decisive games**, and W ≥ L within *each* seed (C71 —
   never a single-seed claim). **Budget trend must not decline:** (W−L) at 10k ≥ (W−L) at 1k — C76's
   signature inverted. Secondary: vs DUCT-alone must not lose; Duel Draft must not lose.
4. **Blast radius:** byte-identity diffs empty for fadeout/nine-grids/tilt; `packages/bots` green with
   no weakened assertion.
5. **Explicitly NOT acceptance:** the `b3-sweep` gate table — secondary evidence only. C74 showed its
   relief semantics changed mid-thread and C71 bars single-seed gate readings. No threshold, budget or
   `explorationC` moves (C55).

**C77 discharge — the mechanism claim gets its own test.** The asserted mechanism is *"tanh(heuristic)
at the leaf creates a monotone gradient over payment pointing at the oracle's optimal set."* Verified
independently of any win rate by (a) the static ordering check, and (b) post-fix E-A showing root
per-own-bid values actually **separated** — report best-minus-worst spread. **If the head-to-head
improves while the spread stays ≈0, the fix worked for a reason other than the claimed one, and that
gets recorded, not papered over.**

---

## 4. Sequencing against DUCT — answered by experiment, not reasoning

**Land on top of DUCT — but prove it with a 2×2 factorial.**

Expectation, stated before measuring: evaluation and selection are orthogonal. Re-landing a real
gradient on max-max should make the fantasy *sharper*, not saner — under leaf evaluation seat 0's best
**joint** arm is literally "opponent overpays 8, I bid 0" (≈ +1 after tanh), a stronger co-operator
fantasy than the one DUCT killed. So: **a correct evaluation makes DUCT's selection rule win, not
irrelevant** — C76's 300–89 should invert, because legacy's advantage was that its bias *accidentally
simulated* a gradient, and a real gradient beats an accidental one.

But C76 is standing proof that selection-rule conclusions flip under different evaluations, so the
experiment distinguishes rather than trusts: **{legacy, DUCT} × {uniform rollout, heuristic leaf}**,
each on (i) E-A agreement and (ii) round-robin head-to-head at {1k, 10k}. Zero package edits needed.

- Both heuristic arms beat both uniform arms → evaluation is the real defect (narrative confirmed as
  *mechanism*, per C77).
- DUCT+h ≥ legacy+h → selection matters once evaluation is sound; DUCT ships with the fix.
- legacy+h ≥ DUCT+h → selection irrelevant under honest evaluation; a **finding**. Tie-break still
  favours DUCT on cost and H1's independent proof — recorded as a judgement, not a measurement.
- DUCT+h ≤ DUCT+uniform → the evaluation narrative is itself refuted; stop and re-diagnose.

---

## 5. Steps — and the single experiment first

1. **Experiment 1 — the static mechanism check. Run first; it is the one to run if only one.**
   A `.scratch/` script: one `createExactOracle(8)` solve (5.1 s) plus microseconds of evaluation.
   **No search.** For the root and a sample of reachable bid-phase states from the oracle's memo,
   compare the own-bid ordering induced by `tanh(heuristic)` against `optimalBids(state, seat)`.
   **This can refute the entire recommendation for seconds of compute before any implementation
   exists**, and it is C77's mandated test of the mechanism, separate from the fix's win rate. If R1
   fires here, go to candidate B having built nothing.
2. **Experiment 2 — the 2×2 factorial**, script-level only (`rolloutCapPlies: 0` variants; re-verify
   `assertCloneAgrees` still gates every run). Judge against §3 and §4's decision table.
3. **Only then implement** `leafEvaluation` in `mcts.ts` (default preserves the literal current path),
   unit tests first; re-mirror the E-A clone; E-A at 50 seeds/cell; byte-identity diffs; head-to-head
   as the acceptance instrument; `b3-sweep` like-for-like as secondary evidence.
4. **Preserve raw outputs** under `docs/research/games/` (C67/C72) — and note the head-to-head *script*
   currently lives only in `.scratch/`; promote it alongside its `.out` in the fix commit.

**Risks:** heuristic weight scale (chip term now worth 2p vs 1/line) may misplace the win/lose
boundary — caught by experiment 1; tanh saturation compresses large deficits (ordering preserved,
magnitude flattened); single-seed variance (C71) — every criterion is multi-seed and paired; and the
standing C77 rule — **if the head-to-head improves but the gradient spread stays flat, the story is
wrong even if the scoreboard is right, and that gets its own correction.**

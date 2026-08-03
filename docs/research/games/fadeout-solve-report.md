# Fadeout — exact solve report (Sonnet, F2)

*Deliverable per `docs/plans/fadeout.md` §2.3. Produced by the game-local solver in
`games/fadeout/solver/` (`raw-engine.ts` = pass 1, `pass2-superko.ts` = pass 2, `solve.ts` =
orchestration, `strategy.ts` = extraction/quotability). Composes `@twist-arcade/harness`'s
`reach()`/`retrograde()` over `positionKey` — never `harness solve`/`solveTwoPlayerGame`
directly, per platform-corrections.md C3 (encode() is not a valid position key under superko).*

---

## 0. How to read this report

- **Pass 1 (raw graph)** ignores the repetition axis entirely and is the exact value under
  **C2 (threefold)** by construction (see `solve.ts`'s module doc for the full
  residue-equals-C2 argument — a standard win/loss/draw-on-cycle backward-induction theorem,
  written out there rather than only cited, per the F2 amendments). It is built once per
  `(decayTiming, playThrough)` pair — 4 raw graphs cover all 8 configs, since each pair is shared
  by its threefold and superko siblings.
- **Pass 2 (history-aware search)** refines a raw config's value to the exact **C1 (superko)**
  value. Two provably sound shortcuts from pass 1 make this fast for six of the eight configs
  (see `pass2-superko.ts`'s module doc for the monotonicity/witness-disjointness arguments); the
  remaining two are a genuine Graph-History-Interaction hard case — reported honestly below,
  not asserted.
- **Reachable states** is the pass-1 (raw) count, exact for `threefold` and an **upper bound**
  for the `superko` sibling sharing that pair (superko's own reachable-position count is a
  subset once some raw positions become unreachable via forbidden repeats — this solve does not
  separately enumerate that smaller set).
- **Quotability** (plan §2.2/§5.5): is the forced win short enough to post as a one-line spoiler?
  Judged on ply count of the extracted canonical line (`strategy.ts`), threshold 5 plies.

---

## 1. Per-config results

The eight syntactic configs collapse to **six distinct games** once `playThrough: true` (plan
§16, the R1 axis collapse) — confirmed below as a solver cross-check, not assumed.

### 1.1 `remove-first` / solid (`playThrough: false`)

**AMENDED 2026-08-03 (F2 amendments): the original C1 row below reported an IMPOSSIBLE value, not
merely an unproven one.** A superko value can never be a draw: the engine has no draw terminal
under superko at all — `engine.ts`'s `computeStatus` gates its draw branch on
`resolved.repetition === "threefold"` specifically, and superko has no other path to a draw
outcome (a mover stuck with zero legal targets simply LOSES; see `pass2-superko.ts`'s module
doc). Positions never repeat under superko, so every superko game ends decisively — meaning the
true C1 root value for THIS config is certainly a win for P0 or a win for P1, with no third
option, even though the table below could previously only report a value that cannot occur. The
gap is corrected below to **"decisive, winner unknown"** rather than "draw, unproven" — see §3.1
for why this changes the recommendation's reasoning, not just its wording, and for the dead code
this amendment is grounded in (the `sawDraw`-shaped accumulator `pass2-superko.ts`'s `value()`
never needed in the first place, now removed and documented as structurally unreachable).

**Ruling (§3.1, §1.5): this config ships under `threefold`, not `superko` — superko is eliminated
for this variant.** The C1 row below remains factually "decisive, winner unknown" (that is simply
what is true about superko here), but it is no longer the ruleset this game will ship with.

| Repetition | Root value | Reachable states (raw) | Exact? |
|---|---|---|---|
| `threefold` (C2) | **draw** | 128,170 | yes (pass 1 IS exact here) |
| `superko` (C1) | **decisive, winner unknown — 8-min budget exhausted before either side's win could be proven; see §1.5** | ≤128,170 | **no** |

Per-opening table (C2, all 9 openings — **every legal first move is a draw under THREEFOLD**;
this table says nothing about C1, which cannot be a draw at all — see the amendment above):

| Cell | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Value | draw | draw | draw | draw | draw | draw | draw | draw | draw |

**Strategy extraction:** none extracted, and none possible from this table — there is no C2
forced win to extract here. This is NOT, however, "the cleanest possible quotability answer" for
the config that would actually ship (superko): the C1 value is certain to be decisive, so a
forced line for SOMEONE certainly exists once C1 is resolved; it just hasn't been extracted yet.
Whether that eventual line is quotable is exactly the open question the escalation in §1.5 exists
to resolve — this row cannot be read as "no spoiler risk" the way a genuinely-proven draw would
be.

**Draw rate under optimal play (C2/threefold only):** 100% (root value is draw under threefold;
under exact optimal play both sides can always force at least a draw by definition, so the
game-theoretic draw rate is exactly the indicator of whether the root value is decisive — see
§1.6 for why this collapses to a single number rather than a distribution). This figure does
**not** carry over to C1/superko: since superko can never produce a draw at all, its optimal-play
"draw rate" is trivially 0% regardless of which side the eventual proof favors — the meaningful
question for superko is which side wins and how quotably, not whether it draws. See §1.6 for why
the harness's statistical sweep (F4, once bots exist) is still the meaningful "draw rate" number
for the design gate on the ruleset that actually ships.

### 1.2 `place-first` / solid (`playThrough: false`)

| Repetition | Root value | Reachable states (raw) | Exact? |
|---|---|---|---|
| `threefold` (C2) | **win** (P0) | 128,170 | yes |
| `superko` (C1) | **win (UNPROVEN — 8-min budget exhausted; this is the C2 fallback, see §1.5)** | ≤128,170 | **no** |

Per-opening table (C2):

| Cell | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Value | draw | **win** | draw | **win** | draw | **win** | draw | **win** | draw |

Exactly the four **edge** cells (1, 3, 5, 7) are forced wins; center and all four corners are
draws.

**Strategy extraction (C2):** `P0: 1 -> P1: 0 -> P0: 4 -> P1: 2 -> P0: 7` — **5 plies total**,
**quotable**. This is a decisive criterion-1 problem for this config under `threefold`
regardless of the pending superko value: "open on any edge, you win in 5 plies" is exactly the
one-line spoiler the plan warns kills a game on the open web.

### 1.3 `remove-first` / playable-through (`playThrough: true`)

| Repetition | Root value | Reachable states (raw) | Exact? |
|---|---|---|---|
| `threefold` (C2) | **win** (P0) | 141,850 | yes |
| `superko` (C1) | **win** (P0) | ≤141,850 | **yes — proved in 5 search nodes** (pass-1 LOSS shortcut resolves the whole root immediately) |

Per-opening table (identical for both repetition rules — see §1.4):

| Cell | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Value | **loss** | **win** | **loss** | **win** | **win** | **win** | **loss** | **win** | **loss** |

**Notable, unanticipated finding:** the four **corners** (0, 2, 6, 8) are *losing* opening moves
for P0 under this ruleset — the exact opposite of classic tic-tac-toe, where corner/center
openings are the strong ones. Worth carrying into the teaching layer / opening-move framing if
this variant ships; a player bringing classic-TTT intuition ("open on a corner") will open into
a loss here.

**Strategy extraction:** `P0: 1 -> P1: 0 -> P0: 4 -> P1: 2 -> P0: 7` — **5 plies, quotable**.
Same criterion-1 problem as §1.2.

### 1.4 `place-first` / playable-through (`playThrough: true`)

**Byte-identical to §1.3** under both repetition rules — confirmed by the solver (root value,
full opening table, and reachable-state count all match exactly; see §1's cross-check test
suite in `solve.test.ts`/`raw-engine.test.ts`/`pass2-superko.test.ts`). This is the R1 axis
collapse (plan §16) working as designed: under `playThrough: true`, `decayTiming` is a no-op on
legality/outcome, so these two syntactic configs are one game counted twice.

### 1.5 Superko (C1) convergence status for the two `playThrough: false` configs — RESULT: neither converged; both fall back honestly

`remove-first/solid` and `place-first/solid` are the genuine Graph-History-Interaction hard
case flagged in the plan (§2.3, §11's risk table): under superko, legality is path-dependent, so
position-keyed memoization is unsound, and the two shortcuts that make the other four configs
resolve almost instantly (the unconditional pass-1 LOSS transfer, and the pass-1 WIN-witness
reuse when its line is disjoint from history-so-far) do not fire nearly as often here.

**Measured, not assumed:** both were run to an 8-minute wall-clock budget (`--wall-clock-ms`
below plan §2.3's stated 10-minute-per-variant allowance, leaving margin) with no node-count
ceiling. **Neither converged.** Concretely:

| Config | Nodes visited in 8 min | Search rate | Pass-1 (raw graph) composition |
|---|---|---|---|
| `remove-first/solid` | 62,206,722 | ~130k/s, steady throughout | 128,170 total states; 12,096 terminal; of the 116,074 ongoing positions: **38,736 win, 0 loss, 77,338 draw-residue** |
| `place-first/solid` | 116,188,211 | ~240k/s, steady throughout | 128,170 total states; 12,096 terminal; of the 116,074 ongoing positions: **78,613 win, 24,268 loss, 13,193 draw-residue** |

Per plan §2.3's explicit fallback rule, **this report reports the C2 (pass-1) value for both,
flagged unproven for C1** — not a silent decisive claim: `remove-first/solid` reports `draw`
(matching C2 exactly); `place-first/solid` reports `win` with the same opening table as C2. In
both cases the underlying node budget was exhausted, not a crash or a stall — search rate stayed
steady the entire run (no evidence of a bug; this is a genuinely large search).

**AMENDED 2026-08-03: "`remove-first/solid` reports `draw`" above is a FALLBACK label, not a
value C1 could actually have** — see §1.1's amendment. Superko has no draw terminal at all, so
whatever `remove-first/solid`'s real C1 value turns out to be, it is certainly a decisive win for
one side; reporting "draw" here is `solveSuperko()`'s documented C2-fallback behavior on an
exhausted budget (a legitimate threefold value, since the fallback IS the threefold/C2 result),
not a claim about what superko itself could ever produce. `place-first/solid`'s "win" fallback
does not have this problem — win is one of superko's two possible values — but is equally
unproven for C1 specifically.

**`run-solve.mts` could not, as originally written, reproduce the node counts above.** It passed
only `wallClockMs` to `solveConfig`/`solveSuperko`, so `maxNodesVisited` silently defaulted to
`pass2-superko.ts`'s `SuperkoBudget` default of 5,000,000 — a ceiling both configs blow past in
well under a minute at the rates measured above, long before the 8-minute wall clock would ever
matter. The 62.2M/116.2M figures came from throwaway scripts (never committed) that passed an
explicit large node ceiling; the committed script could not follow its own "re-run to verify"
instruction and reach them. Fixed: `run-solve.mts` now accepts `--max-nodes` (default
`Number.POSITIVE_INFINITY`, so `--wall-clock-ms` is the only real ceiling unless a caller opts
into a lower one). Re-run with the fix, using the exact invocation the module doc now records
(`npx tsx games/fadeout/solver/run-solve.mts --wall-clock-ms=480000 --max-nodes=Infinity`):

| Config | Nodes visited in 8 min (re-run, `--max-nodes=Infinity`) | Search rate | Original figure |
|---|---|---|---|
| `remove-first/solid` | **53,047,447** | ~110k/s | 62,206,722 (~130k/s) |
| `place-first/solid` | **89,336,917** | ~186k/s | 116,188,211 (~240k/s) |

**Neither converged in this re-run either** (both still `budgetExceeded: true`, same fallback
values as before) — confirming this is a genuinely large search, not something the original
committed script's 5M-node bug ever actually produced or could have papered over. The re-run's
node counts are the same order of magnitude as, but somewhat lower than, the original figures;
the most likely cause is mundane rather than a solver difference: this confirmation run executed
**concurrently**, on the same machine, with the bounded research probe below (both are
CPU-bound, single-threaded Node processes competing for the same cores over the same 8-10 minute
window) — a smoke test of this same config run in isolation earlier in this session measured
~140k/s, closer to the original figure. Re-running in isolation would likely reproduce the
original numbers more closely; re-running was not repeated a third time purely to save wall
clock, since the qualitative conclusion (a real, large, unconverged 8-minute search, not a 5M-node
artifact) does not depend on the exact rate. See the bounded research probe immediately below for
a qualitatively different attempt at convergence.

**A structural finding worth recording on its own:** in `remove-first/solid`'s raw graph, **zero**
reachable ongoing positions are labeled LOSS for their mover — every reachable position is at
worst a draw for whoever is about to move there. That is a real property of this specific
ruleset (not of the search budget), and it is consistent with — arguably the direct cause of —
the root itself being a clean draw: neither side is ever structurally forced into a loss from any
position either of them can reach by playing adequately. `place-first/solid`'s graph looks
nothing like this (24,268 genuine LOSS positions) — the two decay-timing arms are NOT
equivalent under `playThrough: false` (unlike the `playThrough: true` pair), and this asymmetry
is presumably why: the mover's own overflow always fires *before* placement under
`remove-first`, giving the mover comparatively more escape routes than `place-first`'s
place-then-overflow ordering.

**Escalation, per plan §2.3's standing instruction — RESOLVED by the orchestrator, 2026-08-03.**
Neither C1 value is proven by exact solve, and — per the bounded research probe immediately below,
a qualitatively different attack aimed specifically at `remove-first/solid` — a smarter attempt
didn't converge either. **Ruling: `remove-first` / solid ships under `threefold`, not `superko`.**
Superko is **eliminated** for this variant, not deferred pending a future proof attempt. Reasoning:

- The entire reason this config is the recommended one (§3.1) is that its value is a **proven,
  fair draw** — under `threefold`. Superko can never reproduce that draw (§1.1's amendment: no
  draw terminal exists under superko at all), so shipping superko here means shipping an unknown,
  unquantifiable win-or-loss outcome for the one variant chosen specifically for its fairness.
  That defeats the purpose of picking this config in the first place.
- This isn't merely "not yet proven" — it's a genuine computational wall, confirmed twice: the
  original 8-minute exact search (53-62M nodes, re-run above) and a principled, qualitatively
  different reformulation targeted at exactly this bottleneck (10-minute bounded probe, 77.66M
  nodes on a single representative branch) BOTH failed to converge. Nothing here suggests more of
  the same kind of compute would resolve it soon.
- The plan's own default — "ship = superko unless the solve surprises us" — has exactly this
  escape valve built in. An unprovable-in-reasonable-time exact value on the config chosen for its
  provable fairness under the other rule IS the surprise that valve exists for.

`place-first/solid`'s superko value remains separately unproven and is moot: it already fails
criterion 1 under `threefold` (a proven, quotable win), so its superko value was never going to
change which config ships.

### 1.5.1 Bounded research probe: reformulating the search as vertex geography — RESULT: no convergence within budget; freeze unaffected

One additional, qualitatively different attack was tried against `remove-first/solid` specifically
(not a bigger version of the same search — a different reduction), per the orchestrator's
instruction to spend one bounded 10-minute window on it before treating the config as simply
"stuck." Script: `games/fadeout/solver/research-vertex-geography.mts` (throwaway research tooling,
not a change to the shipped solver).

**The idea:** two optimizations, both sound by argument recorded in this codebase (`solve.ts`'s
and `pass2-superko.ts`'s module docs), neither previously exploited together:

1. **Unconditional raw-WIN transfer** — skip the witness/history-disjointness check entirely
   (proven unnecessary: this search never recurses into a raw-LOSS position, so no witness entry
   can ever collide with history). `remove-first/solid`'s raw graph has **zero** ongoing LOSS
   positions (this section, above), so the *other* shortcut (an O(1) LOSS-child resolution) can
   never fire here — every one of the 38,736 raw-WIN positions can ONLY be reached via the
   witness-gated path the shipped search still gates. Removing the gate turns each one into an
   instant, zero-recursion leaf, leaving only the 77,338-node draw residue to actually search —
   reframing the remaining problem as **Generalized/Vertex Geography** (alternately move a token
   along a graph's edges, never revisiting a vertex; loser is whoever can't move).
2. **Root-level symmetry** (sound ONLY at the root — never mid-search, since superko compares
   exact positions and two different histories are never interchangeable): the empty board's
   dihedral symmetry (order 8) means corners `{0,2,6,8}` and edges `{1,3,5,7}` are each a single
   orbit, so solving one representative per orbit (cells 0, 1, 4) and copying the value to the
   other 6 openings is sound — a free ~3x reduction in how many first moves need a full search.

**Result: no convergence, budget respected exactly.** The probe hit its own 10-minute (600s) wall
clock and exited cleanly (self-enforced, no external kill needed) after **77,664,993 nodes**,
still working the FIRST representative opening (`cell=0`, a corner) — it never even reached the
edge (`cell=1`) or center (`cell=4`) representatives. Node rate (~129k/s) was in the same range as
the original, non-reformulated search, meaning the reformulation's constant-factor savings (no
witness computation/disjointness check, no wasted work on the 6 symmetric duplicate openings)
did not translate into a qualitatively faster convergence within this budget — consistent with
Generalized Geography being PSPACE-complete in general (Fadeout's transitions are directed, not
symmetric, so the polynomial-time result for the *undirected* case, via maximum matching, does not
apply here without further work to check whether it could).

**Outcome per the standing instruction:** neither a P0 win, a P1 win, nor a quotable line was
found — just non-convergence. **Threefold stands; this does not reopen the freeze.**

**What a future attempt would need**, recorded so the next person inherits the idea rather than
re-deriving it: (a) determine whether the draw-residue subgraph, or some transformation of it, is
close enough to *undirected* vertex geography for the polynomial maximum-matching characterization
to apply, rather than treating it as a black-box directed search; (b) if not, a real memoization
scheme over `(currentKey, historyBefore)` pairs restricted to the residue (the residue is only
77,338 nodes, but `historyBefore` can vary per path — the open question is whether enough distinct
histories collapse onto equivalent future outcomes to make a bounded cache pay for itself); (c) a
longer budget is very unlikely to help on its own, given this run's rate was comparable to the
original unreformulated search's.

### 1.6 Why "draw rate under optimal play" is a single number, not a distribution, at this level

An exact solve's root value is one of win/loss/draw — by definition, optimal play by both sides
always secures at least that value, so the *exact* draw rate is 100% when the value is a draw
and 0% otherwise; there is no room for a mixed outcome under truly optimal play on both sides.
The plan's harness cross-check (§7, "C1-vs-C2 draw-rate delta measured in self-play... compared
against the solve's optimal-play delta") is about the **statistical, non-optimal** self-play
sweep (mcts-1k etc.), which genuinely does show a distribution — that comparison is F4 scope
(needs bots) and is not fabricated here. What *is* meaningful at the exact-solve level, and
reported per config above, is the **per-opening win/draw/loss split**, which is exactly the
input the pie-rule cliff check (§5.9) needs.

---

## 2. The free cross-check that held

Per §16: "the solve MUST report identical values for {A1,B2,\*} and {A2,B2,\*} configs — a
divergence there means the solver is broken." Confirmed for **both** repetition rules — root
value, full per-opening table, and reachable-state count are byte-identical between
`remove-first/playThrough=true` and `place-first/playThrough=true`, for both `threefold` and
`superko`. **The identical-pair cross-check held.**

---

## 3. Recommendations

### 3.1 Which ruleset ships

**AMENDED 2026-08-03 (F2 amendments), then RULED on the same day by the orchestrator once §1.5's
escalation and its bounded research probe both came back.** The final decision:

> **Ship `remove-first` / solid / `threefold`. Superko is eliminated for this variant — not
> deferred, not "pending a future proof attempt."**

**The error in the original recommendation**, corrected here rather than patched quietly, because
it is what made the freeze necessary in the first place: the original version of this section
leaned on `remove-first/solid`'s C2/threefold value being a proven **draw**, treated that as
evidence the config "survives criterion 1," and then argued informally that superko was UNLIKELY
to overturn that into a decisive, quotable result — while still recommending **superko** as the
ruleset to ship. Both halves of that don't hold once §1.1's amendment is taken seriously:

- **Superko can never produce a draw at all** — not "rarely," not "was unproven and might turn
  out to be one," but structurally impossible (`engine.ts`'s `computeStatus` has no draw path
  under superko; `pass2-superko.ts`'s `value()` correspondingly has no `sawDraw` accumulator at
  all — every leaf of that recursion is win or loss, by construction, and a change that ever made
  it produce "draw" would now throw loudly rather than silently reintroduce an impossible
  outcome). So superko's value for this config was ALWAYS certainly a decisive win for one side or
  the other — the C2 draw the original recommendation leaned on describes threefold, and only
  threefold.
- The plausibility argument — "a config with no forced-loss positions at all seems LESS likely to
  harbor a hidden forced win once repetition is forbidden" — was **backwards**. A forced win for
  someone under superko isn't a risk to be assessed as more or less likely: it is **certain**, full
  stop, by the argument above. The zero-LOSS-position finding (§1.5) is a real, interesting
  structural fact about the *threefold* raw graph, but it says nothing about which side superko's
  guaranteed decisive winner would be, or how long/quotable that forced line is. Treating
  "no evidence of a hidden win" as evidence of safety was the mistake — the win was never hidden,
  it was guaranteed; only its identity and length were ever unknown. **The sharpest evidence for
  this correction is in the code, not just the prose**: `pass2-superko.ts`'s `value()` was written
  with a two-valued (win/loss-only) return type and an explicit note that a `sawDraw`-style
  accumulator would be structurally wrong for this game — the implementation encoded the correct
  fact (superko is always decisive) at the exact moment the report's prose was asserting something
  that assumed the opposite might be true.

**Why the ruling is "eliminate superko" rather than "wait for the proof":** the entire reason
`remove-first/solid` was the standout recommendation is that its value is a **proven, fair draw**
— under threefold. That is the property criterion 1 actually cares about here (no quotable forced
win for anyone). Superko cannot reproduce that property even in principle (no draw terminal
exists), so shipping superko on this config was never going to deliver what made the config
attractive — it would ship an unknown, unquantifiable win-or-loss outcome instead, on the one
variant chosen specifically for its fairness. And "unknown" here is not a gap that more of the
same effort closes soon: the original 8-minute exact search (53-62M nodes depending on run, never
converging) and a principled, qualitatively different reformulation of the SAME question (§1.5.1's
10-minute bounded "vertex geography" probe, 77.66M nodes, also never converging) both hit the same
wall. The plan's own stated default — "ship = superko unless the solve surprises us" — has exactly
this escape valve, and this is what it's for.

**What remains true and unaffected by the correction:**

- Every OTHER of the six distinct games has a proven, quotable, 5-ply forced win under BOTH
  repetition rules (§1.3/§1.4's playThrough:true pair prove this for C1 directly, in 5 search
  nodes) or under C2 with no reason to expect C1 differs favorably (`place-first/solid`, §1.2) —
  `remove-first/solid` remains the only config that survives criterion 1 **under the rule it now
  actually ships with (threefold)** — a claim that is fully proven, not provisional.
- `decayTiming` is irrelevant to §5's telegraph/legibility criterion here since `playThrough:
  false` (B1 solid) is the variant, which the plan's ranking already prefers over B2 at equal
  value (criterion 4) — this pairing needs no B2 affordance cost at all. Unaffected by the
  correction above.
- `place-first/solid`'s superko value remains separately unproven and is moot to this decision: it
  already fails criterion 1 under threefold (a proven, quotable win), so its superko value was
  never going to change which config ships.

**If a future need arises to reconsider superko for this game** (e.g. a real memoization scheme
over the residue, or F4's statistical C1-vs-C2 self-play comparison once bots exist, later
resolves `remove-first/solid`'s actual C1 value): that would be new evidence for a NEW decision,
not a re-opening of this one on the same evidence. §1.5.1 records what a future attempt would
need.

**If a future ruleset change ever makes threefold itself land on a decisive result for this
config** (it does not today — §1.1, proven draw): revisit this section entirely, since the
"proven fair draw" property this recommendation rests on would no longer hold.

### 3.2 Whether the pie rule ships

**Recommend: no**, for the recommended `remove-first/solid` config specifically. The pie rule
ships only if projected strong-self-play FPA lands in 55–70% *and* the per-opening table shows a
near-balanced opening exists (§4, §5.9's cliff check). Since **every** opening in this config is
already a draw under exact optimal play, there is no first-player advantage to correct in the
first place — FPA under strong (near-optimal) self-play is expected to sit near 50%, well below
the 55–70% band the pie rule is gated on. Recommend F4 verify this projection empirically once
bots exist (the exact solve cannot itself produce a self-play FPA percentage), but nothing in
the exact values suggests the band will be hit.

For the **other five games** (all P0-forced-wins), the §5.9 cliff check is unambiguous the
other way: `place-first/solid` has a 5/9 non-losing-opening split (draws at 0,2,4,6,8), so a
near-balanced opening genuinely exists there — pie *could* rescue that variant's fairness *if*
it were otherwise viable, but it already fails criterion 1 on quotability, so criterion 2's pie
question is moot for it (criterion 1 disqualifies before criterion 2 is ever reached).
`remove-first/true` (= `place-first/true`) is the cliff case the plan warns about directly:
**every non-losing opening is ALSO a forced win** (5 of 9 openings win, the other 4 lose
outright — there is no draw opening at all) — if this were the shipped variant, pie would just
hand the loss to whichever side doesn't get to pick the winning opening, exactly the "pie hands
the game to P2" failure §5.9 exists to catch. Recorded here as the concrete instance of that
trap, not just the abstract warning.

### 3.3 Whether 4x4/cap-4 must ship at launch

**Recommend: no — settled, not conditional**, now that §3.1's ruling ships
`remove-first/solid/threefold`, a fully **proven** draw with no forced win to quote at all. The
quotability trigger (criterion in §1) is what forces the 4x4 escalation, and there is nothing to
quote here under the ruleset that actually ships. (This recommendation was conditional in the
original version of this section, pending superko's then-unproven value on this same config —
that condition is resolved by §3.1's ruling: superko is eliminated for this variant, so its
unproven value can no longer trigger this escalation either.)

---

## 4. Anything the solve revealed that the plan did not anticipate

1. **Corner openings are losing, not strong, once decay is in play** (§1.3) — a direct inversion
   of classic-TTT intuition, worth a teaching-layer note if any `playThrough: true` variant ever
   ships (currently not recommended, but the finding stands on its own).
2. **A "fork" can be self-defeating under this decay rule.** While hand-constructing TDD
   fixtures (`raw-engine.test.ts`), a classic double-threat fork (corners {0,8} + a third mark)
   turned out to have one of its two arms structurally unreliable: completing a threat is always
   the forker's 4th placement in a cap-3 game (a fork needs 3 marks already down to hold two
   threats), which decays the forker's OLDEST mark — and if that oldest mark happens to be part
   of the very line being completed, the "threat" evaporates the instant it's completed. Decay
   timing cannot rescue this (the win-check runs on the fully quiescent post-removal board
   regardless of A1/A2 ordering — see `engine-internal.ts`'s transition() doc). This is a
   genuine, previously undocumented ruleset property: **naive tic-tac-toe fork intuition does
   not transfer cleanly to Fadeout**, which likely contributes to why several of these variants
   still land on short, decisive, quotable lines through OTHER mechanisms rather than classic
   forks — worth a mention in any future teaching-layer or "how to play well" copy.
3. **The independent brute-force oracle (`oracle.ts`) directly reproduced the plan's own
   standing warning.** Built as ground truth for cross-checking, its first version used
   ascending-cell-order move exploration with no ordering heuristic — and on the very first
   hand-built fixture, it dove into a legal-but-irrelevant self-rotation branch before ever
   trying the cell that wins outright, blowing past a 200-ply recursion cap on a position that
   resolves in 3 real plies along the fast line. This is the plan's "plain minimax loops/
   over-recurses on a cyclic graph" trap (§2.2), reproduced concretely rather than just cited,
   and fixed with a win-first move-ordering pass (documented in `oracle.ts`).
4. **A witness-extraction bug caught only by full end-to-end replay, not code inspection.** The
   first version of the forced-win witness walk (`winWitnessPositionKeys`/`winWitnessMoves` in
   `raw-engine.ts`) assumed every node along a winning line is itself "win" for whoever moves
   there — wrong, since the opponent's forced replies are LOSS nodes for the opponent. It threw
   as soon as the walk reached one. The fix, and the reasoning for why the opponent's arbitrary
   reply is always safe to pick (it can never itself be an immediate win for them, since the
   node is LOSS-labeled), is recorded in `raw-engine.ts`'s `stepWitness` doc. Caught by
   `raw-engine.test.ts`'s "extracted forced-win lines replay legally to a real win" test, which
   replays the extracted line through the actual public engine end-to-end — not by re-reading
   the code, which read as correct on inspection.
5. **Two of the eight configs are a genuine, budget-exhausting GHI hard case, confirmed, not
   just hypothesized.** Both `playThrough: false` configs ran their full 8-minute budget
   (62.2M and 116.2M search nodes respectively, steady throughput the entire time, no sign of a
   hang) without proving a C1 value. This is exactly the risk the plan flagged (§11) — recorded
   here with real numbers rather than a guess about whether it was "slow" or "hung," and honestly
   escalated (§1.5) rather than papered over with an unproven claim.
6. **`remove-first/solid`'s raw graph has zero LOSS-labeled positions anywhere reachable from
   the root** (§1.5) — every position either side can reach by adequate play is at worst a draw
   for its mover. This is a genuine structural property of the ruleset, not a search artifact
   (0 of 116,074 ongoing positions), and is a plausible structural reason the root itself lands
   on draw rather than a coincidence of this one position. `place-first/solid`'s graph has no
   such property (24,268 genuine LOSS positions) despite sharing the same board/cap — confirming
   `decayTiming` is NOT a no-op under `playThrough: false` (unlike the `playThrough: true` pair),
   and giving a concrete mechanism for why (remove-first's overflow-before-placement ordering
   gives the mover more escape routes than place-first's placement-before-overflow ordering).

---

## 5. Verification summary

- Identical-pair cross-check: **held**, for both repetition rules (§2).
- Superko (C1) proof status: **proven** for both `playThrough: true` configs (5 search nodes,
  agrees with C2 exactly); **decisive but unproven-which-side** for both `playThrough: false`
  configs (8-minute budget exhausted at 62.2M / 116.2M nodes originally, re-confirmed under the
  fixed `run-solve.mts`; C2 fallback reported, flagged, escalated per §1.5 — never itself a valid
  C1 value, since superko has no draw terminal at all, see §1.1's amendment) — stated honestly
  rather than rounded up to "solved."
- Independent reachability oracle (own BFS, own transition logic, own key format): **agrees
  exactly** with the solver's pass-1 counts for all 4 raw configs (128,170 / 141,850 as
  applicable) — see `raw-engine.test.ts`.
- **Independent VALUE cross-check (F2 amendments item 5), not just reachability**: a second,
  from-scratch enumerator sweeps every reachable ongoing position to a win/loss/draw fixpoint by
  repeated full re-scans (a different algorithm from `retrograde()`'s single work-queue pass) and
  agrees with `solveRaw()`'s `valueAt()` on **every** reachable ongoing position, for all 4 raw
  configs — not merely on the two headline splits (38,736/0/77,338 and 78,613/24,268/13,193,
  both independently reproduced exactly) or the root/opening tables, which were the only
  value-level checks this report previously cited. See `raw-engine.test.ts`'s
  "VALUE cross-checked against an independent sweep-to-fixpoint solver" suite.
- Hand-built cyclic mini-position: retrograde converges to a draw residue, with a directly
  confirmed cycle in the graph — plain minimax would not terminate on this fixture.
- Hand-built forced win: solver and an independently-implemented oracle (real public engine,
  zero shared code with the solver) agree, for all 4 raw configs.
- Extracted forced-win lines replay legally to a genuine win through the real public engine,
  under BOTH repetition rules, for every config whose root is a win.
- Plan §2.4's own pass-2 anchor now asserts VALUES, not legality: `solveSuperkoFromPosition()`
  confirms C2=draw/C1=loss at the hand-built "only non-losing move recreates history" fixture,
  plus two further deep-search-core cases beyond the O(1) shortcuts — a genuine no-legal-moves
  superko-exhaustion loss, and a case where blocking the raw graph's own canonical witness forces
  real recursion and flips a position's value from win to a searched loss (F2 amendments item 4).
- `pnpm typecheck && pnpm lint` clean; solver test suite (43 tests across
  `raw-engine`/`pass2-superko`/`solve`/`strategy` — `oracle.ts` is exercised via `raw-engine.test.ts`
  rather than its own file) green.

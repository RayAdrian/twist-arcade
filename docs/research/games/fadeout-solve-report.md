# Fadeout — exact solve report (Sonnet, F2)

*Deliverable per `docs/plans/fadeout.md` §2.3. Produced by the game-local solver in
`games/fadeout/solver/` (`raw-engine.ts` = pass 1, `pass2-superko.ts` = pass 2, `solve.ts` =
orchestration, `strategy.ts` = extraction/quotability). Composes `@twist-arcade/harness`'s
`reach()`/`retrograde()` over `positionKey` — never `harness solve`/`solveTwoPlayerGame`
directly, per platform-corrections.md C3 (encode() is not a valid position key under superko).*

---

## 0. How to read this report

- **Pass 1 (raw graph)** ignores the repetition axis entirely and is the exact value under
  **C2 (threefold)** by construction (see `raw-engine.ts`'s module doc for the residue-equals-C2
  argument). It is built once per `(decayTiming, playThrough)` pair — 4 raw graphs cover all 8
  configs, since each pair is shared by its threefold and superko siblings.
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

| Repetition | Root value | Reachable states (raw) | Exact? |
|---|---|---|---|
| `threefold` (C2) | **draw** | 128,170 | yes (pass 1 IS exact here) |
| `superko` (C1) | **draw (UNPROVEN — 8-min budget exhausted; this is the C2 fallback, see §1.5)** | ≤128,170 | **no** |

Per-opening table (C2, all 9 openings — **every legal first move is a draw**):

| Cell | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| Value | draw | draw | draw | draw | draw | draw | draw | draw | draw |

**Strategy extraction:** none — there is no forced win to extract. This is itself the cleanest
possible quotability answer: nobody can post a spoiler for a line that doesn't exist.

**Draw rate under optimal play:** 100% (root value is draw; under exact optimal play both sides
can always force at least a draw by definition, so the game-theoretic draw rate is exactly the
indicator of whether the root value is decisive — see §1.6 for why this collapses to a single
number rather than a distribution, and why the harness's statistical sweep is still the
meaningful "draw rate" number for the design gate).

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

**Escalation, per plan §2.3's standing instruction:** neither C1 value is proven. The
recommended next step — explicitly named in the plan for exactly this outcome — is a
statistical C1-vs-C2 draw-rate comparison from harness self-play (F4, once bots exist), which
this exact solve cannot itself produce. **This is escalated to the orchestrator as an open item**
rather than resolved here by assumption. §3.1 below gives a recommendation that is explicit
about resting on the unproven C2-fallback value, not a proven C1 result.

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

**Recommend `remove-first` / solid (`playThrough: false`) / `superko`, with the C1 proof gap
stated explicitly rather than papered over.** Reasoning:

- It is the **only** one of the six distinct games whose value is a **draw** (C2, exactly
  proven) — every other variant is a decisive win for P0 with a 5-ply, plainly quotable forced
  line (criterion 1: "a quotable forced win = that variant is dead"). `remove-first/solid` is
  the only candidate that survives criterion 1 on the evidence in hand; the other five games all
  fail it outright.
- Superko over threefold per the plan's stated default ("ship = superko unless the solve
  surprises us") and per game-theory-lens' general argument (guaranteed termination by
  construction). Nothing in the C2 value or the raw-graph composition (§1.5: zero LOSS positions
  anywhere in the reachable graph) suggests superko would flip this to a decisive, quotable
  result — if anything, a config with no forced-loss positions at all seems LESS likely to
  harbor a hidden forced win once repetition is forbidden, not more — but this is a plausibility
  argument, not proof, and is flagged as such.
- **The C1 (superko) value for this exact config is UNPROVEN** (§1.5: 62.2M search nodes in 8
  minutes, budget exhausted, C2 fallback reported). This recommendation is therefore
  conditional on the escalation in §1.5 being resolved — via either a longer/smarter solve
  attempt or F4's statistical C1-vs-C2 self-play comparison — before the ruleset freeze is
  finalized. Shipping on the C2 value alone, without that resolution, would be exactly the kind
  of unproven claim plan §2.3 says not to make.
- `decayTiming` is irrelevant to §5's telegraph/legibility criterion here since `playThrough:
  false` (B1 solid) is the variant, which the plan's ranking already prefers over B2 at equal
  value (criterion 4) — this pairing needs no B2 affordance cost at all.

**If the escalation in §1.5 later shows `remove-first/solid` is NOT a draw under superko** (a
decisive win/loss once proven, or a longer non-quotable forced line): re-open this
recommendation using whichever new evidence resolves it. A decisive-but-non-quotable long forced
line would still be shippable per criterion 1's second clause; the escalation path itself
(statistical C1-vs-C2 comparison via harness self-play, F4) is the one the plan already
prescribes for exactly this situation.

**If superko instead turns out to ALSO be decisive-and-quotable for `remove-first/solid`**
(i.e., no variant among all eight survives criterion 1 once C1 is actually known): this is
criterion 5's territory — declared manifest `exceptions[]` entry, mandatory pie rule, **and**
the 4x4/cap-4 escalation at launch, all confirmed as within this team's own scope (plan §14 Q2).
That would be a materially different launch than the one recommended above, so it is flagged
here explicitly rather than silently assumed away.

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

**Recommend: no**, conditional on §1.5 confirming `remove-first/solid`'s superko value is a draw
(or a non-quotable decisive result). The quotability trigger (criterion in §1) is what forces
the 4x4 escalation, and the recommended config has no forced win to quote at all. If §1.5
instead lands in criterion 5's territory (see §3.1's second contingency), 4x4/cap-4 **would**
be required at launch per that criterion, and this recommendation reverses.

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
  agrees with C2 exactly); **unproven** for both `playThrough: false` configs (8-minute budget
  exhausted at 62.2M / 116.2M nodes; C2 fallback reported, flagged, escalated per §1.5) — stated
  honestly rather than rounded up to "solved."
- Independent reachability oracle (own BFS, own transition logic, own key format): **agrees
  exactly** with the solver's pass-1 counts for all 4 raw configs (128,170 / 141,850 as
  applicable) — see `raw-engine.test.ts`.
- Hand-built cyclic mini-position: retrograde converges to a draw residue, with a directly
  confirmed cycle in the graph — plain minimax would not terminate on this fixture.
- Hand-built forced win: solver and an independently-implemented oracle (real public engine,
  zero shared code with the solver) agree, for all 4 raw configs.
- Extracted forced-win lines replay legally to a genuine win through the real public engine,
  under BOTH repetition rules, for every config whose root is a win.
- `pnpm typecheck && pnpm lint` clean; solver test suite (34 tests across
  `oracle`/`raw-engine`/`pass2-superko`/`solve`/`strategy`) green.

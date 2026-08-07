# Order vs Chaos — Implementation Plan (Fable, 2026-08-07)

*Team: `order-vs-chaos`. Supabase: not started — client-only feature (synthesis §2.6).
Sources: `game-theory-lens.md` §1.8/§2/§4#4, `synthesis.md` §3#4, `roadmap.md` §Phase 1/§6,
`platform-corrections.md` C3/C4/C5/C13/C14/C16/C19/C20/C22–C29, `docs/plans/fadeout.md`
(house plan shape). This plan produces no implementation code.*

**The game.** Asymmetric tic-tac-toe on 6×6. Both players place X *or* O on any turn.
**Order** (seat 0) wins on any 5-in-a-row of either symbol; **Chaos** (seat 1) wins if the
board fills without one. Rule sentence (canonical, 87 chars):
**"Both players place X or O. Order wins with 5 in a row; Chaos wins if the board fills."**

**The governing rule: gates before UI (C16).** No board is built until the balance
measurement is on the record and the orchestrator freezes the config. Wrap had a complete
board before anyone measured it; that is the mistake this ordering exists to prevent.

---

## 1. How this game is gated — the asymmetry question, answered plainly

### 1.1 The shipped gate table CAN judge this game — by a confound worth naming

In this game **seat and role are the same thing**: seat 0 is Order in every game. So the
`first-player-win-rate` gate, run on Order vs Chaos, measures **Order's win rate at equal
bot strength** — which is exactly the role-balance question this game poses. The band
[35, 65] then reads: *neither role dominates at the strength the bots actually play*. That
is a defensible single-game ship bar, and role-swap series alternation (the shell's
existing seat alternation — swapping seats here swaps roles for free) is the series-level
device on top, per game-theory §1.8.

**Platform finding, stated rather than worked around:** the gate *report* will label this
number "first-player win rate," which for an asymmetric game is a misnomer — the quantity
is "seat-0 role win rate," and the two config variants below (Order-first vs Chaos-first)
change tempo and role together, which the gate cannot distinguish by name. The gate is the
right instrument here only because role is bound to seat. A future asymmetric game where
role is *chosen* (e.g. role-choice-as-pie) would break this confound and the gate table
would genuinely not apply. Recommend the gate row carry a manifest-declared label; not a
blocker for this game.

### 1.2 "Order wins 6×6 with correct play" is a hypothesis, not relief

The lens reports 6×6 as an Order win under correct play. **C14 is the precedent for
distrusting exactly this**: a perfect-play claim is not a prediction about equal-budget
MCTS, and Wrap's predicted first-player edge was measured as a 76% *second*-player edge.
Two consequences:

1. **No gate relief.** C23's mechanism (`solvedValue` + proof pointer → FPA reports `n/a`)
   exists in `packages/harness/src/suites.ts` and is self-policing — but relief requires a
   **proof artifact**, and "widely reported" is not one. This game ships
   `solvedValue: { value: "unknown" }` and the [35, 65] band applies in full.
2. **If a genuine 6×6 proof artifact ever arrives** (it will not come from us — §2), relief
   goes through C23, and note what that costs: `solved-value-reached` would then *demand*
   self-play reach the proven value ≥90% of the time. Proof-of-Order-win and a 35–65%
   measured rate are mutually exclusive regimes. We occupy the honest one: unknown, band
   applies, measurement decides.

**Judgment, stated for the orchestrator:** the shipped gate table can judge this game.
No `exceptions[]` entry, no waiver, no new gate machinery is needed for the ship decision.
The one platform gap it exposes is cosmetic-but-real (the gate's name) plus the C27
`deferred` status dependency in §4.

### 1.3 The degeneracy arithmetic (C20's lesson, run before anything is built)

C20 killed Wrap 5×5 on `C(5,4) = 5 = wrap-window count` — a free pencil check that was
skipped. The analogue for full-board maker-breaker chassis: **windows per line**.

| Config | Win-windows total | Windows per row/col | Verdict |
|---|---|---|---|
| 6×6, win 5 | 32 (12 rows + 12 cols + 8 diag) | 2 | **Sound** — blocking costs position; each cell sits in up to 9 windows |
| 6×6, win 6 | 14 | **1** | **Rejected by arithmetic** — one wrong-symbol placement kills an entire line forever; blocking maximally over-efficient; the Wrap shape |
| 5×5, win 5 | 12 | **1** | **Rejected** — same degeneracy |
| 6×6, win 4 | 54 | 3 | **Rejected** — expected monochromatic windows in a random fill ≈ 6.75; nearly every filled board contains a line; Chaos structurally hopeless, and 4-in-a-row double-threat play is quotable |

Proposed as the game-theory-lens general check (companion to C16's §5.12):
**full-board line games require win length ≤ board dimension − 1** (≥2 windows per line).

---

## 2. Exact solve: infeasible on size, and cleanly so (C3)

**C3's structural test passes.** Cells only fill and never empty; there is no repetition
rule and no history-dependent legality; `toMove` is derivable from fill parity plus the
first-mover config. The game graph is a **DAG** — positions cannot recur — so `encode` *is*
a valid position key and the generic solve machinery is structurally applicable. Fadeout's
seam does not exist here.

**Size kills it anyway.** 3^36 ≈ 1.5×10^17 raw; symmetry (÷8) and reachability pruning do
not bring this within orders of magnitude of the ~10^7 ceiling. **No solve is attempted at
6×6.** `solvedValue: { value: "unknown" }`; no relief follows (C23).

**Optional yardstick calibration (feeds risk R3, §6): exact-solve 4×4/win-4.** 3^16 ≈ 43M
raw, ÷8 symmetry, acyclic → memoized negamax at depth ≤16 completes in minutes-to-hours.
This proves **nothing** about 6×6 balance (C25: a number is evidence about the board it was
measured on) — its sole use is C6 yardstick validation: confirm equal-budget MCTS self-play
converges to the proven 4×4 value in *this game family*. If the bots cannot find a proven
value on 16 cells, no 6×6 measurement number is evidence.

---

## 3. Ruleset: what ships, what is held, what is rejected

**Ships (config A):** 6×6 · win length 5, counted as "5 **or more** in a row" (a 6-run
contains a 5-window and wins) · both players may place either symbol on any turn (this
freedom *is* the twist; a fixed-symbol variant is a different, weaker game and is rejected
without measurement) · **Order moves first** (seat 0) · win check runs on **every**
placement regardless of placer — Chaos completing a line loses · a line created by the 36th
placement is an Order win (win check precedes board-full check; pinned) · board full with
no line → Chaos wins. **No draw terminal exists** — the `draw-rate` gate passes at 0% by
construction, and termination is structural at ≤36 plies (any harness cap hit is an engine
bug).

**Held in reserve, pre-registered (the config ladder, max two measured configs — C20's
"no third board" discipline):**
- **Config B — Chaos moves first.** Deployed iff A measures Order >65%. It hands the tempo
  to the defender, and measuring it also de-confounds seat-tempo from role strength.
- **Config C — 7×7, win 5.** Deployed iff A measures Order <35% (the prior disfavors this
  direction). More room favors the maker.

**Kill rule, fixed before the number (C14/C20):** if config A lands outside [35, 65] and
the one indicated fallback (B or C, by direction) also lands outside, **Order vs Chaos is
killed** and the slate slot passes to the fast-follow queue. A second failure on the same
chassis indicts the matchup at bot-playable strength, not the parameters.

---

## 4. Gate cost and the CI-vs-nightly call (C19, C22, C25, C27)

**No imported budget.** Fadeout's 3,000 is evidence about a 9-cell board; Nine Grids' 1,500
about its board (C25). The budget for this game is derived on this board, in this order:

1. **15-game cost pilot** — cost measurement only; **15 games is no evidence of a verdict**
   (C26: Nine Grids' 15-game pilot read 13.3% on a game that measured 46%).
2. **Budget validation sweep** at 100 games — one fixed seed across all budgets, the
   varying parameter **never** templated into the seed (C24). Criterion per C22: the
   cheapest budget whose FPA and mean-plies match the 10,000-rollout baseline (draw rate is
   identically 0 here, so it cannot discriminate).
3. The winner goes into `ciGateBudget.twoPlayerCiRollouts` — **mandatory**, since the
   shipped ruthless tier (10,000) exceeds `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE` (3,000) and
   `runCiSuite` refuses without it (C22).

**Estimate (to be replaced by the pilot):** cost ≈ games × plies × rollouts × rollout
length. 300 games × ~30 mean plies × ~2,000 rollouts × ≤36-step rollouts is the same order
of work as Nine Grids' measured run (300 × 50.2 × 1,500, ~17 min). Root branching is 72
(36 cells × 2 symbols) — the library's highest — but rollouts are cheap flat fills.
**Predicted: ~15–30 min for the full three-matchup table at a ~2,000-rollout CI budget;
~1.5–2.5 h at the 10,000-rollout nightly budget.**

**Call: nightly for the full table; per-PR CI runs the contract/property suite only
(seconds).** The gate-before-UI measurement itself is a one-off offline run and is
unaffected. **Dependency, verified against code:** `GateStatus` is still
`pass | fail | warn | "n/a"` — C27's required `deferred` status does not exist. Until it
lands, the balance rows must be *absent* from PR-tier reports (with a stated reason), never
`n/a` — `n/a` means "does not apply," and these gates apply nightly. Same conflation C27
recorded for Mine Run.

`ruthless-vs-standard` under an active CI override reports `n/a` citing the override (C26
ruling — already the platform's obligation, noted here so the report is read correctly).

---

## 5. Acceptance criteria (stage-3 derives cases from these, not from the code)

Engine (`games/order-vs-chaos/engine.ts`, against `@twist-arcade/engine`, TDD):

1. Move = `{ cell: 0–35, symbol: "X" | "O" }`. Legal iff status ongoing and cell empty;
   both symbols legal for both seats always; `legalMoves.length === 2 × empties`;
   `isLegal ⟺ legalMoves` (contract).
2. Status ∈ `ongoing | won(0) | won(1)`. Never `draw`, never `lost`.
3. Any placement creating a ≥5 same-symbol run (row/col/either diagonal) →
   `won(orderSeat)` — **including a placement by Chaos** (pinned test: Chaos completes a
   line, Order wins).
4. 36th placement, no line → `won(chaosSeat)`. 36th placement creating a line →
   `won(orderSeat)` (precedence pinned).
5. A 6-run wins (contains a 5-window; pinned test).
6. Perfect information: `playerView` = identity, `V = S`; deterministic setup; seeded Rng
   unused; no `Math.random` (lint).
7. `encode` = cells + toMove + config id, excluding effects. `decode` **throws typed
   errors** (C4) on: wrong length, invalid symbols, fill-count/toMove parity mismatch, any
   5-run present while status is `ongoing`, full board with no line while `ongoing`, status
   inconsistent with board.
8. Effects, overwritten every apply: `placed {seat, cell, symbol}` always; `line {cells}`
   on the winning apply (UI highlight + share hook).
9. Structural termination: ≤36 plies; zero cap hits across the full harness sweep.
10. `probes.ts`: `mirrorMove` (point reflection, same symbol — 6×6 has no
    reflection-fixed cell, so mirroring is available on every move and the probe is
    **load-bearing**, per C16's caveat) **plus a game-local pairing-bot probe** as Chaos:
    fixed domino pairing of the 36 cells; answer the opponent's cell with its partner
    carrying the window-poisoning symbol. **Gate: pairing bot as Chaos <40% vs Strong
    Order.** If a naive pairing bot holds Strong, Chaos has a googleable one-sentence
    defense and the game dies on the strategy-description-length test.
11. Manifest: `solvedValue: { value: "unknown" }`; `ciGateBudget.twoPlayerCiRollouts` from
    §4's sweep; tiers as rollouts budgets (starting values 100 / 1,000 / 10,000, retuned on
    this board); no `exceptions[]`.
12. Share artifact: **not designed in this plan.** Every artifact claim is a hypothesis
    until swept against ≥2,000 real games (C12, C18), and the sweep must be of the
    per-game statistic the artifact prints, not a pooled distribution (fadeout.md §16).
    Candidates to sweep in OV3: move-timeline with the line-completing move marked;
    "filled n/36"; dead-windows count at game end.
13. Role presentation: status line, result modal, and share frame say **"Order" /
    "Chaos"**, never "X wins" — X and O carry no allegiance in this game. Needs a shell
    seam for game-supplied seat labels (open question Q3).

---

## 6. Risks, ranked — cheapest disconfirming experiment first (C20/C29)

| # | Risk | Cheapest disconfirming experiment | Cost |
|---|---|---|---|
| R1 | **Rollout blindness (C6 shape):** if almost all uniformly-filled 6×6 boards contain a 5-run, MCTS rollouts carry no Chaos signal and every self-play number measures the yardstick, not the game | Script: sample 10k uniform random filled boards, measure P(contains a ≥5-run). Expected ≈ 0.8 (32 windows × 2·2⁻⁵ ⇒ ~2 expected mono windows; Poisson P(none) ≈ e⁻² ≈ 0.14, correlations raise it). **If ≥0.95, escalate before any gate run** — heuristic-guided rollouts become a design decision | ~50 lines, minutes. **Runs first** |
| R2 | **Role imbalance** — the killer. Hypothesis: Order wins ~75% (70–80) at equal ~2k-rollout MCTS, outside band. Direction held with low confidence (C14) | The config-A gate run itself (§4 pipeline). Ladder per §3; second out-of-band result kills the game | pilot + sweep + one 100-game run |
| R3 | **Extreme number, ambiguous cause:** a >80% or <20% reading could be the game or blind bots | The 4×4/win-4 exact-solve calibration (§2): bots converge to a proven value on the small board ⇒ the 6×6 number is about the game | minutes–hours, only if triggered |
| R4 | **Gate unaffordable** (C19/C27) | The 15-game cost pilot before any 100-game run; if the validated-budget table exceeds ~45 min, nightly-only + the `deferred` prerequisite | 15 games |
| R5 | **Branching 72 vs the design-gate band 4–30** | Report it honestly; symbol choices are near-transpositional early. Design-gate judgment item, not tuned around | free |
| R6 | **Share artifact saturation** (C12/C18) | Sweep the per-game printed statistic across ≥2,000 games before freezing; blocks OV3's share freeze, nothing else | one sweep |

---

## 7. Sequencing (C16 explicit: engine → gates → freeze → UI)

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **OV0** | R1 line-probability script; arithmetic checks (done, §1.3); TDD anchors enumerated | nothing | OV1 |
| **OV1** | Engine + contract suite + probes (incl. pairing bot) + manifest, TDD. Scaffold via `pnpm new-game` — then **unregister until gates are green** (C28: the scaffold registers unconditionally; that inverts gate-before-UI) | M1/M2 (shipped) | OV2 |
| **OV2 — the gate** | Cost pilot (15 games, cost only) → budget sweep (one seed, C24) → config-A 100-game run → ladder decision → **orchestrator reviews numbers, freezes config** | OV1, C13's `--game` filter (shipped) | OV3, OV4 |
| **OV3** | Board UI, teaching (Sentence → role cards → first-line/first-poison callouts), announce(), share artifact **after** the R6 sweep. Chrome polish per C5 (motion narrates; the win-line highlight and role labels are the authoritative static encodings) | **config freeze (OV2)** + shell | playtest |
| **OV4** | Tier tuning on this board, design-gate report (incl. mirror, pairing, comeback, opening concentration, branching judgment) | OV2 | OV5 |
| **OV5** | Both gates on the record; nightly wiring; hotseat playtest framed as role-swap pairs | OV3 + OV4 | merge |

---

## 8. Open questions for the orchestrator (Q1–Q2 block OV2's report; Q3 blocks OV3 only)

1. **Confirm the gating position (§1):** FPA gate applies as the role-balance instrument;
   `solvedValue: unknown`; no `exceptions[]`; relief only ever via C23 with a real proof
   artifact.
2. **C27's `deferred` status is unimplemented** (verified: `GateStatus` has no such
   member). Sequence it before OvC's PR-tier report, or accept balance rows absent-with-
   reason at PR tier (never `n/a`).
3. **Shell seam for role labels** ("Order"/"Chaos" in status line, result modal, share
   frame) — does the shell contract support game-supplied seat labels? If not, a small
   shell addition routed through the orchestrator, not sideways.
4. **Confirm the pre-registered kill rule** (§3): max two measured configs; second
   out-of-band result kills the game and promotes the next queue item.

## 9. Definition of done (observable)

- [ ] R1 script run; result on the record before any gate run
- [ ] `engineContract` green; all §5 pinned cases green; zero cap hits
- [ ] Budget derived on the real board (pilot + single-seed sweep, C24/C25); manifest
      `twoPlayerCiRollouts` set from it
- [ ] Config-A 100-game gate table on the record; ladder decision made by the rule fixed
      in §3, not after the number
- [ ] Mirror probe and pairing-bot probe measured; pairing <40% as Chaos
- [ ] Design-gate report reviewed (branching judgment, opening concentration, comeback,
      quotability)
- [ ] Share statistic swept per-game across ≥2,000 games before format freeze
- [ ] Role labels correct in every surface; grayscale test; cells ≥48 px at 320 px
      (6×6 ⇒ ~53 px — passes without exception); route ≤75 kB gz
- [ ] Nightly runs full budgets; PR CI runs contract suite; no balance row reported `n/a`
      at PR tier

---

## 10. Orchestrator rulings (2026-08-07)

All four open questions are answered in `platform-corrections.md` **C31**. In summary:

**Q1 — confirmed.** The FPA gate applies as the role-balance instrument, `solvedValue` is
`{ value: "unknown" }`, no `exceptions[]`, and relief only ever via C23 with a real proof
artifact. The naming confound is recorded as a platform finding, not worked around.

**Q2 — the `deferred` status is being built** (team `deferstatus`, C27). Until it lands,
balance rows are **absent-with-reason** at PR tier, never `n/a`.

**Q3 — approved.** No seat-label seam exists in `packages/game-spec/src/presentation.ts`;
add one through the orchestrator, not sideways between teams.

**Q4 — confirmed, and binding.** Max two measured configs; the kill rule is fixed *before*
the number and may not be revised after it. Only the user may waive a gate finding.

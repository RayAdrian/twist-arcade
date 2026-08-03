# Mine Run — Implementation Plan

*Fable implementation plan, 2026-08-02. Team: `minerun` (worktree `../claude-project-minerun`,
branch `feature/minerun`). Sibling flagship plan: `docs/plans/fadeout.md` — same rigour bar.*

*Sources: `docs/research/games/solo-games-lens.md` (primary — §1.7 press-your-luck, §1.8
puzzle⇄chase reframe, §2 score-chase format constraints, §3 validation model, §3.6 probes,
§3.8 threshold table, §4 engine deltas, §5 anti-cheat posture, §6 share artifacts, §7 row 2,
§8 launch guardrails), `docs/plans/phase-0-platform-spine.md` (§3 contract, §5 manifest solo
block, §6 safeMove requirement, §7.3–§7.5 solo suite and gates), `docs/research/games/ux-lens.md`
(§1, §2, §5, §8–§10), `docs/roadmap.md` §6.*

**What Mine Run is.** Press-your-luck minesweeper: the deduction chassis of minesweeper,
reframed from "clear the board" into a **seeded, bounded score chase**. You reveal squares to
grow a streak whose per-reveal value escalates; you may bank the streak at any time; a mine
wipes whatever is unbanked. Daily mode: one public seed, one fixed reveal budget, everyone on
the identical board, compared on banked score. Per solo-games-lens §2, the seeded+bounded frame
is what keeps a score chase rankable — an unbounded endless mode is unranked dessert and is not
in this plan.

---

## 1. The ruleset — decided

**Rule sentence (82 chars, frozen unless the harness forces a mechanic change):**

> Reveal squares to grow a streak; bank anytime — a mine wipes your unbanked streak.

The sentence deliberately omits the escalation curve (R5): the HUD teaches it in the player's
first three taps (+1, +2, +3 ticking up), which is the telegraph layer doing its job. One
delta, one sentence — escalation is the *scoring rule* of the one press-your-luck twist, not a
second twist.

### 1.1 Rules, exact

- **R1 — Board.** 10×10 grid, 20 mines (20% density), generated at `setup(1, rng)` — all
  placement randomness through the engine `Rng`. Revealed cells show the classic neighbor-mine
  count. `meta`: `minPlayers: 1, maxPlayers: 1, hiddenInformation: true, simultaneous: false,
  stochastic: false` (all chance is at setup; `apply` never draws — the uncertainty is hidden
  information, not stochasticity; this drives the Strong-agent design in §4.4).
- **R2 — Opening.** Setup selects (via rng) one zero-count cell and pre-reveals it plus its
  flood region before the first move. The opening region costs no budget and scores nothing.
  Everyone on a daily seed starts with the identical opening information — there is no blind
  first click, ever (an uninformed opening gamble fails the same test Battleship's opening
  failed, lens §1.7). Setup retries placement (drawing further from the same rng, hence
  deterministic) until a zero cell exists; after a bounded number of attempts it falls back to
  the minimum-count cell. No first-click mine relocation — relocation would fork the board per
  player and destroy daily comparability.
- **R3 — Moves.** `M = { t: "reveal"; cell: index } | { t: "bank" }`. Reveal is legal iff the
  cell is unrevealed and `revealsLeft > 0`. Bank is legal iff `streakLen ≥ 1`. Revealing an
  already-revealed cell is illegal. There is no pass move and no flag move (flags are
  board-UI annotations, §8.4 — never engine moves, never in the replay).
- **R4 — Reveal, safe.** Revealing a safe cell shows its count and consumes 1 from the reveal
  budget. Revealing a 0 flood-fills its region (classic behavior) for that same single budget
  unit; **every cell opened by the flood advances the streak counter** (each earning its
  incremental value per R5). Zero-hunting is thereby a skill, not a free lunch — floods are
  rare at 20% density and predicting them is inference. *(Fallback pre-authorized for tuning:
  if the Strong-CV gate (>1.2 hard, 0.25–0.7 target) is blown by flood variance, flood cells
  reveal information but only the clicked cell advances the streak. Harness decides, §4.6.)*
- **R5 — Score.** The *i*-th consecutive safe reveal since the last bank/wipe is worth *i*
  points; an unbroken streak of *n* is worth *n(n+1)/2*. Escalation is what prices banking:
  banking early forfeits growth, so bank can be a free action (R6) without "always bank"
  becoming optimal. Escalation is polynomial, not exponential — score stays close enough to
  linear-in-achievements for the §3.2 ratio gates (typical streaks are risk-bounded to ~5–15),
  so the manifest declares `comparisonMetric: "score"`; the harness additionally logs
  `safeReveals` per run as a sanity proxy, and if the ratios look quadratically inflated the
  suite recomputes on the proxy (lens §3.2 scale caveat, honored rather than gamed).
- **R6 — Bank.** Banking moves the streak's value into `banked` (permanent — mines can never
  touch banked points), resets the streak to 0, and consumes **no** budget. Because bank
  requires `streakLen ≥ 1`, two consecutive banks are impossible (load-bearing for §4.1).
- **R7 — Mine.** Revealing a mine: the cell becomes revealed-exploded (permanently visible —
  a hit is costly but *informative*: that mine is now located and out of the danger pool), the
  unbanked streak is wiped to 0, and 1 budget is consumed. A mine hit **never ends the run**.
- **R8 — Termination.** The run ends when `revealsLeft` reaches 0, or when every safe cell is
  revealed (unreachable at launch parameters, kept for parameter safety). At the terminal, any
  surviving streak is **auto-banked** (emitting a `banked` effect) and status becomes
  `{ kind: "scored", scores: [banked] }`. No forced formality tap to bank on the last move.
- **R9 — Terminal statuses.** `ongoing → scored`, always. Mine Run **never emits `lost`**
  (nor `won`/`draw`): a mine is a setback inside a run, not a failure terminal, and a 0-point
  run is `scored: [0]`. The testkit's solo branch enforces the discipline.
- **R10 — Budget.** `revealsLeft` starts at **60** (fixed, identical for every player on a
  daily; not seed-varied). 60 < ~70 hidden safe cells, so full-clear is not the game — the
  budget, not the board, is the scarce resource. Expected run: ~60 reveals + ~5–10 banks ≈
  65–70 decisions, inside the 60–250 design band (§3.7 of the lens) at ~2–4 minutes.
- **R11 — `score()`**. Returns `banked` — monotone (manifest `scoreMonotone: true`), and equals
  `scores[0]` at the terminal because auto-bank folds the streak in first. The at-risk streak
  is HUD state, not `score()` — the harness's learning curves and the share artifact's
  progress line track what the player has actually secured.
- **R12 — Structural bound.** Every reveal strictly decrements budget; banks cannot chain
  (R6); so a run is ≤ 2·60 + 1 = 121 moves. Manifest `solo.moveCap: 400` is a pure tripwire,
  never the terminator.

Launch parameters `{ w: 10, h: 10, mines: 20, budget: 60, increment: +1/reveal }` are declared
tunable by the harness within: density 18–22%, budget 50–75. The rules R1–R12 are not tunable;
the numbers are.

### 1.2 Alternatives rejected, on the record

| Alternative | Why rejected |
|---|---|
| **Sudden death** (mine ends the run) | Early mines dominate outcomes → CV blows past 1.2; every run's story becomes "died at move 12"; contradicts the lens §6 share shape, which shows multiple 💥 per run. Wipe-not-kill keeps variance in band and gives runs an arc. |
| **Lives (3 mines end the run)** | Second rule for no structural gain — the budget already terminates. Revisit only if the harness shows degenerate late-run mine-spam (it shouldn't: spam costs budget, the actual scarce resource). |
| **Doubling multiplier (×2 per reveal)** | Exponential score voids the §3.2 ratio gates and reads as slot-machine theatrics. Triangular escalation gives the same bank/push tension with measurable ratios. |
| **Flat 1 point per reveal** | Banking becomes free in every sense → "bank before every gamble" is optimal → Always-Safe ≡ Strong → automatic §3.6 failure. This is the broken version §4.2 describes. |
| **Bank costs a reveal** | Double-charges caution; escalation already prices banking. Also makes the last-move bank a cruel tax. |
| **First-click mine relocation** (classic) | Boards diverge per player → daily comparability dies. Fixed pre-revealed opening region instead (R2). |
| **Flags as engine moves** | Flags are memory aids, not decisions; as moves they'd pollute the replay, the budget semantics, and the decision-count metrics. UI-local annotation (§8.4). |
| **Stop-anytime, keep remaining budget as bonus** | Converts the game into leave-early optimization and makes the budget a second currency; one resource maximum (lens §1.3). |
| **Unbounded endless as the ranked mode** | Constitutionally excluded — unbounded chases compare persistence, not skill (lens §2). |

---

## 2. Why the press-your-luck layer creates a real decision

Classic minesweeper is a deduction puzzle whose terminal question is binary. Mine Run keeps
100% of the deduction machinery and adds the one decision class solo classics lack: **a choice
about variance** (lens §1.7 — optimal stopping with a posterior-dependent threshold).

**What the player is trading.** At streak *k*, the next reveal of a cell with posterior mine
probability *p* risks *k(k+1)/2* unbanked points to gain *k+1* now plus the escalating
continuation. Banking first keeps *k(k+1)/2* for certain but restarts the escalator at +1.
So pushing is a bet of the *streak's current value* against the *escalation differential* —
and both sides of the bet move during play: *k* grows, *p* varies per cell and per information
state, and the shrinking budget horizon discounts the continuation.

**Where deduction enters — five distinct places:**

1. **Proven-safe chains.** Constraint propagation over the revealed numbers finds cells that
   are safe in every consistent world — free streak growth. Finding more of them than your
   rival on the same board is classic minesweeper skill, fully preserved.
2. **Proven mines.** Never reveal them at streak > 0 (blunder); their identification also
   tightens every neighboring constraint.
3. **Posterior comparison.** When no proven-safe cell exists, frontier cells have *different*
   computable posteriors (16% vs 45% is the whole game); non-frontier cells have the
   background rate. Choosing *which* cell to push into is deduction, every time.
4. **Zero-hunting.** Predicting likely 0-cells (flood jackpots, R4) from the numbers.
5. **Value of information / ordering.** Even among safe cells, reveal *order* matters — a
   reveal that unlocks a constraint chain is worth more than its face value, because it
   converts future gambles into future certainties.

**Why "always continue" and "always bank at N" both fail here — and how we check it.** With a
*fixed* risk *p*, triangular scoring gives a closed-form threshold (~bank at k ≈ 2(1−p)/p) —
which would be a memorizable constant and a dead game. Mine Run's *p* is not fixed: it is 0 on
proven-safe cells (always continue through those), varies across the frontier with the
information state, and the bank decision also depends on remaining budget (horizon) and board
state (what a wipe would cost in *tempo*, not just points). Risk price is also state-dependent
in the other direction: at streak 0 a gamble risks nothing but budget, so probing suspected
cells to buy information is correct exactly when the streak is empty — a genuinely
minesweeper-flavored tactic no fixed threshold captures.

**Harness confirmation (game-local design probe, beyond the standard gates):** the
**fixed-threshold sweep**. For k = 2…15, run the policy "reveal proven-safe when available,
else bank at streak ≥ k, else reveal the minimum-posterior cell" over the paired seed set.
**Design gate: the best fixed-k policy ≤ 90% of Strong's median.** If any constant-k policy
reaches ≥95%, the banking decision is a googleable sentence and the game fails the
strategy-description-length test (roadmap §6) regardless of the standard probes passing. This
sweep is the direct, mechanized answer to "is the game a slot machine with homework."

The density knob is what keeps both halves alive: at 20%, deduction locks up regularly (so
Always-Safe stalls and risk must be taken — §4.2), but the numbers still carry real signal (so
Greedy beats Random and Strong beats Greedy). Density 12% (beginner-classic) would make
deduction near-complete → Always-Safe ≈ Strong → fail; density 30% would make numbers nearly
useless → Greedy ≈ Random → fail. 20% ± 2 is the tuning window (§1.1).

---

## 3. Hidden information: state, view, redaction, generation

### 3.1 State and view (types as spec — implementation is Sonnet's)

```ts
// games/mine-run/engine.ts — shapes only; field names binding, layout free
interface MineRunState extends WithEffects {
  readonly mines: readonly number[];       // sorted cell indices — THE secret
  readonly revealed: readonly number[];    // sorted; includes exploded cells
  readonly exploded: readonly number[];    // sorted subset of revealed
  readonly streakLen: number;
  readonly streakValue: number;            // n(n+1)/2 running total — stored, not recomputed
  readonly banked: number;
  readonly revealsLeft: number;
}
type MineRunMove = { t: "reveal"; cell: number } | { t: "bank" };

interface MineRunView extends WithEffects {
  // Revealed cells ONLY — keyed by index, value = { n } or { exploded: true }.
  // Unrevealed cells are structurally ABSENT: the view type has no field that could
  // carry an unrevealed cell's contents. Omission, never masking (platform §3 contract).
  readonly cells: Readonly<Record<number, { n: number } | { exploded: true }>>;
  readonly minesTotal: number;             // 20 — public, printed in the HUD (informed odds)
  readonly minesExploded: number;
  readonly streakLen: number; readonly streakValue: number;
  readonly nextGain: number;               // streakLen + 1 — the HUD's "+k" chip
  readonly banked: number; readonly revealsLeft: number;
}
```

Numbers are derived from `mines` at reveal time and carried in the view per revealed cell (the
view cannot recompute them — it has no mine list). `encode` is canonical, excludes
`lastEffects`, and — unlike Fadeout — **`encode` IS a valid position key** here: Mine Run has
no history-dependent legality, so the generic Grind cycle-detection and any solver hashing on
`encode(S)` apply without a seam. Stated so nobody imports Fadeout's `positionKey` pattern
where it isn't needed.

### 3.2 The redaction path

`playerView(state, 0)` builds `V` by *construction from the revealed set* — it never copies
the grid and deletes; there is no code path in which an unrevealed cell's identity exists in
`V`. `lastEffects` flows through the same single path: effects are emitted by `apply` already
in public vocabulary — `revealed {cell, n}` (one per cell, floods emit one per flooded cell),
`exploded {cell, streakLost}`, `banked {points}` — all describing now-public cells, so the
redaction filter is the identity *today*, but it structurally exists so a future debug or
telemetry effect carrying layout data is caught, not shipped. **A `revealed` effect is fine; an
effect that references an unrevealed cell is a bug the contract test must catch.**

Contract wiring (`meta.hiddenInformation: true` makes `secretExtractor` mandatory):
- `secretExtractor(state)` returns distinctive serialized tokens for the unrevealed-mine list
  (the exact canonical fragment `"mines":[…]` plus per-mine tokens in an encoding that cannot
  collide with legitimate view numbers — implementation must pick a collision-proof token
  format, e.g. tagged strings, and prove it with a self-test).
- A structural assertion beyond the platform's string-walk: `Object.keys(view.cells) ⊆
  revealed` across random playouts.
- Mutant test: a planted variant whose `apply` emits `{ type: "nearMiss", mineAt: … }` must
  fail the redaction property (TDD anchor, §10).
- Spectator view `playerView(state, null)`: identical to the player view while ongoing; once
  terminal it may reveal the full layout (post-game "show me the mines" — explicitly permitted
  by platform §3).

### 3.3 Generation and replay verifiability

All generation is in `setup` via the engine `Rng` (R1–R2); `apply` draws nothing. With
`rngFor(matchSeed, k)` per-step forking, one seed reproduces the identical layout and opening
region on every replay — the testkit's determinism-through-generation property covers Mine Run
with zero new machinery, and leaderboard verification (§5) regenerates the board from the seed
rather than trusting the client. The honest limit stands (lens §1.2/§5): the layout is in
client memory, so fog is honor-system against devtools; redaction makes *replays* well-defined,
not clients secret-proof.

---

## 4. Degeneracy analysis — the hard section

### 4.1 Grind: structural proof of termination

Claim: **no zero-risk unbounded scoring loop exists — no cycle of any length can repeat.**
Every legal move strictly advances a monotone: `reveal` strictly decreases `revealsLeft`
(and strictly grows `revealed` — even mine hits reveal their cell, R7); `bank` requires
`streakLen ≥ 1` and sets it to 0, so a second consecutive bank is illegal (R6). Therefore any
two moves strictly decrease the lexicographic measure (`revealsLeft`, `streakLen`) and no state
ever recurs; total moves ≤ 121 (R12). The move budget alone would *not* be a sufficient story
if banks were unrestricted (a bank-spam cycle would be a zero-risk, zero-score infinite loop —
degenerate for the move-count metrics and the 2,000-move cap even at score delta 0); the
`streakLen ≥ 1` precondition is the second, necessary half of the device. The Grind probe
(cycle search on `encode(S)`) should find nothing; the TDD anchor plants a mutant with
streak-0 banks legal and asserts the probe trips (§10).

**Broken Mine Run, Grind signature:** a build where re-revealing a revealed cell is legal and
scores, or where bank is legal at streak 0 — the probe reports a length-1 or length-2 cycle
with score delta ≥ 0 and termination risk 0, and CI hard-fails.

### 4.2 Always-Safe and the required `safeMove` hook

Per platform §6/§7.4 the harness **hard-errors** without a per-game `safeMove` for every
score chase. Export from `games/mine-run/probes.ts`:

```ts
// probes.ts — spec. "Provably safe" = safe in EVERY mine assignment consistent with
// the VIEW (full frontier CSP, not single-point deduction — see below). View-honest:
// computes only from revealed information; never reads state.mines.
export function safeMove(state: MineRunState): MineRunMove;
// 1. If a provably-safe unrevealed cell exists → reveal it (prefer the one that is
//    provably safe AND provably 0 if any, else any provably-safe cell).
// 2. Else if streakLen ≥ 1 → bank.
// 3. Else (streak 0, nothing provable) → reveal the minimum-posterior frontier cell
//    (background-rate cell if it's lower). The bot must move; what makes it "Always-Safe"
//    is that it never CARRIES a streak into an unproven reveal — it banks before every gamble.
```

**Why full CSP and not single-point deduction:** the Always-Safe gate asks whether the risk in
"press your luck" is real *for a player who extracts everything deduction offers*. A
single-point-only safeMove would understate safe play; human experts would out-deduce the
probe, and the game could pass the ≤95% gate while expert play is actually riskless — a false
pass. "Provably safe" therefore means: safe in all consistent assignments, computed by exact
enumeration over frontier connected components with the global mine-count coupling handled by
convolving per-component count distributions (standard minesweeper CSP; frontiers on a 10×10
board are small). Component-size cap with a sampling fallback for pathological frontiers
(rare at this scale; the fallback marks cells "not provably safe," which only makes the probe
more conservative, never unsound in the dangerous direction... note the asymmetry: the fallback
may *miss* safe cells, weakening Always-Safe — acceptable for the probe only if rare, so the
harness logs fallback frequency and the design review checks it is <1% of decisions).

This CSP module is written once and consumed three times: `safeMove`, the posterior sampler
`sampleConsistentState` (§4.4), and — later, shell scope — the hint feature. One module, three
consumers, all view-honest by construction.

**How the Always-Safe↔Strong gap arises (the design intent, falsifiable):** Always-Safe's
score ≈ value of deduction-reachable chains, banked before every forced gamble — its streaks
restart at +1 after every lock-up, and at 20% density lock-ups are frequent. Strong carries
streaks *through* selected low-posterior cells, keeping the escalator running; the escalation
differential minus expected wipes is the gap. Target ≤70% (design), hard fail ≥95%. Tuning
levers if the gap is too small: raise density within the window (more lock-ups, safe play
stalls sooner) or steepen the increment (continuation worth more). If the gap is too *large*
(Always-Safe < ~40%: deduction hardly pays → legibility risk), lower density.

**Broken Mine Run, Always-Safe signature:** flat scoring (1/reveal) or density 12% — the probe
lands at 95–100% of Strong because banking costs nothing or gambling is never necessary. The
implementer should see this once on purpose: the tuning notebook (§9 MR3) runs the flat-scoring
variant to watch the gate trip before trusting it.

**Reveal-budget scarcity is a precondition, not a tuning detail (platform-corrections.md C6,
found during the C6 close-out).** The Always-Safe↔Strong separation above assumes the reveal
budget is a REAL constraint. Where `revealsLeft budget == totalCells`, every policy — Always-
Safe, Greedy, Strong, a coin-flip — simply clears the whole board eventually regardless of
strategy, and the gate shows ZERO separation at ANY mine density: raising or lowering density
per the tuning levers above does nothing, because there was never a scarce resource to trade
risk against. A ratio computed under this configuration is not weak evidence of a healthy or
broken game; it is not evidence at all. `games/mine-run/probes.ts`'s
`assertRevealBudgetScarcity(budget, totalCells)` throws `RevealBudgetNotScarceError` whenever
`budget >= totalCells` — every board configuration fed to the Always-Safe gate (the harness's
own Mine Run mutant fixtures included) calls it before trusting a ratio, so this is an enforced
precondition, not merely a comment for the next implementer to remember.

### 4.3 Greedy-Only

Greedy = 1-ply over the game heuristic (§4.5). It does local deduction and takes the best
immediate EV but cannot value information, horizon, or streak trajectory. Design gate: Greedy
≤90% of Strong; hard fail S/G < 1.15. **Broken signature:** if posteriors barely differ across
frontier cells (density too low/high) or escalation is too shallow to reward multi-step streak
planning, Greedy ≈ Strong — the game is one visible trick. The fixed-k sweep (§2) usually
fails first in this world; both are reported.

### 4.4 Strong-agent honesty — load-bearing for every gate

This is Mine Run's sharpest platform interaction. The harness's Strong (beam / flat-MC)
receives full `S` — which contains the mine layout. **An omniscient Strong never hits a mine
and invalidates the entire gate table** (ratios inflated, Always-Safe comparison meaningless,
and the future hint feature — which is Strong, per platform §6 — would be a cheating hint).
Every policy and probe for Mine Run must be **view-honest**: decisions computed only from
information a player could have.

Decided mechanism: Mine Run implements the optional `sampleConsistentState(view, rng)` hook
(the CSP module sampling consistent worlds), and Strong = **flat-MC over determinized worlds**:
for each candidate move, sample K consistent layouts, roll out with the greedy policy to
terminal, average, pick the best; 200 ms/move. This is determinization-lite, far short of the
deferred ISMCTS wrapper (platform non-goal), but it is not the stock `flat-mc` policy either —
stock flat-MC rolls out through the true state. **Open question O1** (§12): whether the
`flat-mc` policy in `packages/bots` grows a "determinize via `sampleConsistentState` when
`meta.hiddenInformation`" mode (small, reusable for Fog Sweep/Fog Pools later — recommended),
or Mine Run ships a game-local Strong policy the harness references by manifest `PolicySpec`.
Either way the seam routes through the orchestrator per CLAUDE.md §4 — not sideways.

**Enforcement, not convention — the view-honesty test (TDD anchor):** fix a mid-run view;
resample the hidden layout via `sampleConsistentState` with different rng; assert
`safeMove`, `heuristic`-greedy, and Strong (same policy rng) choose the **identical move**
across resampled worlds. Any policy that peeks at `state.mines` fails immediately. This test
is cheap and closes the entire class of bugs.

### 4.5 Heuristic (spec for `heuristic.ts` — Greedy's brain, ~20-line spirit)

View-honest, from the single-point fixpoint (cheap tier of the CSP): (1) mark forced mines
(count equals unrevealed neighbors) and forced-safe cells to fixpoint; (2) per-cell risk =
max over adjacent constraints of remaining-mines/unrevealed-count, background rate off-frontier;
(3) 1-ply EV: proven-safe reveal ≻ (bank vs best-risk reveal by immediate expected points).
Deliberately weaker than `safeMove`'s full CSP — Greedy is the "notices the obvious" rung and
must stay simple; the gap between single-point and full-CSP deduction is part of what Strong
and Always-Safe have over Greedy.

### 4.6 Standard gate expectations (solo-ci table, platform §7.5)

All rows apply as-is. Notes where Mine Run has specifics: run length median ~65–70 decisions
(band 15–600 hard, 60–250 target) · cap hits: impossible by R12 · ceiling pile-up: no design
cap exists (floods make the supremum soft), so the gate is expected trivially green — reported
anyway · CV: the watched metric for the flood-scoring decision R4, with the pre-authorized
fallback if >0.7 sustained after density/budget tuning · Strong/Random ≥ 3.0 target on
`comparisonMetric: "score"` with the `safeReveals` proxy cross-check (R5).

---

## 5. Score verification and integrity

Submission = `(gameId, engineVersion, seed, moveLog)` — platform `replay()` regenerates the
board from the seed, validates every move, and **recomputes the score; the claimed score is
discarded** (platform §3.3). Verifiable: layout, legality, streak arithmetic, budget
accounting, final banked score, restart-free single-log integrity. Not verifiable, accepted
per the lens §5 posture: who played (a CSP solver plays perfectly), attempt count beyond the
server's first-view stamp, and fog-peeking (the daily seed is public, so anyone can regenerate
the layout offline and submit a "perfect" run).

Mine Run-specific honesty note: because the daily seed is public, the fog-peek attack is
*trivial* here — a peeker's signature is a near-ceiling score with zero exploded mines and no
banking caution. Posture (lens §5, adopted verbatim): every board entry is a verified replay;
daily per-seed boards reset daily, one submission per user id; **percentile framing over
ranks** ("top 18%", robust to a handful of solver runs at the top); friend boards primary;
statistical flag-and-exclude (zero-💥 + near-ceiling frequency) from the percentile pool,
never visible punishment. No all-time solo boards.

---

## 6. Daily mode

- **Seed:** public daily formula (daily team's `dailyFormula(gameId, engineVersion, day)`).
  No certificate — certificates are the *puzzle* pipeline; a score chase ships on the
  distribution gates instead (roadmap §6 solo parallel gate). What replaces the certificate as
  the bad-day guard: a nightly smoke over upcoming daily seeds asserting setup succeeds
  (zero-cell exists without deep fallback) and the opening region is within a sane size band
  (say 4–20 cells) — a dull daily is tolerable (lens §2), a broken one is not.
- **Bounded:** budget 60, identical for all (R10). Turn-quantized, no wall-clock anywhere.
- **Comparable because:** same layout + same pre-revealed opening (R2) + same budget + same
  scoring + `comparisonMetric: "score"` + verified replays + **no undo in the daily**
  (orchestrator decision, confirmed: no undo in any daily) + **restarts counted and carried
  in the result** — the share artifact and result screen tag the attempt ("2nd run", §7), and
  the server first-view stamp bounds silent retry-scumming.
- Free play (non-daily): random seed, same rules and budget, unranked; undo permitted there
  per ux-lens §1 (solo learning tool). Restart is always available; daily restarts are counted,
  not forbidden.

---

## 7. Share artifact (lens §6 constitution: spoiler-free, ≤7 lines, body = run rhythm)

Body = the bank/wipe sequence in order: `🏦n` per bank (*n* = points banked), `💥` per mine
hit. Header = score + percentile (see O3). Stat line ≤40 chars, game-supplied. The artifact
shows **the shape of the push** — how far each streak was ridden and where it died — and
reveals zero board positions, so it cannot spoil the shared daily. If the sequence exceeds
~14 glyphs, elide the middle with `…` keeping first and last three events.

```
💣 Mine Run #14 — 340 pts · top 18%
🏦7 🏦12 🏦9 💥 🏦21 💥 🏦4
best streak 21 · two streaks lost to mines
twistarcade.game/d/mine-run
```

```
💣 Mine Run #22 — 214 pts · top 44% · 2nd run
🏦15 🏦15 🏦18 🏦12 🏦10
banked every time — never lost a point
twistarcade.game/d/mine-run
```

```
💣 Mine Run #9 — 41 pts · top 91%
💥 🏦6 💥 💥 🏦35 💥
pushed to 35… and the vault stayed shut
twistarcade.game/d/mine-run
```

Texture-line templates (`textureLine`, result screen): "Your 21-streak died one square from a
proven-safe run" · "Banked 12 — the next square was a mine" (computable post-hoc from the
spectator view, which sees the layout at terminal) · "Never gambled, never lost — never rich."
The 💥 glyph is Mine Run's decay-family event mark; `🏦` is game-specific vocabulary, consistent
with the lens §6 example. Restart tag ("2nd run") appears in the header iff restarts > 0.

---

## 8. Board UI and teaching layers (against the shell contract, ux-lens §10)

Built only after the harness has frozen parameters (§9 ordering — the Fadeout lesson: UI never
absorbs ruleset churn).

### 8.1 Layout and the bank affordance

Shell frame as standard (header / rule card / status / board slot / controls). Inside the board
slot: the grid, and directly below it the **BankBar** — the game's one custom control, living
in the game-specific extras slot: a wide button reading **"Bank 28"** (live streak value;
disabled and reading "Bank" at streak 0), placed beside the **at-risk streak chip** (`28 · +8
next`) and the **vault chip** (`banked 96`). Bank is an engine move; the button calls `onMove`
like any cell. The three numbers the push decision needs — at-risk value, next gain, banked —
are adjacent to the button that resolves it. The HUD row above the grid: `revealsLeft` and
`💣 20 · 2 hit` (informed odds, lens §1.7 — the mine counts are always visible).

`ScoreHUD` (shell component) renders banked score and streak; Mine Run supplies the values via
`score()` and the view fields (`streakValue`, `nextGain`). No timers anywhere.

### 8.2 Tension without slot-machine theatrics

Ink-on-paper rules (ux-lens §9) apply: the streak chip ticks up with a 150 ms count animation
and gains slight type-scale weight as it grows — *weight, not flash*. No escalating jingles, no
screen shake, no spinning numbers, no color-ramp-to-red urgency. Risk is communicated by
information (the numbers, the counts, the at-risk value), not by arousal. On a wipe: the
exploded cell gets an ink-burst glyph; the streak chip drains to the vault-side showing
`−28` for 400 ms then resets (reduced-motion: instant swap, `−28` shown statically for one
turn). Banking: the streak value slides into the vault chip, 300 ms (reduced-motion: instant).
Every animation restates a state change the statics already show.

### 8.3 Teaching: sentence → telegraph → callout

- **Sentence:** the 82-char rule card (§1).
- **Telegraph:** the HUD is the telegraph — `+1 +2 +3` on consecutive reveals teaches
  escalation within three taps; the at-risk chip visibly *being at risk* (styled as unsecured —
  e.g. dashed outline vs the vault's solid) teaches the stake before the first mine.
- **First-occurrence callout** (shell machinery, once per device): fires on the first mine hit,
  anchored at the exploded cell: *"💥 Mine — your unbanked streak of 12 is gone. Banked points
  are safe."* A second registered trigger, first bank: *"Banked — these points are safe for the
  rest of the run."* (Two triggers is within the shell's callout contract; if the shell caps at
  one, the mine callout wins and the bank confirmation is carried by the vault animation.)
- **"How?" sheet, 3 frames:** ① reveal squares, streak grows +1 +2 +3 → ② bank moves it to the
  vault → ③ a mine wipes only what's unbanked.
- **A wipe must read as a decision that went wrong, not a gotcha.** The ingredients are all
  informational: the odds were on screen (numbers + mine count), the stake was on screen
  (at-risk chip), the exploded mine stays visible (the board explains itself), and the callout
  names exactly what was lost and what survived. No punitive theatrics — the loss is legible,
  which is what makes players rematch (ux-lens §5).

### 8.4 Input, mobile, accessibility

- **Two-stage commit on small screens (and the cell-size exception).** 10 columns at 320 px =
  32 px cells — under the 48 px design-gate line, and a mis-tap here reveals the wrong cell,
  which can be catastrophic. Decision: cells stage on first tap (staged state in the shared
  `Cell`), commit on second tap on the staged cell; tap elsewhere re-stages. Uses `BoardShell`'s
  pointer-commit machinery. Manifest `exceptions[]` entry: `{ gate: "cell-size-48px",
  justification: "10-column board; staged two-tap commit makes 32px targets safe on touch" }`
  — confirm as O2. Desktop/pointer-fine devices commit on single click; long-press/right-click
  toggles a **flag annotation** (chalk-dot mark, UI-local, never an engine move, excluded from
  replays and score verification).
- **Never colour alone.** Revealed vs unrevealed = fill/texture (paper tile vs flat ink), not
  hue; the numeral is the count encoding (classic number-colours retained as the sacrificial
  third channel); exploded = glyph; staged = outline + scale. Grayscale-screenshot test is a
  review gate.
- **Keyboard:** roving-tabindex grid per ux-lens §8; Enter/Space stages then commits; `B`
  bonus-binds Bank (the BankBar is in the tab order after the grid).
- **Announce strings** (`announce()`): reveal — "Row 3 column 4: 2. Two neighbouring mines.
  Streak 7, worth 28. 41 reveals left." · flood — "Opened 6 squares. Streak 13, worth 91." ·
  bank — "Banked 28. Vault 96." · mine — "Mine at row 2 column 5. Streak of 28 lost. Vault 96
  safe. 40 reveals left." · terminal — "Run over. Final score 233." Cell accessible names carry
  position + contents ("Row 3, column 4. Revealed, 2." / "Row 5, column 1. Hidden." / "…
  flagged" for annotated cells).

---

## 9. Sequencing and dependencies

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **MR0 — now** (no platform deps) | This plan; CSP module design note (enumeration + count-coupling + sampling, budgets); heuristic + safeMove spec finalization; TDD anchor enumeration (§10); share/texture templates; UI paper sketch against the shell contract; O1 seam proposal written for the orchestrator | nothing | MR1 |
| **MR1 — engine** | Engine TDD (fixtures first): generation, flood, streak arithmetic, bank/wipe, terminals; `engineContract` green (solo branch, `secretExtractor`, determinism-through-generation); CSP module with known-answer tests; `probes.ts safeMove`; `sampleConsistentState`; manifest draft | **platform M1** | MR2 |
| **MR2 — agents** | Greedy heuristic; Strong = determinized flat-MC (per O1 resolution); view-honesty test green; first informal distribution runs | **platform M2** + O1 resolved | MR3 |
| **MR3 — validation + tuning** | `suite solo-ci` + `solo-design` over paired seeds; fixed-k sweep; parameter tuning (density/budget, flood-scoring R4 fallback decision) to the §4.6 targets; **parameter freeze (orchestrator review)** | **platform M3c** + MR2 | MR4 |
| **MR4 — UI + teaching** | Board, BankBar, staged commit, callouts, announce, share artifact, a11y passes, grayscale test | parameter freeze (MR3) + **shell `useGame`, `ScoreHUD`, `BoardShell`/`Cell`** | playtest |
| **MR5 — gates + playtest** | Both gates on the record; 5-person playtest (lens §3.9 pass: a new player banks early on a bad-looking count, unprompted, within two runs); daily handoff (seed formula + pinned budget + restart-count plumbing) | MR3 + MR4 | merge readiness |

**Starts today:** all of MR0, and most of MR1's test-writing (the contract shapes are merged in
M1's plan; red tests can be authored against them). MR3 and MR4 do **not** parallelize — UI
waits for the parameter freeze, the Fadeout rule applied here. Note what Mine Run does *not*
need: M3a/M3b (2P solver/harness) and M3d (certificate pipeline) — its platform tail is M3c
only, which the platform plan already parallelizes with M3b.

Roadmap guardrail acknowledged: Mine Run is first in the cut order if week 3 arrives with the
two-player slate not green (lens §8). Nothing below MR4 creates shell-team work beyond the
already-planned solo deltas; the one platform ask is O1, priced small.

---

## 10. TDD anchors (stage-2 red tests with known answers)

- Hand-built 5×5 fixture layout: exact numbers, flood extent, streak arithmetic (streak of 4
  banks 10), wipe zeroes streak but not vault, exploded cell revealed and permanent.
- Same seed twice ⇒ identical layout + opening region (generation determinism); a seed whose
  first placement has no zero cell exercises the deterministic retry path.
- Legality: bank at streak 0 illegal; reveal of a revealed cell illegal; move-count property
  ≤ 2·budget + 1 over random playouts.
- Terminal: budget exhaustion auto-banks (`scores[0] === banked + streakValue`-before-fold);
  full-clear terminal on a tiny fixture; `score()` monotone and equal to `scores[0]` at
  terminal; never emits `won`/`lost`/`draw`.
- CSP known answers: 1-2-1 and 1-2-2-1 frontier patterns (forced safe/mine cells); a
  global-count-coupling case where the frontier alone is ambiguous but the mine total decides;
  posterior values on a hand-solved position to 3 decimals.
- `sampleConsistentState`: every sample consistent with the view; frequency of a hand-solved
  50/50 cell ≈ 0.5 over 2,000 samples (loose band).
- **View-honesty:** fixed view, resampled hidden worlds ⇒ identical `safeMove`, Greedy, and
  Strong choices (same policy rng). The anti-omniscience test — must exist before any tuning
  run is trusted.
- Redaction: planted `nearMiss` effect mutant fails the contract's effect-walk; planted
  `"mines"` field in the view fails the string-walk; `Object.keys(view.cells) ⊆ revealed`.
- Grind: mutant with streak-0 banks legal trips the cycle probe; shipping build does not.
- Gate rehearsal: flat-scoring variant trips Always-Safe ≥95%; density-12% variant degrades
  the Always-Safe gap (recorded, not shipped) — the implementer sees both failure signatures
  before tuning the real game.
- Fixed-k sweep produces a monotone-then-peaked curve over k with best-k ≤90% of Strong at
  frozen parameters (design gate record).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Omniscient Strong silently validates a broken game (the worst failure — green gates, fake game) | View-honesty resampling test is a *precondition* for MR3; O1 routes the determinization seam through the orchestrator; hint feature inherits the same honest policy |
| Always-Safe gap won't open (deduction too complete at chosen density) | Density and increment are the declared levers inside a fixed rule-set; §4.2 states both failure directions and their signatures; flat-scoring rehearsal proves the gate fires |
| Fixed-k threshold ≈ Strong (banking is a memorizable constant) | Game-local sweep gate ≤90% (§2); levers: density variance and budget horizon effects; if unfixable within the window, the mechanic is dead and the cut-order applies — say so, don't ship a slot machine |
| Flood scoring blows the CV gate | Pre-authorized fallback R4-(b) (clicked cell only advances streak); decision recorded at MR3 parameter freeze |
| CSP blowup on pathological frontiers | Component enumeration cap + sampling fallback; fallback frequency logged, design review requires <1% of decisions |
| `comparisonMetric` ratios distorted by the quadratic streak term | `safeReveals` proxy logged per run from day one; suite recomputes on proxy if score ratios and proxy ratios disagree in gate outcome |
| 32 px cells cause catastrophic mis-taps | Staged two-tap commit on touch (BoardShell pointer-commit); manifest exception with justification (O2) |
| Public daily seed ⇒ trivial fog-peek | Accepted residual per lens §5; percentile framing, friend boards, zero-💥-near-ceiling statistical flag |
| UI absorbs parameter churn | MR4 gated on MR3 freeze — the Fadeout rule, held |
| Bank affordance too subtle → players never bank → "why did I lose everything" | BankBar adjacency spec (§8.1), at-risk styling, first-💥 callout; playtest pass condition is exactly a twist-aware early bank |

---

## 12. Open questions for the orchestrator (none block MR0–MR1)

1. **O1 — Strong determinization seam.** Recommend: `flat-mc` in `packages/bots` gains a
   determinized mode (sample via `sampleConsistentState`, roll out per sampled world) activated
   when `meta.hiddenInformation` — small, reusable for Fog Sweep/Fog Pools, and it keeps the
   hint feature honest platform-wide. Alternative: game-local Strong policy referenced from the
   manifest. Needs a routing decision before MR2.
2. **O2 — Cell-size design-gate exception.** Confirm the manifest exception + staged two-tap
   commit as the accepted mitigation for 32 px cells at 320 px (§8.4).
3. **O3 — Percentile source at launch.** "top 18%" needs a same-seed cohort, i.e. a server.
   Phase 0 has none. Confirm the launch fallback header: `💣 Mine Run #14 — 340 pts` +
   `best streak` stat line, with percentile added when the daily board ships (daily team,
   Phase 2). The artifact format above is designed so the percentile slots in without reshaping.
4. **O4 — Free-play mode.** Confirm unranked random-seed free play (same rules, undo allowed)
   is in the shell's solo scope at launch, or daily-only until Phase 2.

## 13. Definition of done (observable)

- [ ] `engineContract(mineRun)` green (solo branch): terminals `scored` only; `score()`
      monotone and terminal-coherent; determinism-through-generation; redaction string-walk
      and effect-walk green with `secretExtractor` wired; all §10 mutants fail their targeted
      properties.
- [ ] `probes.ts safeMove` exported (harness no longer hard-errors); CSP known-answer tests
      green; `sampleConsistentState` consistency + distribution tests green; CSP fallback
      frequency <1% over the paired seed set.
- [ ] **View-honesty test green for safeMove, Greedy, and Strong** — recorded before any
      tuning run is accepted.
- [ ] `pnpm harness suite mine-run --suite solo-ci` green at frozen parameters: S/R ≥ 1.5,
      Strong median ≥ Random p75, G/R ≥ 1.2, S/G ≥ 1.15, CV ≤ 1.2, Always-Safe < 95%, Grind
      none, median run length in 15–600, zero cap hits (structurally ≤121 moves).
- [ ] `--suite solo-design` reviewed by Fable: S/R ≥ 3.0, Strong p10 ≥ Random p90, G/R ≥ 1.5,
      S/G ≥ 1.5, CV 0.25–0.7, Always-Safe ≤ 70%, Greedy-Only ≤ 90%, **fixed-k sweep best
      ≤ 90% of Strong**, run length 60–250; parameter freeze recorded with the flood-scoring
      (R4) decision.
- [ ] Rule sentence ≤ 90 chars (82) on card, catalog, and OG description — one canonical
      string; manifest `solo` block complete (`format: "score-chase"`, `moveCap: 400`,
      `scoreMonotone: true`, `comparisonMetric: "score"`); exceptions recorded (O2).
- [ ] Board UI: BankBar with live value + at-risk/vault chips + mine counts always visible;
      staged two-tap commit on touch; flags UI-local only; grayscale-screenshot test passes;
      reduced-motion parity; announce strings for every event; first-💥 callout fires once per
      device at the exploded cell.
- [ ] Share artifact ≤ 7 lines, 🏦/💥 body with elision rule, ≤40-char stat line, restart tag
      when restarts > 0; texture-line templates fire on their trigger fixtures; spoiler check:
      artifact derivable without any unrevealed-cell information except via the terminal
      spectator view.
- [ ] Daily handoff: seed formula consumed, budget pinned at 60 for all, no-undo-in-daily
      enforced, restart count plumbed into the result; verified-replay submission shape
      documented for the daily team (claimed score discarded).
- [ ] Game route ≤ 75 kB gz; first move < 8 s from cold load on mid-4G.
- [ ] 5-person playtest: ≥1 new player makes a twist-aware play — banks early because the
      board looks dangerous, or probes at streak 0 — within their first two runs, unprompted.

---

## 14. Orchestrator decisions — addendum, 2026-08-02

Rulings on §12's open questions O1–O4, plus one promotion. These are binding; the Sonnet
implementer inherits them as-is.

**View-honesty promoted to a platform-wide rule.** The §4.4 finding — harness policies receive
canonical `S`, so an omniscient "Strong" would post a passing Strong/Random ratio on a game
unplayable to humans, and the failure is *silent* (no error, just a number meaning something
other than what everyone believes) — is promoted from a Mine Run concern to a harness-spec
correction, routed to the platform team: **every policy evaluated against a game with
`hiddenInformation: true` must be view-honest, and the harness must enforce it structurally
rather than trusting the policy author.** The orchestrator's strong preference is that
hidden-info policies receive `playerView(state, seat)` rather than `state` at all, so
view-honesty becomes a type-system guarantee. Consequence for this plan: Mine Run **keeps the
§4.4/§10 resampling test regardless** — compile-time guarantee plus runtime probe is the
belt-and-braces posture for something this quiet. The DoD item stands unchanged.

**O1 — determinized Strong lives in `packages/bots`. Approved as recommended.** `flat-mc`
gains a determinized mode (sample worlds via `sampleConsistentState`, roll out per sampled
world) for hidden-info games. Deciding factor: the same code becomes the shipped hint feature
across Fog Pools, Blindfold Reversi, and every future hidden-info game — a game-local copy
would fork the thing players actually touch. Routed to the platform team as M2 scope; MR2 is
unblocked once it lands (or proceeds against the agreed interface).

**O2 — 32 px cell exception granted, conditionally.** The board wins and the 48 px floor bends
(10×10 cannot reach it at 320 px, and shrinking to 8×8 would change density, CSP lock-up
frequency, and therefore the entire Always-Safe gap this design depends on) — but only with
the mitigation that makes it safe: **two-tap commit is mandatory in Mine Run on every
platform, not just touch.** Tap stages (free, reversible), second tap commits. Rationale: a
mis-tap here doesn't cost a turn, it hits a mine and wipes an unbanked streak — the most
punishing mis-tap in the catalog. Additional binding conditions: the staged cell renders an
**enlarged confirm affordance**, and **mis-taps are an explicit item in the five-person
playtest** (§8.4 and the DoD playtest item are amended accordingly). This is a documented,
justified exception to the shell's hard floor — the manifest `exceptions[]` entry stands, and
the shell team is being informed their constraint has one sanctioned violation and why. §8.4's
desktop single-click commit is **overridden**: two-tap everywhere.

**O3 — percentile-less share header at launch. Approved.** A percentile requires a population;
a population requires a backend; Phase 1 has neither. Ship the absolute score against the seed
(`💣 Mine Run #14 — 340 pts` + stat line); percentiles arrive with leaderboards in Phase 3.
The §7 artifact format already slots the percentile in without reshaping — that stands.

**O4 — free play approved as unranked, and explicitly cuttable.** It is the lens's "dessert."
Under schedule pressure, free play is the first cut from Mine Run — before anything touching
the daily.

**Fixed-k threshold sweep (§2): keep.** Confirmed as a required design-gate record — it
mechanizes the "always bank at N" failure that would otherwise only be caught by a human
noticing the game felt hollow.

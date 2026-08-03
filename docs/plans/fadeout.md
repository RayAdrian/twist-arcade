# Fadeout — Implementation Plan (Fable, 2026-08-02)

*Team: `fadeout` (worktree `../claude-project-fadeout`, branch `feature/fadeout`).
Supabase: **not started** — client-only feature (synthesis §2.6); record as such in
`docs/worktrees.md`.*

*Sources: `research/games/game-theory-lens.md` §1.1/§2/§3/§4#1/§5.9, `plans/phase-0-platform-spine.md`
§3/§5/§7.6/§9, `research/games/ux-lens.md` §1/§2/§5/§6/§10, `roadmap.md` §6 (both gate tables),
`research/games/synthesis.md` §3. This plan produces no implementation code; it is the input to
CLAUDE.md §2 stages 2–6.*

**The game.** Decay tic-tac-toe. Each side keeps at most 3 marks; placing a 4th removes that
side's oldest, telegraphed as it ages. Rule sentence (canonical, ≤90 chars):
**"Your pieces vanish 3 turns after you place them."**

**The one sequencing rule that governs everything: the exact solve comes before any UI work.**
The solve decides the shipping ruleset, the balancing device, and whether the 4×4/cap-4
escalation ships at launch. UI built against an unfrozen ruleset is a rebuild waiting to happen
(roadmap Phase-0 sequencing note). Platform milestone M3a exists specifically to unblock this
step early — do not let M3b's full metrics gate it.

---

## 1. The ruleset parameter space — what must be solved and compared

The viral ruleset's fine print flips the game's value (game-theory §1.1). Three binary axes,
**eight variants, all solved**:

**Axis A — decay timing.**
- **A1 remove-then-place:** when you make your 4th placement, your oldest mark vanishes *first*,
  then your new mark lands. Consequence: the cell your own doomed mark occupies is a legal
  placement target (it is vacated before your mark arrives).
- **A2 place-then-remove:** your new mark lands, then your oldest vanishes. The doomed mark's
  cell is occupied at placement time and not a legal target. Sub-decision inside A2, pinned
  here rather than added as a fourth axis: **win check runs after removal** (a 3-in-a-row that
  exists only in the instant between placement and removal does not win). A momentary
  "win-then-unwin" is illegible on the board and fails the §2.6 5-second-read test; no solve
  needed to reject it.

**Axis B — playable-through.**
- **B1 solid:** a doomed mark (telegraphed, final turn) is a normal occupied cell until it
  vanishes. Nobody may place there.
- **B2 playable-through:** either player may place into the doomed mark's cell, displacing it
  immediately (it was leaving anyway). Note the UX cost: a cell that is simultaneously
  "occupied by a fading O" and "tappable" needs a distinct affordance; this counts against B2
  in the selection criteria below unless the solve shows it buys real value.

**Axis C — repetition rule.**
- **C1 superko:** any move recreating a *prior full position* of this game (occupancy +
  age-orderings + player to move) is illegal. Guarantees termination by construction (positions
  cannot repeat, so game length ≤ number of distinct positions).
- **C2 threefold:** third occurrence of the same full position with the same player to move is
  a draw.

Game-theory §1.1 argues C1 is mandatory for termination and better for draw rate. We solve C2
anyway — first because the C2 solve is the cheap exact one (see §2.3) and its value equals the
C1 value except on the repetition residue, and second because the lens says *verify against the
solve*, not assume. Default ship = superko unless the solve surprises us.

### What each solve output decides

| Output (per variant) | Decision it feeds |
|---|---|
| Root game value (P1 win / P2 win / draw) + depth | Shipping ruleset choice; whether the game is honest to ship at 3×3 at all |
| Per-opening values (all 9 first moves, exact) | Pie-rule viability — the §5.9 trap check is *exact* here, no statistical sweep needed (we still run the sweep as a cross-check, §7) |
| Greedy-extracted optimal strategy → strategy-description-length test | Whether the **4×4/cap-4 escalation must ship at launch** as the ranked mode (if the 3×3 solution is quotable in ≤3 sentences, it dies the day someone posts it — game-theory §2.2, §5.5) |
| Draw rate under optimal play, C1 vs C2 | Verifies the superko-improves-draw-rate claim; final repetition-rule choice |
| Strong-self-play FPA projection | Whether the variant can land inside the CI band 35–65% (roadmap §6) |

### Ruleset selection criteria, ranked

1. Value is a draw, **or** a P1 win whose optimal strategy fails the quotability test (long,
   position-dependent, not memorizable). A quotable forced win = that variant is dead.
2. Among surviving variants: richest set of non-losing openings (pie-rule viability), and
   projected strong-play FPA inside the CI band 35–65%.
3. Lowest optimal-play draw rate.
4. Lowest telegraph/legibility cost (B1 preferred over B2 at equal value; A-axis choice must be
   teachable by the badge semantics in §5 without a footnote).
5. If **no** variant survives criteria 1–2: ship the best available with a declared manifest
   `exceptions[]` entry, mandatory pie rule, **and** the 4×4/cap-4 escalation at launch —
   escalate to the orchestrator before proceeding (open question Q2, §12).

---

## 2. Stage A — the exact solve (before any UI)

### 2.1 State encoding

The state is **not** board occupancy. It is occupancy **plus the age-ordering of each side's
pieces** — a state hashed on occupancy alone will "prove" false repetitions and corrupt both
the solve and superko enforcement (game-theory §1.1; platform plan §3.2's standing warning is
the same trap from the other side).

Canonical position representation:

- `queues: [number[], number[]]` — per player, the cell indices of their on-board marks in
  placement order, **oldest first**. The queue *is* the age-ordering; occupancy is derived from
  it (single source of truth — no separate cells array to drift out of sync).
- `toMove: 0 | 1`.
- **`positionKey(state)`** = canonical stable stringify of `{queues, toMove}`. This is the
  solver's hash key *and* the superko history key. It deliberately excludes history and effects.

State-space arithmetic (sanity anchor for the implementer's reachability test): with a = |P1
marks| ≤ 3, b = |P2 marks| ≤ 3, ordered arrangements number P(9,a)·P(9−a,b); the dominant term
a=b=3 gives 504·120 = 60,480, ×2 for `toMove` ≈ 1.2×10⁵, plus smaller opening terms.
**Reachable states ≲10⁵** (reachability further constrains a−b by turn parity). Exhaustively
solvable in seconds per variant; eight variants is minutes.

### 2.2 Why plain minimax is forbidden here — put this in the code comments

The game graph is **cyclic**: marks leave the board, so positions recur (place–decay–place
cycles return to earlier positions). Plain minimax/negamax recursion on this graph does not
terminate — it loops forever chasing cycles, and depth-capping it produces *wrong values*, not
approximate ones (a position that is a win via a line passing "through" a cycle gets misvalued
as unknown/draw). The correct method is **retrograde analysis / value iteration on the game
graph**: back up wins and losses to a fixed point; any position not labeled at convergence is a
draw-by-repetition. This is the reason platform M3a ships `solver/reach.ts` +
`solver/retrograde.ts` and the reason this plan waits for M3a. **No implementer may "simplify"
this to minimax.** The tiny hand-built cyclic fixture in the platform's TDD anchors (§9 of the
platform plan) exists to catch exactly that simplification.

### 2.3 The solve pipeline, per variant

**Pass 1 — reachability + retrograde (uses M3a building blocks, hashing on `positionKey`).**
BFS all reachable positions from the empty board under the variant's move rules (no repetition
rule applied — the raw cyclic graph). Then value iteration to fixed point. Outputs: exact value
of every position **under the repetition=draw rule (C2)**, distance-to-win/loss depths, and the
win/loss "cores" — positions whose value is forced without ever relying on repetition.

**Pass 2 — superko refinement (C1), Fadeout-local.** Superko makes legality path-dependent
(which moves are legal depends on which positions this game has visited), so position-keyed
memoization is unsound in general — the classic Graph-History-Interaction problem. The residue
where C1 and C2 can differ is exactly pass 1's draw region: pass-1 wins/losses are proved by
depth-decreasing forcing lines that never revisit a position within the line. Method:

- History-aware alpha-beta DFS from the initial position over win/draw/loss values, carrying
  the path's `positionKey` set and filtering illegal (repeating) moves.
- Pass-1 values are used as **move-ordering hints only**, never as proofs, unless the
  implementer additionally verifies a cached win's line is disjoint from the current path.
  Skipping caching entirely is acceptable if the search completes in budget — measure first.
- Budget: 10 minutes per variant. If pass 2 exhausts budget: report the C2 value + the size of
  the draw residue + a statistical C1-vs-C2 comparison from harness self-play, and escalate to
  the orchestrator. Do not ship a superko value claim the solve did not prove.

**Pass 3 — decision extraction.** Per variant: root value; per-opening value table (the exact
first-move-elimination sweep); greedy optimal-strategy extraction + a written
strategy-description attempt (the §2.2 quotability judgment goes in the solve report for Fable
review); optimal-play draw rate under C1 vs C2.

Deliverable: `docs/research/games/fadeout-solve-report.md` — one table, eight rows, plus the
quotability judgments and a recommended shipping ruleset with reasoning. **Orchestrator reviews
and freezes the ruleset before stage F3 (UI) begins.**

### 2.4 Solve TDD anchors (known answers for Sonnet's red tests)

- Reachability count for at least one variant asserted against an independently computed
  number (write a tiny brute-force enumerator as the oracle; the two must agree exactly).
- A hand-constructed cyclic mini-position (2 marks each, forced cycle) that plain minimax
  would loop on: retrograde must label it and converge.
- A hand-constructed position with a known forced win in 3 (build it from a classic TTT double
  threat adapted to decay timing): solver must report win, depth 3.
- Pass-2 sanity: a hand-built position where the only non-losing move recreates a prior
  position — under C1 the mover must be scored as lost (superko removes the escape), under C2
  as draw.

---

## 3. The engine (`games/fadeout/engine.ts`) — against the platform contract

Built against `@twist-arcade/engine` (platform plan §3), TDD, `engineContract()` green.
**Parameterized by the ruleset config** so all eight variants share one engine:

```
RulesetConfig = { decayTiming: "remove-first" | "place-first";
                  playThrough: boolean;
                  repetition: "superko" | "threefold" }
```

The shipping config is frozen after the solve; the config stays (the solve scripts and harness
need all eight; the 4×4/cap-4 escalation later reuses the same engine with
`{ size, cap }` generalized — design the types for that now, implement only 3×3/cap-3).

### 3.1 State shape

```
FadeoutState = {
  queues: [number[], number[]];   // cell indices, oldest first — the age-ordering IS the state
  toMove: 0 | 1;
  history: string[];              // positionKeys seen this game (superko); sorted in encode
  faded: [number, number];        // count of own marks decayed (share-artifact stat)
  longestLife: [number, number];  // max own-placements a mark survived (share-artifact stat)
  lastEffects: readonly Effect[]; // WithEffects — fully overwritten by every apply
}
```

- Occupancy is derived from `queues` via a helper — never stored separately.
- `meta`: `{ id: "fadeout", minPlayers: 2, maxPlayers: 2, hiddenInformation: false,
  simultaneous: false, stochastic: false, version: 1 }`. Perfect info ⇒ `playerView` =
  identity, `V = S`.
- `heuristic(state, player)`: lifetime-weighted line counting, ~20 lines. For each of the 8
  lines: own-mark count weighted by each supporting mark's remaining lifetime (a two-in-a-row
  whose supporting mark dies before it can be converted is discounted toward zero); small
  center > corner > edge positional term; symmetric subtraction for the opponent. Feeds the
  minimax option and the greedy/rush probes; MCTS tiers do not need it.

### 3.2 `apply` — placement and decay to quiescence in one transition

Single transition per the contract: validate → (per `decayTiming`) pop the mover's oldest if
their queue is at cap → push the new mark → update `faded`/`longestLife` → append the *pre-move*
`positionKey` to `history` → set `lastEffects` (fully overwritten):

- `{ type: "placed", player, cell }` — always.
- `{ type: "decayed", player, cell }` — when a mark vanished this apply. Order in the array
  mirrors event order per the variant (A1: decayed then placed; A2: placed then decayed) —
  the shell's animation mapper plays them in array order, so this ordering *is* the animation
  spec.

These two effect types are the shell vocabulary the telegraph and vanish animations key on
(platform §3, ux-lens §9: place = 150 ms stroke-draw; decayed = 400 ms fade+shrink to ghost).
No custom effect types needed.

### 3.3 Superko enforcement

`legalMoves`/`isLegal` filter any move whose resulting `positionKey` ∈ `history`. Consequences
the tests must pin:

- Termination is structural: `history` strictly grows, positions cannot repeat, so the 200-ply
  contract cap is unreachable (assert zero cap hits in the harness — any cap hit is a bug, not
  a tuning problem).
- "No hidden pass" contract rule: if every legal placement would recreate a prior position, the
  mover has no legal move. For a 2P engine `lost` is forbidden — `status` must resolve this as
  a **loss for the mover expressed as `{ kind: "won", winner: opponent }`**, checked when
  `legalMoves` is empty while no line exists. Write the regression test for this exact corner
  before implementing it; it is the likeliest silent-bug site in the engine.

### 3.4 `encode` canonicality — and the seam it forces

`encode(state)` = stable stringify of `{queues, toMove, history: sorted(history), faded,
longestLife}` — **excluding `lastEffects`** (platform §3.2; effects in the encoding would make
rule-identical positions hash differently and silently break superko/repetition detection —
the standing orchestrator warning applies verbatim to this game). `decode(encode(s))`
roundtrips with `lastEffects: []`.

**Consequence, stated so nobody trips on it:** because `history` (and the share-stat counters)
are legitimately part of state, `encode` is *not* a position key. The generic
`harness solve` pipeline hashes on `encode(S)` and would see an exploded, path-dependent state
space — it is **not usable directly on Fadeout with superko enabled**. Fadeout therefore ships
a game-local solve script (stage F2) that composes M3a's `reach`/`retrograde` building blocks
over `positionKey` (pass 1 runs with the repetition rule off, where positionKey fully
determines the game), plus the pass-2 refinement of §2.3. `positionKey` is exported from the
engine module and unit-tested for canonicality (permuting object key insertion order, replaying
to the same position via different move orders ⇒ identical key).

### 3.5 Engine TDD anchors

- Contract suite (`engineContract`) green; purity (deep-frozen inputs), determinism,
  encode∘decode modulo effects, isLegal ⟺ legalMoves.
- Decay timing: a scripted 7-move sequence per variant with hand-computed expected queues and
  effects arrays (both A1 and A2, both B1 and B2 targets).
- Superko: a scripted sequence that recreates an earlier position — the recreating move must be
  absent from `legalMoves` and rejected by `isLegal`; under `threefold` config the same
  sequence is legal and the third occurrence draws.
- The no-legal-moves = mover-loses corner (§3.3).
- Effects never accumulate; effect order matches the variant's event order.
- `faded`/`longestLife` counters against the scripted sequences.

---

## 4. The balancing device

Working hypothesis (game-theory §1.1, §4#1): **first-player win via centre**. The device
decision is made **from the solve's per-opening value table**, not from vibes:

1. **Series alternation** — ships regardless, as the invisible site-wide default (shell-owned;
   players alternate first move across rematches, results framed at series level). Zero rules
   overhead. Fadeout's manifest declares nothing; this is the platform default.
2. **Pie rule** — ships **iff** projected strong-self-play FPA lands in the 55–70% band **and**
   the §5.9 trap check passes: the per-opening table must show at least one near-balanced
   opening (an opening whose value is draw, or whose win is deep/non-quotable). If *every*
   opening is a P1 win, pie just hands the game to P2 — in that case the fix is the ruleset or
   the board (4×4/cap-4 escalation), never the device. The exact table makes this check
   trivial; the harness's statistical first-move-elimination sweep (§7) runs anyway as a
   cross-check and must agree in sign with the table.
3. **4×4/cap-4 escalation at launch** — triggered by the quotability test (§1) or by criterion
   5 (§1). If triggered, it is a scope addition needing an orchestrator call (Q2, §12): same
   engine generalized over `{size, cap}`, its own solve attempt (state space ~10⁸–10⁹ raw —
   likely beyond exact solve; it graduates to the statistical harness like a normal game).

Pie-rule UX, if it ships: P1 places; before P2's first placement the shell offers "swap sides?"
once. This is shell chrome — coordinate with the shell team; Fadeout's manifest carries a flag
the shell reads. Do not build pie UI before the solve says it is needed.

---

## 5. Board UI and teaching layers (after the ruleset freeze — stage F3)

Built against the shell contract (ux-lens §10, platform §5.3): `Board` receives
`BoardProps<V, M>` — view, legal moves, `onMove`, seat, prefs. The shell owns chrome, rule
card, status line, controls, result modal, callout machinery; Fadeout owns board rendering,
telegraph visuals, strings, and hooks. Rendered inside `BoardShell`/`Cell`; cells ≥48 px at a
320 px viewport (3×3 gives ~96 px+ — comfortably above both floors).

### 5.1 The telegraph — three redundant channels, one authoritative

Badge semantics pinned now (they must match the rule sentence and `announce()`): the countdown
counts **the owner's remaining placements before the mark vanishes**. For a mark at queue index
`i` with own queue length `q`, remaining = `i + 1 + (cap − q)`.

- **Opacity ramp** (ambient): fresh and age-1 = 100%, age-2 = 65%, final turn = 40%. Discrete
  steps, stepped down at the moment the turn advances (200 ms), never a continuous fade. Hard
  floor: the mark at 40% must still meet **3:1 non-text contrast** against the board ground in
  both themes (WCAG 1.4.11) — a design-token constraint, verified in review.
- **Countdown badge** (authoritative): circular badge on the mark's corner, appearing **only at
  ≤2 remaining**. ≥16 px, bold numeral, 4.5:1 contrast. The badge is the guaranteed-legible
  channel; **opacity is an enhancement**. The **grayscale-screenshot test** — every board state
  fully readable in grayscale — is a review gate for this game; the badge is what passes it.
- **Desaturation toward ink** (sacrificial third channel): aging marks drift toward the board
  neutral. Allowed to be invisible to some users.

**Just-changed:** the vacated cell shows a dashed **ghost outline** of the departed glyph for
exactly one turn. **Motion:** a single soft **600 ms pulse** when a mark enters its final turn
— once, then static; dropped under `prefers-reduced-motion` (where vanish also becomes an
instant swap to the ghost). All animations key off `view.lastEffects` (`placed`, `decayed`) —
never off state diffs — and every animation restates what the static encodings already show.

If the frozen ruleset is B2 (playable-through), the doomed cell additionally renders as a legal
target (legal-move affordance from `legal`), and the badge remains visible until displacement —
this is the extra affordance cost §1 counts against B2.

### 5.2 Teaching layers (Sentence → Telegraph → Aha-callout)

- **Sentence:** the canonical rule sentence, shell rule card, ≤90 chars (already 48).
- **Telegraph:** §5.1. With cap 3 the mechanic is visibly operating within ~10 s of the first
  move — the telegraph teaches before decay ever costs the player anything.
- **Aha-callout:** `firstOccurrence` hook — trigger: first `decayed` effect of the game whose
  device hasn't seen one (shell owns the once-per-device flag); anchor: the vacated cell; text:
  *"Your X faded — pieces last 3 turns."* Non-modal, dismisses on next move.
- **`announce()`**: composed sentences in shell order — what happened → what's imminent → whose
  turn. Cell accessible names carry position, contents, and pending change ("top left, X, fades
  in 1 turn") using the same counting as the badge. Full-board readback on decay events only.
- **"How?" sheet:** 3 frames — place → age (badge appears) → vanish (ghost) — supplied via
  `howSheetFrames`.

---

## 6. Bot tiers (manifest data over the platform's generic search)

All three tiers use **`rollouts` budgets** (deterministic), not `deadlineMs`: the state is tiny
so rollouts are cheap, cross-device behavior is identical, and the daily-mode pinning
requirement (§9) is then satisfied by construction rather than by a special daily tier.

| Tier | Policy | Budget | Blunder (ε-softmax over root visits) | minReplyMs |
|---|---|---|---|---|
| Casual | mcts | rollouts 100 | ε = 0.30, τ = 1.5 | 250 |
| Standard | mcts | rollouts 1,000 | ε = 0.08, τ = 1.0 | 250 |
| Ruthless | mcts | rollouts 10,000 | none | 250 |

Starting values — tuned in stage F4 against the harness until tier ordering holds (ruthless ≥
standard ≥ casual; ruthless-vs-standard ≥60%, warn at PR budget, fail nightly) **and** the
solve-oracle check passes: over a sample of solved positions, Ruthless's chosen move is in the
optimal set ≥95% of the time (design-gate check — the exact solve makes bot strength directly
auditable, a luxury most games don't get; use it).

**First-game softening (ux-lens §6, binding):** on a device's *first* game of Fadeout, the bot
(at any tier) plays the base game well but does not mercilessly exploit twist-ignorance.
Operationalized: Fadeout exports a policy filter `firstGameFilter(state, rankedMoves)` that
demotes **decay-trap moves** — moves whose winning continuation depends on an opponent blocking
mark decaying within the next 2 plies — unless every alternative loses outright. The shell
applies the filter when its per-device first-game flag is set. Observable acceptance: in a
seeded batch of first-game simulations, the softened bot never completes a win on the exact
turn an opponent blocker decayed, except from positions where all moves win. **The seam (how
the first-game flag reaches the worker host / `BotRequest`) is not in the platform contract —
open question Q1 for the orchestrator; do not invent the plumbing unilaterally.**

---

## 7. Harness validation — both gates, plus the solve cross-check

Fadeout runs the two-player model: `pnpm harness suite fadeout --suite ci` (hard gate) and
`--suite design` (Fable review report).

**CI gate (roadmap §6, build-breaking):** strong-vs-random ≥90% · FPA (strong self-play) inside
35–65% · draw rate ≤60% · mean plies 4–200 with **zero** cap hits (superko makes any cap hit an
engine bug) · ruthless-vs-standard ≥60% (nightly-fail) · contract suite green · bundle ≤75 kB
gz on the game route · no critical axe violation. If the frozen ruleset cannot land FPA in band
even with the device, the manifest `exceptions[]` entry is written with justification and the
orchestrator signs it (criterion 5, §1).

**Design gate (game-theory §3.4 bands, human judgment):** FPA 45–55% raw *or after the device*
· draw rate <10% at mcts-1k (expect draws to rise at mcts-10k if the solved value is a draw —
report both, judge at 1k per the lens) · median 10–40 plies · mcts-1k vs mcts-100 ≥60% · ladder
Elo spread ≥300 (skill slot) · comeback fraction 20–60% · opening-move concentration ·
branching factor 4–30 · quotability test (from the solve report) · rule sentence ≤90 ·
grayscale test · cells ≥48 px.

**Degeneracy probes — the ones that matter here:**

- **Mirror bot (mandatory — 3×3 is centrally symmetric).** Fadeout is tagged `symmetric`, so CI
  *requires* the per-game export `games/fadeout/probes.ts → mirrorMove(state, lastOppMove)`:
  point-reflection through the centre where legal, null → fallback random. Gate: mirror as P2
  <40% (design), ≥50% = the configuration is broken. Decay *should* defeat mirroring (the
  copied marks decay on the mirrorer's own clock, and centre is self-mirror) — verify, don't
  assume.
- **Stall bot:** superko + forced decay should make stalling structurally unprofitable; gate is
  stall ≤ its Elo-peer expectation.
- **Rush bot** vs mcts-1k (tactical flatness check), **opening-move concentration**, and the
  **first-move-elimination sweep** — which must agree in sign with the solve's per-opening
  table (§4).

**Solve ↔ harness cross-checks (this game is exactly solvable — the two validators must agree):**

1. Wrap the pass-1/pass-2 value table as a Fadeout-local **oracle policy**. Oracle vs mcts-10k
   over ≥1,000 games: the oracle never loses (hard assertion — a single oracle loss means the
   solve or the engine is wrong; stop and find out which).
2. Solved root value vs self-play outcome distribution: a solved P1-win should show elevated
   FPA rising with agent strength; a solved draw should show draw rate rising with strength.
   Directional agreement required; disagreement is a bug hunt, not a shrug.
3. C1-vs-C2 draw-rate delta: measured in self-play with both configs, compared against the
   solve's optimal-play delta — this is the verification of game-theory §1.1's superko claim.

---

## 8. Share artifact and texture line

**`shareArtifact(record, finalView)`** — body only (shell owns title/result/URL frame), ≤7
lines total with the frame:

- One emoji per placement in sequence: ❌ / ⭕ by seat glyph. **Substitution encoding:** a move
  that triggered a vanish renders as 💨 instead of its glyph; the winning move renders as 🎯.
  Derived from the `ReplayRecord` move list + the per-step effects (the counters and the
  record suffice — no engine re-import in the presentation layer).
- One stat line, ≤40 chars, from `finalView` counters: `pieces faded: 3 · longest-lived X: 5
  turns`.
- Never a board snapshot — the timeline shows rhythm and chaos; the 💨 is the question mark the
  link answers (ux-lens §5). Daily mode: the shell prepends the "Daily #N" header line.

**`textureLine(finalView)`** — the one-line story on the end screen, ≤60 chars, chosen from
template predicates evaluated on the final apply's `lastEffects` + counters + winning line:

| Trigger (detectable from final state) | Template |
|---|---|
| Loss where the winning apply carries a `decayed` effect on a cell in the winning line's block-set | "Your {cellName} {glyph} faded at the worst possible moment" |
| Win where `placed` cell had a ghost (opponent decayed there previous turn) | "You struck the moment their {glyph} vanished" |
| Win/loss with `faded` ≥4 for the loser | "{They} out-waited your marks" |
| Superko-forced loss (mover had no legal move) | "Trapped — every move repeated the past" |
| Fallback | omit (shell shows result only) |

Cell names: centre / the corners / the edges in plain words. Anything requiring more history
than the final apply exposes is out of scope for v1 — note the limitation in code.

---

## 9. Daily-mode requirements Fadeout must satisfy

The daily team consumes these; Fadeout's job is to make them satisfiable (platform §5.2,
synthesis §2.5 — "won in 9" must be comparable between players):

- **Pinned deterministic bot:** fixed tier (**Standard** proposed — Ruthless vs a solved-P1-win
  ruleset would make the daily unwinnable-feeling for most; confirm with daily team, Q3), fixed
  `rollouts` budget (never `deadlineMs` — a wall-clock budget plays differently on a fast
  laptop than a slow phone and silently destroys comparability; the runner asserts
  `budget.kind === "rollouts"`), fixed policy RNG seed from the public daily formula, pinned
  `engine_version` and `gameVersion`.
- **Pinned seat:** the human is P1 in every daily (series alternation does not apply to
  dailies). Comparability requires everyone playing the same seat against the same bot stream.
- Fadeout's `setup` is deterministic (no chance nodes), so the daily seed feeds only the bot's
  policy RNG — already how the worker host derives it (`rngFor(seed + ":bot", step)`).
- Never retune the daily bot silently: any change to tier/budget/seed/engine version is a new
  daily era (roadmap §8 standing risk).

All of this is satisfied for free by §6's decision to use `rollouts` budgets everywhere.

---

## 10. Sequencing and dependencies

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **F0 — now** (no platform deps) | Ruleset-variant spec finalized (§1); state/positionKey design note; heuristic design; texture-line templates; enumerate TDD anchors; UI spec sketched on paper against the shell contract | nothing | F1 |
| **F1 — engine** | Engine + testkit green, parameterized over all 8 `RulesetConfig`s; probes file (mirrorMove stub); manifest draft | **M1** (contract + testkit) | F2 |
| **F2 — the solve** | Game-local solve script (pass 1 on M3a's reach/retrograde over `positionKey`; pass 2 history-aware DFS); 8-variant solve report; **ruleset freeze + device decision (orchestrator review)** | **M3a** + F1 | F3, F4, and the pie/4×4 decisions |
| **F3 — UI + teaching** | Board, telegraph, ghost, pulse, callout, announce, How-sheet, share artifact, texture lines | ruleset freeze (F2) + **shell team's `useGame` hook + BoardShell/Cell** | playtest |
| **F4 — tiers + validation** | Tier tuning, first-game filter, oracle policy, full ci + design suites, cross-checks | **M2** (bots) + F2; full metrics need **M3b** | design-gate review |
| **F5 — gates + playtest** | Both gates on the record; 5-person hotseat playtest (twist-aware play within 2 games, unprompted — roadmap Phase-0 exit) | F3 + F4 | merge readiness |

F3 and F4 parallelize after F2. The hard rule restated once more: **F3 does not start before
the F2 ruleset freeze.** F0 and most of F1's test-writing can start today.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Implementer "simplifies" retrograde to minimax on the cyclic graph | §2.2 written as a code-comment mandate; cyclic fixture in the TDD anchors fails minimax by construction |
| State hashed on occupancy alone → false repetitions | `positionKey` includes queues+toMove by construction; canonicality unit tests; the platform's encode-canonical property |
| Superko/GHI makes the exact C1 value expensive | Two-pass design confines history-aware search to the draw residue; 10-min/variant budget with a defined fallback + escalation, never a silent claim |
| Generic `harness solve` misapplied to Fadeout (encode includes history) | §3.4 documents the seam; the solve script is game-local and reviewed |
| No variant lands FPA in the CI band | Criterion 5 escalation path: declared exception + pie + 4×4 at launch, orchestrator decision Q2 |
| Pie rule shipped onto a cliff (every opening wins) | Exact per-opening table checked before the device decision (§4); statistical sweep as cross-check |
| UI rework from late ruleset change | F3 gated on the freeze; engine parameterized so the solve, not the UI, absorbs variant churn |
| Bot tiers indistinguishable or Ruthless weak | Oracle policy from the solve audits Ruthless directly; tier-ordering nightly gate |
| Badge/opacity semantics drift from the rule sentence | Counting formula pinned in §5.1 and shared by badge, announce(), and accessible names — one definition, three consumers |

---

## 12. Open questions for the orchestrator (none block F0–F2)

1. **First-game-softening seam:** where does the per-device first-game flag live and how does
   it reach the worker host (`BotRequest` extension? shell-side policy wrap)? Needs a small
   platform/shell contract addition — route per CLAUDE.md §4, not sideways.
2. **If criterion 5 fires** (no variant with acceptable FPA + non-quotable strategy): confirm
   the proposed response — declared manifest exception + pie + 4×4/cap-4 at launch — and
   whether the escalation is this team's scope or a new worktree.
3. **Daily pinning:** confirm Standard tier and human-as-P1 with the daily team.
4. **Pie-rule chrome** (if it ships): shell-owned swap prompt — confirm the shell team's queue
   has room, or Fadeout ships behind series alternation only until it lands.

## 13. Definition of done (observable)

- [ ] Eight-variant solve report exists with root values, per-opening tables, quotability
      judgments, C1/C2 draw-rate comparison; ruleset frozen by orchestrator review on its
      strength; balancing device decided from the per-opening table with the §5.9 trap check
      on the record.
- [ ] `engineContract(fadeout)` green; superko recreation-move rejection, decay-timing
      sequences, no-legal-moves = mover-loses corner, and effect-order tests all green;
      zero cap hits across the full harness sweep.
- [ ] Oracle-vs-mcts10k: zero oracle losses over ≥1,000 games; Ruthless-in-optimal-set ≥95%
      on sampled solved positions; solve/self-play directional agreement recorded.
- [ ] `pnpm harness suite fadeout --suite ci` green (or a signed manifest exception);
      `--suite design` report reviewed by Fable with mirror <40% as P2, stall ≤ peer
      expectation, comeback 20–60%, opening concentration reported.
- [ ] Telegraph passes the grayscale-screenshot test; 40%-opacity marks meet 3:1 in both
      themes; badge only at ≤2; ghost for one turn; single 600 ms pulse; reduced-motion parity;
      first-occurrence callout fires once per device at the vacated cell.
- [ ] `announce()` strings for every event type; cell accessible names carry the pending-change
      counting identical to the badge formula.
- [ ] Share artifact renders ≤7 lines with 💨/🎯 substitution encoding and a ≤40-char stat
      line; `textureLine` templates fire on their trigger fixtures.
- [ ] Tiers ordered (ruthless ≥ standard ≥ casual at CI budget); all budgets `rollouts`;
      first-game filter passes its seeded-batch acceptance test.
- [ ] Daily pinning satisfiable and asserted: `rollouts` budget, pinned tier/seed/versions,
      P1 seat.
- [ ] Game route ≤75 kB gz; cells ≥48 px at 320 px; first move <8 s from cold load on mid-4G.
- [ ] Five-person hotseat playtest run: ≥1 player makes a twist-aware play within their first
      two games, unprompted (roadmap Phase-0 exit criterion).

---

## 14. Orchestrator decisions — addendum, 2026-08-02

Rulings on §12's open questions Q1–Q4, plus one interface note. These are binding; the Sonnet
implementer inherits them as-is.

**Q1 — first-game softening is a bot policy parameter, never engine state.** The engine stays
pure and never knows how many games a device has played. Seam as decided: `BotRequest` gains an
optional `soften?: boolean` (platform team); the shell's `useGame` hook reads the
once-per-device localStorage flag and sets it (shell team); the bot host maps `soften: true` to
a tier modifier — a **raised ε blunder rate applied to twist-exploiting moves specifically**,
not a blanket budget cut, so the bot still plays the *base* game well (the whole point of
ux-lens §6's rule). Consequence for this plan: §6's `firstGameFilter` describes what
"twist-exploiting move" means for Fadeout — the game supplies that classification; **the flag
plumbing is an external dependency on the platform and shell teams, not Fadeout scope.** F4's
acceptance test for softening runs once the `soften` field exists in `BotRequest`.

**Q2 — FPA-out-of-band escalation confirmed, scope owner = Fadeout team.** If no variant lands
first-player advantage inside the CI band: declared manifest exception + pie rule + 4×4/cap-4
at launch, all within this team's scope. The 4×4 escalation does **not** consume one of the
eight launch slots and does not need a new plan — it extends this one (the `{size, cap}`
generalization §3 already reserves). The manifest `exceptions[]` justification string must be
written as part of that path — reviewers see the reasoning, never a silently widened band.

**Q3 — daily pinning confirmed:** Standard tier, human always P1, deterministic `rollouts`
budget, fixed RNG seed, pinned `engine_version`. **Explicit interaction, recorded for the
daily team:** site-wide series alternation is the default balancing device everywhere
*except the daily, where it is suspended*. If half of players opened the daily as P2, "won in
9" would not be comparable between players — comparability is the entire point of a daily.
This is a real exception to a site-wide rule; the daily team's implementation must not apply
alternation to daily seats.

**Q4 — pie-rule chrome deferred by construction.** Conditional on the solve: **iff** FPA lands
in the 55–70% band **and** the per-opening value table shows a near-balanced opening exists
(§4's cliff check), the shell team adds a `PieRulePrompt` component; if either condition
fails, no chrome is built at all. The shell planner is reserving the slot without building it.
The F3-after-F2 ordering (no UI before the ruleset freeze) stands and is being held to.

**Interface note carried to the platform team (from §3.4):** `encode` is not a valid position
key for Fadeout under superko — `history` legitimately lives in state, so the generic
`harness solve` (platform plan §7.6), which hashes on `encode(S)`, is **not applicable to
history-dependent games**. Fadeout's solve composes M3a's reach/retrograde building blocks
locally over `positionKey`. The orchestrator is carrying this to the platform team so the
generic solver ships with that caveat documented rather than a broken promise; any other
future game with path-dependent legality (repetition rules, move-history constraints) inherits
the same pattern.

---

## §15 — Orchestrator correction, 2026-08-03: `longestLife` is a bad share stat

**Ruling 2 in §14 was wrong, and the implementer disproved it with measurement rather than
accepting it. Recording the correction, because the reasoning generalizes.**

I ruled that `longestLife` be redefined from "own placements survived" (confined to
{0, 2, 3}) to "plies survived on the board", expecting real variance. It was implemented
exactly as derived. A 3,200-game sweep across all 8 variants then showed the redefined
field is confined to **{0, 5, 6}** — the same cardinality as the metric it replaced, with
`6` in roughly 74% of observations.

**Why, structurally:** once a mark becomes doomed (oldest, owner's queue at cap), there is
exactly *one* ply in which anyone but its owner can evict it early — the opponent's
immediate next turn, giving lifespan `2·cap − 1 = 5`. If that does not happen, the owner's
own next placement forces eviction unconditionally at exactly `2·cap = 6`, because a player
can never skip a turn. Every eviction in every game is therefore 5 or 6. My derivation
stopped at "lifespan is computable" and never asked what values it could actually take.

**The correction:**

1. **Keep the field as implemented.** It is semantically honest, cheap, and correct. This
   is not a rollback — the new definition is strictly better than the old one and the
   `encode` freeze question is settled.
2. **The share artifact must not use it as its variance stat.** `max(removed, survivor)`
   does not rescue it either: any game long enough to contain one natural eviction yields
   6, which is most games.
3. **For a "longest-lived" flavour line, use the survivor-at-game-end computation** — marks
   still alive when the game ends. The same sweep shows a genuine spread across all of
   {1..6} with median 3, because a game-ending win catches marks mid-lifecycle rather than
   at the forced-eviction boundary. The helpers are already exported for this.
4. **`pieces faded: N` remains the primary stat.** It varies naturally with game length and
   needed no rescuing.

**The generalizable lesson, worth citing in future game plans:** a metric derived from a
fixed-cap FIFO under strict alternation is near-constant by construction. Before a number
goes on a share artifact — whose entire purpose is per-game variance — *sweep it and look
at the distribution*. "It is computable and it means something" is not the bar; "it differs
between two players' games" is.

---

## §16 — Orchestrator correction, 2026-08-03: §15.3 is refuted; drop the longest-lived line

**§15 corrected §14's ruling and then made the same error one level down. Recording both,
because the failure mode is more instructive than either ruling.**

§15.3 directed F3 to use the survivor-at-game-end computation for a "longest-lived X: N
turns" share line, citing a {1..6} spread with median 3. Re-review measured what that line
would actually print, over 480 games across all 8 variants:

- **Pooled per-mark survivor values:** `1:480 2:480 3:480 4:480 5:480 6:389` — values 1–5
  appear in *every single game*.
- **Per-game MAX survivor** — the number a "longest-lived" line prints — `{5: 91, 6: 389}`.
  **Cardinality 2**, worse than the {0, 5, 6} that §15 rejected. `max(survivor,
  longestLife)` gives `{5: 52, 6: 428}` — ~85% would read `6`.

**Why:** survivor lifespans within one game are consecutive integers by construction
(`lifespan(i) = total − 2·(faded[p]+i) − p`), so every game's survivor multiset is
essentially {1,2,3,4,5(,6)}. The spread §15 saw is **within-game structure present
identically in every game — zero between-game variance.** The pooled median is 3 because
the *within-game* median is always 3.

**The error, stated plainly: the measurement was right and the unit of aggregation was
wrong.** §15 correctly said to sweep the distribution before putting a number on a share
artifact. It then swept the pooled per-mark distribution rather than the per-game statistic
the artifact actually prints. A pooled distribution can look rich while every individual
game yields the same answer.

**The ruling:**

1. **Drop the longest-lived line.** No variant of it survives in this ruleset. Forced
   eviction caps every lifespan at `2·cap = 6`, and any end state has a near-full queue
   whose oldest survivor is ≥ 5, so the concentration is structural and therefore
   **play-strength-independent**. Re-sweeping against M2's bots is unnecessary for
   max-type metrics: competent play can only narrow a structurally-capped max, never widen
   it.
2. **Use stats with real between-game variance:** `pieces faded: N` (already primary) plus
   **game length in plies** — observed spread 5–75 under random play.
3. **Whatever replacement stat is chosen must be swept against M2's tiers in F4 before the
   share format freezes.** Unlike max-metrics, length and faded-count distributions *do*
   shift with play strength, so those genuinely need the stronger check.
4. **None of this touches the engine.** Survivor stats are computed, never encoded;
   `longestLife` is the only wire-frozen field and it is settled and honest as implemented.

**The generalized lesson, superseding §15's:** before a number goes on a share artifact,
sweep **the per-game statistic the artifact prints**, not the pooled distribution of its
inputs. Ask "would two players see different numbers?" — not "does this quantity take many
values across my whole sample?"

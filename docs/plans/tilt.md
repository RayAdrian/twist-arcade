# Tilt — Implementation Plan (Fable, 2026-08-07)

*Team: `tilt` (worktree `../claude-project-tilt`, branch `feature/tilt`). Supabase: **not started** — client-only feature (synthesis §2.6); record as such in `docs/worktrees.md`.*

*Sources: `research/games/game-theory-lens.md` §1.7/§3.4/§4#3, `research/games/synthesis.md` §3, `research/games/ux-lens.md` §1/§2/§8/§9/§10, `roadmap.md` Phase 1 + §6, `plans/platform-corrections.md` C3, C4, C5, C13–C28, `plans/fadeout.md` (house plan shape). This plan produces no implementation code; it is the input to CLAUDE.md §2 stages 2–6.*

**The game.** Drop-four (Connect-Four-family mechanic; never that name, never blue-rack/red-yellow trade dress — house palette and a square frame are already distinct). **7×7 frame; drop a disc into a column; after every 4th ply the frame rotates 90° and every disc re-falls under gravity before play continues.** First 4-in-a-row (row, column, or diagonal) wins. Rule sentence (canonical, 59 chars): **"Every 4th turn the board rotates and every piece falls again."**

**Correction to the brief that commissioned this plan:** the brief summarized Tilt as "you play a piece, then the board tips" (per-move tilt). The research entry — the specification — is a **scheduled rotation every 4th ply**, not a per-move tilt and not a player-chosen one. "Scheduled rotation = predictable chaos players can plan into" (game-theory §1.7, two-timescale planning) is the design point: the tilt is a clock both players see coming, not a weapon one player aims. This plan follows the research entry.

**This game carries extra weight:** it is the only non-placement family at launch. The stated priority of this plan is to find out **early and cheaply whether the mechanic works** — the kill-test sweep (§5.1) runs before the full gates, and every gate runs before any UI exists (C16).

---

## 1. Ruleset — shipped config and the fine print that must be pinned

The engine is parameterized so variants are config, not code:

```
TiltConfig = { size: 6 | 7;                    // ship 7
               winLength: 4;                    // fixed
               tiltPeriod: 3 | 4 | 5;           // ship 4
               tiltDirection: "cw" | "alternating";  // ship "cw"
               doubleLine: "draw" | "mover-wins" }   // ship "draw"
```

**Shipped config: `{ size: 7, winLength: 4, tiltPeriod: 4, tiltDirection: "cw", doubleLine: "draw" }`.** The non-shipped values are remedy levers (§4), measured only if the shipped config fails a gate — not speculatively (C19: gate runs are expensive; C25: each board's numbers are its own).

Fine print, pinned now so no implementer decides it silently:

1. **Ply convention.** Plies are 1-indexed; P1 plays odd plies. The rotation fires **inside `apply` of plies 4, 8, 12, …** — a single transition running to quiescence per the engine contract. Consequence, stated because it is a structural seat asymmetry: **with period 4, P2 always places the last disc before a tilt, and P1 always moves first on the resettled board.** Which seat that favors is unknown; it is the named mechanism in the balance hypothesis (§4). Odd periods (3, 5) alternate the trigger seat — that is why they are the first remedy lever.
2. **Rotation semantics.** 90° clockwise, rigid rotation of the disc pattern, then each column compacts downward with **relative vertical order along the gravity axis preserved**. This is the unique deterministic outcome; no discs are destroyed, none collide, none can overflow (49 cells, ≤49 discs). One compaction pass reaches quiescence.
3. **Win-check ordering.** Win is checked after the drop. If the drop wins, the game ends **before** any rotation (no tilt on a decided game). If not terminal and the ply is a multiple of `tiltPeriod`, rotate + re-fall, then check again at quiescence. Intermediate configurations during re-fall carry no rules meaning (the animation is narration, never encoding — C5).
4. **Double line after re-fall.** If the re-fall completes 4-in-a-row for **both** players, the game is a **draw** (shipped). If for exactly one player, that player wins regardless of who moved. The frequency of double-lines is measured in the kill-test sweep (§5.1); if it exceeds ~2% of games the `mover-wins` variant gets measured too, because the rule choice is then material to the game's value. Multiple lines for one player = that player wins, same as one.
5. **Full/edge cases.** A full column is not a legal target; `legalMoves` = columns with space. Board full with no line = draw (ply 49 is not a tilt ply; ply 48's tilt happens with one empty cell — handled by the general rule; a tilt of a nearly-full board may create lines, which is fine and covered by rule 4). A tilt whose re-fall moves nothing is a legal no-op (`moved: []`).
6. **No repetition rule, with proof.** Every ply adds exactly one disc and no rule ever removes one, so disc count strictly increases and **no position can ever repeat**. The game graph is a DAG; termination is structural at ≤49 plies. Unlike Fadeout, Tilt needs no threefold/superko machinery, and the 200-ply harness cap is unreachable — **any cap hit is an engine bug, assert zero**. The brief's repetition question is answered by construction, not by a rule choice.

---

## 2. Position identity, `encode`, and solvability (C3, C23)

### 2.1 `encode` IS a valid position key — under one condition this plan makes binding

The state is the **grid alone**, canonically stored in the gravity-down frame (the engine always normalizes; the visible orientation is presentation, derived as `(discCount div 4) mod 4`). Everything else is derivable from the grid:

- `toMove` = parity of disc count (count(P1) − count(P2) ∈ {0,1} always; rotation never changes counts);
- plies played = disc count; plies until next tilt = `tiltPeriod − (discCount mod tiltPeriod)`;
- legality depends only on current occupancy — never on the path.

So two move orders reaching the same grid reach the *same game in every respect*: same mover, same tilt phase, same futures, same value. **`encode(grid)` is a sound position key and generic solver dedup on it would be valid** — the opposite of Fadeout's C3 situation, and worth recording as the family's second worked example (Crackstep being the first).

**The binding condition:** no path-dependent field may live in state. Share-artifact statistics (discs displaced, tilts survived, etc.) are path-dependent — the same grid is reachable with different values of them. They are therefore **computed from the `ReplayRecord` in the presentation layer, never stored in state** (Fadeout's presentation already works this way). `lastEffects` is excluded from `encode` per the platform convention. If any implementer proposes adding a counter to state, this section is the objection.

### 2.2 Exact solve: not feasible; `solvedValue` stays unknown

Raw per-column state count for height 7 is 255 (Σ 2^h, h = 0..7); seven columns give ~255⁷ ≈ 7×10¹⁶ upper bound. Reachable states are far fewer but the classic 7×6 drop game already has ~4.5×10¹² reachable positions; 7×7 with rotation is at or above that order. This is **many orders beyond the ~10⁷ exact-solve ceiling**. Therefore:

- The manifest carries **no `solvedValue`** (equivalent to `{ value: "unknown" }`). **No gate relief of any kind follows (C23).** All five two-player CI gates and the full design gate run for real, and every balance statement in this plan is a hypothesis awaiting measurement (C14).
- **Optional bounded probe, not a solve of the shipping game:** a 4×4/win-3/period-4 miniature is exactly solvable (≤31⁴ ≈ 9×10⁵ raw column states) using the generic solver — legitimately, since §2.1 makes `encode` a sound key. Its *value* tells us nothing about 7×7 (C25: evidence is about the board it was measured on). Its use is qualitative: does rotation produce pathological double-line floods or tilt-decided-everything degeneracy even in miniature? Run only if §5.1's sweep raises those flags and cheap exactness would settle a mechanism question. Budget: half a day, hard-capped.

---

## 3. Engine (`games/tilt/engine.ts`) — against the platform contract

- **State:** `{ grid: readonly (0 | 1 | null)[]; lastEffects: readonly Effect[] }` — grid is 49 cells, gravity-down frame, single source of truth. `toMove`, ply count, tilt phase all derived via exported helpers. `meta`: `{ id: "tilt", minPlayers: 2, maxPlayers: 2, hiddenInformation: false, simultaneous: false, stochastic: false, version: 1 }`. Perfect info ⇒ `playerView` = identity, `V = S`.
- **Move:** column index `0–6`.
- **`apply`:** validate → place at the column's lowest empty cell → win check → if non-terminal and `discCount % tiltPeriod === 0`: rotate + compact, collecting per-disc displacements → win check (rule §1.4) → set `lastEffects` (fully overwritten):
  - `{ type: "placed", player, column, cell }` — always;
  - `{ type: "tilted", direction: "cw" }` — on tilt plies;
  - `{ type: "moved", player, from, to }` — one per displaced disc, listed in a deterministic order (column-major in the new frame). Effect array order (`placed`, `tilted`, `moved…`) **is** the animation spec: the shell's mapper plays them in order.
- **`encode`/`decode`:** `encode` = canonical grid serialization only (§2.1). `decode` **throws a typed error** (C4) on: wrong shape/length, invalid cell values, **floating discs** (any occupied cell above an empty one in its column), and **count-parity violation** (count(P1) − count(P2) ∉ {0,1}). Note recorded deliberately: a grid containing completed lines for *both* players is **reachable** here (a tilt can create both simultaneously — it is the §1.4 draw terminal), so unlike Nine Grids' A3 ruling, `decode` must *accept* it as a terminal state, not reject it. Full reachability validation is out of scope; the checkable structural invariants above are the C4 bar.
- **`heuristic` (optional):** classic open-line counting with a tilt discount — a threat whose supporting geometry does not survive the imminent rotation (checkable by applying the rotation map to the threat cells) is discounted when the tilt is ≤2 plies away. Feeds greedy/rush probes; MCTS tiers do not need it.
- **TDD anchors:** contract suite green (purity, determinism, encode∘decode, legality coherence, no `Math.random`); a hand-computed 4-ply sequence with the expected post-tilt grid and full `moved` list; the order-preservation property (two discs sharing a post-rotation column keep relative order); drop-wins-on-a-tilt-ply ends without rotating; a constructed re-fall that completes a line for the non-mover (they win); a constructed double-line re-fall (draw); full-column rejection; floating-disc and parity `decode` rejections; a property test that `encode` after two different move orders reaching the same grid is identical; zero cap hits across every harness run.

**Scaffold note (C15.4/C28):** the `new-game` fix landed with Nine Grids — scaffolding is now **unregistered by default** and registration is an explicit post-gate step. Verify this is present on your branch before scaffolding; if you are working from an older base, revert the registry insertion manually.

---

## 4. Balance hypothesis (C14) — a number and its falsification condition

**Hypothesis: first-player win rate 55% in strong equal self-play at the validated budget; predicted draw rate under 10%; predicted mean plies 20–40.**

Mechanism, named so the measurement can confirm or kill it: drop-four games carry a real first-mover initiative (the classic 7×6 is a proven P1 win — a perfect-play theorem, which per C14 is *not* a prediction about shipped bots, hence the modest 55% rather than a confident number), partially offset by the §1.1 asymmetry: **P2 places the final disc before every tilt** and can aim placements at the imminent re-fall, while P1 always opens the resettled board.

**Falsification: measured FPA outside [35%, 65%] in the CI gate at the validated budget on a 100-game sample.** Fifteen-game pilots are cost evidence only, never verdicts (C26: Nine Grids' 15-game pilot read 13.3% on a game that measured 46%).

**Remedy menu, fixed before the number arrives** (the C16 discipline — remedies chosen after the measurement, from a pre-committed list, max two retunes per game-theory §3.4):

1. **`tiltPeriod` 3 or 5** — odd periods alternate the tilt-trigger seat, deleting the named asymmetry. Cheapest lever; changes the rule sentence by one word.
2. **6×6 board** — smaller, cheaper to gate. **Note the orchestrator ruling in §12: 6×6 is reserved as a *balance* remedy and may not be spent on the layout problem.**
3. **Kill** — promote the next fast-follow game. No third board (the Wrap precedent). Note the pie rule is *not* on the menu: with a scheduled global event and no opening-strength spectrum mapped, there is no evidence a near-balanced opening exists for P2 to decline, and Wrap proved the device is a no-op when the advantage runs the other way.

---

## 5. Gates before UI (C16) — sequence, budgets, CI-vs-nightly

### 5.1 T2 — the kill-test sweep (the "cheap early answer" this game owes the catalogue)

Before any full gate run, a purpose-built sweep at low budget (random, MCTS-100, MCTS-1k; ~200 games per pairing; one fixed seed — **never** interpolating swept parameters into the seed, C24):

| Measurement | Kill/flag threshold | What it disconfirms |
|---|---|---|
| Strong-vs-random win rate | <90% → kill risk R1 | tilt-lottery: re-falls destroy skill |
| % of decisive games ended *by a re-fall* rather than a drop | >60% → flag R1; ~0% → flag "twist is cosmetic" | either the tilt decides everything or it decides nothing — both kill the pitch |
| Double-line frequency | >2% → measure `doubleLine: "mover-wins"` variant too | whether §1.4's rule choice is material |
| Draw rate | >40% at MCTS-1k → flag | draw flood |
| Mean/median plies, branching | outside 10–40 median → flag | pacing |
| MCTS-1k vs MCTS-100 | <55% → kill risk | no depth: planning through rotations doesn't pay |

This costs minutes to low tens of minutes and answers "does the mechanic work" before the expensive apparatus runs. Any kill row → escalate to the orchestrator with the data; do not tune first.

### 5.2 T3 — budget pilot on the real 7×7 board (C19, C22, C25)

**No budget is imported from any other game — Wrap's 2,000, Fadeout's 3,000, and every number in this section's priors are evidence about their own boards only (C25).** The pilot measures Tilt's own numbers:

- **Cost prior, stated to structure the pilot, not to be believed:** gate cost ≈ games × plies × rollouts × per-rollout cost. Tilt's branching is far lower (≤7) than most of the catalogue but playouts are longer, and each rollout ply pays an O(49) re-fall every 4th ply. Net prior: **roughly 3–15 minutes for the 100-game CI table at ~2,000 rollouts; ~30–90 minutes at the shipped 10,000**. The pilot replaces these guesses.
- **Method:** ~15 games per budget for *timing only* (C26), one fixed comparison seed across all budgets (C24 — use the `compareBudgets` helper, which landed with C24), candidate budgets 1,500 / 2,000 / 3,000 / 5,000 / 10,000-baseline. Then the validation criterion from the C22 resolution: **the cheapest budget whose mean-plies, draw-rate, and FPA match the 10,000-rollout baseline at 100 games** — never speed alone.
- **Tier-collapse floor:** whatever ships must keep `twoPlayerCiRollouts` strictly above standard's 1,000 (`TierBudgetCollapseError`), and C26's ruling applies: while the CI override is active, `ruthless-vs-standard` reports **`n/a` citing the override**; nightly measures it at shipped budgets.

### 5.3 CI-vs-nightly recommendation

- **Manifest:** `ciGateBudget.twoPlayerCiRollouts` is **required** for Tilt (shipped ruthless 10,000 > the 3,000 ceiling → `MissingCiRolloutBudgetError` otherwise), set from the pilot, with a comment naming the board and pilot data it came from (C25's provenance rule).
- **CI (per-PR):** full two-player gate table at the validated scaled budget via `scripts/ci-gates.ts --game tilt`, **if** the validated budget lands ≤ ~10 minutes wall-clock.
- **If the cheapest faithful budget still exceeds ~15 minutes:** balance rows move to **nightly**, and CI keeps the contract/property suite, the route smoke test (C17), and bundle/a11y checks. Those deferred rows must then be reported with C27's **`deferred` status naming the nightly tier — not `n/a`**.
- **Nightly always:** shipped-budget (10,000) full table including the real `ruthless-vs-standard`.

### 5.4 Probes

- **Mirror probe:** the board has left-right reflection symmetry, but a fixed-CW tilt is **not** reflection-invariant (reflection conjugates CW into CCW), so mirroring is not value-preserving — run the probe anyway (it is cheap and C16 says load-bearing probes are never assumed passed): `mirrorMove` = reflect column `c → 6 − c`. Gate: mirror as P2 <40%.
- **Stall probe:** stalling is structurally impossible (every move adds a disc; ≤49 plies) — expect trivial pass; run it anyway.
- **Opening-move concentration and comeback fraction:** standard. Watch opening concentration specifically for "the pre-first-tilt plies are theory-dead".

---

## 6. UI, teaching, accessibility — after gates are green (T5)

### 6.1 Static encodings are authoritative; the tilt animation only narrates (C5)

The tilt is the most animation-tempting mechanic in the catalogue. The binding rule: **everything the rotation animation conveys must be readable statically.**

- **Tilt telegraph (authoritative, static):** a persistent chrome element — countdown "⟳ 3 / 2 / 1" stepping at each turn advance, plus a **direction marker on the board edge that will become the new floor**. Visible from ply 1. This is the two-timescale planning surface; it must pass the grayscale-screenshot test.
- **Just-moved markers (authoritative, static):** after a tilt, every disc the re-fall displaced renders with a static "just-moved" mark for exactly one ply — the reduced-motion answer to "what did the tilt do". These markers exist in the DOM **regardless of motion preference**; the animation is a narration layered on top.
- **Animation (narration only):** board rotation + per-disc settle, mapped from the `tilted`/`moved` effects in array order, within house timing tokens; CSS transforms / Motion One in the board path (C5 constraints); 75 kB gz route budget unchanged.
- **Reduced motion, *observed* not configured:** under `prefers-reduced-motion`, the tilt renders as an instant re-render plus the just-moved markers. Test spec (binding on stage 3, from the C28 A11Y-008 precedent and the Fadeout deleted-gate incident): (a) the test **asserts `matchMedia('(prefers-reduced-motion: reduce)').matches` inside the page** before trusting any result — Playwright's emulation has silently failed in this repo; (b) at least one test **fails if the reduced-motion branch is deleted**.
- **Grayscale/pattern:** player discs are distinguished by glyph/pattern, not hue alone (filled vs ringed disc), so the board survives grayscale and WCAG 1.4.1.

### 6.2 Teaching (Sentence → Telegraph → Aha-callout)

- **Sentence:** the 59-char canonical sentence, shell rule card.
- **Telegraph:** §6.1's countdown + direction marker; the first tilt lands at ply 4, so the twist demonstrates itself within ~15 seconds of play.
- **Aha-callouts:** `first-tilt` — trigger: first `tilted` effect; text: *"The board tilted — every 4th move, gravity wins."* `first-tilt-decided` — trigger: first game-ending line created by a re-fall rather than a drop; text: *"The tilt finished that line."* Each with its own once-per-device flag.
- **How-sheet:** 3 frames — drop → countdown reaches ⟳ → rotated board with discs resettled.

### 6.3 `announce()` — what a screen-reader user must hear (binding)

Fadeout shipped silent at exactly the plies that teach its twist; Tilt's equivalent failure would be a silent tilt. Binding minimum:

1. **Before:** every move announcement within 2 plies of a tilt appends proximity: *"Board tilts after the next move"* / *"…after 2 more moves."* Same counting source as the visual countdown — one definition, two consumers.
2. **The tilt itself:** *"Board tilted clockwise. N pieces resettled."* — a summary, never a per-disc recitation (verbosity is its own accessibility failure). If the tilt ended the game: *"…and {player} completed four in a row. {Player} wins."* — in the same announcement, never omitted.
3. **After:** cell/column accessible names always reflect the *current* position (a tilt relabels everything); column drop targets carry name + fill state ("Drop in column 3 — 4 discs, 3 spaces left"). The shell's on-demand full-board readback must read the post-tilt grid.
4. Result, and the standard whose-turn sequencing, per shell order.

### 6.4 The 48 px floor collides with 7 columns — ruled in §12

At a 320 px viewport, 7 columns ≈ 41–45 px wide after gutters — under the 48 px floor. Mitigating fact: the drop target is a **full-height column strip** (~41 × ~290 px), a far larger target than a 41 px square. **Ruling (§12.1): exception granted with mandatory two-tap commit.**

---

## 7. Share artifact — candidates, not commitments (C12, C18)

**Every claim here is a hypothesis until swept against real generated games** (C18), and the sweep target is **the per-game statistic the artifact prints**, not pooled inputs (Fadeout §16).

- **Timeline candidate:** one glyph per drop by seat, with **⟳ inserted at each tilt** and 🎯 on the winning move. The genuinely variable information is *where the game ends relative to the tilt cycle*. Chunking: lines of ≤15 glyphs from day one (a 49-ply game must chunk; decide it now, not as a thrown `ShareGrammarError`).
- **Stat-line candidates (≤42 chars):** `tilts survived: N` · `won on the tilt` / `won by drop` · `pieces displaced by the last tilt: N`.
- **Binding acceptance:** before the share format freezes, sweep ≥500 games at two bot strengths and keep only stats whose per-game distribution actually varies between games. `tilts survived` is suspiciously close to `plies ÷ 4` — one degree of freedom printed twice, the exact C12 defect — so it likely dies in the sweep; that is what the sweep is for.
- **Texture lines:** "The tilt handed them the win" · "You built a line gravity couldn't break" · "Both lines landed — a shared tilt" · fallback: omit.

---

## 8. Bot tiers, daily, hotseat

- Tiers as manifest data: Casual mcts/100/ε 0.30 · Standard mcts/1,000/ε 0.08 · Ruthless mcts/10,000 — all `rollouts` budgets, never `deadlineMs`, so daily pinning is satisfied by construction. Tuned in T4 until nightly tier ordering holds.
- Daily: deterministic `setup` (no chance nodes), pinned Standard tier, human P1, fixed seed/versions.
- Hotseat via the standard `PassDeviceInterstitial`. Tilt's "twist-exploiting move" classification = moves whose winning continuation depends on the imminent re-fall completing the line.

---

## 9. Acceptance criteria (stage-3 derivable without reading the implementation)

1. Dropping in a non-full column places at that column's lowest empty cell; a full column is rejected and absent from `legalMoves`.
2. After plies 4, 8, 12, … and only when the drop did not end the game, one `apply` yields the rotated-and-compacted grid; for a hand-specified position the exact post-tilt grid matches the fixture, and discs sharing a post-tilt column preserve relative order.
3. A drop completing 4-in-a-row on a tilt ply ends the game with **no** rotation.
4. A re-fall completing a line for exactly one player ends the game in that player's favor **even when the other player moved**; completing lines for both players ends in a draw.
5. Positions never repeat: across any playout, all `encode` values are distinct; no game exceeds 49 plies; zero harness cap hits.
6. `encode` of the same grid reached by two different move orders is byte-identical; `encode` contains no path-dependent fields.
7. `decode` throws a typed error on malformed shape, floating discs, and count-parity violations; it accepts a both-players-lined grid as a terminal draw.
8. Manifest has no `solvedValue`; all five two-player CI gates run; `ciGateBudget.twoPlayerCiRollouts` is present, above 1,000, and its comment names the pilot measurement on the 7×7 board that produced it.
9. CI gate table at the validated budget: strong-vs-random ≥90%, FPA in [35, 65], draw ≤60%, mean plies in band with zero cap hits; `ruthless-vs-standard` reports `n/a` citing the CI override; nightly runs shipped budgets.
10. The tilt countdown and floor-direction marker are visible from ply 1, step at turn advance, and pass the grayscale-screenshot test; they use the same counting source as `announce()`.
11. Just-moved markers appear on every displaced disc for exactly one ply, present in the DOM under both motion preferences; with `prefers-reduced-motion: reduce` **asserted `matches === true` inside the page**, no board-element animation runs and no information is lost; at least one test fails if the reduced-motion branch is removed.
12. `announce()` covers: tilt proximity (≤2 plies), the tilt summary with displaced count, tilt-created game endings in the same announcement, result; column targets expose name + fill state; post-tilt full readback reads the current grid.
13. Both `firstOccurrence` entries fire once per device on their triggers.
14. Share artifact: chunked ≤15-glyph lines, ⟳ at tilts, 🎯 on the winning move; the shipped stat line's per-game distribution was swept over ≥500 games and varies between games.
15. Route ≤75 kB gz; column-strip targets with two-tap commit per §12.1; first move <8 s from cold load.
16. Five-person hotseat playtest: ≥1 player makes a tilt-aware play within their first two games, unprompted.

---

## 10. Risks, ranked, each with its cheapest disconfirming experiment

| # | Risk | Cheapest disconfirming experiment |
|---|---|---|
| R1 | **Tilt-lottery:** re-falls decide games in ways search (and humans) can't foresee; skill expression dies | §5.1 sweep: strong-vs-random and %-of-wins-created-by-re-fall, ~200 games at low budget, minutes of compute — before any gate or UI |
| R2 | **FPA out of band** (either direction — Wrap died both ways) | The CI gate itself at 100 games/validated budget; remedy menu pre-committed in §4; pilots are never verdicts (C26) |
| R3 | **Twist is cosmetic:** rotations rarely change outcomes | Same §5.1 sweep, opposite tail: re-fall-decided ≈ 0% and post-tilt threat deltas ≈ 0 |
| R4 | **Gate cost unaffordable in CI** (C19) | 15-game timing pilot (§5.2) before any 100-game run; nightly deferral path pre-planned with `deferred` status |
| R5 | **48 px floor collision** (§6.4) | Ruled in §12.1 — exception granted, two-tap commit mandatory |
| R6 | **Double-line rule turns out material** | Double-line frequency counter in §5.1; >2% → measure both variants |
| R7 | **Share stats degenerate** (tilts ≈ plies/4) | The §7 distribution sweep before format freeze |
| R8 | **Silent-tilt accessibility failure** ships (the Fadeout lesson) | Acceptance 11–12 written to fail loudly today ([SPEC]-tagged, C28 precedent) rather than pass vacuously |

---

## 11. Sequencing (gates before UI — C16, mandatory)

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **T0** | This plan; §12 rulings (done) | nothing | T1 |
| **T1 — engine** | Engine + tests per §3, parameterized `TiltConfig`, scaffold **unregistered**, probes file | platform (shipped) | T2 |
| **T2 — kill-test sweep** | §5.1; kill/proceed decision on the record | T1 | T3 (or escalation) |
| **T3 — budget pilot** | §5.2 on the real 7×7; set `ciGateBudget` with provenance comment | T2 pass | T4 |
| **T4 — gates** | Full CI table at validated budget + nightly at shipped; design-gate report; probes; **orchestrator review of the numbers** | T3 | T5, registration |
| **T5 — UI + teaching + a11y** | §6; share artifact + sweep (§7); tier tuning | T4 green + shell | stage-3 test design |
| **T6 — gates on record + playtest** | Both gates recorded; 5-person hotseat; route smoke test green | T5 | merge readiness |

**T5 does not start before T4 is green and reviewed.** If T2 or T4 kills the config, the remedy menu (§4) allows at most two retunes; a third failure escalates as a kill recommendation.

---

## 12. Orchestrator rulings (2026-08-07)

Recorded in full in `platform-corrections.md` **C31**.

1. **Cell-floor exception: GRANTED**, conditional on mandatory two-tap commit (first tap selects and highlights the column, second confirms). Rationale: a ~41 × ~290 px column strip is a far larger target than the 41 px square the floor was written for, and Mine Run's conditional exception is the precedent. **6×6 is explicitly NOT the answer here** — it is reserved as a *balance* remedy (§4), and spending it on a layout problem would leave the balance ladder one rung short if T4 fails. Letting a UI constraint pick the board size would also invert the ordering this whole plan is built on. **Carried caveat:** the two-tap commit inherits the unverified TalkBack synthesized-click premise behind the shell's `Cell` activation fix; the five-person playtest resolves both together.
2. **Double-line = `draw`: CONFIRMED** as shipped, with `mover-wins` measured only if T2's frequency exceeds ~2%. It is the symmetric, least-surprising rule, and §5.1 measures whether the choice is material rather than assuming it is not.
3. **C27's `deferred` status: being built** (team `deferstatus`). Until it lands, deferred balance rows are reported **absent-with-reason**, never `n/a`.
4. **4×4 exact miniature: IN SCOPE**, hard-capped at half a day, and run **only** on a T2 flag. Its value proves nothing about 7×7 (C25); its use is qualitative mechanism-checking.
5. **Scaffold registration: RESOLVED.** The C15/C28 fix landed with Nine Grids — `new-game` now scaffolds unregistered and registration is an explicit post-gate step.

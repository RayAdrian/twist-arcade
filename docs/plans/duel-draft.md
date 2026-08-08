# Duel Draft — Implementation Plan (Fable, 2026-08-08)

*Team: `duel-draft` (worktree `../claude-project-duel-draft`, branch `feature/duel-draft`).
Supabase: **not started** — client-only feature (synthesis §2.6).*

*Sources: `research/games/game-theory-lens.md` §1.3/§3.4/§4 row 8/§5.6, `research/games/synthesis.md` §3,
`roadmap.md` Phase 1 + §6, `plans/platform-corrections.md` C3–C5, C14–C28, C32, C41, C44, C48–C49, C51,
C55–C59, `plans/bid-tac-toe.md`, `plans/tilt.md`. Produces no implementation code.*

**The game.** No turns. Each round both players secretly pick an empty cell; picks resolve together.
Different cells → both marks are placed. The **same** cell → nothing is placed and the cell is
**destroyed, permanently unusable**. First 4-in-a-row of your own marks wins; a line containing a
destroyed cell can never be completed by anyone. 4×4 board.
Rule sentence (77 chars): **"Pick cells at the same time — pick the same one and it's destroyed for good."**

**Standing context.** Duel Draft was promoted from the fast-follow queue when Wrap was killed (C20). It
is now the hedge for the Bid-Tac-Toe user decision (C57/C59): if that goes against shipping, this is
Phase 1's sixth game. Its research entry is one shortlist table row, so this plan pins everything that
row left unsaid, and it is shaped for **cheap early falsification** — the kill-test (§6) runs before any
engine code exists, and the game inherits the open finding that **the platform's simultaneous MCTS is not
yet known to be sound** (§7).

---

## 1. Ruleset — the fine print the shortlist row never specified

```
DuelDraftConfig = {
  size: 3 | 4;                 // ship 4
  winLength: 3 | 4;            // ship 4 (the single pre-committed lever is 3)
  collision: "destroy";        // fixed — alternatives rejected below
  doubleWin: "draw";           // both complete lines same round → draw
}
```

1. **Every round is one simultaneous step.** A pick is legal iff the cell is empty (not occupied, not
   destroyed). No pass, no sequential phase, no seat order — `active()` is
   `{ mode: "simultaneous", players: [0, 1] }` in every non-terminal state. Simpler than Bid-Tac-Toe:
   no alternating bid/place structure at all.
2. **Resolution.** Distinct picks: both marks placed in one `apply`. Same pick: nothing placed, cell
   becomes `destroyed`. A line containing a destroyed cell is dead for both players — emergent from
   "4 of *your own* marks", not a separate rule.
3. **Adjudication order.** Exactly one player completes a line → that player wins, *even though the
   opponent's simultaneous placement also stands*. **Both** complete lines in the same round → **draw**
   (the Tilt C45 precedent: neither caused it more than the resolution did). No empty cell and no line
   → draw.
4. **Forced collision endgame.** With one empty cell left, both players' only legal pick is that cell →
   forced collision → board exhausted. Falls out of the general rules; gets a pinned test.
5. **Termination, proved not asserted.** Every round removes ≥1 empty cell and nothing restores one, so
   games last **4–16 rounds** and the graph is a **DAG**. No repetition rule needed; the 200-ply cap is
   unreachable — **any cap hit is an engine bug; assert zero.**
6. **Why `collision: "destroy"` is fixed.** A "bounce" (no-op) collision makes the same round repeatable
   forever — it deletes the termination proof and creates a free stall. Destruction *is* the termination
   mechanism as well as the twist. Alternatives either reintroduce chance (`stochastic: false` is a
   design goal for daily pinning) or are destruction renamed.
7. **Geometry for the probes:** 10 win-lines. Eight cells sit on 3 lines (4 corners + 4 centers —
   unusually equal), eight on 2.

**Why a single threat never wins (the depth mechanism, named so measurement can kill it).** With 3 of a
line placed and the 4th empty, the defender covers that cell; if the attacker also picks it, the
collision destroys it and the line dies permanently. Single threats are strictly answerable, so winning
requires a **double threat** — two completion cells — which resolves as a genuine mixed-strategy guessing
subgame. Whether double threats are *constructible* against competent defense is exactly what D0 and the
gates measure.

---

## 2. Position identity and solvability (C3, C51)

### 2.1 `encode` IS a valid position key

State is the board alone: 16 cells, each `empty | p0 | p1 | destroyed`. Rounds played =
`marks/2 + destroyed`; `count(p0) === count(p1)` is invariant; there is no mover to track and legality
depends only on occupancy. Two round-orders reaching the same board reach the same game in every respect.
**C3's test passes.**

**Binding condition** (Tilt §2.1 precedent): no path-dependent field in state. Collision counts and share
statistics come from the `ReplayRecord` in the presentation layer. `lastEffects` excluded from `encode`.

### 2.2 The shipped 4×4 is **not** solvable; the 3×3 miniature is, and is held as an instrument

Raw bound 4¹⁶ ≈ 4.3×10⁹; the equal-counts invariant cuts it to ≈7×10⁸; pruning buys perhaps one order.
**Still ≥10⁸, beyond the ~10⁷ ceiling** — and worse than a sequential game that size, because every
non-terminal node is a **matrix-game node** whose equilibria are **expected to be mixed** (unlike
Bid-Tac-Toe, where C51 exhaustively confirmed pure saddle points). Mixed nodes need an LP each.

So the manifest carries **no `solvedValue`**; per C23, **no gate relief** — all five two-player CI gates
run for real, and none of the C23/C55/C59 attainment machinery is involved.

**3×3 / win-3 is exactly solvable** (4⁹ = 262,144 raw) with a small mixed-strategy matrix solver over
backward induction — game-local per C3, since `solver/types.ts:67` and `reach.ts:93` refuse simultaneous
engines. Two free correctness anchors: the root value must be **exactly 0 by seat symmetry**, and a
deliberately unoptimised brute-force oracle at tiny depth (the C51 discipline). **Its value proves nothing
about 4×4 (C25).** Its use is as the one exact reference we can own for a simultaneous tree, to
discriminate "the game is degenerate" from "the search is broken" — conditional, trigger in §7, capped at
one day.

---

## 3. Engine (`games/duel-draft/engine.ts`)

- **State:** `{ board: readonly ("empty" | 0 | 1 | "destroyed")[]; lastEffects: readonly Effect[] }`.
  `meta`: `{ id: "duel-draft", minPlayers: 2, maxPlayers: 2, hiddenInformation: false,
  simultaneous: true, stochastic: false, version: 1 }`.
- **Move:** `{ cell: number }`, 0–15.
- **`apply`:** requires a `ReadonlyMap` with **exactly both seats' moves**; a missing seat, extra actor,
  or illegal cell throws a typed error — never a silent default. Effects, fully overwritten: distinct
  picks → `{ type: "placed", player, cell }` × 2, **seat 0 first** (effect order is the animation spec
  and is pinned); same pick → `{ type: "collided", cell }`.
- **`playerView` = identity** for every seat and spectator; `V = S`.
- **`encode`/`decode`:** `encode` = canonical board only. `decode` **throws typed errors** (C4) on wrong
  shape/length, invalid cell values, and `count(p0) !== count(p1)`. Recorded deliberately: a board with
  completed lines for **both** players is reachable — it is §1.3's double-win draw — so `decode` accepts
  it as terminal rather than rejecting it.
- **`heuristic`** (scripted probes only): own-live-lines minus opponent-live-lines, a line being live if
  it holds no opposing mark and no destroyed cell, weighted by own marks on it.
- **TDD anchors:** contract suite green; pinned resolution table (distinct / collision /
  forced-collision-at-one-cell / one-line win with the opponent's simultaneous placement standing /
  double-win draw / exhausted draw); a line through a destroyed cell never scores; equal-counts property;
  §2.1 order-independence; DAG property (no `encode` repeats); zero cap hits; malformed-`decode`
  rejections; a full random game replays byte-identically with two moves per `StepRecord`.
- **Scaffold** unregistered by default (C15/C28). **Registration only after D3 is green**, with the C33
  expected-ids test updated in the same change.

---

## 4. The redaction boundary

There is **no persistent hidden information**. The only secret is a committed-but-unresolved pick, which
— exactly as ruled for Bid-Tac-Toe's sealed bids — is a **transport concern that never enters `S`**: the
collecting layer holds commitments until both exist, then calls `apply` once with the complete map. It
cannot leak through `encode`, `playerView`, `replay`, or the bot host.

The contract test is therefore a transport test, **T-SIM-4** (adopted verbatim from Bid-Tac-Toe): assert
the `BotRequest` for a round contains no field derived from the human's pending pick. C1 has failed twice
in this build; this game's honest answer is that the class of state C1 protects does not exist here, and
the test that proves it is pinned.

---

## 5. Three hypotheses, each with a number (C14)

**H1 — seat symmetry.** Duel Draft has **zero structural seat asymmetry**: the rules never mention a
seat, and engine + identical bots with exchangeable rng streams are invariant under seat relabeling.
**Hypothesis: seat-0 win rate 50%**, n=100 at the validated budget; CI band [35, 65]. Per C49 the
per-reading SD is ~8.5 points, so single readings in [40, 60] are unremarkable.
**Falsification, and note it inverts the usual reading:** replicated readings on two independent seeds
both outside [40, 60] falsify symmetry — and for *this* game that is **diagnostic of an implementation
defect** (seat-indexed resolution order, seat-asymmetric tie-breaking in the joint-move machinery —
precisely where C56 lived), never a design finding and never a tuning matter.

**H2 — decisiveness.** The structural risk is that competent defense makes 4-in-a-row unreachable.
Sketch prior, recorded as a sketch: under uniform random play, a union-bound estimate of
`P(some full line is one player's)` on an 8/8 split is ≤ 20 × 0.0385 ≈ 0.77 before overlap and
early-termination corrections. **Hypothesis: D0's scripted attackers produce ≥20% decisive games; the CI
draw ceiling (≤60%) holds at D3.** **Falsification:** D0's kill rule at <5% decisive, or D3 draw rate
>60%. Remedy ladder pre-committed: `winLength: 3`, **one** re-measurement, then kill.

**H3 — the matching-pennies collapse** (game-theory §5.6, this game's named death). If cell values are
near-equal, the mixed equilibrium degenerates toward uniform randomization and the game is a coin flip.
§5.6's line: **MCTS-1k vs Random < 80% in a simultaneous game = collapsed.**
**Hypothesis: strong-vs-random ≥90%.** **Falsification:** <80% on two seeds, *after* §7's
search-soundness checks pass.

---

## 6. D0 — the kill-test, before any engine exists

The rules fit in ~15 lines of logic, so a **standalone ~50–80-line script** simulates the outcome
structure with zero platform dependency — the Order vs Chaos OV0 pattern, the cheapest kill in this
build's history. Deliverable: `docs/research/games/duel-draft-d0-report.md` plus the script under
`scripts/research/`.

| Rung | What runs | Pre-registered outcome |
|---|---|---|
| **A** | random vs random, n=2,000, 2 seeds | Record decisive rate, mean rounds, collisions/round. **No kill from rung A alone** — random play failing to win is not proof skilled play cannot. |
| **B** | greedy-threat attacker, defensive-cover, mixed-greedy (ε over top-k), each vs random and each other; ~500 games/pairing, 2 seeds | **KILL: every attacker <5% decisive vs both random and defensive-cover, on both seeds** → win-4 practically unreachable. Fire `winLength: 3`, re-run A+B once; still failing → kill. **Also kills:** defensive-cover forcing ≥95% draws against the best attacker (defense is free — Wrap's shape by a different route). |
| **C** | (at D3) MCTS-1k vs random | <80% on two seeds, after §7 clears the search → kill or restructure; escalate, never tune. |

Rungs A+B cost **minutes of compute and about a day including the report**, and can kill the game before
a line of engine code exists. If B fires there is nothing to throw away — that is what "hedge" should mean.

---

## 7. Search-soundness discipline — what Duel Draft inherits from C55–C59

Duel Draft is the **second** game ever to exercise `simultaneous: true`. The first exercised the search
into two corrections: C56 (joint-argmax selection, fixed by `aggregateByOwnMove`) and an **explicitly
unresolved residue** (C57/C58: `strong-vs-random` still declines with budget on Bid-Tac-Toe, and self-play
never draws on a proven draw). **No gate number here may be read as a game verdict until these are on the
record:**

1. **Budget-monotonicity diagnostic (cheap, first at D3):** strong-vs-random at {1k, 2k, 5k, 10k}, one
   fixed seed, ~30 games each. If the rate *declines* with budget — the C55 signature — **stop and
   escalate as platform work**; every downstream number would describe the search, not the game.
2. **Scripted yardstick (C6 adapted):** MCTS-1k must beat D0's best scripted policy by ≥55%. A search
   that cannot beat a 30-line greedy is not a yardstick. This is why D0's scripted bots become a
   permanent probes file rather than throwaway.
3. **Self-play collision-rate probe (this game's own new failure mode):** on a seat-symmetric position,
   two identical *deterministic* policies compute the same pick and **collide with certainty** — round 1
   could degenerate into ritual mutual destruction. Flag: round-1 collision ≥50% → the bots are not
   mixing; escalate (the fix, stochastic final selection at simultaneous roots, is platform work).
4. **Predictor/collider probe (replaces the mirror probe):** a bot that predicts the opponent's pick and
   picks the same cell, seeking draws by destruction. Gate: **<40% draws forced vs Strong.** At ≥40%,
   Strong is too predictable to ship. The stock **mirror probe reports `n/a` with a reason** — there is no
   prior move within a round to mirror, so mirroring is incoherent under simultaneity (the C48 ruling
   shape). The stall probe expects a trivial pass but runs anyway; the collider is the real stall analogue.
5. **The discriminating instrument, held in reserve:** if D3 lands ambiguous — strong-vs-random in
   [80, 90), H1 out of band on both seeds, or any confusing residue — run the **3×3 miniature exact
   solve** (§2.2, capped one day) and measure the shipped search against exact values. That distinguishes
   "the game is degenerate" from "the search is broken" the way Bid-Tac-Toe's solve did. Trigger and cap
   are pre-registered here so the decision is not made under result-pressure.

---

## 8. Gates before UI (C16) — sequence, budgets, cost

1. Contract + property + simultaneity suites (seconds).
2. §7.1 monotonicity diagnostic; §7.2 scripted yardstick.
3. **Budget pilot and sweep** (C19/C22/C25): ~15 games/candidate for **timing only** (never verdicts —
   C26), then `compareBudgets` over {1,000 · 1,500 · 2,000 · 3,000 · 5,000 · 10,000-baseline}. Criterion
   from the C22 resolution: **the cheapest budget whose mean-plies, draw-rate and FPA match the
   10,000-rollout baseline at 100 games** — never speed alone. Tier-collapse floor: strictly above
   standard's 1,500.
4. Full gate table at the validated budget, n=100; probes; H1/H2/H3 adjudicated. **C49: any row within
   ~10 points of a band edge is provisional until a second seed.**
5. Nightly at shipped budgets, including the real `ruthless-vs-standard` (under a CI override it reports
   `n/a` citing the override, per C26).

**Cost projection, with provenance and to be replaced by the pilot (C25).** Games are 4–16 rounds
(median ~6–10), one simultaneous step per round with 2 policy decisions, so ~12–20 decisions/game — but
joint nodes branch at |empty|² up to **256 at the root**, decaying quadratically. Anchors, each named
with its board: Fadeout (3×3 sequential, ~45 plies, ≤9 branching) measured 2,802 s per 100-game matchup
at 10k; Bid-Tac-Toe (simultaneous, 1,156-arm bid nodes) projected 30–90 min. Duel Draft sits between:
**~15–45 min per 100-game matchup at 10k; ~45 min–2.5 h for the full table; expected 3–5× cheaper at the
validated budget.**

Sample-adequacy note carried from C58: marginal aggregation pools ~16 joint arms per own-move, so a
2,000-rollout budget gives the root ~125 aggregated visits per own move — thin for resolving close
candidates. The sweep's verdict-match criterion is what checks whether that matters.

**CI-vs-nightly:** `ciGateBudget.twoPlayerCiRollouts` **required** (shipped ruthless 10,000 > the 3,000
ceiling), from the sweep, with a provenance comment. CI keeps contract/property/simultaneity suites plus
the route smoke test, and the full table **iff** it lands ≤ ~10 min; otherwise balance rows report
**`deferred`-to-nightly** (C27), never `n/a`. Nightly always runs shipped budgets.

---

## 9. Bots and tiers

MCTS-UCT on the joint move space is the only shipped search (minimax refuses simultaneous by design). All
budgets `rollouts` — deterministic, daily-pinnable.

| Tier | Policy | Budget | Blunder |
|---|---|---|---|
| Casual | mcts | 300 | ε 0.30, τ 1.5 |
| Standard | mcts | 1,500 | ε 0.08, τ 1.0 |
| Ruthless | mcts | 10,000 | none |

Starting values; D5 tunes until nightly tier ordering holds. Noted honestly: ε-softmax incidentally makes
the lower tiers *harder to predict* — a virtue where predictability is exploitable (§7.3–7.4) — while
Ruthless is deterministic and is therefore the tier the collider probe targets. If the collider finding
fires, the remedy is platform-level mixed selection, not a per-game hack.

---

## 10. Failure: what it looks like, and where a kill goes

| Signature | Diagnosis | Response |
|---|---|---|
| D0-B: <5% decisive under every scripted attacker | Win practically unreachable; draw-city | `winLength: 3`, re-run once; still failing → **kill** |
| D0-B: defensive-cover forces ≥95% draws vs best attacker | Defense is free (the Wrap shape) | Same single lever, then kill |
| D3: strong-vs-random <80% after §7 clears the search | §5.6 matching-pennies collapse | **Kill or restructure — escalate, never tune** |
| D3: strong-vs-random declines with budget | C55 residue — platform, not game | Halt gating; escalate `mcts.ts`; issue no game verdict |
| H1 outside [40,60] replicated on 2 seeds | Seat-asymmetry **bug** | Bug lane; fix and re-measure; never a design finding |
| Collider ≥40% draw-force vs Strong | Ruthless too predictable to ship | Escalate (platform mixed-selection work) |
| Draw rate >60% at strong self-play | Destruction doesn't rescue decisiveness | `winLength: 3` if unspent; else kill |

**A kill releases the slate hedge**, leaving Phase 1 one game short if Bid-Tac-Toe is unshipped, and
leaving `simultaneous: true` with Bid-Tac-Toe as its only exerciser. That consequence is the
orchestrator's to weigh, and it is why this plan front-loads a sub-one-day kill-test.

---

## 11. UI, teaching, share (D4 — strictly after D3 is green)

- **Board:** 4×4 at 320 px gives ~72–76 px cells after gutters — **comfortably above the 48 px floor, no
  exception needed.** The first game since the floor was written that clears it with margin.
- **Destroyed cells (authoritative static encoding, C5):** a distinct glyph/pattern, never hue alone;
  must survive the grayscale test. Collision animation narrates on top.
- **Sealed picks in hotseat are the heaviest UX cost in the catalogue:** up to 16 rounds × 2 = **32
  `PassDeviceInterstitial` passes** worst case (median ~12–20), worse than Bid-Tac-Toe's 18. D4 must
  prototype a lighter same-screen masked commit before accepting that; the playtest adjudicates.
- **Reveal moment:** both picks flash simultaneously each round — the reveal *is* the game feel. Static
  encoding: last-round markers on both placed cells for one round.
- **Aha-callouts:** `first-collision` — *"You both picked the same cell. It's gone for good."*;
  `first-dead-line` — *"That line can never be finished now."*
- **`announce()` minimum:** per-round resolution ("You played B2; they played C3") or collision ("You
  both chose B2 — it's destroyed"); result; on-demand full-board readback including destroyed cells.
- **Share artifact — candidates, not commitments (C12/C18):** one glyph per round (placement vs 💥
  collision, 🎯 on the winning round), chunked at ≤15 glyphs/line from day one. Stat candidates:
  `cells destroyed: N` · `won on a double threat` · `N-round game`. **Every claim is a hypothesis until
  swept over ≥2,000 generated games with per-game variance checked** — `cells destroyed` could
  concentrate at 0–1 and die in the sweep; that is what the sweep is for.
- **Daily-mode caveat, routed to the daily team** (the Bid-Tac-Toe exploit, worse here): a deterministic
  pinned bot's pick sequence is learnable across retries of the same seed, and here that knowledge is
  *total* — the retrier can dodge every collision and cover every threat. Accept-with-framing vs exclude
  is the daily team's call before rotation.

---

## 12. Acceptance criteria (stage-3 derivable without reading the implementation)

1. A pick is legal iff the cell is empty; occupied, destroyed and out-of-range picks are rejected with
   typed errors and absent from `legalMoves`.
2. `apply` requires exactly both seats' moves; a missing seat, extra actor, or wrong-shaped move throws.
   `active()` reports simultaneous `[0,1]` in every non-terminal state.
3. Distinct picks place both marks in one `apply`, effects `placed`×2 with seat 0 first; same pick places
   nothing and destroys the cell with a single `collided` effect.
4. A completed line of 4 own marks wins even though the opponent's simultaneous placement stands; both
   completing in the same round is a draw; a line containing a destroyed cell never scores.
5. With one empty cell left the round is a forced collision; an exhausted board with no line is a draw.
6. Termination is structural: empty count strictly decreases; no game exceeds 16 rounds; zero cap hits;
   no `encode` repeats within a playout.
7. `encode` serializes the board only; different round orders encode identically;
   `count(p0) === count(p1)` after every `apply`.
8. `decode` throws on malformed shape, invalid values and unequal counts; **accepts** a double-line board
   as a terminal draw.
9. T-SIM-4: the `BotRequest` for a round contains no data derived from the human's pending pick.
10. A full game replays byte-identically, two moves per `StepRecord`.
11. D0's report is on the record with rungs A and B, both seeds, and the kill rule quoted; **D3 does not
    start without it.**
12. Manifest: no `solvedValue`; `ciGateBudget.twoPlayerCiRollouts` present, >1,500, with a provenance
    comment; unregistered until D3 green; C33 expected-ids test updated at registration.
13. Gate table at the validated budget, n=100: strong-vs-random ≥90%, H1 in band, draws ≤60%, mean plies
    in band, zero cap hits; `ruthless-vs-standard` `n/a`-citing-override at CI and real at nightly; §7's
    diagnostics on the record — monotonicity non-declining, MCTS-1k ≥55% vs best scripted, round-1
    self-play collision <50%, collider draw-force <40%; mirror probe `n/a` with the simultaneity reason;
    near-edge rows replicated on a second seed.
14. D4 only: destroyed-cell glyph distinct in grayscale; cells ≥48 px at 320 px; `announce()` covers
    resolution, collision, result and readback; both callouts fire once per device; hotseat flow decided
    against the masked-commit prototype; share stat swept over ≥2,000 games; route ≤75 kB gz.
15. Five-person hotseat playtest: ≥1 player makes a collision-aware play — baiting a collision, or
    covering a threat rather than advancing their own line — within their first two games, unprompted.

---

## 13. Risks, ranked, each with its cheapest disconfirming experiment

| # | Risk | Cheapest disconfirming experiment |
|---|---|---|
| R1 | **Draw-city:** win-4 unreachable under competent defense | **D0 rungs A+B — a standalone ~50-line script, minutes of compute, before any engine exists** |
| R2 | **Matching-pennies collapse** — game ≈ coin flip | D0-B greedy-vs-random spread (partial, free); D3 vs the 80% line |
| R3 | **Search unsound for simultaneous games** (C55/C57 residue) | §7.1 monotonicity + §7.2 scripted yardstick; miniature solve held as discriminator |
| R4 | **Ruthless too predictable** → collider draws, ritual self-collisions | §7.3–7.4 probes: scripted bots, minutes |
| R5 | **Gate cost unaffordable** | 15-game timing pilot before any 100-game run; `deferred` path pre-planned |
| R6 | **Hidden seat-asymmetry bug reads as FPA** | H1's two-seed replication rule; bug lane, never tuning |
| R7 | **Hotseat sealed-pick flow heavier than the game** (32 passes) | D4 masked-commit prototype before accepting the interstitial count |
| R8 | **Share stats degenerate** (collisions concentrate at 0–1) | The §11 distribution sweep before format freeze |
| R9 | **Daily retry exploit** (total information leak) | Decision, not experiment; routed to the daily team |

---

## 14. Sequencing (kill-test before engine; gates before UI — C16)

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **D0 — kill script** | Standalone rules sim; rungs A+B; report + kill/proceed on the record | nothing | D1, or a kill before any code |
| **D1 — engine** | Engine + tests per §3, probes file (greedy family, collider), scaffold unregistered | D0 pass | D2 |
| **D2 — pilot + sweep** | §7.1–7.2 diagnostics; timing pilot; `compareBudgets`; set `ciGateBudget` with provenance | D1 | D3 |
| **D3 — gates** | Full table at validated budget, n=100; probes; H1/H2/H3 adjudicated; **orchestrator review**; D3b conditional 3×3 solve on a §7.5 trigger, capped 1 day | D2 | D4, registration |
| **D4 — UI** | §11 | D3 green + shell | stage-3 test design |
| **D5 — ship** | Tier tuning, nightly wiring, playtest, both gates on the record | D3, D4 | merge readiness |

**No board, no registration, no UI before D3 is green.** The remedy ladder allows exactly one lever
(`winLength: 3`) and one re-measurement; a second failure is a kill recommendation, not a third config.

---

## 15. Orchestrator rulings (2026-08-08)

Recorded in `platform-corrections.md` **C60**.

1. **D0 runs before the engine — confirmed.** Script under `scripts/research/`, report at
   `docs/research/games/duel-draft-d0-report.md`, no worktree engine required. This is the OV0 pattern
   that produced the cheapest kill in the build's history.
2. **The two-tail kill ladder is confirmed and binding**, with `winLength: 3` as the **single** lever and
   **one** re-measurement. A second failure is a kill recommendation, never a third configuration.
3. **Double-win = draw — confirmed**, on the Tilt C45 precedent: neither player caused it more than the
   resolution did, and the symmetric rule is the least surprising.
4. **Proceed under §7's discipline rather than blocking on a full `mcts.ts` diagnosis — confirmed**, and
   the plan's own argument is why: Duel Draft is a second, *smaller* simultaneous tree and is likely the
   best available diagnostic instrument for the C55 residue. **The halt condition is binding** — a
   declining budget-monotonicity curve stops gating and converts this into platform work, with no game
   verdict issued.
5. **Miniature solve: conditional, trigger pre-registered, capped one day — confirmed.** Pre-registering
   the trigger matters more than the cap: it stops the decision being made under result-pressure.
6. **Slate bookkeeping is mine.** If both Bid-Tac-Toe and Duel Draft end green, seven candidates for six
   slots is an orchestrator call and this plan is right to take no position.
7. **Daily rotation exploit — routed.** The retry leak is worse here than in Bid-Tac-Toe, since the
   knowledge is total. The daily team decides accept-with-framing vs exclude before rotation.

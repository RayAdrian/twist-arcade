# Bid-Tac-Toe — Implementation Plan (Fable, 2026-08-07)

*Team: `bid-tac-toe` (worktree `../claude-project-bid-tac-toe`, branch `feature/bid-tac-toe`). Supabase: not started — client-only feature (synthesis §2.6).*

*Sources: `game-theory-lens.md` §1.5/§2/§3, `synthesis.md` §3 #6, `roadmap.md` §6, `platform-corrections.md` C1–C5, C13–C16, C19–C31, `packages/engine/src/types.ts`, `packages/engine/src/replay.ts`, `packages/harness/src/runner.ts`, `packages/harness/src/solver/types.ts`, `packages/bots/src/policy.ts`, `packages/bots/src/worker/host.ts`, `packages/game-spec/src/manifest.ts`. Produces no implementation code; input to CLAUDE.md §2 stages 2–6.*

**The game.** No fixed turns. Each round both players submit a sealed integer chip bid; the higher bid pays and places a mark; first 3-in-a-row wins. Rule sentence (canonical, 63 chars): **"No turns — bid chips each round; the higher bid pays and plays."**

---

## 0. The finding that reshapes this plan: under the shortlist's own payment rule, private budgets are arithmetically impossible

The brief describes Bid-Tac-Toe as a hidden-information game with private budgets. The shortlist entry (`game-theory-lens.md` §3 row 5) specifies **winner pays loser** (classic Richman). These two statements are mutually exclusive, and the proof is three sentences:

Every chip transfer in a winner-pays-loser game equals the winning bid of that auction. The payer knows the amount because they bid it; the receiver knows it because they received it. Therefore every budget-changing event is common knowledge, both budgets are always derivable by both players from the public starting stack (arithmetic, not inference), and the only private data in the entire game is the history of *losing* bids — which never move chips and have no mechanical effect.

So "budgets are private" is not a presentation choice; it is a **payment-rule choice**. Persistent hidden information exists only if chips leave the economy unobserved (winner pays the *bank*, amount unrevealed — the "Poorman" family — or all-pay). This plan therefore specifies two games and recommends one:

- **Variant R (recommended ship): discrete Richman.** Winner pays loser, budgets public on screen, both bids revealed after each auction. `hiddenInformation: false`, `simultaneous: true`. The only concealment is the sealed bid *within* the current round, which is simultaneity, not hidden state.
- **Variant P (specified, not recommended for launch): Blind Bid.** Winner pays bank, only the winner's identity revealed. `hiddenInformation: true`. Genuinely private budgets, genuine belief-state play.

**Why R ships and P waits.** (1) Richman theory — the entire basis of the "no first-player advantage" claim — is a theorem about the public-budget winner-pays-loser game; Poorman variants have different, asymmetric value theory, so Variant P *weakens* the balance claim the game was shortlisted for. (2) Variant P cannot run today: `runMatchup` (runner.ts:190) and the bot worker host (host.ts:151) both throw `HiddenInformationUnsupportedError` for 2-player hidden-info games — the determinized ViewPolicy arm exists only in the solo lane. (3) Determinization multiplies gate cost by K ≥ 8 (C22/C25/C27) on a game that already carries wide bid branching. (4) An exact solve — the cheapest kill-test available — is feasible for R and out of reach for P.

**ORCHESTRATOR RULING (2026-08-07): Variant R ships.** See §14 and `platform-corrections.md` C31.

---

## 1. Ruleset — the axes, and what ships

```
RulesetConfig = {
  budget: number;                       // starting chips per player (ship candidate: 16)
  payment: "richman" | "poorman";       // ship: richman (winner pays loser)
  reveal: "both-bids" | "winner-only";  // ship: both-bids
  tieTransfer: "when-decisive" | "any-star-win";  // ship: when-decisive (confirm vs. Develin–Payne in B0)
}
```

**Bid form.** A sealed bid is `(amount, star?)` — an integer `0 ≤ amount ≤ own budget`, plus optionally the tie-break star, legal only for its current holder (Develin–Payne's discrete formulation: a starred bid counts as `amount + ½`).

**Resolution.** Higher effective bid wins the auction, pays `amount` to the opponent, and enters the place phase. The star transfers to the opponent **iff it was decisive**. Both amounts are then revealed.

**Ties are the common case, not an edge case** — with budget 16 there are only 17 bid levels, and equal bids will happen constantly. The star rule resolves *every* tie deterministically: star included ⇒ starred bidder wins; star not included ⇒ the **non-holder wins** and the holder keeps the star. One consistent rule, no coin flips, no rng. Every tie sub-case gets a pinned test (§11).

**Zero budget is not elimination.** Bid 0 is always legal. At budgets 0–0 both players bid 0 every round and the star alternates the placement right — the game degenerates to alternating-turn tic-tac-toe on the remaining cells and terminates normally.

**All-pay: rejected.** All-pay drains the economy to the bank, killing the Richman comeback loop (under winner-pays-loser, losing auctions *enriches* you — the built-in anti-snowball), and abandons the balance theorem.

**Budget size is decided by the solve, not by taste.** The research note's ~100 chips fails three independent checks: bid branching 101–202 busts the 4–30 design-gate band, joint MCTS branching (101×101 per bid node) busts the gate budget, and the state space (≈2.4×10⁷) busts the 10⁷ exact-solve ceiling. At budget 16: branching 17–34, state space ≈ 19,683 × 33 × 2 × 3 ≈ **3.9×10⁶ — exactly solvable**. B2 solves budgets {8, 12, 16, 20} exactly and ships the smallest one whose extracted optimal strategy fails the quotability test. Working candidate: **16**.

Note the board reachability change: without alternation, *any* interleaving of X/O placements is reachable, so board positions ≈ 3⁹ = 19,683 upper bound, not classic TTT's 5,478.

---

## 2. The balance claim, restated as C14 demands

The shortlist rates FPA **"none by construction."** C14 downgrades that to hypothesis: Wrap's strategy-stealing argument was also a theorem about optimal play, and the shipped bots measured 76% *the other way*. Richman's balance theorem is likewise about optimal (continuous-money) play; the discrete game is *not* symmetric anyway — **someone must hold the star first**, and Develin–Payne quantify the star as strictly positive value.

**Setup:** seat 1 holds the star initially. Seats swap across series rematches.

**Hypothesis H1:** seat-0 (non-holder) win rate in equal-strength self-play, ≥100 games at a validated budget (C26): **predicted 48%, band [45, 55]**. The 2-point deficit is the star.

**Falsification:** outside [45, 55] ⇒ "none by construction" is falsified; go to the device ladder in §8, and the phrase is struck from every doc that repeats it. Outside [35, 65] ⇒ CI-gate failure ⇒ the config is dead as-is; §8's redesign/kill path, escalated, nothing tuned.

**Hypothesis H2 (secondary, honestly unknown):** draw rate at strong self-play. Plain TTT is 100% drawn at strength; whether bidding rescues decisiveness is what the exact solve answers for optimal play and self-play measures for the shipped bots. If the solve proves a draw at every candidate budget, C23 applies — but that relief is only purchasable with a proof artifact, never with the "by construction" assertion.

---

## 3. Engine (`games/bid-tac-toe/engine.ts`)

### 3.1 The simultaneous turn, mapped onto the engine's move model

The contract already carries the needed shape — this game is its first real user:

- `active()` returns `{ mode: "simultaneous", players: [0, 1] }` in the bid phase and `{ mode: "sequential", player: auctionWinner }` in the place phase.
- `apply(state, moves, rng)` receives a `ReadonlyMap` with **both** bids for a bid step and exactly one placement for a place step. A bid-step map missing either seat's move, or carrying a `place` move, throws a typed error — never a silent default.
- **Replay and the moves log need nothing new.** `StepRecord.moves` is `[PlayerId, Json][]` — n entries per simultaneous step, and `runMatchup` already records one `StepRecord` per ply with all actors together. A game is `steps: [bidStep(2 moves), placeStep(1 move), …]`, ≤ 9 auctions ⇒ ≤ 18 steps.
- **Pending bids never live in engine state.** Sealed-bid collection is a *transport* problem owned by whoever assembles the moves map. The bot host is handed canonical state, which contains no pending bid, so it cannot peek — verified by test T-SIM-4. Async (Phase 2) needs a server-side pending-commitment mechanism because C21 ruled the `moves` PK `(match_id, idx)`; Bid-Tac-Toe ships `modes.asyncLink: false` at launch.

### 3.2 State, moves, encode

```
BidTacState = {
  board: (0 | 1 | null)[];            // 9 cells
  budgets: [number, number];          // public under Variant R
  star: 0 | 1;
  phase: { kind: "bid" } | { kind: "place"; winner: 0 | 1 };
  lastEffects: readonly Effect[];
}

M = { kind: "bid"; amount: number; star?: true } | { kind: "place"; cell: number }
```

- `status`: `won` on a line; `draw` on full board with no line. Never `lost`.
- `encode`: stable stringify of `{ board, budgets, star, phase }`, excluding `lastEffects`. `decode` throws typed errors on anything malformed — non-integer or negative budgets, chip-total ≠ 2×budget under Richman, board with two winning lines for different players, place-phase winner inconsistent — per C4 and the C28-A3 precedent.
- **`encode` is a sound position key** (the C3 test, answered explicitly): every auction strictly fills a cell, bidding never empties one, so the game graph is **acyclic** with no repetition rule and no history in state. Contrast Fadeout (superko ⇒ history-dependent).
- `playerView` under Variant R: **identity** (spectator too — nothing to hide; sealed bids are never in state). `V = S`.

### 3.3 Meta and manifest

`meta`: `{ id: "bid-tac-toe", minPlayers: 2, maxPlayers: 2, hiddenInformation: false, simultaneous: true, stochastic: false, version: 1 }`.

Manifest: `modes: { bot: true, hotseat: true, asyncLink: false }`; `ciGateBudget.twoPlayerCiRollouts` **required** (shipped ruthless 10k exceeds the 3,000 ceiling, so C22's `MissingCiRolloutBudgetError` fires without it); value from B3's sweep, never guessed. `solvedValue` starts `{ value: "unknown" }`, upgraded only with a proof pointer to the B2 solve report (C23). Scaffolding is now unregistered by default (C15/C28 fix landed); register only after B3's gates are green.

---

## 4. The redaction boundary

### 4.1 Variant R (ships)

There is no persistent secret. `playerView(S, seat) = S` for every seat and spectator. The one secret in the whole system — a player's committed-but-unresolved bid — **never enters `S`** and therefore cannot leak through `encode`, `playerView`, replay, or the bot host; it lives in the collecting layer until both commitments exist. The redaction contract test is therefore a *transport* test: assert the bot host's `BotRequest` for a bid step contains no field derived from the human's pending bid (T-SIM-4).

### 4.2 Variant P (specified so the orchestrator can price it; NOT built)

- `playerView(S, seat)` = `{ board, star, phase', myBudget, auctionLog }`; `budgets[1−seat]` omitted (omitted, not masked).
- `sampleConsistentState(view, rng)` mandatory: sample opponent budget uniformly over the interval consistent with `auctionLog`. **This is why `auctionLog` must be in `V`** — a view too thin to bound the worlds makes honest determinization impossible, which is the C1 failure shape one level down.
- Platform prerequisites, none of which exist: a 2-player determinized runner arm, a view-honest path in the worker host, and the C1 runtime resampling probe wired for 2P. Gate cost multiplies by K ≥ 8 on the bid phase's 17–34 candidates.

---

## 5. Exact solve (B2) — feasible, game-local, and the cheapest kill-test we own

**Feasibility (C3 checklist):** acyclic graph, `encode` a sound position key, ≈3.9M states at budget 16 — under the 10⁷ ceiling. **But the generic pipeline still refuses this game twice**: `solver/types.ts:67` rejects simultaneous engines outright, and `reach.ts:93` throws on a simultaneous `active()` spec. So, per C3's pattern, Bid-Tac-Toe ships a **game-local solve script** — simpler than Fadeout's, because acyclicity means straight backward induction over topological layers, no value iteration, no GHI.

**The one genuinely novel piece: bid nodes are matrix-game nodes.** A bid node's value is the value of the (2·(B+1)) × (2·(B+1)) simultaneous zero-sum stage game whose entries are successor values. Develin–Payne's theory says discrete bidding games with the star admit **pure optimal bids** — but that is a hypothesis about *our exact tie/transfer variant* until checked. The solve script computes maximin and minimax at every bid node and:

- if they coincide everywhere: the root value is exact and pure — `solvedValue` gets a proof pointer, per-node optimal bids feed the oracle policy and the quotability test;
- if they diverge anywhere: report the fraction and depth of mixed nodes, publish `solvedValue: { value: "unknown" }`, and **expect no gate relief** (C23). The `SolvedValue` vocabulary has no arm for probabilistic values; do not invent one locally — escalate.

**Outputs, per budget in {8, 12, 16, 20}:** root value + star-holder advantage; per-first-auction value table; extracted optimal strategy + quotability judgment; optimal-play draw rate. Deliverable: `docs/research/games/bid-tac-toe-solve-report.md`, orchestrator freeze of `budget` before B3 completes and before any UI.

**Cost estimate (projection, to be validated by a B=8 pilot):** ~1.3M bid nodes × ~1,156 matrix entries ≈ 1.5×10⁹ successor lookups at B=16 — minutes-scale in TS. B=8 is seconds and runs first as the script's own correctness anchor, cross-checked against a brute-force enumerator.

---

## 6. Gates before UI (C16)

### 6.1 What runs, in order

1. **Contract + property suites** (seconds).
2. **B=8 solve pilot → full solve sweep** (§5). This precedes self-play because a quotable forced win or proven-degenerate structure kills the game for free.
3. **Budget sweep, then the gate table.** C22 requires a validated `twoPlayerCiRollouts`; C24 requires one fixed seed across budgets. Criterion: cheapest budget whose mean-plies / draw-rate / FPA **match the 10k baseline**, not cheapest that runs. C26: `ruthless-vs-standard` under an override reports `n/a`, with nightly at shipped budgets the real comparison.
4. **Degeneracy probes, bidding-specific** — these, not the stock set, are where this game would break: **zero-bot** (always bid 0, hoard, rely on star), **all-in-bot**, **constant-k**, **sniper** (bid 0 until the opponent has two-in-a-row, then bid all), plus stock mirror and rush. If zero-bot or sniper ≥ 45% vs Strong, position-pricing skill is fake and the premise fails regardless of FPA.
5. **H1 adjudication** at ≥100 games (C26).

### 6.2 Cost estimate (projection with provenance — C25)

Per game at B=16: ≤18 steps, 27 policy decisions. **Joint bid nodes branch at 34×34 ≈ 1,156 arms** — ~9 visits per root arm at 10k, thin but measurable. Anchor: Fadeout measured 2,802 s per 100-game matchup at 10k. Bid-Tac-Toe trades ~2.5× shorter games against ~10²× wider bid nodes; projected same order: **~30–90 min per 100-game matchup, ~1.5–4.5 h for the full 3-matchup table**.

**Recommendation: nightly gate, not CI.** Per-PR CI keeps the contract/property/simultaneity suites (~seconds) plus, *only if* the budget sweep proves verdict-stability, a smoke gate at the validated budget (target < 5 min). Deferred rows must report as `deferred`-to-nightly, never `n/a` (C27).

---

## 7. Bots and tiers

All budgets `rollouts` (deterministic, daily-pinnable). MCTS-UCT on the joint move space is the only shipped search (minimax refuses simultaneous by design; flat-mc's per-player apply is meaningless for a simultaneous ply).

| Tier | Policy | Budget | Blunder |
|---|---|---|---|
| Casual | mcts | 300 | ε 0.30, τ 1.5 |
| Standard | mcts | 1,500 | ε 0.08, τ 1.0 |
| Ruthless | mcts | 10,000 | none |

Starting values only — B3 tunes until tier ordering holds at *shipped* budgets. If the solve produced pure optimal bids, wrap them as an **oracle policy** and hold Ruthless to ≥95% optimal-set membership on sampled solved positions. Known limitation, stated rather than hidden: joint-space UCT converges to deterministic bid lines and is in-principle exploitable where the true optimum is mixed; the solve's saddle-point census tells us whether that gap exists, and the sniper/mirror probes measure whether it is exploitable in practice.

---

## 8. Failure: what it looks like, and where a kill goes

| Failure signature | Diagnosis | Response (in order) |
|---|---|---|
| H1 outside [45,55], inside [35,65] | Star value larger than predicted | **Chip komi** — non-holder starts +1 chip (then +2). Re-measure; the solve recomputes the komi'd value exactly. |
| H1 outside [35,65] | Structural seat asymmetry beyond star arithmetic | No tuning (C14). Solve report + measurement to orchestrator; komi only if the solve explains the mechanism; else kill. |
| Draw rate > 60% at strong play, solve proves draw | The auction doesn't rescue TTT's drawnness | Consider Variant P (blind bids inject decisiveness through information asymmetry) as the redesign, one measurement, else kill. |
| Zero-bot / sniper ≥ 45% vs Strong | Pricing skill is fake; the premise fails | Kill. No budget size fixes a game where not bidding is the strategy. |
| Optimal strategy quotable at every swept budget | Solved-and-memorable | Kill (strategy-description-length is a design-gate hard line). |

**A kill releases the "for clever people" slot.** Successor candidates: Fog Pools (keeps a hidden-info entry in the pipeline), Crossout, Closing Walls. Duel Draft already holds the simultaneous slot, so a Bid-Tac-Toe death would not orphan simultaneity coverage.

---

## 9. UI, teaching, share (B4 — strictly after B3 is green)

- **Bid input:** stepper/slider 0..budget + star toggle (holder only) + commit. Both budgets and the star always visible — they are public information, and showing them *is* the legibility win of Variant R.
- **Telegraph:** chips visibly move on every resolution; the star physically slides when it transfers. Static encoding authoritative (budget numerals, star position); motion narrates (C5).
- **Hotseat sealed bids are a real UX cost:** 9 auctions × 2 sealed entries = up to 18 `PassDeviceInterstitial` passes per game. B4 must prototype a lighter same-screen commit (e.g. blur-masked entry) before accepting that.
- **Aha-callout:** first auction *lost* — "They outbid you 5–2. Their chips are yours now." — the moment the economy becomes visible.
- **Share artifact:** candidate — one glyph per auction (❌/⭕ by winner, ⭐ marking a star-decided auction) + stat line `won 5 auctions for 14 chips`. **Hypothesis only**: per C12/C18, sweep the per-game statistic across ≥2,000 generated games before the format freezes.
- **Daily-mode caveat:** a deterministic pinned bot's sealed bids are *learnable across retries* of the same seed — attempt k can name the bot's bids from attempts 1..k−1 and counter-bid +1. Qualitatively worse for a bidding game than for placement games (there the bot's moves are visible anyway; here retries breach the seal). Route to the daily team before rotation.

---

## 10. Sequencing

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **B0** | Variant ruling (**done — R**); confirm Develin–Payne tie/transfer fine print against the paper; pin `RulesetConfig` | ruling #1 | B1 |
| **B1** | Engine + contract/property/tie-table tests; probes file; manifest draft (unregistered) | B0 | B2, B3 |
| **B2** | Game-local solve script; B=8 pilot vs brute-force oracle; sweep {8,12,16,20}; solve report; **budget freeze + `solvedValue` decision** | B1 | B3, B4 |
| **B3** | Budget sweep (C22/C24) → validated `twoPlayerCiRollouts`; full gate table at shipped budgets; bidding probes; **H1 adjudicated; ship/kill decision** | B1 (B2 first — cheaper) | B4, registration |
| **B4** | Board UI, sealed-bid input, hotseat flow, callouts, announce(), share sweep | B3 green + shell | playtest |
| **B5** | Tier tuning vs oracle, nightly wiring, 5-person hotseat playtest | B3, B4 | merge |

**No board, no route registration, no UI before B3 is green.** B2 before B3 because the solve is the cheaper kill-test and its output changes what B3 measures.

---

## 11. Acceptance criteria

- [ ] Tie table pinned and green: equal bids star-included / star-withheld / both-zero / zero-vs-zero-at-zero-budgets; star transfers iff decisive; star never held by both or neither.
- [ ] Bid legality: amount > budget rejected; non-integer rejected; star by non-holder rejected; place by non-winner / into occupied cell / in bid phase rejected — each a typed error.
- [ ] Simultaneous contract: bid-step `apply` with a missing seat or wrong-kind move throws typed errors; `active()` alternates per phase; a full game replays byte-identically through `replay()`.
- [ ] Richman conservation invariant: `budgets[0] + budgets[1] === 2 × config.budget` after every apply (property test).
- [ ] `decode` rejects chip-total violations, impossible boards, inconsistent phase/winner — typed errors, never repaired states (C4).
- [ ] `encode` excludes `lastEffects`; move-order-independent states encode identically; acyclicity: no game revisits an `encode` value.
- [ ] T-SIM-4: `BotRequest` payload for a bid step contains no data derived from the human's pending bid.
- [ ] Solve report exists: values + star advantage + quotability judgment per budget; saddle census; budget frozen on its strength; `solvedValue` carries a proof pointer or is `"unknown"`.
- [ ] Gate table on the record at shipped budgets, ≥100 games: strong-vs-random ≥90%, H1 adjudicated, zero cap hits, probes incl. zero-bot/sniper < 45% vs Strong.
- [ ] Validated `twoPlayerCiRollouts` with its sweep evidence linked; deferred rows never printed `n/a`.
- [ ] B4 only: bid UI operable at 320 px, cells ≥48 px, budgets/star legible in grayscale, announce() covers auction/placement/star-transfer, share stat swept for between-game variance.

---

## 12. Risks, ranked (cheapest killer first)

1. **The solve proves a quotable strategy or a star-holder forced win** — *B=8 solve pilot; ~a day of script work, seconds of compute; runs before any self-play money is spent.*
2. **Joint-MCTS self-play FPA outside band despite theory (the Wrap shape)** — *B3's 100-game run; komi dial ready in §8.*
3. **Draw-city at strength** — *same runs; the solve gives the optimal-play answer first.*
4. **Pricing skill is fake (zero-bot/sniper competitive)** — *probes are scripted bots, minutes to write.*
5. **Simultaneous seams break in untested platform corners** — no registered game has ever exercised `simultaneous: true` end-to-end. *Half-day B1 spike playing one scripted game through runner, replay, and host before committing to the schedule.*
6. **Gate cost projection wrong** (joint branching worse than modeled) — *15-game cost pilot before scheduling the full table.*
7. **Daily retry exploit** (§9) — *decision, not experiment; route to daily team before rotation.*

---

## 13. Open questions

Q1 (variant) is **ruled: R**. Remaining, none blocking B1:

2. **Slate bookkeeping:** confirm the launch slot post-C20 reshuffle, and name the successor in case §8's kill fires (suggest Fog Pools to preserve hidden-info pipeline coverage).
3. **Async commitment storage:** sealed simultaneous bids need a pending-commitment mechanism under C21's one-row-per-idx PK. `modes.asyncLink: false` at launch; design lands in the Phase-2 plan.
4. **C27's `deferred` gate status:** B3's report format needs it.
5. **Daily rotation:** the sealed-bid retry exploit; daily team decides accept-with-framing vs exclude.

---

## 14. Orchestrator rulings (2026-08-07)

Recorded in `platform-corrections.md` **C31**.

1. **Variant R ships. Confirmed on the plan's own proof.** The brief I wrote described Bid-Tac-Toe as hidden-information with private budgets; under the shortlist's winner-pays-loser rule that is arithmetically impossible, and the three-sentence proof in §0 is correct. Every chip transfer equals a winning bid known to both parties, so budgets are common-knowledge-derivable throughout. Variant R also makes the exact solve feasible (~3.9M states at budget 16) — the cheapest kill-test this game owns — and removes the determinization tax entirely. **Variant P is not built**; it is the fast-follow if R ships and thrives, and the redesign candidate if R fails specifically on draw rate.
2. **Budget size is decided by the solve, not chosen.** Confirmed. The research note's ~100 chips is rejected on three independent grounds and the plan's arithmetic for 16 is sound.
3. **B2 before B3.** Confirmed and binding: the solve is the cheaper kill-test and its output changes what B3 measures. This is the C29/C30 lesson — run the experiment that discriminates before the one that merely accumulates.
4. **`deferred` status** is being built (team `deferstatus`, C27). Until it lands, deferred rows are reported absent-with-reason, never `n/a`.
5. **Daily rotation caveat is real and routed.** The sealed-bid retry exploit is qualitatively worse than for placement games; the daily team decides accept-with-framing vs exclude before this game enters rotation.

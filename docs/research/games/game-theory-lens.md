# Game Theory & Design Depth Lens — "Twisted Classics" Library

**Research pass for:** a free web library of short, browser-based games that are twists on familiar classics (seed: tic-tac-toe with decaying moves).
**Question this document answers:** *is each twist actually a good game, or just a gimmick — and how do we know cheaply?*
**Date:** 2026-08-02

---

## 0. Framing: why "twist on a classic" is a strong design position

A classic (tic-tac-toe, nim, connect-style drop games, checkers) gives you three things for free:

1. **Zero rules-teaching cost.** The player already knows 90% of the rules; the twist is a one-sentence delta. This is the single biggest predictor of casual conversion.
2. **A stale equilibrium to subvert.** Tic-tac-toe is a draw under perfect play (trivially, and every adult knows it *feels* solved). Connect-Four-style 7×6 drop is a first-player win (Allis / Allen, 1988). Checkers is a draw (Schaeffer et al., 2007, *Science*). The twist's job is to **invalidate the player's cached strategy** while keeping their cached mental model of the board.
3. **A known-good chassis.** The classics survived centuries of selection for legibility. A twist inherits the legibility and only has to add decision depth.

The core game-theoretic claim of the whole product: **a twist is good exactly when it destroys the classic's known solution without destroying its legibility, and the new game has (a) no human-executable dominant strategy, (b) tolerable first-move advantage, (c) low draw rate, and (d) measurable skill expression.** Everything below operationalizes that sentence.

Two theorems frame everything:

- **Zermelo / backward induction:** any finite two-player, perfect-information, zero-sum game has a determined value (first-player win, second-player win, or draw). So *every* perfect-information twist we ship is "solved in principle." That is fine. The design question is never "is it solvable" but **"is the solution computable/memorizable by a human in the time they'll play it?"** Chess and Go are Zermelo-determined too. The failure mode is a game whose solution is *short* (tic-tac-toe: ~1 paragraph; nim: one XOR rule).
- **Strategy-stealing (Nash's Hex argument):** in symmetric "maker" games where an extra piece on the board can never hurt you, the second player cannot have a winning strategy — so first player wins or draws. This is why almost every placement game we build has first-player advantage (FPA) *by theorem*, and why balancing devices (§2.1) are not optional polish but structural requirements. Crucially, several twists below **break the theorem's premise** ("an extra piece never hurts"), which is genuinely interesting — see decay (§1.1) and misère (§1.6).

---

## 1. Taxonomy of twist mechanics

For each: **definition → game-theoretic effect → depth verdict → design cautions.**

### 1.1 Decay / expiry of past moves (the seed idea)

**Definition.** Pieces placed on turn *t* are removed at turn *t + k* (age-based decay), or each player may have at most *m* pieces on the board and placing the (*m*+1)-th removes their oldest (count-capped decay — the viral "tic-tac-toe but your moves disappear" ruleset uses *m* = 3, with the oldest mark typically highlighted as "about to vanish").

**Lineage.** Count-capped decay tic-tac-toe is a rediscovery of the **three men's morris / Achi / Rota** family (~2,000 years old): three pieces each, then movement instead of placement. Three men's morris is solved — **a draw with perfect play**. Nine men's morris is likewise solved (Gasser, 1993): draw. The decay variant differs from morris in one important way: you don't *choose* which piece moves — the oldest is forced off. That forced-removal clock is the novel decision layer: you must count, for every threat, *when* its supporting pieces expire.

**Game-theoretic effect.**
- The game graph becomes **cyclic** — states can repeat. Zermelo still applies via value iteration on the finite game graph (win/lose/draw values exist), but *you must add a repetition rule* or the game is formally unbounded (§5.2).
- The state space stays tiny but the *state* is no longer "board occupancy" — it is board occupancy **plus the age-ordering of each side's pieces**. For 3-cap TTT that is still ≤ ~10⁵ reachable states: exhaustively solvable in milliseconds. Community and hobbyist exhaustive analyses of the viral ruleset indicate a **first-player win with a center opening** — treat that as the working hypothesis and *verify with the pipeline in §3 before shipping*, because the exact ruleset (does the vanishing mark disappear before or after you place? is the doomed mark playable-through?) flips the value.
- **Strategy-stealing weakens.** An "extra" piece now carries a decay liability — it will force a removal at a scheduled time. The classic proof premise ("extra move can't hurt") fails, so second-player-win rulesets become *possible* in this family. That is theoretically unusual and worth exploiting: tuning *k* or *m* is a balance dial that most placement games simply don't have.
- Threats become **temporal**: "I win in 2 unless you block, but my block-forcing piece dies in 1." This is the same pleasure center as chess zugzwang/tempo, delivered on a 3×3 board.

**Depth verdict.** Real, not a gimmick — but on 3×3 with cap 3 it is *small* (fully solvable, likely first-player win). Ship it as the flagship for brand reasons, apply the pie rule, and offer escalations that push it out of human-solvable range: 4×4 with 4-cap, age-based decay (*k* = 6 plies) instead of count-cap, or decay + gravity.

**Cautions.** (a) Mandatory repetition rule: third occurrence of the same position with the same player to move and same age-ordering is a draw — or, stronger and better for draw rate, *superko*: a move recreating a previous full state is illegal. (b) Decay must be **visually pre-announced** (fade the doomed piece) or the game fails the 5-second legibility test (§2.6).

### 1.2 Hidden information

**Definition.** Some component of the state (opponent pieces, pile sizes, objective) is private. Converts a perfect-information game into an **imperfect-information / Bayesian game**.

**Game-theoretic effect.**
- Backward induction no longer applies per-state; the solution concept becomes (behavioral-strategy) **Nash / sequential equilibrium over information sets**. Optimal play generally requires **randomization** (bluffing is an equilibrium phenomenon, not a psychological trick — cf. poker: von Neumann's simplified poker already shows bluffing in the unique equilibrium).
- New skill axes appear that the classic lacked entirely: **inference from revealed actions** (each opponent move is a Bayesian signal), **information-revelation management** (your moves leak your private state), and **exploitative deviation** (punishing non-equilibrium opponents), which is where human-vs-human replayability lives.
- Precedents: Kriegspiel and dark chess (chess + fog), Battleship (pure hidden placement), Stratego.

**Depth verdict.** Highest ceiling of any twist for human-vs-human play. **Biggest trap:** if information leaks too slowly, the early game is skill-free guessing — Battleship's opening is literally uniform random search, which is why Battleship is a bad game for its first half. Guardrail: **every move must reveal at least one bit** (design the probe/feedback loop so posteriors sharpen monotonically and fast).
**Bot caution:** decent hidden-info bots need belief-state sampling (determinized MCTS / ISMCTS), a step up from vanilla minimax — budget M/L for the bot even when rules are S.

### 1.3 Simultaneous moves / no turn order

**Definition.** Both players commit moves each round without seeing the other's; a **collision rule** resolves conflicts (both bounce, both lose the cell, cell is destroyed, priority token alternates).

**Game-theoretic effect.**
- The game becomes a sequence of **normal-form stage games**. For two-player zero-sum, von Neumann's minimax theorem guarantees a value in **mixed strategies** — optimal play is *randomized*. Turn-order advantage vanishes by construction (the game is symmetric).
- Skill shifts from calculation to **equilibrium computation + opponent modeling**: identify which cells are "matching-pennies" contests, weight them by strategic value (the mixed equilibrium weights options by opponent's cost, not your benefit — a persistently counterintuitive fact that gives the game a learnable skill floor).
- **Degeneracy risk:** if each round is strategically flat, the game collapses to iterated matching pennies = pure coin flip vs. a rational opponent (§5.6). The board must make cell values *asymmetric and evolving* so the mixed equilibria are non-uniform and shift each round — that's where skill re-enters.

**Depth verdict.** Good for async multiplayer (commit moves on your own schedule — a perfect fit for a website with no live matchmaking). Medium ceiling vs. bots; high vs. humans (exploitation). Keep rounds ≤ 10 so variance doesn't swamp skill.

### 1.4 Stochastic elements

**Definition.** Chance nodes in the game tree: dice gate which moves are legal (dice chess), a coin decides who moves (random-turn games), tiles/cards are drawn.

**Game-theoretic effect.**
- Solution concept: **expectiminimax** — maximize expected value over chance nodes. Still fully "solvable" in principle; the value is now a probability.
- **Skill/luck dial:** per-game upset probability rises, but skill re-emerges over repeated play at a rate governed by variance (backgammon is the proof: heavy dice, yet masters crush amateurs over a match series). Quantify: if the stronger player's per-game win prob is *p*, they need on the order of *n* ≈ (1.96)²·p(1−p)/(p−0.5)² games for statistical separation — at *p* = 0.55 that's ~380 games (too slow for a casual site's ranking); at *p* = 0.65 it's ~40; at *p* = 0.75 it's ~15. **Target per-game strong-vs-weak win prob 0.65–0.85** (§2.5).
- **Random-turn games are a special, beautiful case** (Peres–Schramm–Sheffield–Wilson, 2007): in Random-Turn Hex a coin decides each turn's mover, and the optimal move for *both* players is the same — the cell most likely to be pivotal. Elegant theory, and the shared-optimal-move property makes hints/tutoring trivial to implement.
- Stochasticity is also the honest answer to "my losses need an excuse" — a real retention feature for casual audiences. Pure-skill losses are attributional and churn weaker players.

**Depth verdict.** Use as a *seasoning* on one or two library entries, not a core identity. It lowers ceiling per game but raises accessibility and retention.

### 1.5 Resource / economy layers — bidding for the move (Richman games)

**Definition.** No fixed alternation. Each turn both players bid from a finite chip budget; higher bid pays the chips (to the opponent, in the classic Richman formulation) and moves. Discrete version (Develin–Payne): integer chips + a tie-breaking token that changes hands when used.

**Game-theoretic effect.**
- **Richman theory** (Lazarus–Loeb–Propp–Stromquist–Ullman): in continuous-money bidding play, the correct bid at position *v* is determined by the **Richman value** R(v), and — the striking theorem — R(v) equals the probability that the player *loses* the **random-turn** version of the same game. Bidding play and coin-flip play are secretly the same object. This is deep, published, public-domain mathematics sitting under a very tactile mechanic.
- **First-player advantage is eliminated by construction** — there is no first player; there is an opening auction. The FPA problem (§2.1) disappears entirely, which no other twist in this taxonomy achieves as cleanly.
- Two coupled skill layers: play the board *and* price every position ("how much is the initiative worth right now?"). Sacrificing the move cheaply in quiet positions to hoard chips for the critical tempo is the emergent expert skill — recognizably the "tempo" concept from chess, made literal and countable.
- Precedent: Bidding Chess / auction chess has real literature (Bhat–Payne et al.) and cult following.

**Depth verdict.** The best depth-per-rule-sentence ratio in this document after decay. Bidding tic-tac-toe on 3×3 with ~100 chips is *not* human-solved even though plain TTT is trivial — pricing positions is genuinely hard. Ship the discrete-bid version (simultaneous sealed integer bids + tie token) so it works async.

### 1.6 Misère / inverted win conditions

**Definition.** The player who achieves the classic's winning condition **loses** (last-to-move loses; making 3-in-a-row loses; capturing everything loses).

**Game-theoretic effect.**
- Not a mirror of the normal game. For impartial games, the **Sprague–Grundy theorem** (every impartial normal-play game ≡ a nim-heap) *fails* under misère play; the general theory needs **misère quotients** (Plambeck–Siegel) and is famously, publishably harder. Misère nim itself is solved and almost identical to normal nim (play normal-nim XOR strategy except when the move would leave only size-1 heaps — then leave an odd number of them): a one-sentence twist that breaks the memorized rule at exactly one point.
- Concrete solved landmarks to respect: **misère tic-tac-toe** (make 3-of-your-own = lose) is a **draw** — first player draws by taking the center and then mirroring the opponent through the center, an elegant known strategy (so plain misère TTT is *too* solved to ship alone). **Notakto** (misère TTT where *both* players place X): first player wins a single board; the multi-board game has a full combinatorial-game-theoretic solution (Plambeck–Whitehead, "The Secrets of Notakto"). **Antichess / losing chess** was weakly solved (Watkins, 2016): White wins with 1.e3 — full-size antichess is compromised at the top but far beyond human memorization.
- Psychological effect: inverts every intuition the player imported from the classic — high novelty per zero new rules. Also inverts strategy-stealing (an extra "winning" move now *hurts*), so misère games can be second-player wins.

**Depth verdict.** Cheap novelty, real theory underneath, but many small misère games are *more* solved than their normal forms. Best used **composed** with another twist (misère + multi-board Sprague-Grundy, misère + decay) or on chassis big enough to resist memorization.

### 1.7 Dynamic board topology (shrinking / wrapping / growing)

**Definition.** The board itself changes: outer ring collapses every *k* plies (shrinking); edges identify into a torus/cylinder (wrapping); cells are added by players or by schedule (growing).

**Game-theoretic effect.**
- **Shrinking = a built-in termination and anti-stall clock.** It bounds game length by construction (§5.2's cure), forces escalating piece density → forced contact → decisiveness, and creates a second timescale to plan against ("that square won't exist in 6 plies"). It also perturbs parity: who moves last before a collapse becomes a computable, contestable resource.
- **Wrapping (torus)** deletes the corner/edge/center hierarchy that carries most of the player's cached opening theory — every cell becomes locally identical, so all imported heuristics die at once while the rules stay verbatim. It also multiplies win-lines: on a 3×3 torus, tic-tac-toe's line count jumps from 8 to 24 (3 rows + 3 cols + 9 wrapped diagonals each way... concretely: every cell now lies on 4 lines) and the game becomes a **trivial first-player win** — so torus TTT must move to 5×5 / 4-in-a-row (not solved in closed form, edge-free, low draw rate) to be a real game.
- **Growing** boards (players place tiles then pieces) drift toward full game-design territory (that's how you get Carcassonne); keep growth *scheduled*, not chosen, to stay in "twist" scope.
- Vs. strategy stealing: symmetric wrapping boards *strengthen* the first-player-wins pressure (more lines, no safe edges) — expect to need the pie rule.

**Depth verdict.** Shrinking is the single best *structural hygiene* twist — it can be added to almost any other variant to guarantee termination and decisiveness. Wrapping is the cheapest "everything you know is wrong" effect in the taxonomy. Both are S-complexity to implement.

### 1.8 Asymmetric roles / hidden objectives

**Definition.** Players have different move sets, win conditions, or piece counts (fox-and-geese family; maker-breaker games), or the win condition itself is private information (secret objective dealt from a known deck).

**Game-theoretic effect.**
- **Kills mirroring and strategy-stealing outright** — both arguments require symmetry. Asymmetric games are where second-player-favored or perfectly-poised games actually live.
- **Maker–breaker games** are a studied CGT class (positional game theory, Beck): Maker tries to complete a line, Breaker merely prevents. Erdős–Selfridge gives Breaker a potential-function criterion; Maker–breaker on small boards is sharply balanced by board size. The playable classic here is **Order and Chaos** (Sniderman, 1981, published as rules in a magazine — rules are not protectable; see §6): 6×6, both players place X *or* O each turn; Order wants any 5-in-a-row of either symbol, Chaos wants to fill the board without one. Computer analysis indicates Order wins 6×6 with correct play — balance by role-swap match pairs (each player plays each role once; §2.1).
- **Hidden objectives** = 1.2 + 1.8 composed: your moves must advance a secret goal while *not revealing it*, the purest information-management game available on a tiny board. Trap: "unfalsifiable gotcha" endings where the loser never had a chance to infer (guardrail in §5.7 — draw objectives from a small public deck so inference is always possible, and reveal dead objectives).
- Balance tooling: asymmetry gives you **continuous balance dials** (piece counts, geese count, board size) that symmetric games lack — plus role-choice-as-pie-rule ("you pick who plays which side" after seeing the setup).

**Depth verdict.** Asymmetric roles are underrated for a casual library: they produce distinct *experiences* per side (doubling content per game) and they're the honest fix for balance problems. Hidden objectives are the highest-risk/highest-charm entry — prototype behind the §3 gate.

### 1.9 N-player (3+) variants — the coalition/kingmaker problem

**Definition.** Three or more players in what was a two-player classic (3-player TTT on a bigger board, 3-player nim, 3-way drop games).

**Game-theoretic effect.**
- Zero-sum structure is destroyed. Nash equilibria still exist (Nash, 1951) but are **non-unique and non-interchangeable** — "perfect play" stops being well-defined as a prescription. The operative frame becomes coalition dynamics (cooperative game theory), which small abstract games handle badly.
- **Kingmaker:** a player who can no longer win but can decide who does — the canonical destroyer of 3-player abstracts. Related: **leader-bashing equilibria** (everyone attacks whoever's ahead → the optimal early strategy is to *look* weak → play degrades into politics and sandbagging).
- Guardrails, in strength order: (1) **score-based, non-elimination** outcomes — every player is maximizing their own count to the end, never "dead"; (2) **no targeted attacks** — moves affect the shared board, not chosen victims; (3) simultaneous moves (removes "who do I hit" turn choice); (4) short games — kingmaking needs time to matter.

**Depth verdict.** Strategically the weakest twist class *and* operationally the most expensive (3-player async matchmaking on a new site is a liquidity nightmare). **Recommendation: exclude 3+ player games from the launch library entirely.** Revisit only with score-race designs after the site has traffic.

### 1.10 (Bonus) Move-coupling constraints — "your move chooses my options"

**Definition.** Each move constrains the opponent's legal replies through a positional rule. The canonical example is **Ultimate Tic-Tac-Toe** (nine 3×3 boards in a 3×3 macro-grid; the cell you pick *within* a small board sends your opponent *to* the corresponding small board).

**Game-theoretic effect.** Explodes state space (~10¹⁸-ish upper bound; not solved) from a 3×3 chassis; every move is dual-purpose (progress here / dictate opponent's arena there), which is the tempo/forcing-move concept from chess delivered in TTT vocabulary. Known issue: the common ruleset ("sent to a won board → move anywhere") has a meaningful first-player edge and known strong openings — use the stricter ruleset (won/full board = closed, sent there → free move) plus alternation.

**Depth verdict.** This mechanic has already won in the market (Ultimate TTT is the most-played TTT variant on the internet). It's the strongest *proven-demand* candidate in the library and the concept is generic/unprotected. Include it.

---

## 2. Design-quality criteria (the library admission bar)

A candidate must pass **all seven gates**. Each is stated as a measurable test; §3 gives the harness that produces the numbers.

### 2.1 First-player advantage (FPA)

- **Measure:** P1 win rate over ≥1,000 self-play games between *identical* mid-strength agents (MCTS with equal budget; §3.3). 1,000 games ⇒ 95% CI of ±3.1 pp.
- **Bands:** **45–55%** raw → ship as-is. **55–65%** → ship *with a balancing device*. **65–80%** → device mandatory + flag for redesign of the ruleset. **>80%** at equal strength, or an exact solve showing a short forced win → do not ship that configuration.
- **Devices, in order of preference for a casual web library:**
  1. **Series alternation** (default, invisible): players alternate first move across a best-of-*n*; the site frames results at series level. Zero rules overhead. Use everywhere.
  2. **Pie rule / swap:** P1 moves, P2 may swap sides. Converts FPA into a strategic decision and forces P1 to open with a *balanced* move (this is how Hex is played seriously). Slight teach cost; use on games with FPA 55–70% and a rich opening set. Caveat: pie only works if *some* near-balanced opening exists — if every legal first move wins, pie just hands the game to P2 (§5.9).
  3. **Role choice as pie** (asymmetric games): P1 sets up / P2 picks side.
  4. **Komi** (score-based games only, e.g. reversi-likes): fractional komi also eliminates draws. Not available in binary-outcome games — you can't half-point tic-tac-toe.
  5. **Bidding for the first move** — the Richman micro-dose: auction the opening. Elegant, but only for games already teaching an economy.
- **Theory check before measuring:** symmetric placement game where extra material can't hurt ⇒ strategy-stealing says P2 cannot win ⇒ expect FPA ≥ 50% *a priori*; decay/misère/asymmetric games are exempt from the theorem and can legitimately come out second-player-favored — test, don't assume.

### 2.2 Triviality / solvability — is the solution human-sized?

- **Estimate state space** log₁₀: board cells *c* with *s* fillings ⇒ ≤ s^c raw; multiply by auxiliary state (piece ages for decay, chip counts for bidding, info-sets for hidden info). Rough anchors: TTT 3×3 ≈ 5,478 reachable; decay-TTT ≲ 10⁵; 5×5 torus TTT ≈ 10¹⁰ raw / ~10⁸ reachable; bidding TTT ≈ 5,478 × chip splits ≈ 10⁶–10⁷; Ultimate TTT ~10¹⁸.
- **Rule:** if reachable states < ~10⁷, **solve it exactly** (retrograde/value iteration — handles cyclic decay graphs; an afternoon of compute). Being machine-solved is *not* disqualifying (checkers is solved; people play checkers). Apply the **strategy-description-length test**: can the winning/drawing strategy be stated in ≤ 3 sentences a player would retain? TTT: yes → dead. Nim: yes (XOR) → dead *for anyone who reads the trick* — acceptable only if the twist breaks the trick (hidden piles do; misère merely dents it). Decay TTT: TBD from the solve — if it's "take center, then follow a 5-line rule," ship the 4×4 escalation as the ranked mode.
- **Dominant-strategy collapse check:** from self-play among *trained/strong* agents, compute opening-move concentration. If one opening captures >90% of strong-agent play *and* exact/deep search confirms other openings lose, the opening book is one line — mandate pie rule or perturb the ruleset.

### 2.3 Draw rate

- **Measure:** draw fraction in equal-strength self-play (mid *and* strong agents — draws typically rise with strength; report both).
- **Bands:** **<10%** ship. **10–25%** acceptable if draws feel like fought-out results (Go-like), else rebalance. **>40% at strong play** → structural fix or kill. (Classic TTT at competent play: ~100% draws — the definition of stale; the twist's first job is usually killing this number.)
- **Draw-killers ranked:** odd win-lines/komi (score games); shrinking board (forces contact); superko-style repetition = *illegal* rather than drawn (decay games); no-draw-by-topology chassis (Hex has **no draws, provably** — the Hex theorem is equivalent to Brouwer's fixed point theorem; drop games fill up; misère games end when someone is forced to lose).

### 2.4 Game length & decisiveness

- **Measure:** plies per game — median, and 95th percentile — at mid-strength self-play. Also: does a formal termination proof exist (finite board that only fills; shrink schedule; superko)?
- **Bands:** median **10–40 plies** (a casual web session is 1–4 minutes); 95p ≤ 3× median; **any** game reaching a hard cap (set cap = 200 plies in the harness) more than 1% of the time → the ruleset has a stalling loop → fix before proceeding (§5.2).
- **Decisiveness/comeback metric:** log a cheap eval (or MCTS root value) per ply; measure the fraction of games where the eventual *loser* held ≥60% estimated win probability at some point. **20–60%** is the sweet band — below 20% the opening determines everything (feels railroaded); above 60% the mid-game doesn't matter (feels random).

### 2.5 Skill expression / luck-skill ratio

- **Ladder test** (the core empiricism): Random < Greedy-1ply < MCTS-100 < MCTS-1k < MCTS-10k, round-robin ≥1,000 games per pairing, fit Elo by logistic regression (or BayesElo).
- **Gates:** **MCTS-1k vs Random ≥ 90%** (below 85% for a deterministic game means the rules barely reward thinking → kill; for a stochastic game 80–90% is acceptable by design). **MCTS-1k vs MCTS-100 ≥ 60%** (search depth must keep paying — <55% means the game is shallow: the 100-sim agent already plays near-perfectly). **Total ladder Elo spread ≥ 300** for a "skill" library slot; 150–300 marks a "casual/luck" slot — label it, don't kill it.
- **Casual luck-skill target:** strong-vs-noticeably-weaker per-game win prob **0.65–0.85**. >0.95 (chess-like determinism) punishes casual players every game; <0.55 is a coin flip. Stochastic and simultaneous twists exist precisely to pull chess-like 0.95+ chassis down into this band.

### 2.6 Legibility (<5-second state read)

Checklist, all required:
- Full state assessable by a newcomer in **<5 s**: ≤ ~25 salient elements on screen; ≤ 2 hidden quantities to track mentally; every pending timed event (decay, shrink) **visually pre-announced** on the board itself (fading piece, cracking ring) — never only in a side counter.
- Mean branching factor **4–30** at mid-game (below 4: choices feel forced; above ~30: casual paralysis — chess is ~35 and sits at the absolute ceiling for this audience).
- The twist statable in **one sentence** appended to a game the player already knows. If the delta needs a paragraph, it's a new game, not a twist — out of brand scope.
- Immediate feedback: consequences of the twist visible within 1–2 plies of the triggering move (bidding: chips move instantly; hidden info: probe feedback next ply).

### 2.7 Degeneracy & exploit screening

Run each candidate against a battery of *scripted degenerate policies* (cheap to write, catastrophic to miss):
- **Mirror bot** (point-symmetric copy of opponent's last move, where legal): if mirror achieves ≥50% as P2 in a symmetric game, the game is broken (§5.4). Fix: odd/central cells, symmetry-breaking rules, or asymmetry.
- **Stall bot** (maximizes game length): if its win/draw rate beats its ladder Elo peers', stalling is rewarded → add shrink clock / superko / move cap with score adjudication.
- **Rush bot** (always the most immediately threatening move): if rush ≈ MCTS-1k, the game is tactically flat.
- **Opening-book concentration** (from §2.2) and **first-move-elimination sweep**: re-run FPA measurement with each opening move forced; if only one opening avoids losing, document it and mandate pie.

---

## 3. Cheap validation pipeline (build this before any polished UI)

**Principle:** every game ships through the same headless harness; a variant is ~200–500 lines of rules code once the harness exists, and a verdict costs < 1 CPU-hour. Kill games in the harness, not in production.

### 3.1 Rules engine contract (per variant, pure TypeScript, no DOM)

```ts
interface Game<S, M> {
  initial(seed?: number): S;                 // seed for stochastic variants
  players: number;                           // 2 for the whole launch library
  legalMoves(s: S): M[];                     // MUST be [] only at terminal states
  apply(s: S, m: M, rng: RNG): S;            // pure; chance nodes draw from rng
  terminal(s: S): null | { winner: 0|1|-1 }; // -1 = draw
  observe(s: S, player: 0|1): Obs;           // = s for perfect info; masked for hidden info
  hashKey(s: S): string;                     // FULL state incl. ages/chips — feeds repetition rule + solver
}
```
Hard requirements: `apply` is pure (enables perft-style testing and tree search); `hashKey` covers *all* state (a decay game hashed only on occupancy will "prove" false repetitions); a **hard cap of 200 plies** adjudicates any runaway as a draw *and logs it* (cap hits are a red-flag metric, not a rule).

### 3.2 Exact solver (when it fits)

If reachable states < 10⁷ (BFS from initial with `hashKey` to check): run **value iteration / retrograde analysis** on the game graph (required over plain minimax because decay graphs are cyclic; iterate win/loss backup to fixed point, residue = draw). Output: game value, P1's optimal opening set, and — via greedy extraction — the **strategy description length** judgment of §2.2. Cost: minutes.

### 3.3 Agent ladder (when exact solve doesn't fit, and always for "feel" metrics)

| Agent | Spec | Purpose |
|---|---|---|
| Random | uniform legal | floor |
| Greedy | 1-ply + 20-line handcrafted eval | "notices threats" baseline ≈ weak human |
| MCTS-100 / 1k / 10k | UCT, c=1.4, random rollouts capped 60 plies | skill ladder rungs |
| Mirror / Stall / Rush | scripted (§2.7) | degeneracy probes |
| (hidden-info games) ISMCTS-1k | determinized sampling of info sets | replaces MCTS rungs |

Vanilla UCT with random rollouts is deliberately unoptimized — identical handicap across variants keeps cross-game comparisons honest. Stochastic games: same agents; just seed the RNG per game and mirror seeds across the pairing (each seed played once with each side as P1) for variance reduction.

### 3.4 Runs and logged metrics

Per variant: round-robin all agent pairs, **1,000 games per ordered pairing** (±3.1 pp CI), alternating/mirrored seats. Log per game: winner, plies, per-ply branching factor, per-ply root value (MCTS agents), cap-hit flag, opening move. Derive:

| Metric | Ship | Rebalance | Kill |
|---|---|---|---|
| P1 win %, equal MCTS-1k | 45–55 (or 45–55 *after* device) | 55–80 → add device / tune | >80 with no working device, or short forced win |
| Draw %, MCTS-1k self-play | <10 | 10–40 | >40 after draw-killers |
| Median plies | 10–40 | 6–10 or 40–80 | <6 or >80, or cap-hits >1% |
| MCTS-1k vs Random | ≥90 (≥80 stochastic) | 75–90 | <75 |
| MCTS-1k vs MCTS-100 | ≥60 | 55–60 | <55 (shallow) |
| Ladder Elo spread | ≥300 (skill slot) / 150–300 (casual slot, labeled) | — | <150 |
| Mirror-bot as P2 | <40 | 40–50 | ≥50 (symmetric game broken) |
| Stall-bot vs Elo-peer expectation | ≤ expected | slight over | clearly over (stalling pays) |
| Comeback fraction (loser ≥60% at some ply) | 20–60 | 10–20 / 60–75 | <10 or >75 |
| Branching factor, mid-game mean | 4–30 | 30–50 | — (legibility judgment) |

**Decision rule:** all green → ship to library. Any "rebalance" → one tuning iteration (parameter change: cap size, decay age, board size, chip count — *not* a new mechanic), re-run, then ship or kill; do not iterate more than twice (a variant needing 3+ retunes is telling you something). Any "kill" cell → kill the configuration (the *mechanic* may survive at another board size — log which).

**Cost estimate:** harness ~2–3 dev-days once; each variant ~0.5–1 dev-day rules + <1 CPU-hour compute. The entire §4 shortlist can be validated in roughly two engineer-weeks — before a single pixel of game UI exists. The same rules engine then ships to production as the client/server game core, and MCTS-100/1k/10k become the literal Easy/Medium/Hard bots — **the validation artifact is the product's bot**, so validation cost is largely recovered.

### 3.5 One thin human check

Bots don't measure fun. After green metrics, 5 hotseat playtests with the target sentence read aloud ("it's tic-tac-toe but your oldest mark disappears"): if a new player makes a *twist-aware* play (e.g., deliberately waits out a decay) within their first 2 games unprompted, legibility and hook are confirmed. That's the whole human protocol pre-launch.

---

## 4. Launch shortlist (ranked)

Complexity: S ≈ ≤2 days rules+bot, M ≈ ≤1 week, L ≈ multi-week. Modes: **B** solo-vs-bot, **H** hotseat, **A** async. All entries are 2-player (per §1.9). Names are provisional and IP-clean (§6).

| # | Working name | Classic | Exact rule change | Why it's interesting (theory) | FPA risk | Cx | Modes |
|---|---|---|---|---|---|---|---|
| 1 | **Fade** | Tic-tac-toe | Each side keeps max 3 marks; placing a 4th removes your oldest (shown fading one turn ahead). Superko: recreating a prior full position is illegal. | The seed. Cyclic game graph, temporal threats, strategy-stealing premise broken (§1.1); three-men's-morris lineage with a forced-decay clock. Fully solvable → solve exactly, tune ruleset details to the best value. | High (working hypothesis: P1 win via center) → pie rule + series alternation; ship 4×4/4-cap as ranked escalation | S | B/H/A |
| 2 | **Nine Grids** | Tic-tac-toe | Ultimate TTT, strict ruleset: your cell choice sends opponent to that macro-board; won/full boards are closed (sent there → play anywhere). | Move-coupling (§1.10): ~10¹⁸ states from a 3×3 chassis, unsolved, proven market demand; every move is progress + opponent-steering (tempo made visible). | Moderate; strict ruleset + alternation suffices | M | B/H/A |
| 3 | **Tilt** | Drop-four (Connect-Four-style; own name/trade dress only) | 7×7 frame; after every 4th ply the frame rotates 90° and pieces re-fall under gravity before play continues. | The classic is solved (Allis 1988, P1 win) — rotation invalidates the solution and all cached column theory; scheduled rotation = predictable chaos players can plan into (two-timescale planning, §1.7). | Moderate–unknown → measure; series alternation, komi-free | M | B/H/A |
| 4 | **Order vs Chaos** | Tic-tac-toe (maker-breaker) | 6×6; both players may place X *or* O on any turn. Order wins on any 5-in-a-row of either symbol; Chaos wins if the board fills without one. | Asymmetric roles kill mirroring/strategy-stealing (§1.8); positional-game theory (maker-breaker, Erdős–Selfridge) underneath; two genuinely different experiences in one game. | Role imbalance, not FPA (Order favored 6×6) → role-swap match pairs | S | B/H/A |
| 5 | **Bid-Tac-Toe** | Tic-tac-toe | No turns. Both players hold 100 chips + P2 holds the tie-token; sealed integer bids each round, winner pays loser and places a mark. Bankrupt ≠ dead (bid 0, keep tie-token rights). | Richman theory (§1.5): position-pricing on a trivially-solved chassis is *not* trivial; FPA abolished by construction; bidding value = random-turn win probability (LLPSU theorem) is teachable content. | **None by construction** — the flagship answer to "is FPA fixable" | M | B/H/A (sealed bids are async-native) |
| 6 | **Wrap** | Tic-tac-toe | 5×5 board with torus wrap (lines continue across edges); first 4-in-a-row wins. | Topology twist (§1.7): deletes the corner/edge/center hierarchy = every imported heuristic dies while rules stay verbatim; edge-free line geometry slashes draw rate; not human-solved at 5×5/4. | High (strategy-stealing applies with extra force) → pie rule | S | B/H/A |
| 7 | **Fog Pools** | Nim | Three pools (e.g. 5/7/9 total known); one pool's exact size hidden, drawn from a public distribution; taking from the hidden pool reveals its size to you only. Normal play: last take wins. | Hidden info on a Sprague-Grundy chassis (§1.2): the XOR rule — the thing that makes nim dead — requires exact sizes, so the solved game becomes Bayesian; probing-vs-revealing tension every turn. | Low–moderate; nim FPA depends on setup — randomize setups per series | S | B/H/A |
| 8 | **Duel Draft** (simultaneous TTT) | Tic-tac-toe | 4×4/4-line; both players secretly pick a cell each round; same cell → cell is destroyed (unusable). First line wins; destroyed cells break lines. | Simultaneous-move normal-form stages (§1.3); mixed-strategy equilibria over cells whose values shift as destruction reshapes line geometry; zero turn-order by construction. | None (symmetric-simultaneous) | S | B/H/A (commit-reveal is async-native) |
| 9 | **Crossout** | Tic-tac-toe (misère, impartial) | Both players place **X** only, on 2 boards of 3×3 simultaneously in play; completing 3-in-a-row *kills that board*; player forced to complete the last living board's line **loses** (Notakto family). | Misère + Sprague-Grundy composition (§1.6): impartial multi-board play is textbook CGT (Plambeck–Whitehead solved it — use 2 boards where the known solution is least quotable, verify with solver); "winning move loses" inverts every cached instinct. | Solved-game risk > FPA risk: exact-solve, pick board count where strategy description is longest; series alternation | S | B/H/A |
| 10 | **Closing Walls** | Checkers (6×6 lite) | 6×6, 6 pieces each, standard captures; after every 8th ply the outermost ring collapses (pieces on it must have moved off or are lost — collapse is telegraphed 2 plies ahead). | Shrinking topology (§1.7) as anti-draw/anti-stall structure on a chassis whose full game is a solved draw (Schaeffer 2007); endgame *comes to you*; evacuation timing is a new resource. | Unknown → measure; parity of "last move before collapse" is the thing to watch | M | B/H/A |
| 11 | **Pawn Rush** | Chess (pawns only) | Breakthrough-family: 6×6, two rows of pawns each; move straight, capture diagonally, no double-step/en passant; first to reach the far rank wins. No draws possible. | Race game with pure tempo/tension structure; no-draw by construction; deceptively deep sacrifice calculus (breakthrough combinatorics); chess vocabulary with 1-sentence rules. | Moderate → measure at 6×6; series alternation | S | B/H/A |
| 12 | **Blindfold Reversi** | Reversi (public-domain name; not "Othello") | 6×6 reversi; you see only cells occupied by or adjacent to your own discs; flips happen normally (you learn of hidden flips only when the region re-enters your view). | Perfect-info classic → Bayesian (§1.2); reversi's signature (big swings from single moves) becomes an inference engine — you *reconstruct* the board from flip feedback; komi available for balance/draw-kill since it's score-based. | Low (komi tunes it continuously) | L (belief-state bot = ISMCTS) | B/H/A |
| 13 | **Secret Lines** | Tic-tac-toe | 4×4; each player is secretly dealt 1 target line from the public 10-line deck; you win by completing *your* line; completing a non-target line does nothing (public event, pure signal/bluff). Dead objectives are auto-revealed. | Hidden objectives (§1.8): every placement is progress + signal management; bluff placements are equilibrium behavior; small public deck keeps inference always-possible (anti-gotcha, §5.7). | Low–moderate; deal balance matters → deal both lines from disjoint cell sets | M | H/A (bot bluffing is L — ship PvP-first) |
| 14 | **Coin-Turn Hex** | Hex (7×7) | Hex, but a coin flip decides who places each stone. Pie rule not needed — no fixed first player. | Random-turn games (PSSW 2007): both players' optimal move is the *same* cell (max pivotality) — theory-rich, hint-system-trivial; Hex theorem guarantees no draws; luck-skill dial set to casual (§1.4). | None (no turn order) | S–M | B/H/A |
| 15 | **Misère Mills** | Three men's morris | Standard three men's morris (place 3, then move), but forming a mill (3-in-a-row) **loses**; a player unable to avoid a mill on their turn loses. | Misère (§1.6) on the *ancestor of the seed game* — nice brand symmetry with Fade; movement phase gives it more life than misère TTT (which is a known draw via center-mirror). Solve exactly; expect small — this is a "palate cleanser" slot. | Solve-dependent → exact solver decides shipping config | S | B/H/A |

**Cut from consideration (with reasons):** any 3+ player variant (§1.9 — kingmaker + liquidity); full misère TTT standalone (known draw, center-mirror strategy is one sentence — fails §2.2); Battleship-family hidden placement (first half is zero-skill search — fails §2.5 unless heavily redesigned, and the name is trademarked anyway); dice-gated chess on full board (L complexity, chess-teaching burden out of scope for casual); growing-board tile games (drifts out of "twist" brand scope, §1.7).

### Ranked top 6 (rank = novelty-per-rule-sentence × validated-depth-likelihood ÷ implementation risk)

1. **Fade** — the seed and the brand; cheapest to build, solvable-and-tunable, ships first.
2. **Nine Grids** — proven demand; the "I could sink real time into this site" anchor.
3. **Tilt** — biggest visual spectacle per rule-sentence; re-fall animation *is* the marketing GIF.
4. **Bid-Tac-Toe** — deepest theory, zero FPA by construction; the "for clever people" flagship.
5. **Order vs Chaos** — asymmetry doubles content; S-complexity; strongest hotseat game on the list.
6. **Wrap** — one word of rules, total heuristic reset; rounds out launch at near-zero cost.

Launch recommendation: ship 1–6 at launch (three are S-complexity), fast-follow 7–11, hold 12–13 (the two hardest bots) for the month-2 content beat, and use 14–15 as low-cost filler beats between.

---

## 5. Traps and anti-patterns (with guardrails)

1. **Kingmaker / coalition politics (3+ players).** A dead player decides the winner; leader-bashing makes *appearing weak* optimal. *Guardrail:* don't ship 3+ player abstracts at launch (§1.9); if ever revisited — score races, no elimination, no targeted moves, short games.
2. **Unbounded games / no forced termination.** Decay and movement variants create cyclic graphs; two stubborn players (or two bots) loop forever. *Guardrail:* every cyclic variant needs one of — superko (position recreation illegal), three-fold repetition = draw (worse: raises draw rate), or a shrink/entropy clock (§1.7). Harness enforcement: 200-ply cap with cap-hits >1% = automatic fail (§2.4).
3. **Stalling-rewarded rulesets.** If the losing side profits from delay (waiting out a decay, forcing the fill in misère), play degenerates into tempo-wasting. *Guardrail:* stall-bot probe (§2.7); structural fix is a clock the staller pays for (shrinking ring, dwindling placement pool), not a rules patch.
4. **Second-player mirroring.** In centrally-symmetric games, P2 copying P1's move through the center can force a draw (or worse — in misère TTT the *first* player uses center+mirror to draw; in some maker games mirror even wins). *Guardrail:* mirror-bot probe (§2.7); fixes: odd center cell that breaks pairing, asymmetric roles, wrap topology chosen so self-mirroring moves collide, or explicit "no move may recreate point symmetry" only as a last resort (rules patches players must memorize are a tax).
5. **Human-sized solutions (the nim problem).** A game whose optimal strategy fits in a sentence dies the moment one player googles it — and on the open web, they will. *Guardrail:* strategy-description-length test on every exact solve (§2.2); twists must break the quotable rule (hidden piles break XOR; decay breaks TTT lines), not just decorate it.
6. **Simultaneous-move collapse to matching pennies.** If stage-game options are near-equivalent, the mixed equilibrium is uniform randomization = coin-flip game with extra steps. *Guardrail:* board structure must keep cell values unequal and drifting (destruction, line geometry); check: if MCTS-1k vs Random < 80% in a simultaneous game, it has collapsed — kill or restructure.
7. **Hidden-information "gotcha" endings.** Loser never had the information to avoid losing (Battleship openings; secret objectives drawn from an unknown/huge pool). *Guardrail:* every move must leak ≥1 bit; secret pools are small and public; dead secrets auto-reveal (Secret Lines, #13); no win may hinge on information the loser provably never had access to.
8. **Stochastic overwhelm.** Chance so heavy that MCTS-10k ≈ MCTS-100. *Guardrail:* the 0.65–0.85 strong-vs-weak band (§2.5); if a chance mechanic pushes strong-vs-random under 80%, reduce variance (fewer/smaller dice, more draws-with-choice) rather than adding compensating rules.
9. **Pie rule on a cliff.** Pie/swap assumes a spectrum of first-move strengths so P1 can pick a balanced one; if *every* opening wins (tiny solved boards), pie just transfers the win to P2. *Guardrail:* run the first-move-elimination sweep (§2.7) before choosing pie; where all openings win, change the board, not the device.
10. **Twist stacking.** Two twists each pass alone; combined they exceed the legibility budget (decay + hidden info + bidding = nobody can hold the state). *Guardrail:* one primary twist per game, plus at most one *structural hygiene* mechanic (shrink clock, komi, superko). The library's brand is "one sentence of new rules."
11. **Chess-variant scope creep.** Chess chassis pulls in castling/promotion/check edge cases and a strong-bot expectation; each chess variant is silently L. *Guardrail:* only pawn-subset (#11) or heavily reduced boards at launch; full-board chess variants are a post-traction bet.

---

## 6. IP / trademark hazards

**The legal frame (one paragraph):** game *rules and mechanics* are not protectable by copyright (ideas/systems doctrine — this is settled ground); what is protectable is **names (trademark)**, **visual expression / trade dress** (the specific look: Connect Four's blue rack with red/yellow discs as a combined get-up), and **literal rule text and artwork** (copyright — always write your own rules text). Patents on classic mechanics are long expired. So: every *mechanic* in this document is safe to build; the risk is entirely in naming and skinning.

| Chassis | Status | Do / Don't |
|---|---|---|
| Tic-tac-toe, noughts & crosses | Ancient, generic | Free — name included |
| Nim, morris/mills family, Achi/Rota | Ancient | Free |
| Chess, checkers/draughts, Go, reversi | Ancient / 19th-c. generic | Free. Say **reversi**, never "Othello" (trademark, currently Megahouse) |
| Hex | Public-domain math object (Hein/Nash); the *name* is generic in the literature | Low risk; using "Hex" descriptively is standard, but our own name (Coin-Turn Hex → e.g. "Bridgefall") is cheaper than any argument |
| Dots and boxes, sprouts | Folk / academic | Free |
| **Connect Four** | **Hasbro trademark** | Mechanic (vertical drop-four) fine; never the name, never blue-rack/red-yellow trade dress → "Tilt," different palette and frame shape |
| **Battleship** | **Hasbro trademark** | Grid-search mechanic generic; avoid name + pegboard look. (We're not shipping it anyway — §4 cut list) |
| **Othello** | Trademark | Use "reversi" |
| **Scrabble, Boggle, Uno, Yahtzee, Jenga, Monopoly** | Hasbro/Mattel marks | Mechanics fine (Yahtzee's is public-domain **Yacht**; Uno's is public-domain **Crazy Eights**) — but none are in our abstract-strategy scope anyway |
| **Notakto** | Coined name (Sit; popularized via a commercial app) | The misère-X mechanic is math (Plambeck–Whitehead published it); use our own name ("Crossout") |
| Ultimate tic-tac-toe | Folk/generic descriptive name, no registered mark of note | Concept unprotected; our own name ("Nine Grids") still cleaner for brand |
| Order and Chaos | Sniderman 1981, rules published in *Games* magazine | Rules unprotectable; name is descriptive-generic, low risk — but re-skinning costs nothing |
| Modern commercial abstracts (Hive, Onitama, Santorini, Azul…) | Living companies, active marks, distinctive trade dress | **Do not clone.** Out of scope — our brand is twists on *folk* classics, which is also the clean legal lane |

**House rule:** every library entry gets an original name, original visual identity, self-written rules text, and a "family" note ("in the morris family") rather than a commercial comparison. Descriptive references to public-domain classics ("a tic-tac-toe variant") are safe and good for SEO.

---

## 7. Bottom line

- The product thesis is sound *if and only if* every entry is gated by measurement, not vibes. The seed idea (Fade) is genuinely good — decay creates temporal threats, breaks the strategy-stealing premise, and revives a 2,000-year-old solved family — but it is small and near-certainly first-player-won as commonly played, so it ships with pie rule + alternation and a 4×4 ranked mode, informed by an exact solve that costs an afternoon.
- The two highest-leverage engineering investments are (1) the **shared headless harness** (§3) — every go/no-go becomes <1 CPU-hour, and the validation bots become the shipped difficulty levels — and (2) **series-level alternation as the site-wide default**, which silently absorbs most FPA problems before any per-game device is needed.
- The deepest wells in the taxonomy are **bidding (Richman)** and **hidden information** — both convert "solved" into "open" with one sentence of rules. The cheapest structural medicine is **shrinking boards** (termination + anti-stall + decisiveness in one mechanic). The thing to refuse is **3+ player variants** — kingmaker dynamics plus matchmaking liquidity make them the wrong bet for launch.

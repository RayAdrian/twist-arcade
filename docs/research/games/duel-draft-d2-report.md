# Duel Draft D2 — search-soundness probes, the drawishness diagnosis, and the kill

Verdict: **killed** (`docs/plans/platform-corrections.md` C66). This file is the evidence index.
Raw outputs are the `duel-draft-*.out` files beside it, preserved from the team's worktree before
teardown because C66's claims rest on them.

Every number below is `n=100` per cell unless stated, with the seed named in the raw output.

---

## 1. §7.1 — budget monotonicity (the C55 signature)

`duel-draft-d2-71.out`. strong-vs-random at {1k, 2k, 5k, 10k}, one fixed seed, n=30.

| rollouts | win rate |
|---|---|
| 1,000 | 76.7% |
| 2,000 | 80.0% |
| 5,000 | 83.3% |
| 10,000 | 86.7% |

**No decline — no C55 signature.** Duel Draft did not reproduce Bid-Tac-Toe's residue.

**Methodological note (worth more than the result).** The ladder is exactly +1 win per step —
23/30, 24/30, 25/30, 26/30. Three identical increments is the signature of a **paired design**: the
shared seed means the random opponent plays the same games, and only marginal positions flip as
budget rises. The unpaired binomial SE quoted in the raw output (~7.7 pts) is therefore the wrong
error model; on paired data the relevant SE is on the differences and is much smaller. It does not
change the verdict — no decline is no decline in either model — but it is the C47 shape recurring:
the error model was chosen without asking what the design was.

## 2. §7.2 — scripted yardstick

`duel-draft-d2-72.out`. Round robin first, because D0's report named its "best" policy by decisive
rate, and decisive rate does not say who wins.

Measured standings: **defensive-cover 66.0%** > greedy-threat 55.0% > mixed-greedy 29.0%. This
**overturned D0's implicit read** — defensive-cover beats mixed-greedy 64–0, not the reverse.

MCTS-1k vs defensive-cover: **0.0% win rate, 100% draws** against a ≥55% gate.

## 3. Discriminating collider from broken search

`duel-draft-d2-73/74/75.out`. The orchestrator hypothesised §7.4's collider (a bot that predicts the
opponent's pick and destroys it). **Refuted for the pairing that mattered:**

- Pick-coincidence, MCTS-1k vs defensive-cover: round 1 **8.0%**, nowhere near certainty; pooled
  32.6%, concentrated in endgame rounds where §1.4 makes collision *mandatory*, not strategic.
- Budget escalation, MCTS-10k vs defensive-cover: **0W/100D/0L** — identical to 1k. Thin budget was
  not the explanation.
- defensive-cover vs random: 56W/44D/0L — a competent attacker, not a passive staller.
- defensive-cover vs **itself**: 0W/100D/0L at **exactly 16.0 mean plies, zero variance**, round-1
  collision **100%**. Total ritual destruction: the whole board destroyed one cell at a time with no
  mark ever placed. Confirmed for two of three pairings; the hypothesis was simply wrong for MCTS.

## 4. §7.3 — the collision gate, run for the first time

`duel-draft-mcts-selfplay-collision.out`. §7.3's subject is the **shipped bots**, not scripted
policies. This gate had never been run.

| budget | seed | round-1 collision | flag ≥50% |
|---|---|---|---|
| mcts1k | A | 17.0% | clear |
| mcts1k | B | 10.0% | clear |
| mcts10k | A | 17.0% | clear |
| mcts10k | B | 13.0% | clear |

Mean plies 7.1–8.9 with variance 4.5–9.3 — **not** the ritual-destruction signature (16.0, zero
variance). **The bots mix.** Combined with §7.1 and the budget escalation, the search is sound.

Self-play W/D/L across the four cells: **99%, 100%, 99%, 94% draws.**

## 5. The lever — `winLength: 3`, its one sanctioned use

`duel-draft-d2-lever-*.out`. Two independent seeds per measurement.

| measurement | `winLength: 4` | `winLength: 3` | gate |
|---|---|---|---|
| strong self-play draws | 94–99% | **99.0%, 99.0%** | <60% — misses |
| scripted yardstick | 0.0% | **0.0%, 0.0%** | ≥55% — misses |
| first-player advantage | 0.0% | **0.0%, 1.0%** | [40,60] — out |
| strong-vs-random @10k | 86.7% | **99.0%, 97.0%** | ≥90% — clears |
| §7.3 round-1 collision | 10–17% | 17–38% | <50% — clears |

The lever fixed the one thing that was not the problem. Mean plies fell 7.1–8.9 → 4.1–4.6, the search
got much stronger against random, the bots kept mixing — and self-play still drew 99 times in 100.

**A note on the FPA number.** At 99% draws, seat 0 can win at most ~1% by construction, so the
first-player-advantage metric is *degenerate here rather than informative*: 0.0% does not mean
"severe seat asymmetry against seat 0," it means there are almost no decisive games to attribute. It
is reported as out-of-band because it is, but it is not independent evidence — the draw rate already
says everything it says.

## 6. Verdict

Plan §10 row 7 (*draw rate >60% at strong self-play → `winLength: 3` if unspent; else kill*) and row
2 (*defensive-cover forces ≥95% draws vs best attacker → same single lever, then kill*). Lever spent.
**Kill.**

The `winLength: 3` engine change was an experiment and was **not merged** — `main` keeps D1's
`winLength: 4` engine, unregistered. The kill is of the game, not the code: it remains the
catalogue's second `simultaneous: true` exerciser, which is what allowed §7.3's gate to be run at
all.

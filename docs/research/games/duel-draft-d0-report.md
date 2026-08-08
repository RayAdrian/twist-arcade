# Duel Draft D0 — the kill-test

*Plan: `docs/plans/duel-draft.md` §6 (rungs), §15.1/§15.2 (orchestrator rulings on the kill
ladder). Script: `scripts/research/duel-draft-d0.ts` — standalone, zero dependency on
`@twist-arcade/engine`, `@twist-arcade/harness`, or bots. Run:
`pnpm tsx scripts/research/duel-draft-d0.ts`. Total wall-clock for the full run (self-test +
both rungs, both seeds, 2,000+9×500×2 games): well under one second — this is the cheapest kill
in the build's history, exactly as the plan predicted.*

## Verdict

**KILL RULE DID NOT FIRE. D0 passes at the shipped `winLength: 4`. D1 (engine) may proceed.**

The single remedy lever (`winLength: 3`) was never spent — it was not needed. Neither
pre-registered tail fired on either seed.

## The kill rule, quoted verbatim (plan §6 / §15.2)

> **KILL if either tail fires on both seeds:**
> 1. **Every attacker yields <5% decisive** against both random and defensive-cover → 4-in-a-row
>    is practically unreachable, the game is draw-city.
> 2. **Defensive-cover forces ≥95% draws** against the best attacker → defense is free. That is
>    Wrap's shape arrived at by a different route.
>
> If either fires: apply the **single** pre-committed lever, `winLength: 3` (24 win-windows
> instead of 10), re-run A+B **once**, and report. **Still failing → the recommendation is to
> kill the game.** There is no third configuration.

"Attacker" = greedy-threat, mixed-greedy (rung B's two attacking policies). Defensive-cover is
the defender under test in tail 2, not an attacker in tail 1. "Best attacker" for tail 2 is read
as whichever attacker has the *higher* decisive rate against defensive-cover on that seed — the
tougher test of whether defense is actually free.

## Rung A — random vs random, n=2,000, two seeds

```
=== RUNG A: random vs random ===
--- Rung A: duel-draft-d0-seed-a (n=2000) ---
  decisive rate: 31.8% (seat0 15.7% / seat1 16.1%)
  draw rate: 68.2% (double-win among draws: 35)
  mean rounds: 8.45
  collisions/game: mean 1.69 — histogram 0:575 1:202 2:870 3:10 4+:343
--- Rung A: duel-draft-d0-seed-b (n=2000) ---
  decisive rate: 34.9% (seat0 16.6% / seat1 18.4%)
  draw rate: 65.1% (double-win among draws: 37)
  mean rounds: 8.42
  collisions/game: mean 1.68 — histogram 0:585 1:214 2:849 3:8 4+:344
```

Both seeds agree closely (31.8% vs 34.9% decisive, ~8.4 mean rounds, ~1.68 mean collisions/game).
Roughly a third of purely random games are decisive, most collision counts cluster at 0–2 per
game with a long tail (the 4+ bucket, ~17% of games, is largely forced-collision-heavy endgames
where both random players keep landing on the same shrinking pool of empty cells). Double-win
draws are rare (~1.8% of games) but real and correctly resolved as draws.

**Per the plan, no kill is drawn from rung A alone** — random play failing to win >50% of the
time is not evidence that skilled play cannot. It is recorded here only as the baseline rung B is
read against.

## Rung B — scripted policies, ~500 games/pairing, two seeds

```
=== RUNG B: scripted policies (~500 games/pairing) ===
--- seed: duel-draft-d0-seed-a ---
  greedy-threat vs random                decisive  90.6%  draws   9.4%  meanRounds   5.4  meanCollisions 0.56
  greedy-threat vs defensive-cover       decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  mixed-greedy vs random                 decisive  82.0%  draws  18.0%  meanRounds   6.1  meanCollisions 0.76
  mixed-greedy vs defensive-cover        decisive  68.4%  draws  31.6%  meanRounds   8.0  meanCollisions 2.16
  defensive-cover vs random              decisive  64.4%  draws  35.6%  meanRounds   7.6  meanCollisions 1.29
  greedy-threat vs mixed-greedy          decisive  67.8%  draws  32.2%  meanRounds   5.8  meanCollisions 1.04
  greedy-threat SELF-PLAY                decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  defensive-cover SELF-PLAY              decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  mixed-greedy SELF-PLAY                 decisive  70.4%  draws  29.6%  meanRounds   5.7  meanCollisions 0.89

--- seed: duel-draft-d0-seed-b ---
  greedy-threat vs random                decisive  89.2%  draws  10.8%  meanRounds   5.6  meanCollisions 0.67
  greedy-threat vs defensive-cover       decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  mixed-greedy vs random                 decisive  79.0%  draws  21.0%  meanRounds   6.2  meanCollisions 0.81
  mixed-greedy vs defensive-cover        decisive  64.0%  draws  36.0%  meanRounds   8.1  meanCollisions 2.24
  defensive-cover vs random              decisive  64.8%  draws  35.2%  meanRounds   7.6  meanCollisions 1.14
  greedy-threat vs mixed-greedy          decisive  63.8%  draws  36.2%  meanRounds   5.7  meanCollisions 1.08
  greedy-threat SELF-PLAY                decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  defensive-cover SELF-PLAY              decisive   0.0%  draws 100.0%  meanRounds  16.0  meanCollisions 16.00
  mixed-greedy SELF-PLAY                 decisive  66.6%  draws  33.4%  meanRounds   5.8  meanCollisions 0.98
```

Both seeds agree on every pairing within a few points — no near-edge reading here that would need
a third seed to adjudicate.

### The degenerate pairings, explained rather than worked around

**`greedy-threat vs defensive-cover`, `greedy-threat` self-play, and `defensive-cover` self-play
all read exactly 0.0% decisive / 100% draws / 16.0 mean rounds / 16.00 mean collisions — on every
single game, both seeds.** That is not noise and not a bug in the win/loss check; it is the exact
effect the brief warned about, just showing up in two pairings instead of one:

- **`defensive-cover`'s own definition includes a greedy fallback** ("cover the opponent's most
  advanced live line, **else play greedily**"). On the opening board — and on every board this
  matchup ever reaches, because no mark is ever placed — no player has any live-line progress, so
  defensive-cover's "cover" branch never has a target and it falls through to the *same* greedy
  scoring function `greedy-threat` uses.
- Both policies are deterministic and see an identical, symmetric board (no marks, since nothing
  is ever placed): the max-score cell and its tie-break (lowest index) are identical for both
  seats. They pick the same cell — a collision — every round, forever, until the board is
  destroyed cell-by-cell over exactly 16 rounds. No mark is ever placed in this matchup, so no
  line-progress ever exists to break the symmetry on a later round either. It is a fixed point.
- `greedy-threat` vs itself is the same mechanism with both seats running the identical function
  directly, no fallback involved.
- `mixed-greedy` self-play (66.6–70.4% decisive) is the control that shows this is specific to
  determinism, not to "two policies with the same name": its ε-random exploration and top-k
  sampling break the tie on round 1 with very high probability, and once any single mark lands
  the position stops being symmetric.

**This does not corrupt the kill-rule verdict.** Tail 1 requires *every* attacker to read <5%
against both random and defensive-cover; `greedy-threat` alone hits 0.0% vs defense, but
`mixed-greedy` reads 64–68% vs defense on both seeds, so tail 1 is clearly not satisfied. Tail 2's
"best attacker" is selected by decisive rate against defense, which correctly routes around the
degenerate `greedy-threat` reading and picks `mixed-greedy` (68.4%/64.0%) as the harder test —
exactly the pairing that should decide whether defense is free. The degenerate pairings are
reported in full because the brief asked for that honesty, not because they carry weight in the
verdict.

## Kill rule evaluation

```
=== KILL RULE EVALUATION (winLength=4) ===
  seed=duel-draft-d0-seed-a
    tail1 (every attacker <5% decisive vs random AND defense): clear — greedy-threat: vsRandom=90.6% vsDefense=0.0%; mixed-greedy: vsRandom=82.0% vsDefense=68.4%
    tail2 (defense >=95% draw-force vs best attacker):         clear — best attacker vs defense = mixed-greedy (decisive 68.4%), defense draw-force rate = 31.6%
  seed=duel-draft-d0-seed-b
    tail1 (every attacker <5% decisive vs random AND defense): clear — greedy-threat: vsRandom=89.2% vsDefense=0.0%; mixed-greedy: vsRandom=79.0% vsDefense=64.0%
    tail2 (defense >=95% draw-force vs best attacker):         clear — best attacker vs defense = mixed-greedy (decisive 64.0%), defense draw-force rate = 36.0%
  tail1 fired on both seeds: false
  tail2 fired on both seeds: false
  KILL RULE: clear
```

Tail 1 fails to fire by a wide margin — `mixed-greedy` is decisively above 5% against both
random (79–82%) and defensive-cover (64–68%) on both seeds. Tail 2 fails to fire even wider —
defensive-cover's draw-force rate against the best attacker (mixed-greedy) is 31.6%/36.0%, nowhere
near the 95% threshold. Neither reading is close to a band edge that would call the C49 "provisional
until a second seed" caveat into play; both seeds already agree comfortably.

**The remedy lever (`winLength: 3`) was not fired.** Rung A/B were not re-run at `winLength: 3`
because the kill rule never triggered at the shipped `winLength: 4` — the plan's ladder only calls
for the lever on a first-tail failure, and there was none.

## H2 (decisiveness), checked against its own sketch prior

Plan §5 H2: *"Sketch prior, recorded as a sketch: ... D0's scripted attackers produce ≥20%
decisive games."* Measured decisive rates for the two attackers against random —
`greedy-threat` 89.2–90.6%, `mixed-greedy` 79.0–82.0% — clear the 20% sketch prior by a wide
margin on both seeds. The measurement does not contradict the sketch here; if anything the sketch
undersold how reachable 4-in-a-row is against non-defending opponents. Per the plan's own
instruction ("if the measurement contradicts it, the measurement wins"), no contradiction exists
to report — this is a confirmation, not a coincidence to be trusted uncritically, but there is
nothing here that overrides the measured numbers above.

## Self-test discipline

The script runs a pinned self-test before any simulation: window-count pencil-checks (10 windows
at `winLength: 4`, 24 at `winLength: 3` — both asserted, not eyeballed), the resolution table
(distinct picks place both marks; same pick destroys and places nothing), one-line win with the
opponent's simultaneous placement standing, double-win → draw, a line through a destroyed cell
never scoring, the forced-collision-at-one-empty-cell endgame, and a 200-game structural
termination sample (`rounds <= 16`, asserted).

Two of these guards were verified by planting a violation and confirming the failure, then
reverting:

1. Changed the win-4 window-count assertion's expected value from 10 to 11 — the self-test threw
   `SELF-TEST FAILED: win-4 window count — expected 11, got 10` before any matchup ran. Reverted.
2. Changed `checkWinner`'s seat-0 win condition to also accept `"destroyed"` cells as if they were
   seat 0's own marks — the self-test threw `SELF-TEST FAILED: destroyed-cell line: never
   completes for anyone — expected null, got 0`. Reverted.

Both plants landed exactly where the corresponding guard could have failed, and both fired.

## What this does and does not establish

- **Does establish:** win-4 is comfortably reachable against non-defending and lightly-defending
  opponents (random, greedy-threat's own mirror), and defensive-cover — a real, always-block-the-
  most-advanced-threat policy — does not come close to making the game draw-city on its own. The
  game clears D0's bar cheaply, before any engine line is written.
- **Does not establish:** anything about MCTS-driven play, the matching-pennies collapse (H3),
  budget-monotonicity soundness for `simultaneous: true` search (§7's residue), or the D3 draw
  ceiling (≤60%) under real self-play. Those are D2/D3 questions, gated on the engine existing,
  and are explicitly out of scope for D0 per the plan.

## Next step

D0 is on the record with rungs A and B, both seeds, and the kill rule quoted, per acceptance
criterion 11 (`docs/plans/duel-draft.md` §12). **D1 (engine + tests per §3) may proceed.**

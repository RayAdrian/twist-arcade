# Tilt T3 budget validation — raw evidence behind C49

*Full narrative and rulings in `docs/plans/platform-corrections.md` C45/C47/C49. This file is
the raw two-seed comparison referenced there, kept in the repo rather than only in `.scratch/`.
Scripts: `scripts/research/tilt-t3-cost-pilot.ts`, `tilt-t3-validation-sweep.ts`,
`tilt-t3-validation-sweep-b.ts`.*

## The finding

Two independent-seed validation sweeps of the identical 5-candidate budget list
(1,500/2,000/3,000/5,000/10,000 rollouts), each n=100 games/candidate, measured
first-player-win-rate at the SAME 10,000-rollout (shipped) configuration as **38.0%** (seed A)
and **50.0%** (seed B) — a 12-point gap on the identical config, implying a per-reading standard
deviation around **8.5 points**, roughly 1.7x the naive 5.0-point binomial SE (games within a
seed set share boards, so they are not independent Bernoulli trials).

**Consequence for every two-player CI gate this project runs, not just Tilt's**: against the
[35,65] first-player-win-rate band (30 points wide, ±15 around 50%, roughly ±1.76 SD at 8.5
points), a genuinely balanced game reads outside the band on a single n=100 run roughly **8% of
the time** — about one gate run in thirteen false-fails a fine game. This was invisible until
the same configuration was measured twice.

Seed A's own sweep looked like a real effect on its own: first-player-win-rate at 1500/2000/
3000/5000/10000 rollouts read 58/52/48/48/38 — strictly monotone decreasing, superficially
consistent with a "deeper search finds P2's tilt-aiming counterplay" mechanism story (plan §4).
That p-value (~1/60–1/120 under naive independence) was computed post-hoc on a pattern already
observed, and the naive SE assumed independence the games don't have. Seed B's read at the same
5 candidates — 52/38/52/36/50 — is neither monotone increasing nor decreasing, and doesn't even
point the same direction as seed A at matching budgets (seed B's cheapest candidate reads
*lower* than seed A's; seed B's baseline reads *higher* than seed A's). The replication is what
correctly distinguished a real effect from an unlucky ordering — the a priori p-value argument
was not a valid test.

`ciGateBudget.twoPlayerCiRollouts: 3000` stands (docs/plans/tilt.md §5.2/§5.3), chosen for
being affordable and mid-range rather than for reproducing a drift that didn't replicate.
Neither Fadeout's nor Nine Grids' budgets are revisited on this basis (C49) — this finding is
about gate *flakiness at n=100*, not about the specific games measured to find it.

---

## Cost pilot (timing only, n=15, never a verdict — C26)

Seed `tilt-t3-cost-pilot`. Independently reproduced C26's own lesson: the FPA gate flips
pass/fail non-monotonically across candidates at this sample size.

```
Tilt T3 cost pilot — seed="tilt-t3-cost-pilot", 15 games/candidate, candidates=[1500, 2000, 3000, 5000, 10000]
TIMING ONLY. No verdict is drawn from this run (C26).

rollouts=  1500  elapsed=21.1s   gates: strong-vs-random=pass first-player-win-rate=fail draw-rate=pass mean-plies=pass ruthless-vs-standard=n/a solved-value-reached=n/a
rollouts=  2000  elapsed=28.2s   gates: strong-vs-random=pass first-player-win-rate=pass draw-rate=pass mean-plies=pass ruthless-vs-standard=n/a solved-value-reached=n/a
rollouts=  3000  elapsed=40.9s   gates: strong-vs-random=pass first-player-win-rate=pass draw-rate=pass mean-plies=pass ruthless-vs-standard=n/a solved-value-reached=n/a
rollouts=  5000  elapsed=61.4s   gates: strong-vs-random=pass first-player-win-rate=fail draw-rate=pass mean-plies=pass ruthless-vs-standard=n/a solved-value-reached=n/a
rollouts= 10000  elapsed=105.6s   gates: strong-vs-random=pass first-player-win-rate=pass draw-rate=pass mean-plies=pass ruthless-vs-standard=n/a solved-value-reached=n/a

Done. Use this to decide which candidates are affordable for the n=100 validation sweep.
```

## Validation sweep — seed A (n=100)

Seed `tilt-t3-validation`. ~28 minutes wall-clock for all 5 candidates (`compareBudgets`
computes every candidate before returning, so no output streams until the full run completes).

```
Tilt T3 validation sweep — seed="tilt-t3-validation", 100 games/candidate, candidates=[1500, 2000, 3000, 5000, 10000]
Criterion: reproduce the 10,000-rollout baseline's VERDICT, not raw-number closeness.

--- rollouts=1500 ---
  first-player-win-rate: pass — 58.0% (band [35%, 65%])
  draw-rate:             pass — 8.0% (max 60.0%)
  mean-plies:            pass — mean 19.1 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=2000 ---
  first-player-win-rate: pass — 52.0% (band [35%, 65%])
  draw-rate:             pass — 12.0% (max 60.0%)
  mean-plies:            pass — mean 19.2 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=3000 ---
  first-player-win-rate: pass — 48.0% (band [35%, 65%])
  draw-rate:             pass — 8.0% (max 60.0%)
  mean-plies:            pass — mean 18.8 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=5000 ---
  first-player-win-rate: pass — 48.0% (band [35%, 65%])
  draw-rate:             pass — 14.0% (max 60.0%)
  mean-plies:            pass — mean 19.4 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=10000 ---
  first-player-win-rate: pass — 38.0% (band [35%, 65%])
  draw-rate:             pass — 18.0% (max 60.0%)
  mean-plies:            pass — mean 20.2 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

=== VALIDATION VERDICTS (vs 10,000-rollout baseline) ===
Baseline (10000): first-player-win-rate=pass, mean-plies=pass, cap-hit=0.00%

rollouts=  1500: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  2000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  3000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  5000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts= 10000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE

Cheapest budget reproducing the baseline verdict: 1500
```

## Validation sweep — seed B, independent replication (n=100)

Seed `tilt-t3-validation-b`. Same candidates, games, and criterion — only the seed differs.
Run specifically to confirm or kill the monotone drift seed A showed.

```
Tilt T3 validation sweep (SEED B, independent replication) — seed="tilt-t3-validation-b", 100 games/candidate, candidates=[1500, 2000, 3000, 5000, 10000]
Purpose: confirm or kill the monotone FPA drift found on the first seed.

--- rollouts=1500 ---
  first-player-win-rate: pass — 52.0% (band [35%, 65%])
  draw-rate:             pass — 2.0% (max 60.0%)
  mean-plies:            pass — mean 17.8 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=2000 ---
  first-player-win-rate: pass — 38.0% (band [35%, 65%])
  draw-rate:             pass — 12.0% (max 60.0%)
  mean-plies:            pass — mean 17.8 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=3000 ---
  first-player-win-rate: pass — 52.0% (band [35%, 65%])
  draw-rate:             pass — 10.0% (max 60.0%)
  mean-plies:            pass — mean 19.5 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=5000 ---
  first-player-win-rate: pass — 36.0% (band [35%, 65%])
  draw-rate:             pass — 16.0% (max 60.0%)
  mean-plies:            pass — mean 19.4 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

--- rollouts=10000 ---
  first-player-win-rate: pass — 50.0% (band [35%, 65%])
  draw-rate:             pass — 6.0% (max 60.0%)
  mean-plies:            pass — mean 19.7 plies, 0 cap hits across all matchups
  cap-hit rate (all matchups): 0.00%

=== VALIDATION VERDICTS (vs 10,000-rollout baseline, SEED B) ===
Baseline (10000): first-player-win-rate=pass, mean-plies=pass, cap-hit=0.00%

rollouts=  1500: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  2000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  3000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts=  5000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE
rollouts= 10000: FPA-verdict-match=true mean-plies-verdict-match=true zero-cap-hits=true => REPRODUCES BASELINE

Cheapest budget reproducing the baseline verdict (seed B): 1500

FPA by rollouts (seed B): 1500=52%  2000=38%  3000=52%  5000=36%  10000=50%
monotone decreasing: false   monotone increasing: false
```

## T4 — gate table at the validated 3,000-rollout budget (n=100)

```
Tilt T4 — gate table at the validated 3000-rollout CI budget
100 games/matchup, shipped 7x7/win-4/period-4/cw/draw config.

CI suite (ci) for "tilt" — OK
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [PASS] first-player-win-rate: 52.0% (band [35%, 65%])
  [PASS] draw-rate: 6.0% (max 60.0%)
  [PASS] mean-plies: mean 18.6 plies, 0 cap hits across all matchups
  [N/A ] ruthless-vs-standard: manifest.ciGateBudget.twoPlayerCiRollouts is active for this CI-suite run — "ruthless" is measured at 3000 rollouts vs "standard"'s shipped 1000 — the override has changed the very quantity under comparison, so this gate cannot measure its claim at suite "ci" (C26). Nightly measures it at the real shipped budgets, where it means something.
  [N/A ] solved-value-reached: no proven manifest.solvedValue — nothing to confirm

ruthless vs random — 100 games
  first-player win rate:   50.0%
  draw rate:               0.0%
  win rate by seat:        [50.0%, 50.0%]
  plies (mean/median/p95): 11.1 / 11 / 16
  mean branching factor:   6.98
  cap-hit rate:            0.00%
  throughput:              2.1 games/sec

ruthless vs ruthless — 100 games
  first-player win rate:   52.0%
  draw rate:               6.0%
  win rate by seat:        [52.0%, 42.0%]
  plies (mean/median/p95): 18.6 / 18 / 24
  mean branching factor:   6.95
  cap-hit rate:            0.00%
  throughput:              0.8 games/sec

[PASS] mirror probe (P2, vs ruthless@3000): 0.0% win rate (gate: <40%) — plan §5.4 predicted this SHOULD fail-to-win (fixed-CW tilt is not reflection-invariant, so mirroring is not value-preserving here)

[PASS] stall probe (P2, vs ruthless@3000): 0.0% win rate, cap-hit rate 0.00% (expect trivial pass — stalling is structurally impossible, plan §5.4)

Overall CI suite: OK
```

# Fadeout CI-budget sweep — raw evidence behind C23

Six configurations, fixed seed `c22-sweep` so every budget played identical games.
Every row: 100% draws, 0% first-player wins, `strong-vs-random` 100%. The bots are
reaching the proven draw value (see `fadeout-solve-report.md`); the gate fails them for it.

```
SWEEP START 01:24:39
--- point baseline (100 games x 10000 rollouts) started 01:24:39 ---
=== baseline: games=100 rollouts=10000 ===
startedAt=2026-08-06T17:24:39.769Z
wall-clock (full 3-matchup suite): 2802.0s
mean-plies (self-play):            45.54
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [FAIL] mean-plies: mean 45.5 plies in band, but cap-hit rate 1.00% > 0 (any cap hit fails)
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END baseline ===
--- point baseline done 02:11:21 ---
--- point r8000 (100 games x 8000 rollouts) started 02:11:21 ---
=== r8000: games=100 rollouts=8000 ===
startedAt=2026-08-06T18:11:22.397Z
wall-clock (full 3-matchup suite): 2274.6s
mean-plies (self-play):            42.88
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [PASS] mean-plies: mean 42.9 plies, 0 cap hits
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END r8000 ===
--- point r8000 done 02:49:17 ---
--- point r5000 (100 games x 5000 rollouts) started 02:49:17 ---
=== r5000: games=100 rollouts=5000 ===
startedAt=2026-08-06T18:49:17.539Z
wall-clock (full 3-matchup suite): 1304.8s
mean-plies (self-play):            40.42
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [PASS] mean-plies: mean 40.4 plies, 0 cap hits
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END r5000 ===
--- point r5000 done 03:11:02 ---
--- point r3000 (100 games x 3000 rollouts) started 03:11:02 ---
=== r3000: games=100 rollouts=3000 ===
startedAt=2026-08-06T19:11:02.716Z
wall-clock (full 3-matchup suite): 847.9s
mean-plies (self-play):            40.94
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [PASS] mean-plies: mean 40.9 plies, 0 cap hits
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END r3000 ===
--- point r3000 done 03:25:10 ---
--- point g50-full (50 games x 10000 rollouts) started 03:25:10 ---
=== g50-full: games=50 rollouts=10000 ===
startedAt=2026-08-06T19:25:11.022Z
wall-clock (full 3-matchup suite): 1624.5s
mean-plies (self-play):            43.96
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [PASS] mean-plies: mean 44.0 plies, 0 cap hits
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END g50-full ===
--- point g50-full done 03:52:15 ---
--- point g25-full (25 games x 10000 rollouts) started 03:52:15 ---
=== g25-full: games=25 rollouts=10000 ===
startedAt=2026-08-06T19:52:16.393Z
wall-clock (full 3-matchup suite): 954.9s
mean-plies (self-play):            46.48
draw-rate (self-play):             100.0%
first-player-win-rate (self-play): 0.0%
cap-hit-rate (self-play):          0.00%
gate table:
  [PASS] strong-vs-random: 100.0% (min 90.0%)
  [FAIL] first-player-win-rate: 0.0% (band [35%, 65%])
  [FAIL] draw-rate: 100.0% (max 60.0%)
  [PASS] mean-plies: mean 46.5 plies, 0 cap hits
  [WARN] ruthless-vs-standard: 0.0% (min 60.0%, ci)
overall ok=false
=== END g25-full ===
--- point g25-full done 04:08:11 ---
SWEEP COMPLETE 04:08:11
```

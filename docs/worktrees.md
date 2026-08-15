# Agent team registry

One row per agent team. Register **before** creating the worktree or starting Supabase.
Claim the next free port block; never reuse a block marked ACTIVE. Mark CLOSED only after
the full teardown checklist in `CLAUDE.md` §6 passes.

Port block for team _n_: Supabase defaults + `n*100` (see `CLAUDE.md` §5).

**Supabase policy for Phase 0/1 (see `docs/research/games/synthesis.md` §2.6):** solo and
hotseat play touch no database. A team whose feature never hits Postgres reserves its port
block and writes its unique `project_id` into `supabase/config.toml`, but does **not** run
`supabase start` — recorded below as `not started`. Supabase becomes load-bearing in
Phase 2 (async link multiplayer). Teardown still applies to whatever was actually started.

| Team / feature | Worktree dir | Branch | Supabase `project_id` | Port block | Supabase | Status |
|---|---|---|---|---|---|---|
| platform (engine/bots/harness + workspace bootstrap) | `../claude-project-platform` | `feature/platform` | `twistarcade_platform` | 54421–54429 | not started (no DB) | ACTIVE |
| shell (Next.js app + component kit) | `../claude-project-shell` | `feature/shell` | `twistarcade_shell` | 54521–54529 | not started (no DB) | PENDING — blocked on platform |
| fadeout (flagship game + exact solve) | `../claude-project-fadeout` | `feature/fadeout` | `twistarcade_fadeout` | 54621–54629 | not started (no DB) | PENDING — blocked on platform |
| daily (Daily Twist, share artifact, streaks) | `../claude-project-daily` | `feature/daily` | `twistarcade_daily` | 54721–54729 | not started (no DB) | ACTIVE |
| harness-solo (M3c/M3d solo suite + certificates) | `../claude-project-solowork` | `feature/harness-solo` | `twistarcade_solowork` | 55021–55029 | not started (no DB) | ACTIVE |
| crackstep (solo daily puzzle) | `../claude-project-crackstep` | `feature/crackstep` | `twistarcade_crackstep` | 54821–54829 | not started (no DB) | PENDING — blocked on platform M1 + M3d |
| minerun (solo score chase) | `../claude-project-minerun` | `feature/minerun` | `twistarcade_minerun` | 54921–54929 | not started (no DB) | PENDING — blocked on platform M1 + M3c |
| phase2schema (A0: schema home + amendments, `docs/plans/phase-2-async-multiplayer.md`) | `../claude-project-phase2schema` | `feature/phase2-schema` | `twistarcade_phase2schema` | 55221–55229 | never started (Docker on this host was loaded with unrelated projects' stacks; skipped deliberately, see report) | **CLOSED** — merged `1c8244e`, worktree removed, branch deleted, ports released |
| ninegrids (engine built + green, deliberately unregistered) | `../claude-project-ninegrids` | `feature/ninegrids` | `twistarcade_ninegrids` | 55121–55129 | not started (no DB) | ACTIVE — 2 commits ahead; awaiting affordable gates (C22) before UI + registration |
| ui-material ("ink on paper" material foundation) | — removed | — deleted | `twistarcade_ui` | — | never started (no DB) | **CLOSED** — fully merged into `main`, 0 unique commits, worktree and branch removed |
| wrap (killed game) | — removed | `feature/wrap` retained | `twistarcade_wrap` | — | never started (no DB) | **CLOSED — GAME KILLED (C20).** Worktree removed; branch and tag `archive/wrap-killed-by-c20` kept: its 5 commits are the measurement evidence that killed it |
| deferstatus (C27: `deferred` gate status + Mine Run CI-tier wiring) | `../claude-project-deferstatus` | `feature/defer-status` | `twistarcade_deferstatus` | 55321–55329 | not started (no DB) — pure harness/gate-table change, no game code touches Postgres | ACTIVE |
| ninegridsui (Nine Grids board UI — real macro/micro board, replacing the deliberate engine-only placeholder) | `../claude-project-ninegridsui` | `feature/ninegrids-ui` | `twistarcade_ninegridsui` | 55421–55429 | not started (no DB) — solo/hotseat UI work, no game code touches Postgres | ACTIVE |
| ordervschaos (Order vs Chaos — OV0 kill-check + OV1 engine, `docs/plans/order-vs-chaos.md`) | `../claude-project-ordervschaos` | `feature/order-vs-chaos` | `twistarcade_ordervschaos` | 55521–55529 | not started (no DB) — engine-only work, gate-before-UI (C16), no game code touches Postgres | ACTIVE |
| chunkbudget (C38: per-game dynamic-import chunk budget, `docs/plans/platform-corrections.md` C38) | `../claude-project-chunkbudget` | `feature/chunk-budget` | `twistarcade_chunkbudget` | 55621–55629 | not started (no DB) — CI/build-tooling work only, no game code touches Postgres | ACTIVE |
| tilt (Tilt — T1 engine + T2 kill-test sweep, `docs/plans/tilt.md`) | `../claude-project-tilt` | `feature/tilt` | `twistarcade_tilt` | 55721–55729 | not started (no DB) — engine-only work, gate-before-UI (C16), no game code touches Postgres | ACTIVE |
| bidtactoe (Bid-Tac-Toe — B1 engine + simultaneous-turn platform spike, `docs/plans/bid-tac-toe.md`) | `../claude-project-bid-tac-toe` | `feature/bid-tac-toe` | `twistarcade_bidtactoe` | 55821–55829 | not started (no DB) — engine-only work, gate-before-UI (C16), no game code touches Postgres | ACTIVE |
| chunkfix (C50: repair `scripts/chunk-budget.ts`'s registry-object-literal probe, broken by Tilt's fourth-game chunk-splitting topology change; `docs/plans/platform-corrections.md` C43/C50) | `../claude-project-chunkfix` | `feature/chunk-budget-fix` | `twistarcade_chunkfix` | 55921–55929 | not started (no DB) — CI/build-tooling work only, no game code touches Postgres | ACTIVE — verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| solvedrelief (C55: wire `solved-value-reached` as the gate on the three decisiveness gates' `n/a` relief from C23, `docs/plans/platform-corrections.md` C55) | `../claude-project-solvedrelief` | `feature/solved-value-relief` | `twistarcade_solvedrelief` | 56021–56029 | not started (no DB) — harness/gate-table work only, no game code touches Postgres | ACTIVE — verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| mctssim (C56: fix `packages/bots/src/mcts.ts` simultaneous-node selection — marginal aggregation instead of joint argmax, `docs/plans/platform-corrections.md` C56) | `../claude-project-mctssim` | `feature/mcts-simultaneous` | `twistarcade_mctssim` | 56121–56129 | not started (no DB) — shared platform/bots code only, no game code touches Postgres | ACTIVE — verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| attainbase (C57: calibrate `solved-value-reached`'s 90% absolute floor — distinguish "regressed from declared baseline" from "never attained," `docs/plans/platform-corrections.md` C57) | `../claude-project-attainbase` | `feature/attainment-baseline` | `twistarcade_attainbase` | 56221–56229 | not started (no DB) — harness/gate-table work only, no game code touches Postgres | ACTIVE — verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| duel-draft (D1: engine + probes file for Duel Draft — no turns, simultaneous picks with collision-destroy, `docs/plans/duel-draft.md`) | `../claude-project-duel-draft` | `feature/duel-draft` | `twistarcade_duelraft` | 56421–56429 (RELEASED) | never started (no DB) — engine-only work, no game code touched Postgres | **CLOSED 2026-08-12** — Duel Draft KILLED at D2 (platform-corrections.md C66: forced draw under competent play; self-play draws 99% at both sanctioned winLength values, scripted yardstick 0.0% at every seed/budget). Worktree removed, branch deleted, no containers ever created. Engine stays on `main` unregistered as the second `simultaneous: true` exerciser; evidence at docs/research/games/duel-draft-d2-report.md. Historical note: the brief's suggested block 56321–56329 was already held by an unrelated project (`stampmate-qa`, confirmed via `docker ps`), so 56421–56429 (team 21) was claimed instead, verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` (all 9 ports silent) |
| mirrorna (C48/C62: route the never-implemented mirror-probe `n/a`-with-reason ruling — a manifest declaration mechanism plus the harness gate that reports it, wired into Duel Draft and (blocked — see status) Bid-Tac-Toe, `docs/plans/platform-corrections.md` C48/C62) | `../claude-project-mirrorna` | `feature/mirror-na` | `twistarcade_mirrorna` | 56521–56529 (RELEASED) | never started (no DB) — harness/gate-table work only, no game code touched Postgres | **CLOSED 2026-08-12** — merged to `main` at 5f17793 after two Fable review passes, all eight findings applied, none waived. Byte-identical gate output re-verified after each commit. Worktree removed, branch deleted, no containers ever created. Historical note: verified free with BOTH `lsof -nP -iTCP:<port> -sTCP:LISTEN` (all 9 ports silent) AND `docker ps` (no container publishes any port in range; C62's own lesson — `lsof` alone missed the 56321 collision) before claiming |


> **2026-08-12 — mass teardown (platform-corrections.md C67).** Fourteen teams were found leaked:
> branches merged, worktrees never removed, port blocks still marked CLAIMED. CLAUDE.md §6 calls
> teardown "not optional and not deferred"; it had been deferred fourteen times. All fourteen are now
> closed, every merged branch deleted, and **every port block below is RELEASED** — no team on this
> host holds a block. No Supabase stack was ever started by any of them, so there were no containers
> or volumes to remove; verified with `docker ps -a`, not assumed.
>
> Teardown now begins with an audit for uncommitted or untracked non-scratch work, never with a
> removal. That audit is what caught `games/bid-tac-toe/` — a complete game plus its solve report —
> existing only as untracked files, rescued to `0ef6c88`. See C67.
>
> Remaining: `main`, and `../claude-project-bid-tac-toe` (rescued work, fate is a pending user
> decision). Stale unmerged branches kept deliberately, never to be merged: `feature/shell` (39,090
> lines behind main), `feature/order-vs-chaos`, `feature/wrap`.

| probes (C64: wire the two-player degeneracy probe suite — mirror, stall, rush — into CI; all three are implemented and roster-resolvable but none is computed for any game, `docs/plans/platform-corrections.md` C64) | `../claude-project-probes` | `feature/degeneracy-probes` | `twistarcade_probes` | 56621–56629 | not started (no DB) — harness/CI wiring only, no game code touches Postgres | ACTIVE — verified free with BOTH `lsof -nP -iTCP:<port> -sTCP:LISTEN` (all silent) AND `docker ps` (no container publishes a 566xx port), per C62 |

| deferrals (C70: make an undischarged gate deferral visible and eventually fatal — Mine Run defers 8/10 gates to a nightly that has never run, `docs/plans/platform-corrections.md` C68/C70) | `../claude-project-deferrals` | `feature/deferral-discharge` | `twistarcade_deferrals` | 56821–56829 | not started (no DB) — harness/gate-table work only | ACTIVE — verified free with `lsof` AND `docker ps` per C62 |
| tsconfig (C72: automate the tsconfig-coverage audit — two packages silently excluded real source from typecheck, `docs/plans/platform-corrections.md` C69/C72) | `../claude-project-tsconfig` | `feature/tsconfig-guard` | `twistarcade_tsconfig` | 56921–56929 | not started (no DB) — build-tooling only | ACTIVE — verified free with `lsof` AND `docker ps` per C62 |

| home1b (design direction 1b "Riso Zine" — the library home rebuilt from the user's Claude Design project, replacing Phase 0's placeholder `app/page.tsx`) | `../claude-project-home1b` | `feature/home-riso-zine` | `twistarcade_home1b` | 57021–57029 (RELEASED) | never started (no DB) | **CLOSED 2026-08-15** — merged at a8b7f9f; the 1b home is live on `main`. Worktree removed, branch deleted, no containers ever created. |
| seedgate (C71: single hardcoded gate seed makes borderline verdicts coin flips — 12.9pp across-seed SD against a 30-point band, `docs/plans/platform-corrections.md` C49/C71) | `../claude-project-seedgate` | `feature/multi-seed-gates` | `twistarcade_seedgate` | 57121–57129 | not started (no DB) — harness/gate-table work only | ACTIVE — verified free with `lsof` AND `docker ps` per C62 |

| classic (C77 ruling 4 / task #23: `GameManifest.classic` becomes `string | null` so two consumers stop pattern-matching an "N/A" sentinel) | `../claude-project-classic` | `feature/classic-nullable` | `twistarcade_classic` | 57621–57629 | not started (no DB) | ACTIVE — verified free with `lsof` AND `docker ps`; 57321 was skipped, held by 4 unrelated containers (C62) |
| mirrorfix (C81 tasks #26/#27: Nine Grids' mirrorMove null convention + harness fallback counting, and rush's draw-relief source under multi-seed) | `../claude-project-mirrorfix` | `feature/mirror-convention` | `twistarcade_mirrorfix` | 57721–57729 | not started (no DB) | ACTIVE — verified free with `lsof` AND `docker ps` |
| depguard (C83 task #28: a guard comparing workspace imports against declared dependencies, including the templated-dynamic case) | `../claude-project-depguard` | `feature/deps-guard` | `twistarcade_depguard` | 57821–57829 | not started (no DB) | ACTIVE — verified free with `lsof` AND `docker ps` |

## Port blocks

| Block | Team | Status |
|---|---|---|
| 54321–54329 (default) | — | RESERVED — do not use for teams |
| 54421–54429 (team 1) | platform | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 54521–54529 (team 2) | shell | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 54621–54629 (team 3) | fadeout | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 54721–54729 (team 4) | daily | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 54821–54829 (team 5) | crackstep | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 54921–54929 (team 6) | minerun | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 55021–55029 (team 7) | harness-solo | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 55121–55129 (team 8) | ninegrids | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 55221–55229 (team 9) | phase2schema | **RELEASED** — team closed 2026-08-07 |
| 55321–55329 (team 10) | deferstatus | RELEASED 2026-08-12 (C67) — team closed, worktree removed, branch deleted; no Supabase stack was ever started |
| 55421–55429 (team 11) | ninegridsui | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 55521–55529 (team 12) | ordervschaos | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 55621–55629 (team 13) | chunkbudget | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 55721–55729 (team 14) | tilt | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 55821–55829 (team 15) | bidtactoe | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 55921–55929 (team 16) | chunkfix | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 56021–56029 (team 17) | solvedrelief | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 56121–56129 (team 18) | mctssim | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 56221–56229 (team 19) | attainbase | RELEASED 2026-08-12 (C67) — was: verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before claiming (all 9 ports silent) |
| 56321–56329 (team 20) | — | **NOT AVAILABLE** — externally occupied by an unrelated project's Docker containers (`supabase_kong_stampmate-qa`, `supabase_db_stampmate-qa`), confirmed via `docker ps` on 2026-08-08. Never claimed by a team here; skip when allocating the next block. |
| 56421–56429 (team 21) | — | **FREE** — released 2026-08-12 when duel-draft closed (game killed, C66). Never bound: the team ran no Supabase stack. |
| 56521–56529 (team 22) | — | **FREE** — released 2026-08-12 when mirrorna closed (merged at 5f17793). Never bound: the team ran no Supabase stack. Historical note: claimed after verifying with `lsof` AND `docker ps` (63 unrelated containers running on this host; none publish a port in this range) before claiming, per C62's "lsof alone is not sufficient" finding |

**Host note (2026-08-02):** Docker on this machine already runs Supabase stacks for
unrelated projects (`mento-h0`, `prequal-and405`, `prequal-and473-450`). All four blocks
above were verified free with `lsof` before claiming. Never stop another project's
containers to free a port — claim a different block.

**Registry reconciliation (2026-08-07).** This table had drifted from reality: three
worktrees existed on disk with no row here — `wrap`, `ui-material`, and `ninegrids` (which
held a claimed port block but no team). CLAUDE.md §4 makes this file the orchestrator's to
own, so the drift was mine. Reconciled against `git worktree list`, and the check that found
it is worth repeating whenever a team closes: **the registry is not the source of truth about
what is running — the filesystem is.** A row that says CLOSED next to a directory that still
exists is exactly the leak §6 exists to prevent.
| 56621–56629 (team 23) | probes | CLAIMED 2026-08-12 — verified free with `lsof` AND `docker ps` before claiming (C62's lesson) |
| 56821–56829 (team 24) | deferrals | CLAIMED 2026-08-15 — verified free with `lsof` AND `docker ps` |
| 56921–56929 (team 25) | tsconfig | CLAIMED 2026-08-15 — verified free with `lsof` AND `docker ps` |
| 57021–57029 (team 26) | — | **FREE** — released 2026-08-15 when home1b merged at a8b7f9f. Never bound: no Supabase stack. |
| 57121–57129 (team 27) | seedgate | CLAIMED 2026-08-15 — verified free with `lsof` AND `docker ps` |
| 57321–57329 | — | **NOT AVAILABLE** — externally occupied by 4 unrelated Docker containers, confirmed via `docker ps` 2026-08-16. Skip when allocating. |
| 57621–57629 (team 28) | classic | CLAIMED 2026-08-16 — `lsof` AND `docker ps` |
| 57721–57729 (team 29) | mirrorfix | CLAIMED 2026-08-16 — `lsof` AND `docker ps` |
| 57821–57829 (team 30) | depguard | CLAIMED 2026-08-16 — `lsof` AND `docker ps` |

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

## Port blocks

| Block | Team | Status |
|---|---|---|
| 54321–54329 (default) | — | RESERVED — do not use for teams |
| 54421–54429 (team 1) | platform | CLAIMED |
| 54521–54529 (team 2) | shell | CLAIMED |
| 54621–54629 (team 3) | fadeout | CLAIMED |
| 54721–54729 (team 4) | daily | CLAIMED |
| 54821–54829 (team 5) | crackstep | CLAIMED |
| 54921–54929 (team 6) | minerun | CLAIMED |
| 55021–55029 (team 7) | harness-solo | CLAIMED |
| 55121–55129 (team 8) | ninegrids | CLAIMED |
| 55221–55229 (team 9) | phase2schema | **RELEASED** — team closed 2026-08-07 |
| 55321–55329 (team 10) | deferstatus | CLAIMED |

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

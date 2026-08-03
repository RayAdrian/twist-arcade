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
| 55121–55129 (team 8) | — | free |

**Host note (2026-08-02):** Docker on this machine already runs Supabase stacks for
unrelated projects (`mento-h0`, `prequal-and405`, `prequal-and473-450`). All four blocks
above were verified free with `lsof` before claiming. Never stop another project's
containers to free a port — claim a different block.

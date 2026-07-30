# Agent team registry

One row per agent team. Register **before** creating the worktree or starting Supabase.
Claim the next free port block; never reuse a block marked ACTIVE. Mark CLOSED only after
the full teardown checklist in `CLAUDE.md` §6 passes.

Port block for team _n_: Supabase defaults + `n*100` (see `CLAUDE.md` §5).

| Team / feature | Worktree dir | Branch | Supabase `project_id` | Port block | Status |
|---|---|---|---|---|---|
| _(example)_ billing | `../claude-project-billing` | `feature/billing` | `claudeproj_billing` | 54401–54429 | CLOSED |

## Port blocks

| Block | Team | Status |
|---|---|---|
| 54321–54329 (default) | — | RESERVED — do not use for teams |
| 54421–54429 (team 1) | — | free |
| 54521–54529 (team 2) | — | free |
| 54621–54629 (team 3) | — | free |
| 54721–54729 (team 4) | — | free |

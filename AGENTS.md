# AGENTS.md

**The development workflow bible for this repo is [`CLAUDE.md`](./CLAUDE.md). Read it before
doing anything. It is authoritative; this file is a pointer plus a summary.**

## Summary

**Model roles**
- **Opus (main agent)** — orchestrator. Sequences work, delegates, integrates, owns
  worktree and Supabase lifecycle. Does not write feature code.
- **Fable** — plans, generates test cases, reviews code. Does not write implementation code.
- **Sonnet** — writes code and executes tests. Does not author its own feature test cases.

**The feature loop (always, no exceptions)**

`Fable plans → Sonnet develops → Fable generates test cases (happy path + edge cases) →
Sonnet executes tests (Playwright MCP or Claude in Chrome) → Sonnet fixes bugs →
Fable code review → repeat until green.`

**TDD** — red, green, refactor. No production code without a failing test. Every bug fix
starts with a reproducing test. Never edit or skip a test to reach green.

**Parallelism** — one feature = one agent team = one git worktree = one branch = one local
Supabase stack with a unique `project_id` and its own port block (see CLAUDE.md §5). Teams
never touch each other's worktrees or containers.

**Teardown** — on merge to `main`: `supabase stop --no-backup`, remove the worktree, delete
the branch, release the port block in `docs/worktrees.md`.

See `CLAUDE.md` for port tables, exact commands, stage-by-stage detail, and the teardown
checklist.

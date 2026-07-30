# CLAUDE.md — Development Workflow Bible

This file is authoritative. Every agent working in this repo follows it. When a request
conflicts with this document, say so before proceeding.

---

## 1. Model roles

| Model | Role | Owns |
|---|---|---|
| **Opus** (main agent) | **Orchestrator** | Sequencing, delegation, integration, merge decisions, worktree/Supabase lifecycle. Does not write feature code. |
| **Fable** | **Planner / Reviewer / Test designer** | Implementation plans, test case generation, code review. |
| **Sonnet** | **Implementer / Test executor** | Writing code, running tests (Playwright MCP or Claude in Chrome), fixing bugs. |

Hard rules:

- The orchestrator **never writes feature code itself**. It delegates. Trivial mechanical
  edits (a typo, a rename the orchestrator already verified) are the only exception.
- Fable **never writes implementation code**. It produces plans, test cases, and review findings.
- Sonnet **never writes its own test cases** for a feature it just built. Test cases come
  from Fable so the author of the code is not the author of its acceptance criteria.

Delegation is via the `Agent` tool with an explicit `model` override:

```
Agent(subagent_type: "<specialist>", model: "fable",  prompt: "...")   # plan / tests / review
Agent(subagent_type: "<specialist>", model: "sonnet", prompt: "...")   # build / run tests / fix
```

Pick the `subagent_type` that matches the domain (`backend-engineer`, `frontend-engineer`,
`qa-test-case-designer`, `code-reviewer`, `infra-devops-sre`, …). The `model` override
above wins over whatever the agent definition declares.

---

## 2. The feature loop

**This is the flow, always.** No feature ships without completing every stage.

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  ▼                                                                     │
1. PLAN            Fable    → implementation plan                       │
2. DEVELOP         Sonnet   → code, TDD (see §3)                        │
3. TEST DESIGN     Fable    → test cases: happy path AND edge cases     │
4. TEST EXECUTION  Sonnet   → run via Playwright MCP / Claude in Chrome  │
5. FIX             Sonnet   → fix every bug found in 4                  │
6. CODE REVIEW     Fable    → review findings                           │
  │                                                                     │
  └──── not green? ──────────────────────────────────────────────────────┘
                                    │
                                 green → ready to merge
```

**Green** means all of:
- Every test case from stage 3 passes in stage 4.
- Zero unresolved findings from stage 6 (each finding is fixed, or explicitly waived by
  the user — never waived by an agent).
- Typecheck, lint, and the automated test suite pass.

Loop iterations repeat stages 4–6. If stage 6 surfaces a design problem (not a bug), go
back to stage 1 — do not patch around a bad plan.

### Stage detail

**1. Plan (Fable).** Output is a written plan: files to touch, data model changes, API
surface, sequencing, risks, and what "done" looks like. The orchestrator reviews the plan
before any code is written. Plans are saved under `docs/plans/<feature>.md`.

**2. Develop (Sonnet).** Follows the plan and TDD (§3). Reports what it built and any
deviation from the plan, with reasons.

**3. Test design (Fable).** Derived from the plan's acceptance criteria, **not** from the
implementation. Must cover:
- happy path
- boundary conditions (empty, zero, one, max, off-by-one)
- invalid / malformed input
- auth and permission failures (wrong user, wrong tenant, logged out)
- concurrency and duplicate submission where relevant
- network and dependency failure (timeout, 500 from an upstream service)
- state after failure (no partial writes, no orphaned rows)

Output is a structured test plan: preconditions → steps → expected result, saved under
`docs/tests/<feature>.md`. A test plan that is only the happy path is rejected.

**4. Test execution (Sonnet).** Runs the test plan against the team's own local Supabase
instance (§5) using Playwright MCP or Claude in Chrome. Records actual vs. expected for
every case. Never marks a case passed without observing it.

**5. Fix (Sonnet).** Fixes bugs. Each fix gets a regression test first (§3).

**6. Review (Fable).** Reviews the diff for correctness, edge cases, security,
tenant/permission scoping, error handling, convention adherence, and test coverage.
Reports findings ranked by severity. "Looks good" with no evidence of having read the
diff is not a review.

---

## 3. TDD

Development is test-driven. Red → green → refactor.

1. **Red** — write a failing test that captures the next slice of behavior. Run it. See it
   fail for the reason you expect. A test that passes before the code exists is a broken
   test.
2. **Green** — write the minimum code to pass it.
3. **Refactor** — clean up with the test still green.

Rules:
- No production code without a failing test that demands it.
- Every bug fix starts with a test that reproduces the bug.
- Never change a test to make it pass. If a test is wrong, say why and fix it deliberately.
- Never delete or skip a failing test to get to green. Report it.

TDD at the unit/integration level (stage 2) is separate from the Fable-authored test plan
(stage 3). Both are required: TDD drives the code, the test plan validates the feature.

---

## 4. Worktrees — parallel agent teams

Each agent team works in its **own git worktree** so teams run in parallel without
stepping on each other.

An **agent team** = one feature = one worktree = one branch = one local Supabase stack.

### Create

```bash
# from the repo root
git worktree add ../claude-project-<feature> -b feature/<feature>
```

Convention:

| Item | Pattern | Example |
|---|---|---|
| Worktree dir | `../claude-project-<feature>` | `../claude-project-billing` |
| Branch | `feature/<feature>` | `feature/billing` |
| Supabase project id | `claudeproj_<feature>` | `claudeproj_billing` |
| Port block | see §5 | `54401–54429` |

### Rules

- An agent team **only** touches files inside its own worktree. Never edit another
  worktree's files, never `git checkout` a sibling branch inside your worktree.
- Every team is registered in `docs/worktrees.md` (feature, dir, branch, port block, owner
  agent, status) at creation. The orchestrator owns this file.
- Shared changes (schema conventions, shared libs, this file) go through the orchestrator,
  not sideways between teams.
- Rebase on `main` before the final review pass so review sees the code as it will merge.

---

## 5. Local Supabase per team (no port collisions)

Every team runs its **own** local Supabase stack. Two things must be unique per team:
the **`project_id`** (it prefixes every Docker container name) and the **port block**.

### Port allocation

Base is Supabase's default block. Team _n_ (1-indexed) gets `base + n*100`.

| Service | `config.toml` key | Default | Team 1 | Team 2 | Team 3 |
|---|---|---|---|---|---|
| API | `[api] port` | 54321 | 54421 | 54521 | 54621 |
| DB | `[db] port` | 54322 | 54422 | 54522 | 54622 |
| Shadow DB | `[db] shadow_port` | 54320 | 54420 | 54520 | 54620 |
| Pooler | `[db.pooler] port` | 54329 | 54429 | 54529 | 54629 |
| Studio | `[studio] port` | 54323 | 54423 | 54523 | 54623 |
| Inbucket | `[inbucket] port` | 54324 | 54424 | 54524 | 54624 |
| Analytics | `[analytics] port` | 54327 | 54427 | 54527 | 54627 |

Claim the next free block in `docs/worktrees.md` **before** starting the stack. Never
reuse a block that is listed as active.

### Start

In the worktree, edit `supabase/config.toml`:

```toml
project_id = "claudeproj_<feature>"   # MUST be unique — prefixes container names

[api]
port = 544xx
[db]
port = 544xx
shadow_port = 544xx
[db.pooler]
port = 544xx
[studio]
port = 544xx
[inbucket]
port = 544xx
[analytics]
port = 544xx
```

Then:

```bash
supabase start                 # from inside the worktree
supabase status                # confirm URLs/keys
```

Point the app at the team's stack via the worktree's `.env.local`
(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:544xx`, plus the anon/service keys from
`supabase status`). `.env.local` is git-ignored and never shared between worktrees.

### Verify isolation

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep supabase
lsof -nP -iTCP:544xx -sTCP:LISTEN     # must be empty before `supabase start`
```

If a port is taken, claim a different block — do not kill another team's containers.

---

## 6. Merge and teardown

On merge to `main`, tear down the team's environment. Nothing is left running.

```bash
# 1. from inside the worktree — stop the stack and drop its volumes
supabase stop --no-backup

# 2. confirm the containers are gone
docker ps -a --format '{{.Names}}' | grep 'claudeproj_<feature>'   # expect no output

# 3. merge, then remove the worktree
git -C <repo-root> merge --no-ff feature/<feature>
git -C <repo-root> worktree remove ../claude-project-<feature>
git -C <repo-root> branch -d feature/<feature>

# 4. release the port block
#    mark the team CLOSED in docs/worktrees.md
```

Teardown checklist — all four must be true before the team is closed:
- [ ] Supabase containers and volumes for `claudeproj_<feature>` removed
- [ ] Port block released in `docs/worktrees.md`
- [ ] Worktree directory removed (`git worktree list` no longer shows it)
- [ ] Feature branch deleted

The orchestrator runs teardown. It is not optional and not deferred — a leaked stack is
what causes the next team's port collision.

---

## 7. Orchestrator checklist per feature

1. Claim a port block and register the team in `docs/worktrees.md`.
2. Create the worktree and branch.
3. Configure `supabase/config.toml` (unique `project_id` + port block), `supabase start`.
4. Fable → plan. Review it.
5. Sonnet → develop (TDD).
6. Fable → test cases (happy path + edge cases).
7. Sonnet → execute test plan (Playwright MCP / Claude in Chrome).
8. Sonnet → fix bugs, each with a regression test.
9. Fable → code review.
10. Not green? Back to 7 (or to 4 if the plan itself is wrong).
11. Green → rebase on `main`, merge.
12. Teardown: `supabase stop --no-backup`, remove worktree, delete branch, release ports.

---

## 8. Reporting

- Report what actually happened. If tests fail, show the output. If a stage was skipped,
  say which and why.
- Do not report "green" unless §2's definition of green is met and observed.
- Subagent claims are not evidence. Spot-check before accepting "all tests pass."

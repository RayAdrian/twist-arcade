# Twist Arcade — build progress

*Orchestrator-maintained. Last updated 2026-08-03.*

Repo: `github.com/RayAdrian/twist-arcade` · Roadmap: `docs/roadmap.md` ·
Research: `docs/research/games/` · Corrections: `docs/plans/platform-corrections.md`

---

## Where things stand

**Planning: complete.** Six plans written by Fable, reviewed, and merged to `main` —
platform spine, app shell, Fadeout, daily/share, Crackstep, Mine Run. Five research
passes precede them.

**Phase 0 milestones:**

| Milestone | State |
|---|---|
| M0 workspace bootstrap | ✅ merged (`270c2d5`) |
| M1 engine contract | ✅ merged (`270c2d5`) — 103 tests, two review rounds |
| M2 bots | 🔄 in progress on `feature/platform` |
| M3a/M3b two-player harness | ⬜ not started |
| M3c/M3d solo harness + certificates | ⬜ not started |
| M4 CI gates | ⬜ not started |
| M5 `new-game` scaffold | ⬜ not started |

**Game engines (ahead of their milestones, since the contract is merged):**

| Game | State |
|---|---|
| Fadeout | ✅ F1 engine done — 204 tests, all 8 ruleset variants pass the contract. Review + test design pending. Exact solve (F2) needs M3a. |
| Mine Run | 🔄 engine core + CSP module committed; probes and view-honesty test in progress |
| Crackstep | ⬜ planned, not started |
| Shell | 🔄 S0 committed (tokens, pure modules, BoardShell/Cell); `useGame` + routes pending |

---

## Branch state

All feature branches are ahead of `main` and unmerged. Nothing below is on `main`.

| Branch | Commits ahead | Note |
|---|---|---|
| `feature/platform` | 5 | **Last commit is deliberately red**: `rush.test.ts` exists, `src/probes/rush.ts` does not. This is the TDD red phase, committed to protect it from loss — not a broken build to debug. 161 tests pass. |
| `feature/shell` | 2 | S0 plus WIP on `HowSheet`/`BoardShell`; `CalloutLayer` was next |
| `feature/minerun` | 3 | engine + CSP committed; probes/view-honesty WIP |
| `feature/fadeout` | 3 | F1 engine complete and green |

---

## Open decisions owed by the orchestrator

Both raised by the Fadeout implementer; both are genuine gaps in the plan rather than
implementation preferences, so they need a ruling rather than inheriting a default:

1. **Displacement effect ordering.** Axis A defines the order of the mover's own placement
   versus their own overflow-removal, but is silent on where a `playThrough` displacement
   of the *opponent's* doomed mark sits. The implementer chose "displacement first" (you
   must vacate a cell before occupying it). Needs confirmation before F2's solve depends
   on it.
2. **`longestLife` semantics.** Documented as "own placements survived", but plan §8's
   example share artifact says "longest-lived X: 5 turns" — impossible under cap-3 FIFO,
   where the answer is structurally always 3 or 2. The doc comment and the example measure
   different things, and the share artifact depends on which one is meant.

---

## Standing corrections (see `docs/plans/platform-corrections.md`)

- **C1** — hidden-info policies must receive the redacted view, not canonical state.
  Critical, and it fails *silently*: an omniscient bot posts a passing skill score on a
  game that is unplayable blind.
- **C2** — solo CI gates keyed on `manifest.solo.format`, not player count.
- **C3** — `harness solve` is not generic; path-dependent legality means `encode` is not a
  position key.
- **C4** — `decode` throws on malformed input, never returns a partial state.

Plus the M2 entry checklist: G-2 and G-9 before the first game contract gate (G-2 and G-4
and G-14 are already closed in `7ddea79`).

---

## User-owned items (needed ~week 3)

Domain purchase · Vercel account · Supabase account · Umami Cloud account (analytics;
share rate is metric #1). Plus the five-person hotseat playtest that closes Phase 0.

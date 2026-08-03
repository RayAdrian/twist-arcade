# Twist Arcade — build progress

*Orchestrator-maintained. Last updated 2026-08-03.*

Repo: `github.com/RayAdrian/twist-arcade` · Roadmap: `docs/roadmap.md` ·
Research: `docs/research/games/` · Corrections: `docs/plans/platform-corrections.md`

`main` is green: **911 tests**, typecheck, lint, engine-purity, and a real `next build`.

---

## Phase 0 — the platform spine

| Milestone | State |
|---|---|
| M0 workspace bootstrap | ✅ merged |
| M1 engine contract | ✅ merged — the seam five teams build against |
| M2 bots | ✅ merged — generic search, tiers, worker host |
| M3a/M3b two-player harness | ✅ merged — exact solver + CI gate table |
| M3c/M3d solo harness + certificates | ✅ merged |
| M4 CI gates | 🔄 in progress |
| M5 `new-game` scaffold | 🔄 in progress |

## Games

| Game | State |
|---|---|
| Fadeout (flagship) | engine ✅ merged — 8 configs / **6 distinct games**. **F2 exact solve running** — it picks the shipping ruleset, decides the pie rule, and decides whether 4×4 launches. UI is blocked on it by design. |
| Mine Run | engine ✅ merged — the platform's hidden-information template. UI not started. |
| Crackstep | planned, not started |
| Nine Grids, Wrap, Order vs Chaos, Tilt, Bid-Tac-Toe | planned, not started |

**Nothing is playable yet.** `games/registry.ts` is empty — both merged engines exist but
neither is registered, because neither has a Board. Fadeout's is gated on F2; Mine Run's is
gated on the shell seam that landed with the shell merge. This is also why the Playwright
suite currently exercises only `/` and the 404 path.

## Phase 1

| | State |
|---|---|
| App shell (GameShell, `useGame`, routes) | ✅ merged |
| Daily Twist, share artifact, streaks, metrics | built — **in review**; C8 consolidation pending |

## Infrastructure

- **Remote Supabase** (`fjiwrzaosluymamannaw`) — Phase 2 schema applied with **RLS enabled
  and zero policies**, which denies everything. Verified against a real row carrying a
  canary seed, not against an empty table. Phase 2 opens exactly what it needs.
- **Local Supabase** — unchanged; per-worktree stacks per `CLAUDE.md` §5, never pointed at
  the remote. Every team is still `not started` because nothing yet touches Postgres.

---

## The recurring defect, and why the reviews attack rather than read

Every serious bug this build has produced was **a guard that doesn't guard**, and every one
of them passed a green build:

| | |
|---|---|
| M1 | Golden vectors would have been tautological if computed from the implementation |
| M1 | The `setup` rng stream was byte-identical to step 0's — a hidden secret derivable from the first public chance event, in a format that freezes at merge |
| M2 | `probeViewHonesty` passed an omniscient cheater; it called the policy with an identical view each iteration, so it could only detect nondeterminism |
| M2 | `soften` measured **0% effect** at default settings; its tests passed only because they were tuned to temperature 60 and 200 |
| Mine Run | The secret token was engineered to be unguessable — which meant it could never match a real leak either |
| Mine Run | A `decode` check transcribed one arm of a disjunction: a counterexample illustrates a class, it is not the class |
| Shell | Two lint boundaries were silently dead — a later flat-config block re-keyed `no-restricted-imports` and replaced them |
| Shell | The self-test written to catch that was blind to three of four planted mutations |
| M3b | The runner handed canonical state to policies for hidden-info games — in the exact seam correction C1's closing line had named |
| M3b | The "independent oracle" validating the solver passed under two distinct solver mutants: classic-ttt is all draws, so it cannot see the same-mover branch or the LOSS countdown |
| M3c | The shipped `Strong` was too weak to be a yardstick — every solo gate is defined relative to it |
| M3c | `grindProbe` was blind to the farm it exists to catch, because the plan's own mechanism contradicted itself |
| M3d | `verifyCertificate` never compared `par` to `moveLog.length`; a certificate tampered to `par: 999` verified clean |
| M3d | IDA\* tested the goal before the cutoff, returning non-optimal paths labelled `optimal: true` — and par *is* that path's length |
| Daily | An immutability guard whose pure predicate was correctly unit-tested, while its CLI ran `git diff` with a cwd-relative pathspec and matched nothing |

**The standing instruction that came out of it:** for every gate you write, plant a
violation and confirm it fires. A gate never observed failing is not a gate. Test the thing
that runs, not only the function it calls. And sweep the *per-game statistic* a number
actually reports, not the pooled distribution of its inputs.

---

## Corrections in force

`docs/plans/platform-corrections.md` — C1 (view-honesty), C2 (format-keyed gates),
C3 (`solve` is not generic), C4 (`decode` throws), C5 (animation boundary),
C6 (a yardstick must be strong enough to measure with), C7 (format literals),
C8 (consolidate streak/share into shell), C9 (grind probe mechanism),
C10 (unverified par), C11 (fog rejection), plus the M2 entry checklist.

## User-owned items (needed ~week 3)

Domain purchase · Vercel account · Umami Cloud account (share rate is metric #1) ·
the five-person hotseat playtest that closes Phase 0. Supabase is done.

One item is deliberately open and labelled as such: the **TalkBack synthesized-click
premise** behind the shell's `Cell` activation fix. Nobody has observed it on a device. The
fix is inert if the premise is wrong, the comment says so, and the playtest resolves it with
a real Android phone in hand.

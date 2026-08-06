# Twist Arcade — build progress

*Orchestrator-maintained. Last updated 2026-08-04.*

Repo: `github.com/RayAdrian/twist-arcade` · Roadmap: `docs/roadmap.md` ·
Research: `docs/research/games/` · Corrections: `docs/plans/platform-corrections.md`

**`main` is green: 1,321 tests, typecheck, lint, engine purity, production build.**
**Two games are playable: `/play/fadeout` and `/play/crackstep`.**

---

## Phase 0 — complete

| Milestone | |
|---|---|
| M0 workspace · M1 engine contract · M2 bots | ✅ |
| M3a/M3b two-player harness · M3c/M3d solo harness + certificates | ✅ |
| M4 CI gates · M5 `new-game` scaffold | ✅ |
| App shell, `useGame`, component kit | ✅ |
| S2 real bot worker — tiers now affect play | ✅ |

## Phase 1 — in progress

| | |
|---|---|
| Daily Twist, share artifact, streaks, metrics | ✅ merged |
| UI material foundation ("ink on paper", performed) | ✅ merged |
| **Fadeout** — exact solve, frozen ruleset, board | ✅ playable |
| **Crackstep** — 90 certified days, board | ✅ playable |
| **Wrap** — failed at 5×5, redesigned to 6×6 | gate re-run in flight |
| **Mine Run** — engine merged, gates running | board gated behind gates |
| Nine Grids, Order vs Chaos, Tilt, Bid-Tac-Toe | queued |

## Phase 2 — planned, first milestone in flight

`docs/plans/phase-2-async-multiplayer.md` is written and reviewed. Orchestrator rulings are
**C21**: RLS stays at zero policies as the *end-state* (a participant-scoped SELECT would be a
second redaction path in a second language — C1's seam); seat claim moves to first **move**,
not link-open (a claimed-but-vanished guest would dead-lock the match with no account to
unclaim from); the move log is the record of truth with `state` as a cache. One overrule: the
`moves` PK drops `seat`, because "Phase 2 writes only one row per idx" was an intention in
prose while the schema permitted its violation.

**An orchestrator error the build could not have caught:** the schema was applied to the
remote via MCP and **never checked in** — no `supabase/` directory existed, so the shape of
the production database lived only on a hosted server. Every gate stayed green throughout,
because none of them look at a database no code uses yet. Milestone A0 (in flight) checks it
in as migration `0001`, generated from the live database rather than from memory.

---

## The two rules this phase bought, expensively

**Gate before UI** (C16). Wrap received a complete board, presentation, and registration
before anyone measured it. The gates then killed it. Order is now engine → gates → UI.

**A theorem about perfect play is not a prediction about the bots you ship** (C14). Wrap was
predicted to have a high *first*-player advantage on strategy-stealing grounds. It measured a
**76% second-player advantage** — the opposite direction. Strategy-stealing proves P1 cannot
be a guaranteed loser against a *perfect* opponent; it says nothing about two equally
configured but imperfect MCTS agents at a fixed rollout budget, which is how every game here
will actually be played. The shortlist's balance column is now **hypothesis**, including
Bid-Tac-Toe's "none by construction".

---

## The recurring defect — twenty-three instances, all passing green builds

Every serious bug this build produced was **a guard that doesn't guard**:

| | |
|---|---|
| M1 | Golden vectors would have been tautological if computed from the implementation |
| M1 | `setup`'s rng stream was byte-identical to step 0's — a hidden secret derivable from the first public chance event, in a format frozen at merge |
| M2 | `probeViewHonesty` passed an omniscient cheater; it called the policy with an identical view each iteration |
| M2 | `soften` measured **0% effect** at default settings; its tests passed only because they were tuned to temperature 60 and 200 |
| Mine Run | The secret token was engineered to be unguessable — so it could never match a real leak either |
| Mine Run | A `decode` check transcribed one arm of a disjunction: a counterexample illustrates a class, it is not the class |
| Shell | Two lint boundaries silently dead — a later flat-config block re-keyed `no-restricted-imports` and replaced them |
| Shell | The self-test written to catch that was blind to three of four planted mutations |
| M3b | The runner handed canonical state to policies for hidden-info games — in the exact seam C1's closing line had named |
| M3b | The "independent oracle" passed under two distinct solver mutants: classic-ttt is all draws, so it cannot see the same-mover branch or the LOSS countdown |
| M3c | The shipped `Strong` was too weak to be a yardstick — every solo gate is defined relative to it |
| M3c | `grindProbe` was blind to the farm it exists to catch, because the plan's own mechanism contradicted itself |
| M3d | `verifyCertificate` never compared `par` to `moveLog.length`; a certificate tampered to `par: 999` verified clean |
| M3d | IDA\* tested the goal before the cutoff, returning non-optimal paths labelled `optimal: true` — and par *is* that path's length |
| Daily | An immutability guard whose pure predicate was correctly unit-tested, while its CLI ran `git diff` with a cwd-relative pathspec and matched nothing |
| Daily | Three working guards that **no CI step invoked** |
| Daily | `share_done` fired on a *dismissed* share sheet, inflating the product's #1 metric |
| Fadeout F3 | The screen reader was silent at plies 5 and 6 — the onset of each player's first vanish, the moment the game teaches its twist |
| Fadeout F3 | The reduced-motion gate's deletion broke no test |
| Fadeout F3 | Playwright's `reducedMotion` setting never applied, so the assertion checked the wrong state entirely |
| Fadeout F2 | A solve report asserted a value the engine makes structurally impossible, while dead code in the same file encoded the truth |
| UI | Motion One does not self-respect `prefers-reduced-motion`; `loading.tsx`'s skeleton was ungated |
| **Crackstep** | **`/play/crackstep` returned 500 in the live app** while typecheck, lint, and 1,321 tests were green — and both files carried comments asserting it couldn't happen |

**The standing instructions that came out of it:**

- For every gate you write, plant a violation and confirm it fires. A gate never observed failing is not a gate.
- Test the thing that runs, not only the function it calls.
- Sweep the *per-game statistic the artifact prints*, not the pooled distribution of its inputs.
- A comment asserting an invariant is not enforcement. Comments don't run.

---

## Corrections in force

`docs/plans/platform-corrections.md` — C1 view-honesty · C2 format-keyed gates · C3 `solve`
is not generic · C4 `decode` throws · C5 animation boundary · C6 the yardstick must be strong
enough · C7 format literals · C8 consolidate streak/share · C9 grind mechanism · C10
unverified par · C11 fog rejection · C12 saturated share timeline · C13 no per-game gate
runner · C14 Wrap's inverted failure · C15 scaffold gaps · C16 the Wrap diagnosis and what the
queue inherits · C17 no per-route smoke test · C18 a share invariant false at scale.

## Open, highest value first

1. **C17 — per-route smoke test.** A shipped route was 500ing with every gate green. A loop
   over the registry asserting 200 + a rendered board. The Playwright harness already exists.
2. **C13 — a `--game` filter for the CI gates.** Without it every team improvises a script,
   and improvised gates get tuned.
3. **Bid-Tac-Toe's balance claim**, rated "none by construction" — the exact shape of
   confidence that just failed.

## User-owned (needed ~week 3)

Domain · Vercel · Umami Cloud (share rate is metric #1) · the five-person hotseat playtest.
Supabase is done. One item stays deliberately open and labelled: the **TalkBack
synthesized-click premise** behind the shell's `Cell` activation fix — nobody has observed it
on a device, the fix is inert if the premise is wrong, and the playtest resolves it.

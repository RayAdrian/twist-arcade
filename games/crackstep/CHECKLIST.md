# `crackstep` (solo daily puzzle) — build checklist

Stamped by `pnpm new-game crackstep --solo puzzle`. Work through this in order — it doubles
as the CLAUDE.md §2 loop's stage-2 (Develop) TDD anchor list for this game.

## Traps every new engine hits (read before you touch `engine.ts`)

1. **`Move` needs an explicit index signature.** A `Move` type used as the engine's `M`
   generic must satisfy `Json`, and TypeScript will **not** synthesize a `[key: string]: Json`
   index signature for a plain `interface`/type-literal — you must write it yourself (see
   `CrackstepMove` in `engine.ts`).
2. **`encode` must exclude `lastEffects`.** Two states identical except for effects must hash
   identically — solvers hash on `encode(S)`. If effects leak into the canonical encoding,
   positions equal in every way the rules care about hash differently, silently.
3. **If legality depends on the PATH taken, not the position reached, `encode` is NOT a valid
   position key** (platform-corrections.md C3). Crackstep's own mechanic (positions can never
   repeat) is the case where `encode` IS a sound key and `dfsSolver` (see `solver.ts`) works
   directly — a superko-style rule is the other pattern; check which one your real mechanic is
   before wiring `solver.ts`.
4. **`decode` must throw on malformed input, never return a partial state**
   (platform-corrections.md C4). `decode` feeds `replay()` AND `verifyCertificate` — the
   platform's trust boundary for whether a shipped daily is genuine. A lenient decode here
   means a forged certificate could validate, with no exception and no red test.

## Daily-puzzle-specific

- **No `score()`, no `safeMove` hook.** A puzzle has no score distribution and no risk
  decision — the harness's puzzle gate table (`solo-gates.ts`) reports every score-chase-only
  row as explicitly N/A for you (never a format exclusion accident).
- **Structural termination is mandatory** — a finite board with no cycle back to an earlier
  reachable position, not a move cap.
- **Fog games must be deduction-only** (platform-corrections.md C11): if
  `meta.hiddenInformation: true`, `certifyDay` REJECTS any candidate day whose solve requires
  a guess (`guessFree: false`) rather than shipping it.
- **`solver.ts`'s `dfsSolver` needs `encode` to be a sound position key** (see trap 3) — if it
  isn't, do not use it as-is.

## Build order

- [x] `engine.ts` — real win/lose rules implemented; `engineContract` green incl. the solo
      branch, termination-bound test, position-key property test.
- [x] `engineContract` green — the solo branch (puzzle terminals: `won`/`lost` only — never
      `scored`/`draw`, never a non-zero winner) is auto-checked because `maxPlayers === 1`.
- [x] `solver.ts` — `idaStarSolver(heuristic)` (trap 3: `encode` is a sound position key here,
      confirmed by `engine-fixtures.test.ts`'s position-key property test) + the two prunes.
      Imports the harness's browser-safe `"@twist-arcade/harness/solver"` subpath, NOT the
      package root — see solver.ts's own header comment (the root barrel statically imports
      certify.ts's `node:fs/promises`, which 500'd `next dev`'s `/play/crackstep` outright
      until this was narrowed).
- [x] `manifest.ts` — filled in and asserted (`manifest.test.ts`, 90-char rule sentence).
- [x] 90 certified days on disk (`data/certificates/crackstep/`, via
      `games/crackstep/solver/certify-day.ts` + `scripts/certify-crackstep.ts` — the literal
      `pnpm harness certify crackstep --days 90` in this line's original text does not exist;
      `packages/harness/src/cli.ts` scopes real-game `certify`/`calibrate` commands out of its
      surface — see docs/plans/crackstep.md §14 #2). `scripts/verify-certificates.ts` re-verifies
      all 90+ clean; a planted par-tamper on a real on-disk certificate was caught and reverted.
- [x] Rejection rate reviewed: **69.7% aggregate over the real 90-day buffer** (10k-seed
      calibration independently measures 68.1%, consistent) — WARN zone (>50%), well under the
      90% hard-fail. Flagged to the orchestrator (crackstep.md §14 #1) alongside the related
      "some optimal solves need a stone revisit" finding, both measured triggers for the
      plan's pre-approved constructive-generation fallback (§3.1) — not fixed unilaterally here.
- [x] Solo-ci gate table verified directly against `runGameCiGate` (kind: "solo-puzzle"): every
      applicable row PASS/WARN (never FAIL), every score-chase-only row prints "N/A
      (daily-puzzle)" explicitly, not silently skipped.
- [x] `ui/Board.tsx` — real screenshot taken (`/play/crackstep`, live `next dev`) and converted
      to true grayscale; all five tile states read distinctly (measured: hole mean-L 20, rubble
      67, current 134, wood 144, stone 202 — four value bands, stone additionally
      pattern-distinct via its rivet dots). First-crumble and first-stone-survival callouts
      both fired live with the exact plan text.
- [x] `index.ts`'s `announce()` strings — tested (`index.test.ts`) against the literal §7.4
      templates.
- [x] `shareArtifact()` — tested and CORRECTED: sweeping 150+ real boards found the plan's
      "detours == moves-over-par" claim false on ~40% of certified days (`shareArtifact` has no
      `par` parameter to compare against — game-spec's frozen signature). Fixed to the true,
      locally-provable invariant and recorded as crackstep.md §14 #1.
- [x] `howSheetFrames` — three real frames (present since the scaffold, confirmed here).
- [x] Registered in `games/registry.ts`. `loadSolver` now resolves via the package's own
      `"./solver"` subpath export (`@twist-arcade/crackstep/solver`) rather than the package
      root — the root re-exporting `solver` used to silently drag it into `loadEngine`/
      `loadPresentation`'s own bundle too (fixed; verified at runtime the root module no longer
      exposes `solver` at all).
- [ ] Hand `par` rendering to the shell team (the certificate is now a real artifact they can
      render); open the PR — CLAUDE.md §2's loop (stage 3 onward) takes it from here.

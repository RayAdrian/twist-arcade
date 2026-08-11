# `bid-tac-toe` — build checklist

Stamped by `pnpm new-game bid-tac-toe`. Work through this in order — it doubles as the
CLAUDE.md §2 loop's stage-2 (Develop) TDD anchor list for this game.

## Traps every new engine hits (read before you touch `engine.ts`)

1. **`Move` needs an explicit index signature.** A `Move` type used as the engine's `M`
   generic must satisfy `Json`, and TypeScript will **not** synthesize a `[key: string]: Json`
   index signature for a plain `interface`/type-literal — you must write it yourself (see
   `BidTacToeMove` in `engine.ts` for the pattern every fixture in this repo uses).
2. **`encode` must exclude `lastEffects`.** Two states identical except for effects must hash
   identically — `encode` is what solvers and repetition/superko detection hash on. If effects
   ever leak into the canonical encoding, two positions that are the same in every way the
   rules care about will hash differently, and nothing will fail loudly — it will just be
   silently wrong.
3. **If legality depends on the PATH taken, not the position reached, `encode` is NOT a valid
   position key** (platform-corrections.md C3). Superko-style rules (a position is illegal if
   it repeats a prior position in THIS game) need the history in the state itself, and a
   generic `harness solve` dedup on `encode(S)` would then conflate genuinely different
   states. If this applies to you, do not reach for the generic solver — compose
   `packages/harness/src/solver/reach.ts` / `retrograde.ts` locally instead, over your own
   history-aware position key.
4. **`decode` must throw on malformed input, never return a partial state**
   (platform-corrections.md C4). `decode` feeds `replay()` and any future leaderboard/replay
   verification — the one place the platform decides whether a submitted move log is genuine.
   A `decode` that quietly accepts garbage and returns a plausible-looking state means a forged
   record could validate, with no exception and no red test. The stamped `decode` already
   throws on a shape mismatch; keep that property no matter how much richer your real state
   gets.

## Build order

- [x] `engine.ts` — B1: simultaneous bid/place phases, tie table, decode invariants (C4),
      resolveBid() exported for B2's reuse. 44 B1 tests + 10 B2 solver tests, all green.
- [x] `engineContract` green (`pnpm --filter @twist-arcade/bid-tac-toe test`).
- [x] `heuristic.ts` — a real (untuned, not needed by any shipped MCTS tier) evaluation.
- [x] **B2: exact solve — NOT `pnpm harness solve` (this engine is `simultaneous: true`,
      which `packages/harness/src/solver/types.ts:67` refuses per C3).** Game-local script per
      the Fadeout precedent: `games/bid-tac-toe/solver/` (`backward-induction.ts` +
      independent oracle cross-check + `run-solve.mts`). Result:
      `docs/research/games/bid-tac-toe-solve-report.md` — all four swept budgets {8,12,16,20}
      are PURE, PROVEN, EXACT DRAWS with zero star-holder advantage. Budget freeze:
      recommended B=8 in the report, not yet ruled by the orchestrator.
- [x] `manifest.ts` — `title`, `classic`, `ruleSentence`, `tags`, `estMinutes` filled in (B1).
      `ciGateBudget.twoPlayerCiRollouts` deliberately left unset — B3's job, per its own note.
- [ ] `pnpm harness suite bid-tac-toe --suite ci` green — B3, not yet run.
- [ ] `pnpm harness suite bid-tac-toe --suite design` reviewed (Fable stage-3/6, tighter bands
      — CI proves not-broken, design decides good).
- [ ] Tune the three difficulty tiers in `manifest.ts` against the design-gate's tier-ordering
      expectation (ruthless >= standard >= casual).
- [x] Mirror probe: the board is point-symmetric but bids/the star are not, so neither
      `mirrorMove` nor the `"symmetric"` tag applies (probes.ts's module doc). Declared via
      `manifest.ts`'s `mirrorProbe: { applicable: false, reason: ... }` (platform-corrections.md
      C48, routed at C62 — B1's own flag, "Implement at B3") so the harness reports this as
      `n/a` citing the reason, not a silent skip or a WARN.
- [ ] `ui/Board.tsx` + the grayscale-screenshot test (every state change must read from a
      static, colorless render — motion may only restate it, per C5).
- [ ] `index.ts`'s `announce()` strings — real per-event sentence fragments (ux-lens §9).
- [ ] `shareArtifact()` — <=7 lines, emoji move-timeline body only (the shell owns the frame).
- [ ] `howSheetFrames` — three real frames.
- [ ] **Gates green, THEN register** (platform-corrections.md C15/C28): this game was
      scaffolded UNREGISTERED on purpose — gate-before-UI (C16) means `/play/bid-tac-toe` must
      not be routable until `pnpm harness:ci-gates -- --game bid-tac-toe` passes. Once it does,
      run `pnpm new-game bid-tac-toe --register` (same id — this re-run inserts the
      `games/registry.ts` entry at the `<new-game:insert>` marker without re-stamping your
      files) and delete this line.
- [ ] Open the PR — CLAUDE.md §2's loop (stage 3 onward: Fable test design, Sonnet execution,
      fix, Fable review) takes it from here.

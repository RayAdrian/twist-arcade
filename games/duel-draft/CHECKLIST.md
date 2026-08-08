# `duel-draft` — build checklist

Stamped by `pnpm new-game duel-draft`. Work through this in order — it doubles as the
CLAUDE.md §2 loop's stage-2 (Develop) TDD anchor list for this game.

## Traps every new engine hits (read before you touch `engine.ts`)

1. **`Move` needs an explicit index signature.** A `Move` type used as the engine's `M`
   generic must satisfy `Json`, and TypeScript will **not** synthesize a `[key: string]: Json`
   index signature for a plain `interface`/type-literal — you must write it yourself (see
   `DuelDraftMove` in `engine.ts` for the pattern every fixture in this repo uses).
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

- [ ] `engine.ts` — replace `computeStatus`'s TODO with your real win/draw rules.
      `pnpm --filter @twist-arcade/duel-draft test` should turn the "termination" failure
      green (see `engine.ts`'s own module doc for exactly what should change).
- [ ] `engineContract` green (`pnpm --filter @twist-arcade/duel-draft test`) — every other
      property was already passing; termination is the last one.
- [ ] `heuristic.ts` — a real position evaluation (only needed once you have a `minimax` tier).
- [ ] `pnpm harness solve duel-draft` if your state space is under ~10^7 (see
      platform-corrections.md C3 first if legality is history-dependent).
- [ ] `manifest.ts` — fill in `title`, `classic`, `ruleSentence` (<=90 chars — asserted for
      real in `manifest.test.ts`, not just at module load), `tags`, `estMinutes`.
- [ ] `pnpm harness suite duel-draft --suite ci` green.
- [ ] `pnpm harness suite duel-draft --suite design` reviewed (Fable stage-3/6, tighter bands
      — CI proves not-broken, design decides good).
- [ ] Tune the three difficulty tiers in `manifest.ts` against the design-gate's tier-ordering
      expectation (ruthless >= standard >= casual).
- [ ] If your board is point-symmetric, implement the real `mirrorMove` in `probes.ts` and add
      the `"symmetric"` tag to `manifest.ts` — CI hard-requires the probe for that tag. If it
      is NOT symmetric, delete `probes.ts` and skip this.
- [ ] `ui/Board.tsx` + the grayscale-screenshot test (every state change must read from a
      static, colorless render — motion may only restate it, per C5).
- [ ] `index.ts`'s `announce()` strings — real per-event sentence fragments (ux-lens §9).
- [ ] `shareArtifact()` — <=7 lines, emoji move-timeline body only (the shell owns the frame).
- [ ] `howSheetFrames` — three real frames.
- [ ] **Gates green, THEN register** (platform-corrections.md C15/C28): this game was
      scaffolded UNREGISTERED on purpose — gate-before-UI (C16) means `/play/duel-draft` must
      not be routable until `pnpm harness:ci-gates -- --game duel-draft` passes. Once it does,
      run `pnpm new-game duel-draft --register` (same id — this re-run inserts the
      `games/registry.ts` entry at the `<new-game:insert>` marker without re-stamping your
      files) and delete this line.
- [ ] Open the PR — CLAUDE.md §2's loop (stage 3 onward: Fable test design, Sonnet execution,
      fix, Fable review) takes it from here.

# Phase 0 Plan — Platform Spine

*Fable implementation plan, 2026-08-02 (rev 2 — solo-games-lens deltas folded in as binding;
orchestrator decisions 1–7 of 2026-08-02 incorporated). Team: `platform` (worktree
`../claude-project-platform`, branch `feature/platform`, port block 54421–54429, Supabase not
started — no DB in this phase).*

*Sources: `docs/roadmap.md` (Phase 0 scope incl. the solo-support row, §6 gates incl. the solo
parallel gate), `docs/research/games/architecture-lens.md` (§1–§7 — the engine contract is
adopted essentially verbatim, deviations flagged inline), `docs/research/games/game-theory-lens.md`
(§2–§3), `docs/research/games/solo-games-lens.md` (§3, §4 — **binding**: it landed pre-M1-merge,
so per this plan's reconciliation rule its engine and harness deltas are contract, not ADR
material), `docs/research/games/synthesis.md` (§2.3, §2.4), `docs/research/games/ux-lens.md` (§10).*

*Naming is settled (roadmap §9): the site is **Twist Arcade**, repo `twist-arcade`
(github.com/RayAdrian/twist-arcade), flagship **Fadeout**, npm scope `@twist-arcade/*`.*

---

## 1. Goal and non-goals

**Goal.** The owned packages plus workspace plumbing, ordered so the blocked teams (shell,
fadeout, daily — and now the two solo game teams, Crackstep and Mine Run) unblock as early as
possible:

1. Workspace bootstrap (pnpm monorepo, Next.js 15 skeleton app, lint/tsconfig, CI).
2. `packages/engine` — the `GameEngine<S,M,V>` contract **including the solo deltas** (`lost`
   status, optional `score()`, `minPlayers: 1`, effects-carrying views), seeded `Rng` with
   per-step forking, encode/decode conventions, replay utilities, and the shared
   `engineContract()` property-test kit with its solo branch.
3. `packages/game-spec` — the `GameDefinition` seam (manifest + presentation types) that nests
   over the engine per synthesis §2.3. *(New package, justified in §5.3.)*
4. `packages/bots` — RandomPolicy, minimax+αβ, MCTS-UCT, **the solo Strong agent (beam /
   flat-MC / 1-player MCTS — product code: it ships as the hint/ghost feature)**, difficulty
   tiers as manifest data, Web Worker host.
5. `packages/harness` — **two validation models, both first-class**:
   - two-player: headless self-play CLI, full metric set, degeneracy probes (mirror/stall/rush),
     exact solver (value iteration on the cyclic game graph);
   - solo (solo-games-lens §3): policy-distribution suite over paired seed sets, solo probes
     (Grind, Always-Safe, Greedy-Only, Suicide), and the **daily solvability-certificate
     pipeline** (`harness certify`) with the certificate as a first-class stored artifact.
6. CI gates per roadmap §6 — the two-player table **and** the solo parallel gate — wired as
   failing assertions.
7. `pnpm new-game <id>` scaffold (with a `--solo` flavor) + `CHECKLIST.md`.

**Non-goals (explicitly out of Phase-0-platform scope):**

- The GameShell, BoardShell, `useGame` hook, and all components from ux-lens §9/§10 — **shell
  team**. We own only the *types* they build against. (The solo shell deltas — score HUD,
  par-framed end screen, restart-centric controls — are shell-team scope too; we ship the
  `score()` and certificate data they render.)
- Fadeout, Crackstep, Mine Run themselves — **game teams**. We ship the solvers' building
  blocks and the pipelines; they run them.
- Daily seed derivation and rotation, share plumbing, streaks — **daily team**. We ship the
  deterministic pinned-bot capability and the certificate artifacts they consume.
- Determinization (`sampleConsistentState`) *implementation* for hidden-info bots — the optional
  hook is in the v1 type surface; the ISMCTS wrapper is a fast-follow (Fog Pools, Phase 2).
- **Any real-time tick loop.** The guardrail from solo-games-lens §8 stands: turn-quantized
  games only. No `realtime` flag in `GameMeta`, no tick lifecycle anywhere in the contract —
  a future real-time mode is a platform ADR, and speculating a field for it now is exactly the
  kind of unused surface this plan refuses.
- Any Supabase table, route handler, or auth. No server exists in Phase 0. (Consequence for
  certificates: they are build-time artifacts committed to the repo, §7.7 — migrating them to
  Postgres is Phase 2 work.)

---

## 2. Workspace layout and files to touch

Monorepo-lite per architecture-lens §6: one Next.js app at the root, workspace packages beside it.

```
package.json                     # name: "twist-arcade", private, pnpm workspace root
pnpm-workspace.yaml              # packages: ["packages/*", "games/*"]
tsconfig.base.json               # strict, ES2022, bundler resolution; packages extend it
eslint.config.mjs                # flat config; §5.6 purity rules scoped to engine + games
vitest.workspace.ts              # one runner across packages + games
.github/workflows/ci.yml         # typecheck → lint → test → harness ci suites → size-limit
.github/workflows/nightly.yml    # 20k-game harness sweep + 10k-seed calibration + buffer check
.size-limit.json                 # per-route budgets; app routes activate when shell team lands
next.config.ts, app/layout.tsx, app/page.tsx   # placeholder shell — handed to shell team
tailwind.config.ts, app/globals.css, components.json   # Tailwind + shadcn init (chrome only)

packages/engine/
  package.json                   # @twist-arcade/engine — ZERO runtime deps
  src/types.ts                   # GameEngine, GameMeta, Status (incl. lost), ActiveSpec,
                                 # Effect, WithEffects, Json
  src/rng.ts                     # mulberry32 core, splitmix32 mixer, rngFromSeed, rngFor
  src/encode.ts                  # stableStringify helper; canonical-encode contract
  src/replay.ts                  # ReplayRecord, replay(), replayTo(), appendStep()
  src/index.ts
  testkit/contract.ts            # engineContract(engine, opts) — shared property suite,
                                 # solo branch auto-activates when maxPlayers === 1
  testkit/fixtures/classic-ttt.ts    # 2P reference engine (internal, NOT a shipped game)
  testkit/fixtures/mini-crackstep.ts # solo puzzle fixture (tiny crumbling-path board)
  testkit/fixtures/bank-run.ts       # solo chase fixture (trivial press-your-luck banker;
                                     # has a build flag that plants a farming loop, for
                                     # TDD-ing the Grind probe)
  test/*.test.ts                 # rng, replay, encode, testkit-self-tests (mutant fixtures)

packages/game-spec/
  package.json                   # @twist-arcade/game-spec — types only; react as type-only peer
  src/manifest.ts                # GameManifest (incl. solo block), DifficultyTier, PolicySpec,
                                 # SearchBudget
  src/thresholds.ts              # HarnessThresholds + SoloThresholds + platform defaults
  src/presentation.ts            # GamePresentation, BoardProps, GameEvent, Frame
  src/definition.ts              # GameDefinition = manifest + engine + presentation
  src/certificate.ts             # DailyCertificate schema (first-class artifact, §7.7)
  src/solver.ts                  # SoloSolver / SoloSolveResult interfaces (per-game solvers)
  src/registry.ts                # RegistryEntry (incl. loadSolver?) + defineGame() helper

packages/bots/
  package.json                   # @twist-arcade/bots — deps: @twist-arcade/engine only
  src/policy.ts                  # Policy interface, SearchStats, Clock injection
  src/random.ts                  # RandomPolicy
  src/minimax.ts                 # minimax + alpha-beta, iterative deepening, needs heuristic
  src/mcts.ts                    # UCT; joint moves for simultaneous; 1-player native (max-only)
  src/beam.ts                    # beam search (width 100 default) — solo Strong; PRODUCT code
  src/flat-mc.ts                 # flat Monte-Carlo (32 rollouts/action) — cheap solo Strong
  src/tiers.ts                   # tierPolicy(tier): blunder wrapper + policy mix
  src/probes/stall.ts, probes/rush.ts       # generic 2P probes (mirror is per-game, §6)
  src/probes/greedy-only.ts, probes/suicide.ts  # generic solo probes (§6)
  src/worker/protocol.ts         # BotRequest/BotResponse wire types
  src/worker/host.ts             # worker entry: dynamic-imports engine via registry loader
  test/*.test.ts                 # anchor tests vs fixtures (§9)

packages/harness/
  package.json                   # @twist-arcade/harness — node CLI; deps: engine, bots, game-spec
  src/cli.ts                     # `pnpm harness run|suite|solve|certify|calibrate`
  src/runner.ts                  # 2P matchup executor; workers; mirrored seats
  src/solo-runner.ts             # policy-vs-distribution executor over paired seed sets
  src/metrics.ts                 # 2P metric derivation (§7.2)
  src/solo-metrics.ts            # distribution separation, CV, overlap, ceiling pile-up (§7.3)
  src/suites.ts                  # ci / nightly / design + solo-ci / solo-design definitions
  src/probes-solo.ts             # Grind cycle-search; Always-Safe driver (per-game hook)
  src/solver/reach.ts            # 2P BFS reachability, hash = encode(S)
  src/solver/retrograde.ts       # 2P value iteration to fixed point on the cyclic graph
  src/solver/generic-solo.ts     # dfsSolver (encode-deduped, pruned) + idaStarSolver(h) —
                                 # building blocks per-game solvers compose
  src/certify.ts                 # the generate → solve → reject → store certificate loop (§7.6)
  src/calibrate.ts               # 10k-seed feature distribution + z-scoring (nightly tier)
  src/report.ts                  # pretty table + JSON output
  test/*.test.ts                 # solver known-answer tests, certify tests vs fixtures (§9)

games/
  registry.ts                    # id → { manifest (eager), loadEngine(), loadPresentation(),
                                 #        loadSolver?() } — scaffold inserts at a marker

data/certificates/<gameId>/<yyyy-mm-dd>.json   # committed certificate artifacts (§7.7)

scripts/new-game.ts              # `pnpm new-game <id> [--solo puzzle|chase]`
templates/game/                  # 2P: engine.ts, engine.test.ts, heuristic.ts, probes.ts,
                                 #     manifest.ts, ui/Board.tsx, index.ts, CHECKLIST.md
templates/game-solo/             # solo: same minus probes-mirror, plus solver.ts stub (puzzle)
                                 #       or safeMove probe stub (chase)
docs/plans/phase-0-platform-spine.md   # this file
```

Tooling (all confirmed by orchestrator): **pnpm**, **vitest**, **fast-check**, **tsx**,
**size-limit**. No Immer, no framework in any package.

---

## 3. The engine contract (`packages/engine`) — exact surface

Adopted from architecture-lens §1 **plus the binding solo deltas from solo-games-lens §4**, and
four deliberate strengthenings, each justified below: (a) `lastEffects` is **required** on `S`
via a `WithEffects` constraint, (b) **`V` is also constrained to `WithEffects`** — views carry a
redacted effects list (orchestrator decision 4), (c) `encode` **excludes** `lastEffects` and must
be canonical, (d) moves must be JSON-plain.

```ts
// packages/engine/src/types.ts — no imports from react/next/supabase, ever.

export type PlayerId = number; // 0-indexed seat; seat→user mapping is the platform's job

export type Status =
  | { kind: "ongoing" }
  | { kind: "won"; winner: PlayerId }     // solo puzzle solved: winner = 0
  | { kind: "lost" }                      // SOLO-ONLY terminal failure (stranded, dead
                                          //   pre-goal, no legal moves unsolved). Two-player
                                          //   engines never emit it — testkit-asserted.
  | { kind: "draw" }                      // solo engines never emit draw — testkit-asserted
  | { kind: "scored"; scores: number[] }; // point variants AND solo score-chase terminals
                                          //   (scores = [final]). Invariant:
                                          //   scores.length === numPlayers.

export interface Rng {
  next(): number;                     // [0, 1)
  int(maxExclusive: number): number;
  shuffle<T>(xs: readonly T[]): T[];  // returns a new array
}

/** Factories — the algorithm behind these is part of the replay format (see §3.4). */
export function rngFromSeed(seed: string | number): Rng;
export function rngFor(matchSeed: string, step: number): Rng;  // fork-per-step rule

export type ActiveSpec =
  | { mode: "sequential"; player: PlayerId }
  | { mode: "simultaneous"; players: PlayerId[] };

/** JSON-plain data. Moves and effects must satisfy this (persistence + worker postMessage). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Transient presentation echo of the last apply(). A diff of two quiescent states cannot
 * distinguish "decayed" from "captured" — effects can (architecture-lens §5).
 * Common vocabulary the shell's animation mapper recognizes: "placed", "removed", "decayed",
 * "moved", "captured", "revealed", "rotated", "banked", "crumbled". Games may add custom
 * types; the shell ignores unknown ones gracefully.
 */
export type Effect = { type: string } & { [k: string]: Json };

export interface WithEffects {
  /** Set (fully overwritten, never appended) by every apply(). setup() sets []. */
  readonly lastEffects: readonly Effect[];
}

export interface GameMeta {
  id: string;                 // "fadeout" — stable; URLs, replays, registry key
  name: string;
  minPlayers: number;         // 1 is legal: solo ⇔ maxPlayers === 1. NO separate solo flag,
  maxPlayers: number;         //   and NO realtime flag — turn-quantized games only (§1).
  hiddenInformation: boolean; // solo fog games (unrevealed mines) set true
  simultaneous: boolean;
  stochastic: boolean;        // any chance events after setup?
  version: number;            // bump on ANY rules change; replays store it
}

export interface GameEngine<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects = S    // views carry effects too — see redaction note below
> {
  meta: GameMeta;

  /** All randomness (shuffle, starting player, procedural content — mine layouts,
   *  spawn schedules, food sequences) via rng. Solo generation lives here and in apply()
   *  (mid-run spawns draw from the step rng) — with rngFor's child-seed-per-step rule,
   *  replays and leaderboard verification cover generated content with zero new machinery. */
  setup(numPlayers: number, rng: Rng): S;

  /** Legal moves for one player. [] means that player cannot act right now. */
  legalMoves(state: S, player: PlayerId): M[];

  /** Cheap membership check; server validation calls this, not legalMoves(). */
  isLegal(state: S, player: PlayerId, move: M): boolean;

  /** Solo engines KEEP active(): return { mode: "sequential", player: 0 } while ongoing.
   *  The shell, harness, and replayer loop on active() and must not branch on player
   *  count. One trivial line per solo engine buys no forks in any consumer. */
  active(state: S): ActiveSpec;

  /**
   * The ONLY transition. One entry for sequential, one per active player for simultaneous.
   * Runs ALL automatic post-move transitions (decay, gravity, cascades, crumbling,
   * rot, re-fog) to quiescence. Pure: same (state, moves, rng stream) ⇒ identical result.
   * MUST NOT mutate input. MUST fully overwrite lastEffects.
   */
  apply(state: S, moves: ReadonlyMap<PlayerId, M>, rng: Rng): S;

  status(state: S): Status;

  /**
   * Redaction boundary. player === null is the spectator view. V must contain NO
   * recoverable secret — of another player (2P hidden info) OR of generated content the
   * player has not yet revealed (solo fog: unrevealed mines are ABSENT from V, not
   * masked). The spectator view may reveal everything once terminal (post-game "show me
   * the mines"). V's lastEffects is REDACTED BY THIS SAME SINGLE CODE PATH: an effect the
   * player may not see is omitted, not masked — absence is structural, not a runtime
   * audit (orchestrator decision 4). The contract test walks the effects array with the
   * same no-secrets assertion as the rest of the view. Perfect-info games:
   * playerView = identity, and V = S satisfies the constraint for free.
   */
  playerView(state: S, player: PlayerId | null): V;

  /**
   * Canonical serialization. EXCLUDES lastEffects (effects are recomputable by re-applying;
   * see §3.2). Same logical state ⇒ byte-identical string (solvers hash on this).
   * decode(x).lastEffects === []. Use stableStringify() unless there is a measured reason not to.
   */
  encode(state: S): string;
  decode(encoded: string): S;

  /** Optional per-game eval for minimax/greedy; MCTS needs nothing. Positive = good for player. */
  heuristic?(state: S, player: PlayerId): number;

  /** NEW (solo-games-lens §4), optional: live score for the HUD, harness learning curves,
   *  and the share artifact's progress line. MUST be pure and MUST equal
   *  status().scores[0] at a scored terminal (testkit-asserted). Puzzles omit it. */
  score?(state: S, player: PlayerId): number;

  /** Optional: sample a full state consistent with a view — enables determinized MCTS
   *  for hidden-info games. Hook in v1; no platform consumer until the ISMCTS fast-follow. */
  sampleConsistentState?(view: V, rng: Rng): S;
}
```

**Contract rules the testkit enforces (beyond types):**

- **No hidden pass:** if `status` is ongoing, every player listed by `active()` has ≥1 legal
  move. A stuck player is either skipped by `active()` or given an explicit pass move — a solo
  game with no legal moves and the goal unmet must return `{ kind: "lost" }`, not hang.
- **Termination:** random legal playouts terminate within the ply cap (2P default 200; solo
  score chases use the manifest's `solo.moveCap`, default 2,000 — cap hits fail the contract
  suite and are a red-flag metric in the harness).
- `isLegal(s,p,m)` ⟺ `m ∈ legalMoves(s,p)` (deep equality on JSON-plain moves).
- `encode∘decode` identity **modulo `lastEffects`**; `encode(decode(encode(s))) === encode(s)`.
- Determinism: same seed + same move sequence twice ⇒ deep-equal trajectories *including*
  effects — and, for solo games, **identical generated content** (spawn/mine/tile sequences);
  this is the leaderboard-verification property, tested directly.
- Purity: inputs deep-frozen in tests; any mutation throws.
- `playerView` total: never throws for any seat and for `null`.
- **Status discipline:** 2P engines never emit `lost`; solo engines never emit `draw` or a
  winner ≠ 0. Protects the union's semantics on both sides.
- `score` (when present): defined at every reachable state; equals `scores[0]` at scored
  terminals; if the manifest declares `solo.scoreMonotone: true`, never decreases.

### 3.1 Immutability decision (settled)

**Immutable, plain-object, hand-written spreads. No Immer.** States are tiny; naive immutable
`apply` supports ~10⁵–10⁶ applies/sec, and search at our budgets needs 10⁴–10⁵ expansions —
10–100× headroom (architecture-lens §2).

**Escape hatch — documented here, deliberately NOT built:** if a future game measures as
search-bound, its engine may additionally implement
`applyInPlace(state, moves, rng): void` + `clone(state): S`, and search will prefer them when
present. The trigger is a *measured* bot-strength problem in the harness, never a hunch. Sonnet
must not implement these methods, stubs, or interface slots beyond this paragraph.

### 3.2 `lastEffects` decision (settled, orchestrator-approved)

`apply` returns a state **carrying** `lastEffects: readonly Effect[]`, per architecture-lens §5
— not a separate `{state, effects}` return. Reasons: the `S → S` signature stays uniform for
bots/solvers/replayer; replaying moves `0..k` reproduces step-k effects automatically, so undo,
redo, and async view-refetch animate correctly with zero extra plumbing.

Two sharp edges, both resolved in the contract above:

- **Solver/hash pollution:** two states identical except for effects must hash identically →
  `encode` excludes `lastEffects`, and every solver hashes on `encode(S)`.
  **Standing warning to future authors (orchestrator decision 6): never "helpfully" add
  effects back into `encode`.** If effects entered the canonical encoding, two positions
  identical in every way that matters to the rules would hash differently, and
  superko/repetition detection in the decay games would **silently break** — no test failure,
  just wrong game outcomes. The testkit's canonical-form property exists to catch exactly this;
  do not weaken it.
- **Author bookkeeping:** "cleared next step" is restated as "fully overwritten by every
  `apply`" — no clearing step to forget; the testkit asserts effects never accumulate.

Deviation from architecture-lens noted and approved: the lens said state "may include" effects;
we make it **required** (`S extends WithEffects`), and — per orchestrator decision 4 — views
too (`V extends WithEffects`): `Board` receives `V`, never `S`, so effects not in `V` would be
effects the UI physically cannot animate, collapsing ux-lens §9's "animation restates a state
change" rule. Effects in views are redacted by the same single `playerView` path as everything
else (omit, don't mask).

### 3.3 Replay utilities

```ts
// packages/engine/src/replay.ts
export interface StepRecord { moves: [PlayerId, Json][] }   // 1 entry sequential, n simultaneous

export interface ReplayRecord {
  gameId: string;
  gameVersion: number;       // GameMeta.version at record time
  engineVersion: string;     // @twist-arcade/engine package version (see §10 freeze policy)
  numPlayers: number;        // 1 for solo
  seed: string;              // matchSeed; rng for step k = rngFor(seed, k)
  steps: StepRecord[];
}

export function replay<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>, record: ReplayRecord
): { states: S[]; final: S; status: Status };          // validates each move; throws on illegal

export function replayTo<...>(engine, record, k: number): S;
export function appendStep(record: ReplayRecord, moves: ReadonlyMap<PlayerId, Json>): ReplayRecord;
```

`replay` validates every move with `isLegal` before applying — it is the future leaderboard
verifier (solo scores included: claimed score discarded, recomputed from the replay), the
certificate re-verifier, and the bug-repro tool. It must refuse illegal logs loudly.

### 3.4 Rng implementation (pinned — this is a wire format)

mulberry32 as the stream generator; splitmix32 as the seed mixer; strings folded to 32-bit via
xmur3. `rngFor(matchSeed, k) = mulberry32(splitmix32(xmur3(matchSeed) + k))` (exact constants in
code, golden-value tests lock them). **The derivation algorithm is part of the replay format:**
changing any constant orphans every stored replay, daily seed, and certificate. Golden-vector
tests (fixed seed → first 8 outputs asserted) ship with it; changing it is a breaking
`engineVersion` change requiring an ADR — the one thing that needs an ADR even pre-freeze.

Per-step forking means replaying steps `0..k` consumes identical random streams regardless of
how many draws earlier steps made — engine-internal refactors that change draw counts within a
step cannot corrupt replays. For solo games this is what makes mid-run generation (snake food,
2048 spawns, mine reveals) replay-verifiable for free.

---

## 4. The testkit (`packages/engine/testkit`)

```ts
export interface ContractOptions {
  runs?: number;               // fast-check iterations per property (default 100; CI can raise)
  maxPlies?: number;           // default 200; solo chases default to manifest solo.moveCap (2000)
  playerCounts?: number[];     // default: [meta.minPlayers .. meta.maxPlayers]
  /** Hidden-info AND solo-fog games: extract secret strings (opponent secrets, or unrevealed
   *  generated content) from canonical S for a given viewer. The kit asserts
   *  JSON.stringify(playerView(S, p)) — INCLUDING its lastEffects array — contains none of
   *  them, across random playouts. Required when meta.hiddenInformation is true. */
  secretExtractor?: (state: unknown, player: PlayerId) => string[];
}

/** Registers describe/it blocks (vitest) — every game's engine.test.ts calls this.
 *  The solo branch auto-activates when meta.maxPlayers === 1. */
export function engineContract<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>, opts?: ContractOptions
): void;

/** Certificate replay check (puzzle games): asserts the (seed, moveLog) pair reaches
 *  { kind: "won" }. CI runs this against every shipped daily certificate. */
export function verifyCertificate(engine: GameEngine<any, any, any>, cert: DailyCertificate): void;
```

Properties: everything in §3's contract-rules box, plus: effects never accumulate;
`meta.hiddenInformation === false` ⇒ spot-check `playerView(S, p)` deep-equals `S`; status
stable under encode/decode.

**Solo branch (auto-activated, from solo-games-lens §4):** terminals are `won | lost | scored`
only; `score` coherence and optional monotonicity; determinism-through-generation (two full
replays from one seed ⇒ identical spawn/mine/tile sequences); fog redaction via
`secretExtractor` pointed at generated content; `verifyCertificate` acceptance. **Two-player
branch:** asserts `lost` is never emitted.

**The testkit is itself TDD'd against sabotage:** fixtures `classic-ttt` (2P),
`mini-crackstep` (solo puzzle), `bank-run` (solo chase), plus deliberately broken mutants — an
engine that mutates input, one that leaks `Math.random`, one whose `encode` includes effects,
one non-terminating, one solo engine that emits `draw`, one whose `score` disagrees with its
scored terminal, one 2P engine that emits `lost`. The kit's own suite asserts each mutant
**fails the right property**. A testkit that cannot catch planted bugs is theater.

---

## 5. The `GameDefinition` seam (`packages/game-spec`)

### 5.1 The split (synthesis §2.3, made exact)

| Part | Type | May import | Owner of the type | Implemented by |
|---|---|---|---|---|
| `manifest` | `GameManifest` | nothing (pure data) | platform | each game |
| `engine` | `GameEngine<S,M,V>` | `@twist-arcade/engine` | platform | each game |
| `presentation` | `GamePresentation<S,M,V>` | React **types only** + engine types | platform (shape) / shell team (semantic refinement pre-freeze) | each game |

```ts
export interface GameDefinition<S extends WithEffects, M extends Json, V extends WithEffects = S> {
  manifest: GameManifest;
  engine: GameEngine<S, M, V>;
  presentation: GamePresentation<S, M, V>;
}
```

### 5.2 Manifest (pure data — eagerly imported by the catalog)

```ts
export interface GameManifest {
  id: string;                       // === engine.meta.id (contract test asserts equality)
  title: string;                    // "Fadeout", "Crackstep", "Mine Run"
  classic: string;                  // "Tic-Tac-Toe", "Minesweeper" — drives shelves
  ruleSentence: string;             // ≤90 chars — hard constraint, asserted in the contract test
  tags: string[];                   // ["decay"], ["press-your-luck"] — facets, next-twist loop
  estMinutes: number;
  modes: { bot: boolean; hotseat: boolean; asyncLink: boolean };  // solo games: no opponent
                                    //   modes at all — daily/endless framing is shell scope
  players: { min: number; max: number };
  difficultyTiers: DifficultyTier[];       // DATA consumed by packages/bots (2P games)
  thresholds?: Partial<HarnessThresholds | SoloThresholds>; // overrides platform defaults
  exceptions?: { gate: string; justification: string }[];   // visible in review

  /** Present iff players.max === 1. Drives which harness model and gate table apply. */
  solo?: {
    format: "daily-puzzle" | "score-chase";
    moveCap?: number;               // default 2000 (chases); structural termination is still
                                    //   mandatory — the cap is a tripwire, not a rule
    scoreMonotone?: boolean;        // enables the testkit monotonicity property
    /** §3.2 scale caveat from the solo lens: ratios need a score linear in achievements.
     *  Exponential-score games (2048-family) declare a linear proxy the harness compares
     *  on instead. */
    comparisonMetric?: "score" | { proxy: string };  // proxy = a key the game logs per run
    /** chase games: per-game Always-Safe hook is REQUIRED (harness enforces, §7.4) */
  };
}

export type SearchBudget =
  | { kind: "deadlineMs"; ms: number }      // interactive play — responsive on weak devices
  | { kind: "rollouts"; n: number };        // DETERMINISTIC — same move on every machine

export type PolicySpec =
  | { kind: "random" }
  | { kind: "minimax"; maxDepth?: number }        // requires engine.heuristic
  | { kind: "mcts"; explorationC?: number }
  | { kind: "beam"; width?: number }              // solo Strong (also the hint/ghost feature)
  | { kind: "flat-mc"; rolloutsPerAction?: number }
  | { kind: "mix"; components: { weight: number; policy: PolicySpec }[] };

export interface DifficultyTier {
  id: "casual" | "standard" | "ruthless";
  policy: PolicySpec;
  budget: SearchBudget;
  minReplyMs: number;                        // artificial floor (~250 on casual) — UX feature
  blunder?: { epsilon: number; temperature: number };  // ε-softmax over root visit counts
}
```

**Constraint the daily team inherits here (orchestrator decision 7):** the Daily Twist bot must
be pinned — fixed tier, fixed budget, fixed RNG seed, pinned `engine_version` — or "won in 9"
is not comparable between players. Only a `rollouts` budget makes that pinning possible: a
wall-clock `deadlineMs` bot plays *differently on a fast laptop than on a slow phone*, silently
destroying the day's comparability and any leaderboard built on it. The harness runner and any
future daily code **assert `budget.kind === "rollouts"` wherever determinism is required** and
refuse `deadlineMs` there. Interactive (non-daily) tiers keep `deadlineMs` for weak-device
responsiveness.

### 5.3 Presentation (React-shaped; type-only React imports)

```ts
import type { ComponentType } from "react";

export interface BoardProps<V extends WithEffects, M extends Json> {
  view: V;                          // the seat's VIEW, never canonical S — redaction by type;
                                    //   effects arrive via view.lastEffects (already redacted)
  legal: M[];
  onMove(m: M): void;               // shell wraps with commit/lockout/undo
  seat: PlayerId | "spectator";
  prefs: { reducedMotion: boolean; theme: "light" | "dark" };
}

export type GameEvent =
  | { kind: "moved"; player: PlayerId; effects: readonly Effect[] }
  | { kind: "status"; status: Status }
  | { kind: "effect"; effect: Effect };     // shell refines pre-freeze; keep loose for now

export interface GamePresentation<S extends WithEffects, M extends Json, V extends WithEffects = S> {
  Board: ComponentType<BoardProps<V, M>>;
  announce(ev: GameEvent): string;
  firstOccurrence?: {
    trigger(ev: GameEvent): boolean;
    text: string;
    anchor(ev: GameEvent): Json;
  };
  shareArtifact(record: ReplayRecord, finalView: V): string;  // emoji timeline BODY only;
    // shell owns the frame. Solo games get the certificate handed alongside by the shell
    // (par lives in the header) — the artifact body may diff the player's log against
    // solver values (🟩🟨🟥 struggle-shape, solo-games-lens §6) offline.
  howSheetFrames: [Frame, Frame, Frame];
  textureLine?(finalView: V): string;
}
```

Why a separate package: engine must stay react-free (workers, Node CLI, route handlers);
presentation types reference `ComponentType`; and the seam needs a platform-owned home because
game teams and the shell team both build against it (CLAUDE.md §4 routes shared-contract changes
through the orchestrator). Types-only, near-zero runtime — not a new operational cost.

### 5.4 Registry

```ts
export interface RegistryEntry {
  manifest: GameManifest;                                   // EAGER — catalog payload
  loadEngine(): Promise<GameEngine<any, any, any>>;         // dynamic import() — code-split
  loadPresentation(): Promise<GamePresentation<any, any, any>>;
  loadSolver?(): Promise<SoloSolver<any, any>>;             // puzzle games — harness certify only,
                                                            //   NEVER imported by app routes
}
export type Registry = Record<string, RegistryEntry>;
```

`games/registry.ts` implements it with a `// <new-game:insert>` marker the scaffold appends at.
Manifests eager; engine/UI/solver only via dynamic `import()` (lint-enforced on the app side).

---

## 6. Bots (`packages/bots`)

```ts
export interface SearchStats {
  elapsedMs: number; rollouts?: number; depth?: number; rootValue?: number;
  rootVisits?: { move: Json; visits: number }[];   // feeds ε-softmax blunder + harness logging
}
export interface Clock { now(): number }           // injected — bots may not touch Date.now

export interface Policy<S extends WithEffects, M extends Json> {
  chooseMove(args: {
    engine: GameEngine<S, M, any>;
    state: S; player: PlayerId;
    rng: Rng;                       // ALL policy randomness flows through this
    budget: SearchBudget; clock: Clock;
  }): { move: M; stats: SearchStats };
}

export function randomPolicy(): Policy<any, any>;
export function minimaxPolicy(opts?: { maxDepth?: number }): Policy<any, any>;
  // iterative deepening inside the budget; typed error if heuristic absent or the game is
  // simultaneous/hidden-info (minimax fits sequential perfect-info only)
export function mctsPolicy(opts?: { explorationC?: number; rolloutCapPlies?: number }): Policy;
  // UCT c=1.4 default; simultaneous: JOINT move space (decoupled UCT deferred);
  // stochastic: fresh child rng per rollout; 1-PLAYER NATIVE: with one seat the tree is
  // max-only — no code fork, just no opponent nodes
export function beamPolicy(opts?: { width?: number }): Policy;       // default width 100;
  // solo only; requires score() or heuristic. THE solo Strong agent at 200 ms/move —
  // and PRODUCT code: it ships later as the hint/ghost feature (solo-games-lens §3.1),
  // which is why it lives here and not in the harness.
export function flatMonteCarloPolicy(opts?: { rolloutsPerAction?: number }): Policy;
  // default 32/action; the cheap Strong stand-in for stochastic solo games
export function tierPolicy(tier: DifficultyTier): Policy;   // interprets PolicySpec data:
  // mix + blunder wrapper (prob ε: sample softmax of root visits at temperature τ) + budget kind
```

**Determinism contract:** same `(engine, state, player, rng seed, rollouts-budget)` ⇒ same move.
`deadlineMs` budgets are explicitly non-deterministic and forbidden where reproducibility
matters (§5.2).

**Worker host** (`src/worker/`): `BotRequest { requestId, gameId, encodedState, player, tierId,
seed, step }` → registry → `loadEngine()` → `tierPolicy` → `BotResponse { requestId, move,
stats }` (policy rng = `rngFor(seed + ":bot", step)`). `minReplyMs` floor is enforced by the
*shell*, not the worker (UX concern; ux-lens §10 ownership table). Host is UI-framework-free;
the shell team wraps it in their `useGame` hook.

**Degeneracy probes:**

- *Two-player:* **stall** (maximize estimated remaining plies via shallow rollouts), **rush**
  (1-ply greedy: win now, else block, else best heuristic, else random) — generic, in this
  package. **Mirror is per-game** (point symmetry is board geometry the interface deliberately
  doesn't expose): optional export `games/<id>/probes.ts → mirrorMove(state, lastOpponentMove)`;
  harness warns when absent, CI **requires** it for games tagged `symmetric`.
- *Solo (solo-games-lens §3.6):* **Greedy-Only** (1-ply on `heuristic` — generic, here) and
  **Suicide** (shortest path to a terminal — generic, here; harness runs it only for games
  tagged `misere`). **Grind** is a harness-side *analysis*, not a policy (it searches for a
  repeatable cycle — §7.4). **Always-Safe is per-game** (what "the minimum-variance option"
  means is game knowledge): required export `games/<id>/probes.ts → safeMove(state): M` for
  every `solo.format === "score-chase"` game; harness hard-errors if missing (a chase without
  it cannot pass CI, by design — the risk-is-fake gate cannot run without it).

---

## 7. Harness (`packages/harness`) — two validation models

### 7.1 CLI

```
# two-player (self-play model)
pnpm harness run <gameId> --matchup mcts1k:random --games 1000 --seed 42 [--json out.json]
pnpm harness suite <gameId> --suite ci|nightly|design [--seed 42]
pnpm harness solve <gameId> [--max-states 1e7]            # value iteration, cyclic-safe

# solo (distribution + certificate model)
pnpm harness suite <gameId> --suite solo-ci|solo-design   # auto-selected when maxPlayers === 1
pnpm harness certify <gameId> --days 90 [--from 2026-09-01]
pnpm harness calibrate <gameId> --seeds 10000             # nightly tier, once per game

pnpm harness suite --all --suite ci                       # per-PR; picks ci or solo-ci per game
pnpm harness suite --all --suite nightly                  # 20k+ games + calibration drift check
```

Named 2P agents: `random`, `greedy`, `mcts100|mcts1k|mcts10k`, `minimax<d>`, `stall`, `rush`,
`mirror`, plus manifest tier ids. Solo roster: `random`, `greedy`, `strong` (beam-100 @ 200
ms/move; `flat-mc` for stochastic games — per-manifest `PolicySpec` choice), `greedy-only`,
`always-safe`, `suicide`. Deterministic seeds per run; 2P uses seat-mirrored pairs; solo uses
**paired seed sets** (every policy runs the identical N seeds — the solo analogue of mirrored
seats, same variance reduction); `worker_threads` fan-out across cores.

### 7.2 Two-player metrics

First-player win rate · draw rate · win rate by seat · mean/median/p95 plies · mean branching
factor · decisiveness/comeback curve (per-ply MCTS root value; comeback fraction = loser held
≥60% at some ply) · opening-move concentration · cap-hit rate (200-ply cap, adjudicated draw +
logged) · throughput · ladder mode (round-robin, logistic-regression Elo, spread).

### 7.3 Solo metrics (solo-games-lens §3.2, §3.5, §3.7)

Over N=1,000 runs per policy on paired seeds, computed on the manifest's `comparisonMetric`
(linear proxy for exponential scores — stated so nobody games the ratios):

Median score ratios Strong/Random, Greedy/Random, Strong/Greedy · distribution overlap
(Strong p10 vs Random p90; Strong median vs Random p75) · Strong score CV across seeds ·
ceiling pile-up (share of Strong runs within 1% of max/capped score) · median + p95 run length
(decisions) · cap-hit rate (2,000-move cap) · per-run score curves (via `score()`) ·
throughput. **Skill is distribution separation, not head-to-head wins** — there is no head to
head.

### 7.4 Solo degeneracy probes (solo-games-lens §3.6)

- **Grind** (`probes-solo.ts`): breadth-limited search for a repeatable move cycle (cycle
  detection on `encode(S)`, sequences up to length ~8) whose score delta ≥ 0 and whose
  per-cycle termination risk ≈ 0 (estimated by rollouts through the cycle). Any such loop =
  hard fail: unbounded zero-risk farming; the leaderboard becomes a patience contest. Honest
  limitation, on the record: the search is bounded, so it can miss long/conditional loops — it
  is a tripwire, not a proof; structural termination (§7.5's run-length gate + the mandatory
  per-game termination device) is the real defense.
- **Always-Safe**: drives the per-game `safeMove` hook for full runs; compares its median to
  Strong's. ≥95% = the risk mechanic is decorative, hard fail. Hook required for every chase
  (§6).
- **Greedy-Only**: dominant-strategy probe (design gate: within 10% of Strong ⇒ one visible
  policy is the whole game).
- **Suicide** (misère-tagged only): "losing fast" must not be the optimal line.

### 7.5 Suites and CI gates — both tables wired as failing assertions

Platform defaults in `game-spec/thresholds.ts`; per-manifest overrides; `exceptions[]` surfaced
in the report. The `--suite ci` runner auto-selects the table by `players.max`.

**Two-player CI hard fails (roadmap §6):** strong-vs-random < 90% · P1 win rate outside 35–65% ·
draw rate > 60% · mean plies outside 4–200 or any cap hit · ruthless-vs-standard < 60% (warn at
PR budget, fail nightly) · contract suite failure · redaction leak · bundle > 75 kB gz/route ·
critical axe violation.

**Solo CI hard fails (roadmap §6 solo parallel gate + solo-games-lens §3.8):**

| Gate | Fail when |
|---|---|
| Strong/Random median ratio (comparison metric) | < 1.5 (slot machine) |
| Distribution overlap | Strong median < Random p75 |
| Greedy/Random | < 1.2 (the obvious strategy doesn't pay — illegible) |
| Strong/Greedy | < 1.15 (search adds nothing — one-trick game) |
| Strong score CV across seeds | > 1.2 (perfect play is mostly dice) |
| Always-Safe vs Strong median | ≥ 95% (risk is fake) |
| Grind probe | any zero-risk unbounded loop found |
| Median run length | outside 15–600 decisions |
| Cap hits (2,000 moves), any policy | > 1% |
| Ceiling pile-up | > 20% of Strong runs at/within 1% of cap |
| **Daily certificate** | **any shipped seed missing one, or failing CI re-verification** |
| Certificate L* (par) | outside 8–80 |
| Random-playout solve rate | > 30% (trivial) |
| Forced-move fraction on optimal path | > 85% |
| Generator rejection rate | > 90% (generator/band mismatch — redesign; warn at > 50%) |
| Day-over-day difficulty drift | > 1.5σ |
| Certified-seed buffer | < 7 days (alert at < 30) |
| Fog games | any daily requiring a guess (deduction-only clause) |
| Contract suite (incl. solo branch) | any failure |

**Design-gate suites** (`--suite design` / `--suite solo-design`): non-failing reports of the
tighter bands (2P: game-theory §3.4 table; solo: solo-games-lens §3.8 design column — S/R ≥ 3.0,
Strong p10 ≥ Random p90, Always-Safe ≤ 70%, CV 0.25–0.7, L* 12–50, forced-move 30–70%, etc.)
for the Fable review stage. CI proves not-broken; a human decides good.

Budgets: PR ~1–2k games (2P) / 1k runs per policy (solo) — minutes; nightly 20k+ across all
games plus calibration drift; the one-time 10k-seed calibration (~30 CPU-min/game) is
nightly-tier only, never PR-tier.

### 7.6 Exact solvers

**Two-player:** preconditions perfect-info/deterministic/sequential/2P; `reach.ts` BFS on
`encode(S)` hashes, abort past `--max-states` (default 10⁷); `retrograde.ts` **value iteration
to a fixed point** — required over plain minimax because decay graphs are **cyclic**; residue
after convergence = draw. Output: game value, optimal opening set, per-opening values (feeds
pie-rule decisions).

**Solo** (`solver/generic-solo.ts` + per-game solvers): the harness ships composable building
blocks — `dfsSolver()` (pruned DFS with `encode`-dedup and reachability pruning; sufficient for
Crackstep) and `idaStarSolver(h)` (per-game admissible heuristic). Games with richer structure
(CSP propagation for deduction/fog games, GF(2) elimination for toggle games) export a bespoke
solver via `games/<id>/solver.ts` implementing:

```ts
// packages/game-spec/src/solver.ts
export interface SoloSolveBudget { maxNodes: number; maxMs: number }  // default 1e7 / 10_000
export interface SoloSolveResult {
  outcome: "solved" | "unsolvable" | "budget-exhausted";
  moveLog?: Json[];                 // the solution — replayable through the engine
  length?: number;                  // L*
  optimal?: boolean;                // false ⇒ best-found-in-budget (anytime beam/IDA*);
                                    //   par is then an upper bound — beating it is a player
                                    //   achievement, not a bug
  guessFree?: boolean;              // fog games: solvable by deduction alone (no branching)
  nodesExpanded: number;
  features?: Record<string, number>;  // extra per-game difficulty features
}
export interface SoloSolver<S extends WithEffects, M extends Json> {
  solve(engine: GameEngine<S, M, any>, initial: S, budget: SoloSolveBudget): SoloSolveResult;
}
```

### 7.7 The certificate pipeline (`harness certify`) — a first-class artifact

The generate → exact-solve → reject → store loop of solo-games-lens §3.3, run **offline in
batch at build time, never at request time**. The certificate is simultaneously the fairness
proof, the difficulty calibration, and the share hook ("par"), so it gets a schema, storage,
and CI re-verification — not a throwaway check:

```ts
// packages/game-spec/src/certificate.ts
export interface DailyCertificate {
  gameId: string;
  gameVersion: number;
  engineVersion: string;            // pinned — a version bump invalidates the buffer for that game
  day: string;                      // "2026-09-14" (UTC) — the daily slot certified
  seed: string;                     // dailyFormula(gameId, engineVersion, day) + ":" + nonce
  nonce: number;                    // how many candidates were rejected before this one
  moveLog: Json[];                  // solver solution — CI replays it via verifyCertificate()
  par: number;                      // L* — published in UI and share artifact
  parKind: "optimal" | "best-in-budget";
  solverNodes: number;
  guessFree?: boolean;              // fog games only
  features: {
    forcedMoveFraction: number; branchingMean: number;
    deadEndDensity: number;         // fraction of 1,000 random playouts reaching unsolvable state
    greedyGap: number | null;       // greedy length − L*, null = greedy fails
    zScore: number;                 // vs the game's 10k-seed calibration distribution
  };
}
```

Loop per candidate day: derive candidate seed (public daily formula + nonce counter) →
`setup(1, rngFromSeed)` → per-game solver at budget 10⁷ nodes / 10 s → **reject** if
unsolvable, if the solver exhausted budget (**treated as unsolvable — a daily is NEVER shipped
uncertified**), if trivial (random-playout solve rate > 30%, or L* < 8, or forced-move
fraction > 85%), if outside the difficulty band (target ±0.5σ, ≤0.5σ drift day-over-day), or —
fog games — if not deduction-only. Else store to `data/certificates/<gameId>/<day>.json`
(committed; Phase 2 moves the buffer to Postgres when a server exists — schema unchanged).

Buffer policy: **90 certified days per game** generated at build time; nightly CI re-verifies
every stored certificate through `verifyCertificate` (purity makes this cheap), alerts below 30
days of buffer, hard-fails below 7. A daily outage is the one failure mode with site-wide blast
radius; the buffer makes it a build-time problem, never a 6 a.m. incident.

`harness calibrate` produces the 10k-seed feature distribution the band/z-scores are computed
against (once per game + nightly drift check). Weekly difficulty ramp: **not at launch** — flat
band until the solver-effort→human-effort mapping is validated (Phase 3 nicety, per the lens).

---

## 8. Scaffold — `pnpm new-game <id> [--solo puzzle|chase]`

`scripts/new-game.ts` (hand-rolled ~200-line generator; no plop unless it stays smaller):

1. Validates id (kebab-case, not in registry).
2. Stamps from `templates/game/` (2P) or `templates/game-solo/` (solo): `engine.ts` (typed
   skeleton, `WithEffects` state, TODO-marked `apply`; solo variants pre-set `minPlayers/
   maxPlayers: 1` and stub `score()` for chases), `engine.test.ts` (imports `engineContract` —
   **pre-wired red**: the contract suite fails until the engine is real, exactly the TDD
   stage-2 starting point), `heuristic.ts`, `probes.ts` (2P: mirror stub; chase: **safeMove
   stub** — required, the suite will not pass without it), `solver.ts` (puzzle only: wraps
   `dfsSolver`/`idaStarSolver` with TODOs), `manifest.ts` (tiers/thresholds from platform
   defaults; solo block per flavor), `ui/Board.tsx` (typed against `BoardProps`), `index.ts`
   (`GameDefinition` assembly), `CHECKLIST.md`.
3. Inserts the registry entry (incl. `loadSolver` for puzzles) at the marker.
4. Prints next steps.

`CHECKLIST.md` per flavor. 2P: engine → contract green → heuristic → `harness solve` if <10⁷
states → `suite ci` green → `suite design` reviewed → tiers tuned → mirror probe if symmetric →
Board + telegraph (grayscale test) → announce strings → rule sentence ≤90 → shareArtifact <7
lines → PR. Solo adds: `solver.ts`/`safeMove` → `suite solo-ci` green → `certify --days 90`
(puzzles) → rejection rate reviewed → par rendering handed to shell.

Observable acceptance: `pnpm new-game demo && pnpm typecheck && pnpm test --filter demo`
compiles and fails **only** on the TODO engine, under a minute — for both flavors.

---

## 9. Sequencing — what lands when, and whom it unblocks

Five consumers are parked on this work: shell, fadeout, daily, and the two solo game teams.
The engine contract types — **including the solo deltas, which are on the M1 critical path** —
land first. The solo deltas cost ~0.5 day inside M1 (one Status variant, one optional method,
the testkit solo branch) and must precede the v1 freeze anyway, so there is no version of this
plan where they trail. The solo *harness* machinery (M3c/M3d), by contrast, is **off the
critical path** for shell/fadeout/daily — it blocks only the solo game teams' validation runs,
and it parallelizes with M3b.

Orchestrator-confirmed merge strategy: **M0+M1 runs the CLAUDE.md §2 loop as its own feature
and merges to main before M2 starts.**

| # | Milestone | Contents | Days (est) | Unblocks on merge |
|---|---|---|---|---|
| M0 | Workspace bootstrap | pnpm workspace, tsconfig/eslint (purity rules), vitest, placeholder Next app, CI skeleton | 0.5–1 | shell team forks the app skeleton |
| M1 | **The contract** (incl. solo deltas) | `packages/engine` complete: types (`lost`, `score?`, `WithEffects` on S **and** V), Rng + golden vectors, encode, replay, testkit with 2P **and solo branches**, all three fixtures + mutant self-tests; `packages/game-spec` complete (manifest incl. solo block, presentation, certificate + solver schemas, registry); empty `games/registry.ts` | 3–4 | **fadeout** (engine + TDD red) · **shell** (GameDefinition/BoardProps/registry seam) · **Crackstep & Mine Run** (solo engine contract + testkit) — merge to main immediately on green |
| M2 | Bots | random → minimax → MCTS (1-player native) → **beam + flat-MC (solo Strong = future hint/ghost)** → tiers/blunder → stall/rush/greedy-only/suicide probes → worker host | 3–4 | **shell** (worker protocol) · **daily** (deterministic `rollouts` tier — the pinned daily bot) · solo teams (Strong agent to tune against) |
| M3a | 2P solver + minimal runner | reach + retrograde + `solve` + single-matchup `run` | 1–1.5 | **fadeout's exact-solve-before-UI step** (their critical path — do not let full metrics block it) |
| M3b | Full 2P harness | metrics, ladder/Elo, probe wiring, comeback curve, suites ci/design/nightly, thresholds + exceptions | 2 | CI gate wiring; fadeout design review |
| M3c | Solo suite | solo-runner (paired seeds), solo-metrics, Grind/Always-Safe drivers, solo-ci/solo-design suites + threshold table | 2–3 | **Mine Run** validation (and Crackstep's non-certificate gates). Parallelizable with M3b after M2 |
| M3d | Certificate pipeline | generic-solo solvers, `certify` loop + rejection rules, `DailyCertificate` storage + `verifyCertificate` CI job, `calibrate`, buffer alerts | 1.5–2 | **Crackstep** dailies · **daily team's** solo-daily slot (par + seed + nonce artifacts) |
| M4 | CI gates | `ci.yml` full order (both tables), nightly workflow (sweep + calibration drift + buffer), size-limit config (dormant until app) | 0.5–1 | everyone's definition of green |
| M5 | Scaffold | `new-game` + both template flavors + CHECKLISTs | 1–1.5 | week-2+ game teams; live test that the seam is sufficient |

Total ≈ 15–20 build-days (rev 1 was 9–12; the delta of ~5–8 matches the roadmap's solo-support
pricing). Dependency spine: M1 → M2 → {M3a → M3b, M3c, M3d}; M3c/M3d need M2 (Strong agent) but
not M3a/M3b. M5 after M3d so the checklist references real commands. **This is now the work of
two Sonnet lanes, not one** — after M2, lane A takes M3a→M3b (two-player) while lane B takes
M3c→M3d (solo); they share only already-merged code. Flagged for the orchestrator's staffing
call (§11.1).

**TDD anchors for Sonnet** (stage-2 red tests with known answers — free oracles):

- Rng golden vectors; `rngFor` independence across k; shuffle permutation property.
- Testkit: each planted mutant (incl. the three solo mutants) fails exactly its property.
- Minimax on classic-ttt: never loses; finds the win in a two-in-a-row position.
- MCTS on classic-ttt: mcts1k ≥90% vs random over a seeded batch.
- 2P solver on classic-ttt: **5,478 reachable states, value = draw** (published numbers);
  tiny hand-built cyclic fixture converges where plain minimax would loop.
- `dfsSolver` on mini-crackstep: known board → known L*; planted unsolvable board → `unsolvable`;
  tiny budget → `budget-exhausted` (and certify rejects it).
- `certify` on mini-crackstep: 5 days → 5 valid certificate JSONs, `verifyCertificate` green;
  nonce increments past a planted-bad candidate.
- Solo suite on bank-run: Strong/Random ratio reproducible under fixed seeds; the
  farming-loop build flag trips the Grind probe; a variant where `safeMove` is optimal trips
  the Always-Safe ≥95% gate.
- Tier ordering on classic-ttt: ruthless ≥ standard ≥ casual at CI budget.
- Harness runner (both models): fixed seed ⇒ byte-identical JSON report.

---

## 10. Versioning and the interface-freeze policy

**v1 does not freeze until four deliberately diverse games exist:** perfect-info sequential
(Fadeout), hidden-info (Fog Pools class), simultaneous+stochastic (Bid-Tac-Toe/Duel Draft
class), and **a solo game (Crackstep or Mine Run — now launch-slated, so this leg lands
naturally in Phase 1)**. The solo deltas landing in M1 is what makes the fourth leg cost ~0.5
day instead of a versioned migration at game 10.

Until freeze: `@twist-arcade/engine` at 0.x semver; every replay and certificate stores
`engineVersion` + `gameVersion`; breaking contract changes require an ADR, a same-PR migration
of every existing game and template, and a version bump. The Rng derivation and `encode`
canonical-form rules are **frozen from M1** (wire formats, §3.4) — ADR-only even now. The
freeze (1.0.0) is an ADR the orchestrator files after the four diversity legs ship with no
contract-change pressure outstanding.

Note: rev 1 left "does `V` carry effects" as a freeze-blocking question; **decided 2026-08-02**
(orchestrator decision 4) — `V extends WithEffects`, redacted through the single `playerView`
path. It is in the contract now and no longer blocks anything.

---

## 11. Open questions for the orchestrator

Rev 1's five questions are all resolved (solo lens binding · early M1 merge confirmed · vitest
confirmed · V-carries-effects decided into the contract · naming settled: Twist Arcade /
Fadeout / `@twist-arcade`). Remaining, none blocking M1:

1. **Staffing:** M3b (2P harness) and M3c/M3d (solo harness) are independent after M2 — run two
   Sonnet lanes in parallel, or accept ~4 extra serial days?
2. **Certificate storage migration:** committed JSON under `data/certificates/` is right for
   Phase 0 (no server); confirm the Phase 2 backlog item to move the buffer to Postgres when
   Supabase becomes load-bearing (schema is designed to survive the move unchanged).
3. **Hint/ghost surfacing:** the Strong beam policy is built as product code per the lens; when
   the shell team ships hint/ghost UI is their scope — nothing here blocks or requires it.

## 12. Risks

| Risk | Mitigation in this plan |
|---|---|
| Contract merges early, then churns under five consuming teams | game-spec is types-only and platform-owned; changes route through orchestrator (CLAUDE §4); §10 ADR + same-PR-migration rule makes churn expensive and visible |
| Testkit gives false confidence | mutant self-tests, now incl. solo mutants (§4) — the kit must catch planted bugs before any game trusts it |
| Rng/encode treated as refactorable internals | golden vectors + frozen-from-M1 rule; certificates add a second consumer that breaks loudly |
| Effects sneak back into `encode` and silently break repetition detection in decay games | explicit standing warning + canonical-form property (§3.2, orchestrator-approved) |
| Deadline budgets used where determinism is required (daily comparability dies) | `SearchBudget` union + runtime assertions; consequence documented for the daily team (§5.2) |
| Mirror / safeMove probes silently skipped | mirror: warn + CI-required for `symmetric` tags; **safeMove: hard-error for every score-chase** — the suite cannot run without it (§6, §7.4) |
| Grind probe misses long/conditional farming loops | stated as a tripwire, not a proof; the real defense is the mandatory structural-termination device + run-length/cap gates (§7.4, §7.5) |
| Certificate generator rejection-rate blowup (band/generator mismatch) | warn > 50%, hard fail > 90% per the lens; rejection stats in every certify report so drift is visible early |
| Solver budget stress on heavier puzzle games (the Fade Deal problem) | not a launch problem (Crackstep = pruned DFS); `best-in-budget` parKind is the designed relief valve; budget-exhaustion = rejection, never an uncertified ship |
| Solo scope creep re-serializes the critical path | solo engine deltas capped inside M1 (~0.5 d); all heavier solo work isolated in M3c/M3d off the shell/fadeout/daily path; the roadmap's cut order (Mine Run first, then Crackstep) remains available without touching M1–M3b |
| Over-engineering creep (applyInPlace, decoupled UCT, ISMCTS, realtime flag, plop) | each explicitly deferred with a written trigger; Sonnet instructed not to build them |

## 13. Definition of done (observable)

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` green at root; lint **fails** a
      planted `Math.random`/`Date.now` in `packages/engine` or `games/*`.
- [ ] `engineContract` green on all three fixtures (classic-ttt, mini-crackstep, bank-run);
      every mutant fixture — including the solo mutants (emits `draw`; `score` ≠ terminal
      scores; 2P emitting `lost`) — fails its targeted property.
- [ ] Rng golden vectors green; `replay()` reproduces recorded games byte-identically for both
      a 2P and a solo fixture (generated content included).
- [ ] Redaction test walks `lastEffects` in views: a planted secret-leaking effect on a fog
      fixture variant is caught.
- [ ] Bots anchors green (§9), incl. minimax-never-loses-TTT, mcts1k ≥90% vs random, and beam
      Strong beating random on bank-run by the reproducible fixed-seed margin.
- [ ] Worker host round-trips `BotRequest → BotResponse` twice with a `rollouts` budget →
      identical move; a `deadlineMs` budget where determinism is asserted → typed refusal.
- [ ] `pnpm harness solve classic-ttt-fixture`: 5,478 reachable states, value **draw**, under a
      minute; cyclic fixture converges.
- [ ] `pnpm harness certify mini-crackstep --days 5`: 5 certificate JSONs with par + features;
      planted unsolvable/budget-exhausted candidates rejected with nonce advance;
      `verifyCertificate` CI job green; buffer alert fires when the buffer is trimmed below 30.
- [ ] `pnpm harness suite <fixture> --suite ci|solo-ci` runs the right gate table per player
      count, exits non-zero on a sabotaged threshold, emits JSON + table; fixed seed ⇒
      identical output. Grind probe finds bank-run's planted loop; Always-Safe gate trips on
      the safe-is-optimal variant; a chase fixture without `safeMove` hard-errors.
- [ ] `--suite design` and `--suite solo-design` print every design-gate band from their
      respective tables (mirror row warns on a missing hook rather than passing silently).
- [ ] CI workflow runs the §7.5 order on PR; nightly runs the sweep + calibration drift +
      certificate re-verify + buffer check.
- [ ] `pnpm new-game demo` and `pnpm new-game demo-solo --solo puzzle` both produce compiling
      trees whose contract suite fails **only** on the TODO engine, under 60 s each; deletion
      restores a clean tree.
- [ ] No package imports react except `game-spec` (type-only) and `app/`; `packages/engine` has
      zero runtime dependencies (CI dependency check).
- [ ] `docs/worktrees.md` handoff notes updated: M1 → shell + fadeout + solo game teams; M2 →
      daily (pinned bot) + shell (worker); M3a → fadeout solve; M3c → Mine Run; M3d → Crackstep
      + daily (certificates).

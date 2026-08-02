# Crackstep — Implementation Plan (Fable, 2026-08-02)

*Team: `crackstep` (worktree `../claude-project-crackstep`, branch `feature/crackstep`).
Supabase: **not started** — client-only feature plus build-time certificate artifacts; record
as such in `docs/worktrees.md`.*

*Sources: `research/games/solo-games-lens.md` §1.1/§1.8/§2/§3/§4/§6/§7#1/§8 (binding),
`plans/phase-0-platform-spine.md` §3/§5/§7.6/§7.7/§9, `plans/fadeout.md` (structure template +
the solve-before-UI lesson + the encode-vs-position-key seam), `research/games/ux-lens.md`
§1/§2/§5/§7/§10, `roadmap.md` §6 (both gate tables). This plan produces no implementation
code; it is the input to CLAUDE.md §2 stages 2–6.*

**The game.** Crumbling-floor path puzzle — the house decay mechanic in solo form. You walk a
tiled floor; every tile falls away the moment you step off it, so the route you take destroys
the routes you might have taken. **Deterministic daily puzzle**: one seed, one board, everyone
plays the same floor, compared on moves against a machine-certified par.

Rule sentence (canonical, 90 chars exactly — verified; reworded per §13 #1 so it is
literally true of a two-material floor):
**"Wooden tiles crumble as you leave them — cross the whole floor without stranding yourself."**

**The sequencing rule inherited from Fadeout, adapted:** the solver and the 10k-seed
calibration run come **before** UI work. The calibration decides the shipping board-parameter
band (sizes, hole density, stone count, difficulty center); UI built against unfrozen board
parameters is a rebuild waiting to happen. Stage C3 does not start before the C2 parameter
freeze.

---

## 1. The ruleset — decided

Every choice below is final for v1 unless the calibration run (C2) falsifies a stated
assumption; the rejected alternatives are on the record so they are not re-litigated.

### 1.1 Board

- **Grid:** rectangular, width and height each in **5–6** (5×5, 5×6, 6×5, 6×6). Orthogonal
  adjacency (4-neighbor).
- **Holes:** 10–30% of cells removed at generation (never walkable, visually flat dark pits).
  All walkable tiles must be orthogonally connected (generator-enforced, pre-solver).
- **Walkable tiles: 16–34** after holes.
- **Tile types:** **wooden** (crumbling — the default; falls when you leave it) and
  **stone** (0–5 per board — never crumbles, crossable any number of times). The floor is
  a two-material floor and the rule sentence names the material, so stone is not an
  exception to the rule — it is the other half of it. "Crumbling tile" below always means
  a wooden tile; the engine's internal `"crumble"` id is unchanged. Generator constraint:
  **no two stone tiles orthogonally adjacent** (see §1.5 — this is the structural
  termination device, not a style choice).
- **Start:** one fixed, marked tile, chosen by the generator. **The start tile is always a
  crumbling tile** — so the very first move triggers the first crumble and the first-occurrence
  callout fires within ~5 seconds of play. Teaching by construction.
- **No goal tile.** The goal is the floor itself: the run ends wherever the last tile is.

**Why 6×6 is the hard cap (not 7×7):** the shell's tap-target floor is 48 px cells at a
320 px viewport (ux-lens §7, shell-enforced). Board width = 320 − 32 gutters = 288 px;
288/7 ≈ 41 px — below the floor. 288/6 = 48 px exactly. 7×7 is excluded by arithmetic, and
the L* band (§4) is comfortably reachable inside 6×6.

### 1.2 Movement and crumbling

- **Move:** step to an orthogonally adjacent tile that exists and has not crumbled. That is
  the entire move set — no diagonals, no sliding, no jumps, no pass.
- **Crumble timing: a crumbling tile falls at the instant you leave it** — including the
  start tile on move 1. Not on a timer, not after N visits, not behind-by-one. While you
  stand on a crumbling tile it is intact; the moment you step off, it is gone.
- **Crumbled tiles are visible as gaps with rubble** — the board silhouette persists, and the
  rubble is distinct from never-was-floor holes, so your entire route stays readable as a
  trail. This is deliberate post-mortem legibility: when you strand yourself, the board shows
  you exactly the path that did it.
- **Win (`won`, winner 0):** every walkable tile (stone included) has been visited at least
  once. The tile underfoot never crumbles (you never leave it), so the run ends standing on
  the last tile.
- **Lost (`lost`):** no legal move exists and the win condition is unmet — stranded. The
  engine emits `lost` immediately (contract "no hidden pass" rule); it never hangs.
- **The engine does not detect doomed-but-mobile states.** If the puzzle has become
  unsolvable but moves remain, status stays `ongoing` — the player plays on or restarts.
  Detecting doom in-engine would require the solver (expensive, and it would spoil the
  realize-you're-stranded learning moment that is the game's core lesson). Doom detection is
  offline share-artifact work only (§9).

### 1.3 Design reasoning per choice, against the solo-lens criteria

| Choice | Reasoning | Alternatives rejected, and why |
|---|---|---|
| Crumble **on leave** | Instantaneous cause-effect: the player watches each step delete the tile behind them — the twist is on screen from move 1, zero memory load, one clause in the sentence | **Timer decay** (tile falls k moves after first touch): taxes working memory across the whole board, needs per-tile countdown badges everywhere (visual noise), and the sentence gains a number. **Crumble after 2 visits everywhere** ("cracked ice"): every tile forgiving twice makes stranding rare and late — random-playout solve rate would threaten the >30% triviality gate, and dead-end density falls out of the punishing-but-fair band |
| **Full-coverage objective** (visit every tile) | This is what makes crumbling *bind*. A reach-the-exit objective never needs to revisit, so crumbling never constrains a shortest path — that game is a maze wearing a costume (see §2). Coverage + crumble-on-leave = a Hamiltonian-path-with-reusable-vertices problem: NP-hard family, honestly hard at small sizes, trivially exact-solvable at ours (solo-lens §1.1, §7#1) | **Reach-the-exit**: crumbling irrelevant on any shortest path — fails the "twist must change the decision problem" bar outright. **Collect-gems-then-exit**: real decisions, but adds a second object vocabulary (gems + exit) and a second sentence clause; coverage gets the same routing problem with zero new objects |
| **Stone tiles** (a few, generator-placed) | Three jobs: (1) they make solution lengths *vary* — without them every solution is exactly walkable−1 moves and "solved in 23, par 19" is impossible, collapsing the entire par/share design; (2) they are the recoverable-mistake device — a suboptimal ordering costs stone re-crossings (a visible move tax) instead of instant death; (3) they are the generator's structural dial (corridors, bridges, rooms) | **No stone tiles**: par degenerates to a fixed constant per board; every result is "par or fail"; 🟨-detour encoding meaningless. **Stone as limited-use (2-visit cracked tiles)**: adds per-tile counting the player must track; stone's binary "this one never falls" reads instantly and needs no badge |
| **Fixed start** | Legible (the marked tile is where you begin), teachable, and gives the generator its strongest difficulty dial; solvability-from-a-fixed-start is also the tighter, easier-to-band condition for the certificate | **Choose-your-start**: a real extra decision, but it makes most boards easier (solvable from *any* good start), muddies the first-tap UX ("why did nothing happen"), and forces the solver to minimize over all starts |
| **Free end** (no goal tile) | "Cross the whole floor" self-defines completion; free end maximizes solution variety (lower forced-move fraction) and keeps the object vocabulary at two tile types | **Fixed exit tile**: narrows the solution set (raises forced-move fraction toward the >85% reject line), adds a third marked object, and the sentence would need it |
| **Orthogonal movement** | Matches every player's grid-walking prior; branching factor ≤4 keeps positions readable at a glance | **Diagonals**: branching 8 makes imminent-stranding illegible; **ice-slide movement**: a different (also good) game — out of scope, and the rule sentence dies |

**The sentence-accuracy question is resolved (orchestrator ruling, §13 #1).** An earlier
draft used *"Every tile crumbles as you leave it…"* — 95% true, with stone tiles as a silent
exception, and the first stone tile a player stepped off would do *nothing*, the hardest
event to interpret ("the game is broken", not "stone exists"). The shipped sentence is 100%
true: the floor is two materials, wooden tiles crumble, stone does not, and stone's first
survival is a teachable moment with its own callout (§13 #1–#2). The general principle now
on the record for the whole library: **a rule sentence that is 95% true is worse than a
longer sentence that is 100% true** — the ≤90-char constitution constrains length, never
accuracy. (The original framing — "same class of trade as Fadeout's sentence omitting
superko" — was rejected: superko is an edge-case procedural rule a player may never hit;
stone is on the board and in the player's path from move 1, and a silent mismatch there is
not a footnote — it is the ux-lens §1 bug-feeling. Naming the material fixes it at zero
extra rule load.)

### 1.4 Restated as mechanics (the spec Sonnet implements)

1. `setup(1, rng)` generates board layout (§3.1) and places the player on the start tile,
   which is marked visited.
2. A move to tile `t` is legal iff `t` is orthogonally adjacent to `pos`, is not a hole, and
   has not crumbled.
3. Applying a move: if the tile at `pos` is crumbling, mark it crumbled. Set `pos = t`; mark
   `t` visited. (Stone tiles are never marked crumbled; re-entering visited stone is legal.)
4. `won` iff every non-hole tile is visited. `lost` iff not won and no legal moves. Else
   `ongoing`.

### 1.5 Termination is structural (and why stone non-adjacency is load-bearing)

Because no two stone tiles are adjacent, every move either departs a crumbling tile
(permanently consuming it) or arrives on one from stone (and the *next* move consumes it).
Any run is therefore bounded by **2·|crumbling| + 1 ≤ 69 moves** — far under the contract's
200-ply cap. Without the non-adjacency rule, two adjacent stone tiles would permit an
infinite ping-pong walk, random playouts would hit the cap, and the contract termination
property would fail. The bound gets its own engine test (§6.5). A second structural fact
falls out of the same argument: **every move strictly grows `visited` or `crumbled`, so no
position ever repeats** — the game graph is acyclic, and Crackstep needs no superko or
repetition machinery of any kind.

---

## 2. Why the twist creates a real decision

**The failure mode to beat:** a path puzzle where crumbling is irrelevant is a maze. In a
reach-the-exit game, a shortest path never revisits a tile, so crumble-on-leave constrains
nothing — the twist would be pure decoration. The coverage objective is what arms it.

**What the player is actually choosing: the order of consumption.** Formally, each move
deletes a vertex from the graph the player must still cover — the route taken destroys the
routes not taken. Concretely, the board reads as crumbling "rooms" connected by stone
bridges and narrow necks, and the player chooses, at every junction of ≥3 intact neighbors
and at every stone tile:

- **which region to sweep first** (a region entered too early may need its bridge again
  later — but the bridge's crumbling approach tiles will be gone);
- **which entrance to enter it by** (a room entered by the wrong door splits into two
  sub-regions of which only one can be swept before the connecting tiles fall);
- **which sweep direction** (a serpentine sweep ending at the far exit vs. one ending in the
  room's own dead-end corner — one of these must be the run's final tile, and there is only
  one final tile per run).

**Wrong choices are recoverable early:** with most of the floor intact, a suboptimal
ordering costs extra stone re-crossings — a visible move tax the HUD tallies against par
(🟨 in the share artifact), not death. The stone network is the escape hatch, and it is
priced: every recovery is +1 move over par.

**Wrong choices become unrecoverable late, and the player can watch it happen:** as
crumbling tiles vanish, the intact graph thins toward a tree; fewer coverage orderings
remain feasible; a degree-1 crumbling tile ("a dead-end pocket") must be either swept now or
reserved as the run's single final tile — and there can be only one such reservation. The
moment two dead-end pockets exist and neither is where you'll finish, the run is dead —
usually several moves before the board physically strands you. That gap between the fatal
choice and the visible stranding is the puzzle's signature feeling, and it is exactly what
the 🟥 marker in the share artifact names (§9).

The skill expressed is planning depth: reading the room structure, counting dead-ends,
reserving the final tile, and sequencing regions — none of which random play does. Random
playouts on band seeds strand at high rates (the triviality and dead-end-density gates in §4
verify both directions: not too random-solvable, not mistake-proof).

---

## 3. The generator and the certificate pipeline (the heart of the plan)

### 3.1 The generator

All randomness from the seed's `Rng`. Per candidate:

1. Sample dimensions (w, h ∈ {5,6}), hole count (10–30% of cells), hole placement —
   re-draw until the walkable set is orthogonally connected.
2. Sample stone count (0–5) and placement, rejecting adjacency between stone tiles.
3. Sample the start tile from the crumbling tiles.
4. **Cheap pre-solver rejections (free, before any search):**
   - disconnected walkable set (re-drawn at step 1);
   - **parity check, 0-stone boards only:** a coverage path alternates checkerboard colors,
     so if the color-class sizes differ by ≥2 the board is unsolvable — reject without
     search. (Stone tiles break the parity argument — revisits change color freely — so the
     check applies only when stone count is 0.)
   - **dead-end count:** ≥2 crumbling tiles of walkable-degree 1, neither of which is the
     start → at most one can be the run's final tile → unsolvable if both are non-start
     degree-1 crumbling tiles and there are more such tiles than one; reject when the count
     of non-start degree-1 crumbling tiles exceeds 1.
5. Hand the board to the exact solver (§3.2); apply the acceptance rules (§3.3).

**Fallback, pre-approved but not built at launch:** if calibration shows the rejection rate
running hot (>50% warn zone), switch to constructive generation — seed the board from a
random coverage walk (backbite-style Hamiltonian path generation), then convert sampled path
cells to stone — which guarantees solvability by construction and confines rejection to the
difficulty band. The trigger is a measured rejection rate, never a hunch.

### 3.2 The exact solver (`games/crackstep/solver.ts`)

Implements the platform's `SoloSolver` interface (game-spec §7.6), composing the harness's
`idaStarSolver(h)` building block (M3d) with Crackstep's heuristic and prunes:

- **Search:** IDA* over engine states, deduplicated on `encode(S)` — which is a sound
  position key for Crackstep (§6.4).
- **Admissible heuristic:** `h = number of unvisited tiles`. Each move visits at most one
  new tile, so h never overestimates; it is also *tight* — the gap between h and true cost
  is exactly the run's stone-detour overhead, which is small (0–15) on band seeds. IDA*
  therefore converges in very few threshold iterations, and the first solution found at the
  converged threshold is provably optimal: **L\*** is exact.
- **Prunes (applied at every node):**
  1. **Reachability:** flood-fill from `pos` over intact tiles; any unvisited tile
     unreachable → cut.
  2. **Dead-end reservation:** count unvisited crumbling tiles whose intact-degree ≤1;
     if ≥2 (at most one can be the final tile) → cut.
  3. Dedup on `encode(S)` within the current threshold.
- **Budget:** platform default — 10⁷ nodes / 10 s per seed. Budget exhaustion is treated as
  unsolvable → **reject the seed, never ship it**. There is no best-in-budget relief valve
  for Crackstep: because the solver is cheap at our sizes, **`parKind` is always
  `"optimal"`** — a deliberate, stronger promise than the platform minimum (see §4 for what
  this buys the player).

**Verifying the lens's "trivial solver" claim** (it is true, for four compounding reasons):
(1) instances are ≤34 tiles with L* ≤ ~45; (2) the admissible heuristic is tight, so IDA*
runs few iterations; (3) monotone consumption makes the state graph acyclic and the dedup
effective; (4) the reachability and dead-end prunes kill doomed branches within one node of
the fatal move — the same structure that makes the game legible to humans makes it easy for
the machine. Expected solve time: milliseconds per seed; the 10⁷/10 s budget is orders of
magnitude of headroom, and the calibration run (§4) will confirm empirically.

**Feature extraction (free by-products of the solve, per certificate schema):**
`forcedMoveFraction` (fraction of positions along the optimal log with exactly one legal
move), `branchingMean` (mean legal-move count along the optimal log), `deadEndDensity`
(fraction of 1,000 random playouts from the start that terminate `lost` — the cheap proxy
for "how punishing mistakes are"; also yields the random-playout solve rate = won fraction),
`greedyGap` (greedy agent's solve length − L*, or null when greedy strands — greedy = 1-ply
on the engine heuristic, §6.3), `zScore` (vs. the 10k-seed calibration distribution).

### 3.3 The certify loop and rejection rules

`pnpm harness certify crackstep --days 90` runs the platform §7.7 loop verbatim — offline,
at build time, never at request time:

```
for each day D in the horizon:
  for nonce n = 0, 1, 2, ...:
    seed  = dailyFormula("crackstep", engineVersion, D) + ":" + n
    board = engine.setup(1, rngFromSeed(seed))
    (generator pre-rejections may already have consumed nonces — each is a rejection)
    r = solver.solve(engine, board, { maxNodes: 1e7, maxMs: 10_000 })
    REJECT if:
      r.outcome === "unsolvable"
      r.outcome === "budget-exhausted"        // treated as unsolvable — NEVER ship uncertified
      random-playout solve rate > 30%          // trivial
      L* < 8                                   // trivial (CI floor; design floor is 12)
      forcedMoveFraction > 85%                 // plays itself
      |zScore| > 0.5σ from the difficulty center, or drift from day D−1 > 0.5σ
    else: store data/certificates/crackstep/D.json ; break
```

**`DailyCertificate` contents (schema is the platform's, values are Crackstep's):**
`gameId: "crackstep"` · `gameVersion` · `engineVersion` (pinned — a bump invalidates the
buffer) · `day` · `seed` (formula + nonce) · `nonce` (rejection count — the drift telemetry) ·
`moveLog` (the optimal solution, replayable) · `par` = L* · `parKind: "optimal"` (always) ·
`solverNodes` · `features` as in §3.2. `guessFree` omitted — Crackstep is perfect-information
(`hiddenInformation: false`); the fog clause does not apply.

**Buffer policy (platform §7.7, adopted verbatim):** 90 certified days generated at build
time; nightly CI re-verifies **every** stored certificate via `verifyCertificate` (replays
`moveLog` through the engine, asserts `won` and length == par); alert below 30 days of
buffer, hard fail below 7.

### 3.4 What a missing or wrong certificate costs — stated plainly

The daily is the one surface with site-wide blast radius. An unsolvable daily, or one whose
par is wrong, ruins the day **for every player simultaneously**: everyone plays the same
seed, most within the same hours, and by the time the defect is noticed thousands of results
exist against the bad board. It cannot be quietly patched — swapping the board mid-day
splits the player base into two incomparable cohorts and turns the share artifact into
gibberish, and an understated par (impossible if `parKind` is honest, but possible via a
solver bug) makes every honest player's result read as failure. This is why: certificates
are generated offline in batch, CI *re-verifies* rather than trusts them, the buffer makes
outages a build-time problem instead of a 6 a.m. incident, and budget exhaustion is a
rejection — never a shrug. A corollary invariant worth wiring as an alert: since par is
provably optimal, **no verified replay may ever come in under par** — if one does, the
solver or the engine is wrong; stop the line and find out which (the Fadeout oracle rule,
solo edition).

---

## 4. Difficulty calibration and what par means

**Calibration:** `pnpm harness calibrate crackstep --seeds 10000` (nightly-tier, once at
game-land plus drift checks) computes the feature distribution over 10k generated-and-solved
seeds. Every candidate daily is z-scored against it. Dailies are drawn from **±0.5σ around
the chosen difficulty center**, with day-over-day drift ≤0.5σ (CI fails >1.5σ) — consistency
is what makes "par 19, I took 23" feel like a fair fight rather than weather.

**Automatic difficulty measures**, in predictive order (solo-lens §3.4): solver nodes
expanded (search effort ≈ human effort — the primary component), L*, forced-move fraction,
mean branching, dead-end density, greedy gap. The composite z-score weights are chosen after
the calibration run, not now — proposing weights before seeing the distribution would be
vibes.

**Proposed bands (validated or revised by calibration — these are C2-freeze inputs, not
guesses to ship blind):**
- L*: CI 8–80 (platform), design target **18–38** (a 1–4 minute solve, inside the lens's
  12–50 design band).
- Forced-move fraction: CI ≤85%, design 30–70%. This is also the lens's shortlist warning
  for Crackstep operationalized: a board with <2 genuine decisions' worth of choices shows
  up as forced-move fraction near 1 and near-zero branching — both gated.
- Random-playout solve rate: CI ≤30%, design 1–15%.
- Dead-end density: design band **20–60%** of random playouts strand — "punishing but fair";
  no CI row (it feeds the z-score).
- Greedy gap: reported per seed; design-review flag if greedy solves ≥50% of band seeds at
  par (the obvious strategy would be the whole game — the puzzle analogue of the
  Greedy-Only probe, §5).

**Weekly ramp: not at launch.** Flat difficulty until the solver-effort→human-effort mapping
is validated against real completion rates (solo-lens §3.4 mandate). The Mon-easy→Sat-hard
ramp is a Phase-3 nicety with a written trigger, not a launch feature.

**What par means to the player:** "the fewest moves possible on today's floor —
machine-proven." Because `parKind` is always `"optimal"`, the UI may say **"Best possible:
19"** without hedging, matching par is a genuine perfect game (🎯), and beating par is
impossible rather than a labeled achievement — Crackstep deliberately takes the stronger of
the two par postures the platform supports, because its solver can afford it.

---

## 5. The solo validation gates — exact applicability ruling

The solo-lens §3.8 table is sectioned **Score chase / Daily puzzle / Both**. Crackstep's
manifest declares `solo: { format: "daily-puzzle" }`, and the ruling per row follows. This
section exists so CI is never ambiguous.

**Apply as written (daily-puzzle + both sections):**

| Gate | CI hard fail | Status |
|---|---|---|
| Solvability certificate, every shipped seed | missing / fails CI replay | applies verbatim |
| L* | outside 8–80 | applies (design 18–38, §4) |
| Random-playout solve rate | > 30% | applies verbatim |
| Forced-move fraction on optimal path | > 85% | applies verbatim |
| Generator rejection rate | > 90% (warn > 50%) | applies verbatim |
| Day-over-day difficulty drift | > 1.5σ | applies verbatim |
| Certified-seed buffer | < 7 days (alert < 30) | applies verbatim |
| Engine contract suite incl. solo branch | any failure | applies verbatim |
| Rule sentence ≤90 chars | > 90 | applies (90 exactly — at the cap, count verified) |
| Bundle ≤75 kB gz / no critical axe violation | per roadmap §6 | applies verbatim |

**Inapplicable — score-chase rows, skipped for `format: "daily-puzzle"`, and the CI report
must print them as "N/A (daily-puzzle)", never silently omit them:**

- **Strong/Random median score ratio, distribution overlap, Greedy/Random, Strong/Greedy,
  score CV across seeds, ceiling pile-up** — Crackstep has no `score()` (puzzles omit it,
  platform §3) and no score distributions exist. The concern these rows guard (skill
  expression) is carried on the puzzle side by the certificate + triviality gates: the
  random-playout solve-rate ceiling **is** the puzzle's slot-machine test (solo-lens §3.1
  names Random as "triviality probe for puzzles").
- **Always-Safe probe** — guards risk mechanics in chases; Crackstep has no bank/push
  decision. Consistently, the `safeMove` hook is **required only for `score-chase`**
  manifests (platform §6) — Crackstep ships no `probes.ts` safeMove, and that is compliant,
  not an omission.
- **Grind probe** — guards unbounded zero-risk farming; Crackstep has no score to farm and
  termination is structural (§1.5, bound ≤ 2|C|+1). The probe's underlying concern is
  discharged by the contract termination property, which the bound satisfies with a proof
  rather than a tripwire.
- **Median run length 15–600 / cap hits >1%** — score-chase rows; the puzzle analogue is the
  L* band, which applies. (Every Crackstep run is ≤69 moves regardless.)
- **Suicide probe** — misère-tagged games only; not tagged.
- **Fog deduction-only clause** — `hiddenInformation: false`; no fog.

**Puzzle-specific analogues added at the design gate (non-CI, Fable-review):**
- **Strong-vs-Random solve-rate separation:** on 200 band seeds, Strong (beam-100 over the
  §6.3 heuristic, 200 ms/move) solves ≥80% while Random solves ≤15% — the puzzle restatement
  of "skill is distribution separation". Runs under `--suite solo-design` once M2+M3c land.
- **Greedy-gap review** (§4) — the dominant-strategy analogue.
- **Thin human check** (solo-lens §3.9): 5 playtests, sentence read aloud; pass = a new
  player makes a twist-aware play (reserving a dead-end pocket for last, or deliberately
  keeping a stone bridge usable) within their first two runs, unprompted; ≥3 of 5 finish
  (restarts allowed); nobody finishes on autopilot.

**One wiring note for the platform team (§12 Q1):** the phase-0 plan §7.5 says the `--suite
ci` runner auto-selects the gate table "by `players.max`" — but Crackstep and Mine Run are
both `maxPlayers: 1` with *different* formats. The runner must additionally section by
`manifest.solo.format`, per the lens table's own sectioning. Flagged so the daily-puzzle
rows and only those rows gate Crackstep.

---

## 6. The engine (`games/crackstep/engine.ts`) — against the platform contract

Built against `@twist-arcade/engine` (M1), TDD, `engineContract()` green with the solo
branch auto-activated.

### 6.1 State and move shapes

```
CrackstepState = {
  width: number; height: number;
  tiles: ("crumble" | "stone" | "hole")[];   // row-major; static after setup
  crumbled: boolean[];                        // per-cell; only ever true for "crumble" cells
  visited: boolean[];                         // per-cell; start is visited from setup
  pos: number;                                // current cell index
  lastEffects: readonly Effect[];             // WithEffects — fully overwritten every apply
}
Move M = number                                // target cell index (JSON-plain)
```

- **No move counter in state.** The move count is derivable as `steps.length` from the
  `ReplayRecord`; the shell counts moves itself for the HUD. Keeping a counter out of the
  state is what makes `encode` a sound position key (§6.4) — do not "helpfully" add one.
- `meta`: `{ id: "crackstep", minPlayers: 1, maxPlayers: 1, hiddenInformation: false,
  simultaneous: false, stochastic: false, version: 1 }`. `stochastic: false` is correct
  despite the generated board: the flag means chance events *after* setup (platform §5.2),
  and Crackstep has none — all randomness is consumed in `setup`.
- Perfect information ⇒ `playerView` = identity, `V = S`. `active` returns
  `{ mode: "sequential", player: 0 }` while ongoing. `score()` omitted (puzzle). No
  `sampleConsistentState`.
- Manifest solo block: `solo: { format: "daily-puzzle" }` — no `moveCap` (structural bound
  §1.5 beats the default), no `scoreMonotone`, no `comparisonMetric`.

### 6.2 `apply` — movement and crumbling to quiescence in one transition

Validate (`isLegal`): target adjacent, not hole, not crumbled. Then, in one pure transition:
mark `tiles[pos] === "crumble"` ⇒ `crumbled[pos] = true`; set `pos = target`; set
`visited[target] = true`; overwrite `lastEffects`:

- `{ type: "moved", from, to }` — always, first.
- `{ type: "crumbled", cell }` — when the departed tile fell, second.

Array order **is** the animation spec (Fadeout §3.2 precedent): the step plays (150 ms),
then the tile falls behind the player (400 ms fade+drop to rubble). Both types are in the
platform's shared effect vocabulary — no custom types needed. There are no cascades; a
single step is already quiescent, but the rule "all automatic consequences inside the one
`apply`" is honored by construction. The rng parameter is unused after setup (no draws —
determinism trivially holds).

`status`: `won` iff every non-hole cell is visited; else `lost` iff `legalMoves` is empty;
else `ongoing`. Solo status discipline (never `draw`, winner always 0) — testkit-asserted.

### 6.3 `heuristic(state, 0)` — ~20 lines, three consumers

`-(count of unvisited tiles) - 100 × (count of unvisited tiles unreachable by flood-fill
from pos over intact tiles)`. Consumers: the Greedy probe (1-ply — becomes the greedy-gap
feature), the Strong beam agent (M2 — which later ships as the **hint feature**, so this
heuristic is product code), and the design-gate solve-rate separation (§5).

### 6.4 `encode` canonicality — and the answer to the Fadeout seam question

`encode(state)` = `stableStringify({ width, height, tiles, crumbled, visited, pos })` —
**excluding `lastEffects`** (platform §3.2, the standing orchestrator warning applies
verbatim). `decode(encode(s))` roundtrips with `lastEffects: []`.

**Is Crackstep history-dependent the way Fadeout is under superko? No — and this is a
deliberate design property, verified here per the flagged question.** Every field in the
encoding is rule-relevant: legality depends on `(tiles, crumbled, pos)` and the win
condition on `visited` — nothing in the state records *how* the position was reached, and
there is no repetition rule to make legality path-dependent (none is needed: positions
cannot repeat, §1.5). Therefore **`encode` is a sound canonical position key**, the generic
`dfsSolver`/`idaStarSolver` dedup hashing on `encode(S)` works on Crackstep directly, and
none of Fadeout's game-local `positionKey` machinery is required. Unit test pinning it: two
different move orders through a stone junction that reach the same
`(crumbled, visited, pos)` triple must produce byte-identical encodings.

### 6.5 Engine TDD anchors (stage-2 red tests with known answers)

- Contract suite green: purity (deep-frozen inputs), determinism-through-generation (same
  seed ⇒ identical board twice), encode∘decode modulo effects, isLegal ⟺ legalMoves,
  terminals `won | lost` only, never `draw`.
- Scripted 3×3 hand-board: full walkthrough with hand-computed `crumbled`/`visited`/effects
  at every step; win fires on the last visit; effect order `[moved, crumbled]`; effects
  never accumulate.
- First move crumbles the start tile (start is always crumbling).
- Stone: re-entry legal; leaving stone emits no `crumbled`; a stone cell never appears in
  `crumbled`.
- Crumbled re-entry illegal (`isLegal` false, absent from `legalMoves`).
- Stranding fixture: scripted sequence into a pocket → `legalMoves` empty → `lost`, never a
  hang.
- Termination bound: exhaustive random playouts on a max board never exceed 2|C|+1 moves.
- Position-key property: two move orders → same triple → identical `encode` (§6.4).
- Solver anchors: known 4×4 board with hand-verified L*; planted parity-unsolvable board →
  `unsolvable`; tiny budget → `budget-exhausted` (and certify rejects it, nonce advances);
  optimality spot-check — brute-force enumeration on a ≤12-tile board agrees with IDA*'s L*.
- Certify anchors: `--days 5` on the real game → 5 valid certificates, `verifyCertificate`
  green; deterministic — same formula inputs ⇒ byte-identical certificates.

---

## 7. Board UI and teaching layers (stage C3, after the C2 parameter freeze)

Built against the shell contract (ux-lens §10, platform §5.3): `Board` receives
`BoardProps<V, M>`; the shell owns chrome, rule card, status line, controls, result modal,
callout machinery, HUD; Crackstep owns board rendering, tile visuals, strings, hooks.
Cells: 6×6 at a 320 px viewport = 48 px — exactly the hard floor; 5×5 boards get 57 px,
above the 56 px small-board target. No board may exceed 6×6 (§1.1).

### 7.1 Tile-state legibility (the §2-of-ux-lens three classes)

Five visual states, encoded shape/texture-first so the grayscale-screenshot test passes:

| State | Value (grayscale) | Texture/shape | Meaning |
|---|---|---|---|
| Intact crumbling | mid, warm | plank/pane with faint fracture seams | walkable, one-shot |
| Stone | light | solid slab, chamfered corners + rivets | walkable, reusable |
| Current (underfoot) | mid + pawn | **crack pattern radiating under the pawn** + slight sag/drop-shadow | will fall when you leave |
| Crumbled | dark | **rubble remnant** | your trail — gone |
| Hole | darkest | flat pit, no rubble | never was floor |

Rubble-vs-pit distinctness is deliberate: the player's whole route stays readable after the
fact, which is what makes a stranding self-explaining (§7.5).

### 7.2 The imminent telegraph — never a single channel

The only "about to change" entity in Crackstep is deterministic and singular: **the tile
underfoot falls when you leave it**. Three redundant channels on the current tile:
(1) the radiating crack texture (pattern — survives grayscale), (2) a warm color shift
(hue — sacrificial), (3) a 2-px sag with deepened drop-shadow (position/value — survives
grayscale). No countdown badge exists because there is no countdown — the badge system's
*authoritative-channel* role is filled by the crack texture, which is unambiguous and
always-on. Grayscale test: the five §7.1 states occupy four value bands plus two textures;
a grayscale screenshot of any position is fully readable — this is a review gate.

**Legal-move affordance:** adjacent walkable tiles get the shell's standard legal-target
treatment; everything else is inert. With branching ≤4 the choice is visually enumerable at
a glance.

### 7.3 Just-changed and motion

The most recently crumbled tile plays a 400 ms fade+drop to rubble with a 💨 dust puff
(keyed off `lastEffects` `crumbled` — never off state diffs), then holds a dashed outline
ghost for exactly one move before settling to plain rubble. `prefers-reduced-motion`:
instant swap to rubble+ghost, no drop animation, no dust. Move animation: pawn steps in
150 ms ease-out. Win: the final tile gets the drawn-line celebration treatment
(300 ms); no confetti. All timings from the shared token set.

### 7.4 Teaching layers (Sentence → Telegraph → Aha-callout)

- **Sentence:** the canonical 90-char rule sentence on the shell rule card.
- **Telegraph:** §7.2 — and because the start tile is always crumbling (§1.1), the mechanic
  visibly operates on move 1.
- **Aha-callout (`firstOccurrence`):** trigger — the game's first `crumbled` effect on a
  device that hasn't seen one; anchor — the fallen cell; text — *"The tile crumbled behind
  you — every tile falls when you leave it."* Non-modal, dismisses on next move.
- **Stone teaching:** the platform `firstOccurrence` hook is singular. The stone lesson
  ("stone doesn't crumble — cross it as often as you like") is carried by the How-sheet and
  the accessible names; if the shell team generalizes the hook to an array, Crackstep
  registers a second callout on first stone re-entry (§12 Q3 — nice-to-have, not blocking).
- **How-sheet frames (3):** step off a tile → it falls (rubble + 💨) → the crossed floor
  with one stranded figure vs one completed sweep. Frame 3 carries the stone exception
  visually.
- **`announce()`:** composed per shell order (what happened → what's imminent → whose
  turn/state): *"Moved to row 2, column 3. The tile behind you crumbled. 9 tiles left."*
  Cell accessible names: position, type, state — *"row 2 column 3, stone, crossed"* /
  *"row 4 column 1, gone."* Status line shows tiles-remaining; the result is announced
  assertively once.

### 7.5 HUD, par display, and the `lost` presentation

- **HUD (shell `ScoreHUD` slot):** `Moves 12 · Par 19` — moves from the shell's step count
  (the engine deliberately carries no counter, §6.1), par from the day's certificate, which
  the shell hands to the game alongside the view (platform non-goals note: the platform
  ships `score()`/certificate data; the shell renders it). Practice/casual runs on the same
  board show the same par; par is never hidden — it is the point.
- **Win presentation:** "Crossed in 23 · best possible 19" (or "Perfect crossing — 19 🎯"
  at par). `parKind` is always optimal, so the copy never hedges.
- **`lost` presentation — must read as "you stranded yourself", a legible mistake, never a
  bug:** the result modal states the mechanism and the count — **"Stranded — 4 tiles out of
  reach."** Behind it, the board highlights the unvisited tiles and leaves the full rubble
  trail visible, so the player can trace exactly which step cut them off. Texture line
  templates (≤60 chars, from final state + counters): *"That last pocket needed a bridge
  you'd already dropped"* (unreached tiles adjacent to crumbled cells only) · *"One tile
  short — the floor beat you by a step"* (1 unvisited) · fallback: omit. Primary button:
  **Try again** (restart, counted). The word "lose" never appears; stranding is the game's
  vocabulary.

---

## 8. Undo and restart policy

Orchestrator decision, inherited as binding: **daily mode has no undo** — undo would make
par meaningless. **Casual/practice play gets unlimited undo** as a learning tool (ux-lens
§1: undo converts "the twist punished me" into "let me try that again").

- **Engine impact: none.** Undo is shell-owned replay truncation over the pure engine;
  restart is a fresh `setup` from the same seed. The engine knows nothing of either.
- **UI:** in daily mode the Undo control is **hidden, not greyed** (ux-lens rule). Restart
  is always available; the shell shows a quiet attempt counter ("Attempt 3") — restarts are
  legal, expected, and part of the story, not shameful.
- **Result record:** restarts are counted by the shell and carried in the daily result —
  proposed shape `{ gameId, day, moves, par, restarts, solved }`, where `moves` is the
  completing run's length and `restarts` the count of abandoned runs before it. The
  `ReplayRecord` itself has no restart field (each attempt is its own record) — the result
  record is a **daily-team artifact**, and the restart-count field is a small contract
  addition flagged to them (§12 Q2).
- **Submission semantics (recommendation, daily team owns the call):** the first *completed*
  run is the recorded result; later completions on the same day are practice and never
  overwrite. This matches the lens §5 posture (first accepted verified replay) and blunts
  retry-scumming without pretending to eliminate it.
- Casual mode (undo enabled) runs on the same board, marked unranked, and never submits.

---

## 9. The share artifact (solo-lens §6, daily-puzzle body)

Spoiler-free (never directions or positions — struggle shape only), comparable on the same
seed, par-relative in the header, ≤7 lines with the shell frame. Body: one emoji per move,
one row per attempt (restart boundaries are rows); >3 attempts collapse middle rows into a
`💥×n` summary line so the 7-line budget holds.

**Encoding, and how each mark is derived (offline, presentation-layer, no solver import —
the registry rule that `loadSolver` never reaches app routes is respected):**

- 🟩 — move that visited a new tile (from the replay alone).
- 🟨 — detour: a stone re-crossing, spending a move without visiting a new tile (replay
  alone). Detours are exactly the moves-over-par, so the row *visually reconciles* with the
  header arithmetic.
- 🟥 — the move after which the position became provably unsolvable, detected by the cheap
  **necessary-condition checker** (flood-fill reachability + the ≥2-dead-ends test — the
  solver's prunes §3.2, extracted as a tiny pure helper). The checker is sound (it never
  cries doom falsely) but incomplete (it may fire late); v1 accepts that a 🟥 can lag the
  true fatal move. Full solver-valued marking is a Phase-2 nicety, priced only if players
  ask.
- 💥 — stranded / attempt abandoned. ✅ — solved. 🎯 in the header at par.

**Literal examples:**

```
🧊 Crackstep #14 — solved in 23 (par 19)
🟩🟩🟩🟨🟩🟩🟩🟥💥
🟩🟩🟩🟩🟩🟨🟨🟩🟩🟩🟩🟩🟩🟩✅
1 restart · the floor crumbles behind you
twistarcade.game/d/crackstep
```

```
🧊 Crackstep #15 — perfect crossing, 19 (par 19) 🎯
🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩✅
no restarts · every tile, no wasted step
twistarcade.game/d/crackstep
```

```
🧊 Crackstep #16 — stranded, 5 tiles out of reach
💥×2
🟩🟩🟩🟩🟨🟩🟥🟩🟩💥
the floor crumbles behind you
twistarcade.game/d/crackstep
```

The hook is the pair of numbers (23 vs 19) plus the visible 🟥→💥 story — a red square in a
group chat is a question mark; the rule sentence in the link's OG description is the answer.
The stat line (≤40 chars) carries the twist text or the perfect-run flourish.

---

## 10. Sequencing, dependencies, and definition of done

### 10.1 Stages

| Stage | Work | Needs | Unblocks |
|---|---|---|---|
| **C0 — now** (no platform deps) | This plan · board-format + generator design note · solver prune specs · TDD anchor enumeration (§6.5) · UI spec on paper (§7) · share/texture templates · heuristic design | nothing | C1 |
| **C1 — engine** | Engine + `engineContract` green (solo branch) · manifest (`solo.format: "daily-puzzle"`) · heuristic · position-key test | **M1** (contract, testkit, game-spec incl. `SoloSolver`/`DailyCertificate` types) | C2 |
| **C2 — generator + solver + calibration freeze** | Generator with pre-rejections · `games/crackstep/solver.ts` composing `idaStarSolver` (M3d building blocks) · certify dry-runs · **10k-seed calibration → freeze board parameters + difficulty center (orchestrator reviews the calibration report)** · rejection-rate reading vs the 50%/90% gates | **M3d** (generic-solo solvers, `certify`, `calibrate`) + C1 | C3, C4, the 90-day buffer |
| **C3 — UI + teaching** | Board, tile visuals, telegraph, dust/ghost, callout, announce, How-sheet, HUD/par, lost presentation, share artifact + doom checker | parameter freeze (C2) + **shell team's `useGame`/`BoardShell`/`Cell` + certificate-to-shell plumbing** | playtest |
| **C4 — validation** | `--suite solo-ci` green (daily-puzzle rows) · `--suite solo-design` incl. Strong/Random solve-rate separation and greedy-gap review · `certify --days 90` + nightly re-verify wired | **M2** (Strong beam) + **M3c** (solo suite) + C2 | design-gate review |
| **C5 — gates + human check** | Both gate tables on the record · 5-person playtest per §5's thin human check | C3 + C4 | merge readiness |

C3 and C4 parallelize after C2. What can start **today**: all of C0, and C1's red tests
against the M1 fixture types the moment M1 merges. The Strong agent (M2) is wanted for C4
only — note it doubles as the shipped hint feature, so nothing in C4 is throwaway.

### 10.2 Definition of done (observable, against both gate tables)

- [ ] `engineContract(crackstep)` green incl. solo branch; every §6.5 anchor green; zero
      draws, zero cap hits, termination bound test green.
- [ ] Position-key property pinned: `encode` verified path-independent (§6.4); no move
      counter or history field in state.
- [ ] Calibration report reviewed; board parameters + difficulty center frozen by
      orchestrator; generator rejection rate < 50% (warn line) on the record.
- [ ] `pnpm harness certify crackstep --days 90`: 90 certificates stored, all
      `parKind: "optimal"`, `verifyCertificate` green in CI; buffer alert wired (<30) and
      hard fail (<7); planted unsolvable and budget-exhausted candidates rejected with
      nonce advance.
- [ ] `--suite solo-ci` green on every applicable row of §5's table; inapplicable rows
      printed as "N/A (daily-puzzle)"; `--suite solo-design` report reviewed: L* in 18–38,
      forced-move 30–70%, random solve 1–15%, dead-end density 20–60%, Strong ≥80% vs
      Random ≤15% solve rate, greedy-gap review recorded.
- [ ] Under-par-replay alarm wired: any verified replay < par fails loudly.
- [ ] Grayscale-screenshot test passes for all five tile states; cells ≥48 px at 320 px
      (board capped 6×6); reduced-motion parity; announce strings for every event; axe
      clean; route ≤75 kB gz.
- [ ] First-occurrence callout fires once per device on the first `crumbled`; How-sheet's
      3 frames land; `lost` modal reads "Stranded — N tiles out of reach" with the trail
      visible.
- [ ] Daily mode: no undo control rendered; restarts counted and carried in the result
      record; share artifact renders ≤7 lines with 🟩🟨🟥💥✅ encoding and reconciles
      (🟨 count = moves − par on solved runs).
- [ ] Five-person playtest: ≥3 of 5 finish; ≥1 twist-aware play within two runs,
      unprompted; nobody finishes on autopilot.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Par collapses to a constant (all solutions same length) | Stone tiles exist precisely to prevent this (§1.3); calibration asserts L* variance and greedy-gap spread across seeds — a degenerate distribution fails the C2 freeze review |
| Generator rejection rate blows up (band/generator mismatch) | Free pre-solver rejections (parity, dead-ends, connectivity) absorb most of it; 50%/90% gates per the lens; constructive backbite fallback pre-approved with a measured trigger (§3.1) |
| Solver "trivial" claim fails at 6×6 | Four structural reasons verified in §3.2 + a brute-force optimality oracle on small boards in TDD anchors; if calibration still shows budget pressure, shrink the band — never ship best-in-budget par (Crackstep's stronger posture) without an orchestrator decision |
| Random playouts don't terminate (contract failure) | Stone non-adjacency gives a proof, not a tripwire (§1.5); bound has its own test |
| A move counter or history sneaks into state/`encode` | §6.1/§6.4 standing warnings; position-key property test breaks the build if violated |
| Doomed-but-mobile states read as a bug ("it let me keep walking") | Deliberate (§1.2); the 🟥 share mark, rubble-trail legibility, and the stranded modal turn it into the game's signature lesson; playtest question explicitly probes it |
| Stone exception undermines the rule sentence | Visual distinctness + How-sheet frame + (if shell allows) second callout; orchestrator sign-off requested (Q5) |
| Solo-ci runner applies score-chase gates to Crackstep | §5's explicit N/A table + the format-sectioning note to the platform team (Q1) |
| 6×6 cells exactly at the 48 px floor feel cramped | 5×5/5×6 boards get 57/48+ px; if playtest flags 6×6, the fix is dropping 6×6 from the band (calibration re-run), not shrinking targets |
| Certificate/engine version drift orphans the buffer | `engineVersion` pinned per certificate (platform schema); nightly re-verify catches drift the day it happens, not the morning it ships |

---

## 12. Open questions for the orchestrator (none block C0–C1)

1. **Platform — gate-table sectioning:** confirm the solo-ci runner selects gate rows by
   `manifest.solo.format`, not just `players.max` (§5). Without it, Crackstep would be
   gated on score-chase rows that cannot run (no `score()`, no `safeMove`).
2. **Daily team — result record:** confirm the `{ moves, par, restarts, solved }` result
   shape and the first-completion-counts submission rule (§8). Small contract addition;
   route per CLAUDE.md §4.
3. **Shell team — `firstOccurrence` cardinality:** singular today; a second callout slot
   (first stone re-entry) is wanted but not blocking (§7.4).
4. **Shell team — casual/undo mode scope at launch:** practice-on-today's-board with undo,
   unranked (§8) — confirm it fits the shell's launch queue; Crackstep degrades gracefully
   to daily-only if not.
5. **Rule-sentence exception sign-off:** "every tile crumbles" vs. stone tiles (§1.3) —
   recommendation: accept, same class as Fadeout's sentence omitting superko.
   *(Resolved — see §13 #1: the recommendation was overruled; the sentence was reworded
   to be literally true.)*

---

## 13. Orchestrator decisions — addendum, 2026-08-02

Rulings on §12's open questions. These are binding; the Sonnet implementer inherits them
as-is, and where they conflict with the body above, this addendum wins.

**#1 — The stone-tile exception is NOT accepted as written; the rule sentence must be
literally true.** Q5's recommendation is overruled. The draft sentence ("Every tile
crumbles as you leave it…") violated the player's model the moment they stepped off a stone
tile and *nothing happened* — and "nothing happened" is the hardest event to interpret; the
player concludes the game is broken, not that stone exists. That is precisely the failure
ux-lens §1 exists to prevent. The stone tiles themselves survive — their justification
(without them par collapses to a constant and the "23 vs par 19" share hook stops existing,
§1.3) stands. Resolution, applied in place in §1:

- **New canonical sentence (90 chars exactly, count verified):**
  *"Wooden tiles crumble as you leave them — cross the whole floor without stranding
  yourself."* Stone is no longer an exception to the rule; the floor is a **two-material
  floor** and the sentence names the material.
- **Visual consequence, binding on §7.1/§7.2:** stone must be **visually unmistakable as a
  different material** — texture and form, never a colour variant — and must pass the
  grayscale-screenshot test *on its own* (a grayscale screenshot must distinguish
  stone from wood by material alone). §7.1's slab/rivets vs. plank/fracture-seam spec
  already satisfies this; it is now a review gate, not a style choice.
- **Teaching consequence, superseding §7.4's workaround:** the **first stone survival** —
  the first time a player leaves a stone tile and it does not fall — is a first-class
  teachable moment with its own callout, exactly like the first crumble. Trigger: first
  `moved` effect departing a stone tile with no accompanying `crumbled` effect, on a device
  that hasn't seen one. Anchor: the surviving stone tile. Text: *"Stone doesn't crumble —
  cross it as often as you like."*
- **General principle, recorded for the whole library:** *a rule sentence that is 95% true
  is worse than a longer sentence that is 100% true.* The ≤90-character constitution
  constrains length; it does not license inaccuracy. Future game plans cite this ruling
  rather than re-arguing it.

**#2 — `firstOccurrence` is an array (Q3 resolved).** The shell hook becomes a list of
entries, each with its own once-per-device flag key. Crackstep registers two: (1) first
crumble (§7.4's existing callout), (2) first stone survival (#1 above). Mine Run will have
its own. Routed to the shell team by the orchestrator; §7.4's "singular hook, stone lesson
carried by the How-sheet" fallback is superseded — the How-sheet frames keep the stone
material anyway, as reinforcement rather than sole carrier.

**#3 — Restart count in the daily result record already exists (Q2 resolved).** The daily
team's plan carries a restart count surfaced as **`· attempt {k}`** in the share artifact,
specifically so a fifth attempt is never presented as a first. Crackstep **references that
field rather than defining its own**: §8's proposed `{ moves, par, restarts, solved }`
shape is withdrawn in favor of the daily plan's record, and §9's stat-line examples adopt
the `· attempt {k}` convention (e.g. `attempt 2 · the floor crumbles behind you`). The §8
recommendation that the first *completed* run is the recorded result stands as Crackstep's
input to the daily team's semantics.

**#4 — Solo-ci gate sectioning by `manifest.solo.format` approved (Q1 resolved).** A
genuine platform correction: Crackstep and Mine Run are both `maxPlayers: 1` with entirely
different gate tables, and keying on player count alone would run score-chase gates against
a puzzle — failing it for lacking a `safeMove` hook it has no business having. Carried to
the platform team for M3c by the orchestrator. §5's N/A table is the contract Crackstep
holds CI to.

**Affirmed, no change:** the §6.4 finding that Crackstep is *not* history-dependent —
positions can never repeat, so `encode` is a sound position key and the generic solver
dedup works directly — stays prominent as the stated contrast with Fadeout's superko seam.
It is the thing that tells a future author which of the two patterns their game falls into.

**Still open (unchanged):** Q4 — casual/undo mode scope at launch (shell team's queue).

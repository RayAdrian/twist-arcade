# Test Plan — Phase 0 Platform Spine, Milestones M0 + M1

*Fable test design (stage 3), 2026-08-02. Feature under test: workspace bootstrap (M0) and
the engine contract (M1) on branch `feature/platform`.*

*Source of acceptance criteria: `docs/plans/phase-0-platform-spine.md` §1, §3 (contract rules
box), §3.2, §3.3, §3.4, §4, §5, §13 — and `docs/plans/platform-corrections.md` C1
(view-honesty / omit-not-mask). Test cases are derived from the plan, **not** the
implementation; the implementation and its tests were read only afterwards, to mark coverage
and hunt gaps.*

---

## How to execute (stage 4)

This slice is a pure TypeScript library — no UI, no browser. Every case is a CLI/Node
procedure run from the worktree root `/Users/raymundrafael/Desktop/repos/claude-project-platform`:

- **Existing-suite cases** name the vitest file: `pnpm vitest run <path>`.
- **NEW cases** describe a scratch spec. Convention: write it to
  `packages/engine/test/__qa__/<case-id>.test.ts` (or a `pnpm tsx` one-off script), run it
  with `pnpm vitest run packages/engine/test/__qa__/<case-id>.test.ts`, record the result,
  and **delete the scratch file afterwards** (or keep it if stage 5 promotes it to a
  regression test — preferred for every case marked Critical/High).
- **Procedural cases** (WS-*) plant a change, run a command, assert the command's exit
  code/output, then `git checkout --` the planted change. Never leave a plant behind.
- A case **passes only if the exact expected result is observed**. "It threw something" does
  not satisfy an expectation that names a specific property or error.

Coverage column: **AUTO** = already exercised by a named existing automated test.
**PART** = partially covered (the delta is stated). **NEW** = no existing coverage; stage 4
must build the scratch spec.

Severity: Critical / High / Medium / Low — priority for stage-4 execution order and for
stage-5 promotion into the permanent suite.

---

## Area HP — Happy path: the contract on the three fixtures

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| HP-001 | Critical | `pnpm install` done | `pnpm vitest run packages/engine/test/classic-ttt.engineContract.test.ts` | All properties green, incl. the two-player branch ("never emits `lost`"). Exit 0. | AUTO (`classic-ttt.engineContract.test.ts`) |
| HP-002 | Critical | — | `pnpm vitest run packages/engine/test/mini-crackstep.engineContract.test.ts` | All properties green, incl. solo branch (never `draw`; any `won` has winner 0). Exit 0. | AUTO |
| HP-003 | Critical | — | `pnpm vitest run packages/engine/test/bank-run.engineContract.test.ts` | All properties green incl. score-coherence and monotonicity (`scoreMonotone: true`). Exit 0. | AUTO |
| HP-004 | High | — | `pnpm vitest run packages/engine/test/fixtures-sanity.test.ts` | Known crackstep solution (0→1→2→5→8) replays to `{kind:"won",winner:0}`; dead-end path replays to `{kind:"lost"}` with `legalMoves === []`. | AUTO (`fixtures-sanity.test.ts`) |
| HP-005 | **Critical** | — | Scratch spec: build a `CertificateReplayInput` from `MINI_CRACKSTEP_KNOWN_SOLUTION` (`gameId: "mini-crackstep-fixture"`, `gameVersion: 1`, any `engineVersion`, any `seed`, `moveLog: [{to:1},{to:2},{to:5},{to:8}]`) and call `verifyCertificate(miniCrackstep, cert)` | Returns without throwing. **`verifyCertificate` is defined in plan §4 and ships in M1 (testkit/contract.ts) but has ZERO existing tests — not even the happy path.** | **NEW** |
| HP-006 | High | — | `pnpm vitest run packages/engine/test/replay.test.ts` | 2P record replays to full trajectory (`states.length === steps+1`), `{kind:"won",winner:0}`, expected final board; two independent replays byte-identical via `encode`. | AUTO (`replay.test.ts`) |
| HP-007 | Medium | — | `pnpm vitest run packages/engine/test/rng.test.ts packages/engine/test/encode.test.ts` | Golden vectors, `rngFor` independence, `int`/`shuffle` properties, `stableStringify` canonical-form tests all green. | AUTO |

## Area WIRE — Determinism and the frozen wire formats (highest-value area)

The Rng derivation (§3.4) and `encode`'s canonical form (§3, §3.2) are frozen wire formats:
a silently changed constant orphans every future stored replay, daily seed, and certificate.
Cases here are designed to *actually catch a silent change*, not merely re-run the suite.

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| WIRE-001 | Critical | — | `pnpm vitest run packages/engine/test/rng.test.ts` | Golden vectors for `rngFromSeed(42)`, `rngFromSeed(0)`, `rngFromSeed("hello")`, `rngFor("match-1", 0/1/5)` — first 8 outputs byte-exact. | AUTO (`rng.test.ts`) |
| WIRE-002 | **Critical** | Clean tree | Sabotage sensitivity probe: temporarily change one constant in `packages/engine/src/rng.ts` (e.g. `0x9e3779b9` → `0x9e3779b8` in splitmix32), run `pnpm vitest run packages/engine/test/rng.test.ts`, then `git checkout -- packages/engine/src/rng.ts` | The golden-vector tests **fail**. Repeat for one mulberry32 constant (`0x6d2b79f5`) and one xmur3 constant (`3432918353`) — each single-constant change must be caught. If any sabotage passes, the goldens do not actually lock the format. | **NEW** |
| WIRE-003 | High | — | Independent-oracle check: the existing goldens were generated **from the implementation itself** (circular for initial correctness). Scratch script: implement xmur3/splitmix32/mulberry32 from their published reference sources (bryc/PRNG reference, transcribed by hand into the scratch file, not imported from src) and assert `rngFor("match-1", 0)`'s first 8 outputs match `packages/engine/src/rng.ts` | Byte-identical. If they diverge, the shipped constants differ from the reference algorithms the plan names — an ADR-level finding even if internally consistent. | **NEW** |
| WIRE-004 | Critical | — | `pnpm vitest run packages/engine/test/rng.test.ts -t "independence"` | Step 1's stream identical whether step 0 drew 0–4 values; distinct steps differ; distinct seeds at same step differ. | AUTO |
| WIRE-005 | **High** | — | Scratch spec: assert `rngFromSeed("s").next() × 8` ≡ `rngFor("s", 0).next() × 8` for several string seeds | They ARE identical (algebraically, per the pinned formula). **Pin this as a documented wire-format fact** — replay.ts feeds `setup()` from `rngFromSeed(seed)`, so setup and step-0 `apply()` receive the *same* stream. For a game that draws in both, step-0 randomness is correlated with setup content. Plan §3.3/§3.4 never specifies setup's rng at all. Record the pin AND flag the ambiguity (Gaps G-1). | **NEW** |
| WIRE-006 | **Critical** | — | Golden end-to-end trajectory: scratch spec replays bank-run with `seed: "wire-golden-1"`, moves `push,push,bank,push,push,push`, and pins the **exact** `encode()` string of every intermediate state and the exact `lastEffects` arrays (incl. which pushes succeed/bust) as literal expected values captured on first run and committed by stage 5 | Byte-identical on every run. This is the only test shape that freezes the *composite* wire format — setup-rng convention + per-step forking + stream consumption — end-to-end. The rng goldens alone do NOT pin how `replay()` wires streams to steps (a one-line refactor of `replay.ts`'s setup line would pass every existing test and orphan every future stored replay). | **NEW** |
| WIRE-007 | High | — | Cross-process reproducibility: run the WIRE-006 scratch via `pnpm tsx` twice in two separate node processes, emitting JSON of all encoded states; `diff` the outputs | Byte-identical files. Catches ambient-state nondeterminism a single-process double-run cannot. | **NEW** |
| WIRE-008 | Critical | — | Contract canonical-form property (encode excludes `lastEffects`; effects never accumulate) on all three fixtures — run HP-001..003 | Green; and the mutant `mutantEncodeIncludesEffects` fails it (KIT-003). | AUTO (`contract.ts` + self-test) |
| WIRE-009 | **High** | — | Encode injectivity spot-check: scratch spec runs a bank-run and a crackstep playout, collects all states, and asserts **distinct logical states ⇒ distinct `encode()` strings** (compare pairwise; states differing in any non-`lastEffects` field must not collide). Then build a degenerate mutant whose `encode` returns `""` constantly and run it through `checkEncodeDecodeAndEffects` + `checkDeterminism` | Fixtures: no collisions. Degenerate mutant: **currently passes both checks** — `encode(decode(encode(s)))===encode(s)` is trivially satisfied by a constant encode, and determinism compares via encode. Plan §3 says "solvers hash on this"; a collision-prone encode silently mis-values every future solve. Expected per plan: the kit should catch it. Record as Gap G-2 with the failing-to-fail evidence. | **NEW** |
| WIRE-010 | **High** | — | Status-stability property: scratch spec asserts `status(decode(encode(s)))` deep-equals `status(s)` for every state of a playout, all three fixtures | Green on fixtures — but **the property is listed verbatim in plan §4 ("status stable under encode/decode") and is NOT implemented in `testkit/contract.ts`**. Record as Gap G-3; stage 5 should add it to the kit plus a mutant that breaks it (e.g. `decode` dropping a field `status` reads). | **NEW** |
| WIRE-011 | Medium | — | Determinism-through-generation, solo: bank-run — replay the same record (with pushes) twice via `replay()`, assert identical success/bust outcomes and identical `lastEffects` at every step | Identical. (The contract's `checkDeterminism` covers this generically; this direct case is the plan §3's "leaderboard-verification property, tested directly".) | PART (`contract.ts` checkDeterminism via HP-003; no *direct* named test) |
| WIRE-012 | Low | — | Domain edges of `rngFor`: scratch — `rngFor("s", -1)`, `rngFor("s", 2**32 + 3)` vs `rngFor("s", 3)` | `(base + step) >>> 0` wraps: step `k + 2^32` collides with step `k`; negative steps silently wrap. Harmless at `moveCap ≤ 2000` but pin the behavior and note it in the rng.ts comment (stage 5). | **NEW** |
| WIRE-013 | Low | — | Numeric-seed coercion: `rngFromSeed(-1)` vs `rngFromSeed(0xFFFFFFFF)`; `rngFromSeed(1.5)` | `-1` ≡ `0xFFFFFFFF` (`>>>0`); pin whatever `1.5` does (`>>>0` → 1). Document; do not change (wire format). | **NEW** |

## Area BND — Boundary conditions

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| BND-001 | High | — | First state: scratch — `setup()` on all three fixtures | `lastEffects` is exactly `[]` (plan §3: "setup() sets []"); crackstep `pos===0, visitOrder===[0]`; bank-run all-zero; ttt board all-null, turn 0. | PART (implied by contract playouts; no direct assertion on `setup().lastEffects === []`) |
| BND-002 | High | — | Terminal states: for each fixture drive to each reachable terminal kind (ttt: won + draw; crackstep: won + lost; bank-run: scored) and assert `legalMoves(s, p) === []` for every seat and `isLegal` false for any move | Empty legal sets at every terminal; no move accepted. | PART (crackstep-lost only, `fixtures-sanity.test.ts`) |
| BND-003 | Medium | — | One move before terminal: crackstep after 0→1→2→5 — assert status ongoing, `legalMoves` contains `{to:8}` (and only legal cells); apply `{to:8}` → `{kind:"won",winner:0}` and `legalMoves === []` | Exactly as stated; the won terminal is reached on the boundary move, not before. | **NEW** |
| BND-004 | High | — | `moveCap` off-by-one (bank-run `ROUND_CAP = 6` is the solo cap analogue): after 5 moves assert status `ongoing` and both moves legal; after the 6th assert `{kind:"scored"}` and `legalMoves === []`; a 7th step through `replay()` throws `IllegalReplayMoveError` | Boundary is exact: 5 → ongoing, 6 → scored, 7 → refused. | **NEW** |
| BND-005 | High | — | Ply-cap off-by-one in the kit: scratch counter engine that terminates at exactly `n === N`. Run `checkTermination(engine, {maxPlies: N})` and `checkTermination(engine, {maxPlies: N-1})` | `maxPlies: N` passes (terminates *within* the cap); `maxPlies: N-1` throws `/termination/`. Pins which side of the fence "within the ply cap" means. | **NEW** |
| BND-006 | Medium | — | `Rng.int` boundaries: `int(1)` × 100 draws; `int(0)`, `int(-1)`, `int(2.5)` | `int(1)` always returns 0; the other three each throw `RangeError`. | PART (`rng.test.ts` fc covers max ≥ 2 only; the throw path and `int(1)` are untested) |
| BND-007 | Low | — | `shuffle([])` and `shuffle([x])` with several seeds | `[]` and `[x]`; new array identity; input untouched. | PART (fc `minLength: 0` reaches these probabilistically) |
| BND-008 | Medium | — | Empty legal set for a non-active seat: solo fixtures `legalMoves(s, 1)`; ttt `legalMoves(s, 1 - s.turn)` | `[]` in all cases and `isLegal` false — "[] means that player cannot act right now" (plan §3), without throwing. | **NEW** |
| BND-009 | Medium | — | Degenerate-board exhaustion: scratch DFS enumerates **every** crackstep trajectory (branching ≤ 3, depth ≤ 8 — trivially small) | Every leaf is `won` (only at pos 8) or `lost`; no trajectory exceeds 8 moves; at least one `won` leaf AND at least one `lost` leaf exist (the fixture demonstrates both solo terminals, per its plan §2 purpose). This independently proves the structural-termination claim rather than sampling it. | **NEW** |
| BND-010 | Medium | — | Largest-state / hostile values through `stableStringify`: `NaN`, `Infinity`, `-0`, an object with an `undefined`-valued key, a 1000-key object, 50-deep nesting | Pin actual behavior: `NaN`/`Infinity` serialize as `"null"` (JSON semantics) — meaning a NaN-bearing state **silently encodes as null and breaks decode round-trip with no error**; `-0` → `"0"`. Record as Gap G-4 (plan is silent; silent null-ing is a canonical-form hazard). Deep/wide objects must not throw or reorder. | **NEW** |

## Area INV — Invalid / malformed input

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| INV-001 | Critical | — | Illegal move through `replay`: corrupt a valid ttt record so step 2 re-plays an occupied cell; `replay()` | Throws `IllegalReplayMoveError` with `name === "IllegalReplayMoveError"` and a message naming **step 2** and **player 0** and the offending move. Plan §3.3: "refuse illegal logs loudly". | PART (`replay.test.ts` asserts a bare `toThrow()` — error type, step, and player are unchecked) |
| INV-002 | High | — | Wrong player index: a ttt step recorded as `[[5, {cell: 4}]]`; a crackstep step as `[[1, {to: 1}]]` | Both throw `IllegalReplayMoveError` (isLegal is false for a foreign seat) — never applied, never silently skipped. | **NEW** |
| INV-003 | Medium | — | Duplicate player entries in one `StepRecord`: `moves: [[0,{cell:0}],[0,{cell:4}]]` on a fresh ttt | Pin current behavior: the `Map` construction silently dedups (last entry wins) so `{cell:4}` is applied and `{cell:0}` vanishes. Plan says "refuse illegal logs loudly" — a log carrying two moves for one seat in a sequential step is malformed. Record as Gap G-5 (should throw; currently silent). | **NEW** |
| INV-004 | High | — | Record/engine mismatch: replay a record with `gameId: "some-other-game"` (and separately `gameVersion: 99`) through `classicTicTacToe`, moves otherwise legal | Pin current behavior: **`replay()` ignores both fields entirely and succeeds.** Only `verifyCertificate` checks them. A version-99 record replaying silently under version-1 rules is exactly the "wrong trajectory, no error" failure the plan's loud-refusal rule targets. Record as Gap G-6 (needs an orchestrator ruling: validate in `replay()` or document that callers must). | **NEW** |
| INV-005 | Medium | — | `replayTo` range: `k = -1` and `k = steps.length + 1` → `RangeError`; `k = steps.length` → final state; `k = 0` → setup state | Exactly as stated. | PART (`replay.test.ts` covers k=0 and k=2; both rejects and the k=len boundary are untested) |
| INV-006 | High | — | Corrupt strings into `decode`: for each fixture — (a) `decode("not json")`, (b) `decode("{}")`, (c) `decode('{"pos": "x"}')` / shape-valid-but-type-wrong | (a) throws (JSON.parse). (b)/(c): pin current behavior — fixtures cast blindly, so **a structurally wrong payload returns a corrupt state with `undefined` fields and no error**, which then poisons anything downstream. Plan is silent on decode validation. Record as Gap G-7 with each fixture's observed behavior; propose "decode must throw on shape violations" as the contract reading. | **NEW** |
| INV-007 | **Critical** | — | `verifyCertificate` rejection paths: (a) `gameId` mismatch, (b) `gameVersion` mismatch, (c) a moveLog that replays legally to `{kind:"lost"}` (crackstep dead-end path 1,4,7,6,3), (d) a moveLog with an illegal move | (a),(b) throw ContractViolation naming the mismatched field; (c) throws "did not reach a won status"; (d) throws `IllegalReplayMoveError` from the inner replay. Zero existing coverage on any of these. | **NEW** |
| INV-008 | Low | — | Non-JSON-plain move at runtime: pass a move containing a function/Date into `replay` on crackstep (so the illegal-move error path must `stableStringify` it) | Behavior pinned: `stableStringify` throws its exhaustiveness `TypeError` while *formatting the error*. Acceptable but worth documenting; type-level rejection is FIX-011. | **NEW** |
| INV-009 | Medium | — | `apply()` with an empty moves map / missing seat entry on each fixture | Each fixture throws a descriptive error (crackstep: "illegal move null"; bank-run: "called without a move for player 0"); input state untouched (see FAIL-004). | **NEW** |

## Area RED — The redaction boundary (`playerView` + `V.lastEffects`)

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| RED-001 | Critical | — | `pnpm vitest run packages/engine/test/testkit-self-test.test.ts -t "FogLeak"` | `mutantFogLeak` fails `checkRedaction`; `fogFixtureCorrect` passes it with the same extractor. | AUTO (`testkit-self-test.test.ts`) |
| RED-002 | **Critical** | — | Effects-only leak: scratch mutant of the fog engine whose `playerView` correctly redacts the `secret` **field** but passes `lastEffects` through unredacted pre-reveal (the exact inverse of `fogFixtureCorrect`'s split). Run `checkRedaction` with `fogSecretExtractor` | Must throw `/redaction/` — the secret reaches the viewer *only* through the effects array. DoD §13 requires precisely this ("a planted secret-leaking effect ... is caught"), and the existing `mutantFogLeak` leaks the whole state, so the effects path has never been isolated. This is the newest, least-exercised part of the contract (orchestrator decision 4). | **NEW** |
| RED-003 | **High** | — | Omit-vs-mask: plan §3 and correction C1 require secrets be **omitted ("absence is structural"), not masked**. Inspect `fogFixtureCorrect.playerView` output pre-reveal: assert the `secret` **key is absent** from the view object (`"secret" in view === false`) | **Expected to FAIL as written today**: the fixture masks with sentinel `-1` (`secret: state.revealed ? state.secret : -1`), and `checkRedaction`'s string-inclusion test cannot distinguish masking from omission. The reference fixture therefore models the pattern C1 exists to forbid. Record as Defect D-1 (fixture) + Gap G-8 (kit cannot express structural absence — needs a shape-based assertion or an `omittedKeys` extractor variant). | **NEW** |
| RED-004 | High | — | Kit refuses to skip: call `checkRedaction(fogFixtureCorrect, {})` (hiddenInformation true, **no** `secretExtractor`) | Throws `/redaction/` — "cannot run without one (plan §4)". A hidden-info game must not silently pass the redaction property by omitting the extractor. | **NEW** (behavior exists in `contract.ts`; never self-tested) |
| RED-005 | Medium | — | Spectator semantics: pre-terminal, `playerView(s, null)` on the correct fog engine contains no secret (extractor treats viewer −1 as non-omniscient); post-terminal the spectator MAY see everything ("show me the mines", plan §3) and the extractor returns `[]` | Pre-terminal spectator leak → caught; post-reveal disclosure → allowed (no false positive). Pins that the extractor's "sensitive until revealed" convention is the intended reading. | PART (checkRedaction iterates seat null; the terminal-disclosure allowance is only implicit in `fogSecretExtractor`) |
| RED-006 | High | — | Perfect-info identity: `meta.hiddenInformation === false` ⇒ `playerView(s, p)` deep-equals `s` (all three fixtures) | Green via contract suite. | AUTO (`contract.ts` checkPerfectInfoIdentity) |
| RED-007 | Low | — | `playerView` totality beyond declared seats: `playerView(s, 7)` and `playerView(s, -2)` on each fixture | Plan §3: "never throws for any seat". Pin fixture behavior (they ignore the seat — no throw). The kit only probes seats `0..n-1` and `null`; note the untested out-of-range corner as informational. | **NEW** |

## Area FAIL — State after failure and purity

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| FAIL-001 | High | — | Throw partway through `replay`: build a 5-step record whose step-3 move is illegal; call `replay()` in a try/catch; then (a) assert nothing was returned, (b) assert the `record` object deep-equals its pre-call snapshot, (c) call `replay()` again on the same record after fixing step 3 out-of-band | (a) only the throw is observable — no partial `states` array escapes; (b) record unmutated; (c) the corrected record replays cleanly, proving no hidden state persisted across the failed call. | **NEW** |
| FAIL-002 | Critical | — | Purity of `apply` on state input: `pnpm vitest run packages/engine/test/testkit-self-test.test.ts -t "MutatesInput"` | `mutantMutatesInput` fails `checkPurity` with `/purity/`. | AUTO |
| FAIL-003 | **High** | — | Purity hole — the `moves` Map: scratch mutant whose `apply` calls `moves.set(...)` or `moves.clear()` on its input map before returning a correct result. Run `checkPurity` against it | Plan §3: apply "MUST NOT mutate input" — *all* inputs. **Expected to expose a kit blind spot**: `deepFreeze` uses `Object.freeze` + `Object.keys`, and `Object.freeze` on a `Map` does not prevent `map.set` (Map contents live in internal slots). The mutant will likely pass `checkPurity` today. Record as Gap G-9 with evidence; stage 5 should harden the kit (wrap the map or assert size/entries unchanged). | **NEW** |
| FAIL-004 | Medium | — | `apply` throws on illegal input but leaves state usable: snapshot-encode a crackstep state, call `apply` with an illegal move (throws), then assert `encode(state)` unchanged and a legal move still applies correctly from it | The throw is clean: no half-applied mutation, the same state object continues the game. | **NEW** |
| FAIL-005 | Low | — | `appendStep` never mutates: existing test | Original record's `steps` length unchanged; new object returned. | AUTO (`replay.test.ts`) |

## Area KIT — The testkit's own credibility (mutant precision)

The load-bearing claim of the slice (plan §4): each mutant fails **exactly** its targeted
property. A mutant that fails several properties proves less than one that fails precisely
one — and a real bug that fails *no* property proves the kit is theater.

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| KIT-001 | Critical | — | `pnpm vitest run packages/engine/test/testkit-self-test.test.ts` | All 9 targeted-failure assertions green (mutants 1–8 + fog pair), incl. both status-discipline directions (solo `draw`, 2P `lost`). | AUTO |
| KIT-002 | **High** | — | Full precision matrix: scratch spec runs **every applicable check function** against **each** of the 9 mutants (not just the 3 spot-checked pairs) and records a pass/fail grid. Before running, write down the expected grid: each mutant fails its target; every other cell passes **except** knock-ons that must be explicitly justified in the grid (e.g. `mutantNonTerminating` will also trip playout-driven checks that run to the cap; `mutantMutatesInput` corrupts stored trajectories, so `checkEncodeDecodeAndEffects` may incidentally fail) | Observed grid matches the pre-registered expected grid cell-for-cell. Any *unexpected* extra failure means the mutant plants more than one bug; any unexpected pass means a property has a blind spot. The existing suite spot-checks only 3 of ~80 off-diagonal cells. | **NEW** |
| KIT-003 | Critical | — | Wire-format guard mutant: `mutantEncodeIncludesEffects` fails `/encode-excludes-lastEffects/` and **nothing else it shouldn't** (per KIT-002 grid) | As stated — this is the guard for the §3.2 standing warning (superko/repetition silent breakage). | AUTO (targeted) / PART (precision) |
| KIT-004 | **High** | — | Missing mutant — `isLegal` too permissive: scratch mutant of classic-ttt with `isLegal: () => true`. Run `checkLegalityCoherence` | Plan §3 requires **`isLegal(s,p,m)` ⟺ `m ∈ legalMoves(s,p)`** — both directions. The kit checks only ⇒ (every legal move accepted), so this mutant **passes today**. Since `replay()` and future server validation trust `isLegal` alone, a permissive `isLegal` accepts corrupt logs while every test stays green. Record as Gap G-10; stage 5 adds the reverse-direction check (probe occupied-cell / foreign-seat / out-of-range moves) plus this mutant. | **NEW** |
| KIT-005 | High | — | Missing mutant — hidden pass: scratch solo engine whose `active()` lists player 0 while `legalMoves` returns `[]` and status stays `ongoing`. Run any playout-driven check (e.g. `checkTermination`) | Throws `/no-hidden-pass/` (the check exists inline in `randomPlayout` but has no self-test proving it fires). | **NEW** |
| KIT-006 | Medium | — | Missing mutant — `scoreMonotone` violation: bank-run variant whose `score()` dips (e.g. returns `banked - streak`). Run `checkScoreCoherence(engine, {scoreMonotone: true})` | Throws `/score-coherence/` on the decrease. The monotonicity branch exists in the kit but no mutant exercises it. | **NEW** |
| KIT-007 | Medium | — | Missing mutant — solo `won` with winner ≠ 0: crackstep variant returning `{kind:"won",winner:1}` at the goal. Run `checkStatusDiscipline` | Throws `/status-discipline/` ("must be 0"). Branch exists; never self-tested. | **NEW** |
| KIT-008 | Medium | — | Missing property — `scored.scores.length === numPlayers` (plan §3 Status invariant): scratch mutant bank-run returning `{kind:"scored", scores: [x, 99]}`. Run the full kit | **No property checks this today** — the invariant is stated in the plan's Status comment and enforced nowhere. Record as Gap G-11. | **NEW** |
| KIT-009 | Low | — | Kit does not false-positive: run every raw check function directly against the three healthy fixtures (outside vitest registration, via `runAllProperties`) | No throws. | PART (equivalent to HP-001..003 via the vitest adapter; direct raw-function run also validates `runAllProperties` itself) |
| KIT-010 | Low | — | Deviation pin: plan §4 says `runs` default 100; `contract.ts` defaults 20 (and 10 inside `checkDeterminism`) | Confirm the numbers in code; record as documented deviation (weaker sampling than the plan promised) for the stage-6 reviewer to accept or reject. Not a code fix in stage 4. | **NEW** (informational) |

## Area FIX — Implementer-reported weak spots (independent derivation)

### FIX-A: `mini-crackstep` and `bank-run` — cases derived from the PLAN's description only

Plan §2: mini-crackstep = "solo puzzle fixture (tiny crumbling-path board)"; bank-run =
"solo chase fixture (trivial press-your-luck banker; has a build flag that plants a farming
loop, for TDD-ing the Grind probe)". Plan §4: fixtures exist to exercise the solo testkit
branches. These were implemented test-with-code (not red-first), so nothing below may be
derived from their source.

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| FIX-001 | High | — | No-revisit rule: after 0→1, assert `{to:0}` is not in `legalMoves`, `isLegal` false, and pushing it through `replay` throws | A crumbling-path board must forbid returning to any crumbled cell — the defining mechanic. | **NEW** (direct; only implied by contract playouts) |
| FIX-002 | High | — | Both solo terminals reachable and correct: a goal-reaching path → `{kind:"won",winner:0}`; a stranding path → `{kind:"lost"}` (never `draw`, never a hang) | As stated — this is what a solo-puzzle fixture must demonstrate for the kit's solo branch (plan §3 status discipline + no-hidden-pass). | AUTO (`fixtures-sanity.test.ts` — but see BND-009 for the exhaustive version) |
| FIX-003 | Medium | — | Seed-irrelevance of a deterministic puzzle: replay the same move log under 5 different `seed` values | Identical trajectories and effects (a non-stochastic puzzle must not secretly consume rng). Cross-check `meta.stochastic === false`. | **NEW** |
| FIX-004 | Medium | — | Effects vocabulary honesty: each crackstep `apply` emits effects that restate the transition — a movement effect and a crumble effect, drawn from the plan's common vocabulary ("moved", "crumbled"), fully overwritten each step | Effects present, both types, exactly the last step's; never accumulate (contract covers accumulation generically; this checks the *content*). | **NEW** |
| FIX-005 | High | — | Bust semantics (press-your-luck core): find (by scanning seeds) a replay where a push busts; assert streak → 0, `banked` unchanged, and a distinguishable bust effect | The risk mechanic must actually fire under real seeded rng and must cost exactly the unbanked streak. Existing tests exercise bust only via a stubbed rng constant. | **NEW** |
| FIX-006 | High | — | Banker semantics end-to-end: interleaved run (push, push, bank, push, bust-or-push, …) to the cap — at **every** state `score(s,0) === banked`; at the scored terminal `scores === [banked]` and any live streak is forfeited | Independent of the implementer's always-push / always-bank scripts; exercises the mixed path where score-vs-streak confusion would actually hide. | PART (`fixtures-sanity.test.ts` covers the two pure strategies) |
| FIX-007 | High | — | Farming-loop flag with real streams: `createBankRun({plantFarmingLoop: true})` — run 50 seeded full replays of all-push | Zero busts across all seeds/steps (flag forces success probability to 1 against genuine `rngFor` streams, not a stubbed rng). Also: default engine with `successProb: 0` → every push busts. Boundary probabilities 0 and 1 under real streams. | PART (existing test uses a hand-stubbed rng, one probe) |
| FIX-008 | Medium | — | Chase termination is structural, not cap-dependent: every bank-run playout has exactly `ROUND_CAP` steps regardless of policy; `checkTermination` passes with `maxPlies` set to exactly `ROUND_CAP` | Exactly 7 states (setup + 6); no cap-hit at the tight bound. (Plan §3: "the cap is a tripwire, not a rule" — the fixture must terminate structurally.) | **NEW** |

### FIX-B: the `Move` index-signature constraint (pin as documented, not a trap)

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| FIX-009 | Medium | — | Compile-time pin: scratch type-test file (`*.test-d.ts` style, or a `.test.ts` using `// @ts-expect-error` and run through `pnpm typecheck`): (a) `interface BadMove { cell: number }` used as `GameEngine<S, BadMove>` → must FAIL to compile (`@ts-expect-error` satisfied); (b) same interface plus `readonly [key: string]: Json` → compiles; (c) `type OkMove = { cell: number }` (type alias literal) — pin whether the alias form needs the signature too | (a) rejected, (b) accepted, (c) recorded either way. Result: the constraint is **pinned by a test and documented**, so the first game team hits a documented rule, not a trap. Stage 5 should also surface the note somewhere a game author reads at M5 (template/CHECKLIST) — flag for the M5 backlog. | **NEW** |
| FIX-010 | Low | — | Non-JSON move types rejected at compile time: `{ when: Date }`, `{ f: () => void }`, `{ u: undefined }` as `M` each under `@ts-expect-error` | All three rejected by `M extends Json`. | **NEW** |

## Area SPEC — The `game-spec` seam (§5) — types-only package

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| SPEC-001 | High | — | `pnpm typecheck` at root; confirm `packages/game-spec/src/` exports the §2 surface: `GameManifest` (incl. `solo` block + `comparisonMetric`), `DifficultyTier`, `PolicySpec`, `SearchBudget`, `HarnessThresholds`/`SoloThresholds`, `GamePresentation`/`BoardProps`/`GameEvent`/`Frame`, `GameDefinition`, `DailyCertificate`, `SoloSolver`/`SoloSolveResult`/`SoloSolveBudget`, `RegistryEntry` + `defineGame` | Typecheck green; every named type importable from `@twist-arcade/game-spec` in a scratch `.ts` file. | PART (typecheck runs; no explicit import-surface test) |
| SPEC-002 | High | — | React is type-only: (a) `packages/game-spec/package.json` has no runtime `dependencies` on react; (b) built output (`dist/`) contains no `require("react")`/`from "react"` **value** import; (c) `node -e "import('@twist-arcade/game-spec/...')"`-equivalent smoke: importing the package in a react-less node process does not throw | All three hold — plan §5.3: "React types only", near-zero runtime. | **NEW** |
| SPEC-003 | Medium | — | Structural-assignability claim in `contract.ts`: scratch type-test — a value of type `DailyCertificate` assigned to `CertificateReplayInput` with no cast | Compiles (the "structural superset, no adapter" claim holds). Under `@ts-expect-error`, removing `seed` from the object breaks it. | **NEW** |
| SPEC-004 | Medium | — | Seam assembly: scratch file builds a `GameDefinition<TTTState, TTTMove>` from `classicTicTacToe` + a minimal manifest + a presentation object with a dummy `ComponentType` — typecheck only, never rendered | Compiles; `V` defaults to `S`; `BoardProps<V, M>` accepts the fixture's types. Proves the seam is sufficient for the first consumer (shell team unblocks on exactly this). | **NEW** |
| SPEC-005 | Medium | — | Constraint homes: plan §5.2 says `manifest.id === engine.meta.id` and `ruleSentence ≤ 90 chars` are "asserted in the contract test" | **No such assertion exists anywhere in M1** — `engineContract()` receives no manifest. Record as Gap G-12: either the kit grows a manifest-aware entry point, or the plan's claim moves to M5's per-game test template. Needs an owner decision; not silently droppable. | **NEW** (gap documentation) |
| SPEC-006 | Low | — | `games/registry.ts`: typecheck as `Registry`; contains the `// <new-game:insert>` marker (plan §5.4 — the M5 scaffold appends there) | Both true. | **NEW** |

## Area WS — Workspace / M0 DoD (procedural CLI cases)

| ID | Sev | Preconditions | Steps | Expected result | Coverage |
|---|---|---|---|---|---|
| WS-001 | Critical | Clean install | `pnpm install && pnpm typecheck && pnpm lint && pnpm test` at root | All four exit 0 (DoD §13 line 1). | AUTO (CI) — re-observe, do not trust the claim (§8 of CLAUDE.md) |
| WS-002 | Critical | Clean tree | Plant `const x = Math.random();` in `packages/engine/src/rng.ts`; `pnpm lint`; revert | Lint **fails**, naming the file and a no-restricted rule (DoD: "lint fails a planted Math.random ... in packages/engine"). | **NEW** (procedural; the DoD demands the negative be observed, not assumed) |
| WS-003 | Critical | Clean tree | Plant `const t = Date.now();` in `packages/engine/src/replay.ts`; `pnpm lint`; revert | Lint fails likewise (Date.now is in the same purity rule per plan §2 eslint note). | **NEW** |
| WS-004 | High | Clean tree | Plant the same `Math.random()` line in a file under `games/` (e.g. a scratch `games/qa-probe.ts` importing nothing); `pnpm lint`; delete | Lint fails — DoD says "in packages/engine **or games/***". If `games/*` is not covered by the purity rule scope, that is a finding. | **NEW** |
| WS-005 | Medium | — | Confirm the sanctioned carve-out: `Math.random` inside `packages/engine/test/mutants/mutants.ts` does **not** fail lint (the leak mutant depends on it) and the carve-out is scoped to that directory only — plant `Math.random()` in `packages/engine/test/rng.test.ts` and check lint | Mutants dir exempt; ordinary test files still banned (otherwise the exemption is a hole, not a carve-out). Record actual scope either way. | **NEW** |
| WS-006 | High | Clean tree | `node scripts/check-engine-purity.mjs` clean; then (a) plant `import type { FC } from "react";` → **pin**: script's regex catches `from "react"` even type-only — expected fail; (b) plant a real `import { useState } from "react"` in `packages/engine/src/types.ts` → fail; (c) add `"lodash": "*"` to `packages/engine/package.json#dependencies` → fail; revert all | Clean run exits 0 with the two ✓ lines; each plant exits 1 naming the violation (DoD: "packages/engine has zero runtime dependencies (CI dependency check)"). | **NEW** (script exists; its failure modes are unobserved) |
| WS-007 | Medium | — | Purity-script blind spots, documented: (a) the react scan covers `src/` and `testkit/` but not `test/` (stated in the script — verify deliberate); (b) the script does not detect react reachable via a transitive dependency, only direct imports and declared deps | Pin actuals; note (b) as an accepted limitation unless the orchestrator wants `pnpm why react --filter @twist-arcade/engine` added to CI. | **NEW** (informational) |
| WS-008 | Medium | — | Public-surface audit of `packages/engine/src/index.ts` vs plan §3/§3.3: `IllegalReplayMoveError` is thrown by `replay()` but **not exported** from the package index | Confirm; record as Gap G-13 — the harness/leaderboard verifier (the plan's named consumers of "refuse loudly") cannot `instanceof`-match the refusal without the class. One-line fix for stage 5. | **NEW** |

---

## Coverage summary (plan acceptance criteria → cases)

| Acceptance criterion (plan §) | Cases | Existing automated coverage |
|---|---|---|
| §13: root install/typecheck/lint/test green; lint catches planted `Math.random`/`Date.now` | WS-001..005 | Positive path only — **the planted-negative has never been observed** |
| §13: `engineContract` green on all three fixtures | HP-001..003 | Full |
| §13: every mutant fails its targeted property (incl. solo mutants) | KIT-001, KIT-002 | Targeted direction full; **precision (no-other-failures) grid ~3/80 cells** |
| §13: Rng golden vectors; `replay()` byte-identical for a 2P and a solo fixture incl. generated content | WIRE-001..007, WIRE-011, HP-006 | Goldens + 2P replay covered; **no end-to-end golden trajectory pins the setup-rng convention**; solo byte-identity only indirect |
| §13: redaction walks `lastEffects`; a planted secret-leaking **effect** is caught | RED-001..003 | Whole-state leak covered; **effects-only leak never isolated**; omit-vs-mask (C1) violated by the reference fixture |
| §13: no react in engine; zero runtime deps | WS-006..007, SPEC-002 | Script exists; failure modes unobserved |
| §3 contract-rules box: no hidden pass · termination · isLegal ⟺ legalMoves · encode∘decode · determinism · purity · view-total · status discipline · score coherence | HP-001..003, BND-005, KIT-004..008, FAIL-003, WIRE-009..010 | Mostly covered EXCEPT: **isLegal reverse direction (G-10), moves-Map purity (G-9), status-stable-under-encode/decode (G-3), scores.length invariant (G-11), encode injectivity (G-2)** |
| §3.3: replay validates and refuses loudly; replayTo; appendStep | INV-001..005, FAIL-001, FAIL-005 | Partial — error identity, wrong-seat, duplicate-seat, and record/engine mismatch untested |
| §3.4: Rng as frozen wire format | WIRE-002..003, WIRE-012..013 | Goldens only; **sabotage sensitivity and independent oracle never run** |
| §4: `verifyCertificate` | HP-005, INV-007 | **Zero coverage — none at all** |
| §5: game-spec seam sufficient for consumers | SPEC-001..006 | Typecheck only |
| Correction C1 (view-honesty, as applied to M1's redaction path) | RED-002, RED-003 | Not covered; fixture arguably non-compliant |

**Criteria with NO existing test coverage at all:** `verifyCertificate` (every path — happy
and all four rejections); the §4 "status stable under encode/decode" property (not even
implemented); the DoD's planted secret-leaking *effect* (only whole-state leak exists); the
reverse direction of `isLegal ⟺ legalMoves`; `moves`-argument purity; every planted-negative
in the M0 DoD (lint/purity-script failures); the game-spec seam beyond bare typecheck.

## Risk assessment

1. **Highest-risk untested path — the unpinned setup-rng convention (WIRE-005/006, Gap G-1).**
   `replay()` feeds `setup()` from `rngFromSeed(seed)`, a stream byte-identical to
   `rngFor(seed, 0)`. The plan never specifies setup's rng; no golden end-to-end trajectory
   pins it. A one-line "clean-up" of that wiring passes every existing test and silently
   orphans every future stored replay, daily seed, and certificate — the exact failure class
   §3.4 declares catastrophic. The stream collision additionally correlates setup content
   with step-0 randomness for any game that draws in both.
2. **Silent-pass blind spots in the kit** (G-2 constant-encode, G-9 moves-Map mutation,
   G-10 permissive `isLegal`): each is a bug class that ships green today. G-10 is the worst
   downstream — `replay()` and future server validation trust `isLegal` alone.
3. **Redaction of effects** (RED-002/003): newest contract surface, weakest exercise, and the
   reference fixture models mask-not-omit, which C1 exists to forbid. Whatever the first fog
   game copies from the fixture becomes the de-facto pattern.
4. **verifyCertificate**: unblocks M3d and the daily team; currently unproven in both
   directions.

## Regression notes

- Promote to the permanent suite (stage 5): WIRE-002 (as a documented manual/CI sabotage
  procedure or a constants-hash test), WIRE-006 golden trajectory, WIRE-009/010 as new kit
  properties + mutants, RED-002 mutant, KIT-004/005/006/007 mutants, HP-005 + INV-007
  verifyCertificate suite, FAIL-003 kit hardening, FIX-009 type-pin file.
- Smoke set (must-pass, blocks merge): HP-001..006, WIRE-001, KIT-001, WS-001.
- Full regression = every Critical + High case in this plan.
- WS-002..006 planted-negatives are release-gate procedures: run once per CI-config change,
  not per PR.

## Gaps and ambiguities (each needs an owner ruling, not silent resolution)

| # | Gap | Found by | Proposed reading |
|---|---|---|---|
| G-1 | Plan never specifies which rng `setup()` receives during replay; implementation chose `rngFromSeed(seed)` ≡ `rngFor(seed, 0)` (stream collision with step 0) | WIRE-005/006 | Pin the current convention as wire format via the golden trajectory; document the collision; consider `rngFor(seed, -1)`-style separation ONLY if decided before any replay is ever stored (afterwards it is frozen) |
| G-2 | `encode` injectivity unchecked — a constant/collision-prone encode passes the kit while breaking every solver hash | WIRE-009 | Add a distinct-states⇒distinct-encodes property over playout states |
| G-3 | Plan §4 property "status stable under encode/decode" not implemented in the kit | WIRE-010 | Implement + mutant |
| G-4 | `stableStringify` silently serializes NaN/Infinity as `null` | BND-010 | Throw on non-finite numbers (they are outside JSON-plain semantics anyway) |
| G-5 | Duplicate seat entries in one `StepRecord` silently dedup (last wins) | INV-003 | `replay()` should throw on duplicates in a sequential step |
| G-6 | `replay()` ignores `gameId`/`gameVersion` entirely | INV-004 | Validate both, matching `verifyCertificate`'s behavior; version mismatch = loud refusal |
| G-7 | `decode()` of shape-invalid JSON returns a corrupt state silently (all fixtures) | INV-006 | Contract reading: decode must throw on shape violations; at minimum document caller responsibility |
| G-8 / D-1 | Kit cannot distinguish omit from mask; `fogFixtureCorrect` masks (`secret: -1`) — the pattern C1 forbids | RED-003 | Fix the fixture to omit; extend the kit with a structural-absence assertion |
| G-9 | `deepFreeze` cannot freeze `Map` contents — `moves`-mutating engines pass `checkPurity` | FAIL-003 | Harden the kit (guarded Map wrapper or before/after entries comparison) |
| G-10 | `isLegal ⟺ legalMoves` checked in one direction only; `isLegal ≡ true` passes | KIT-004 | Add reverse-direction probes + mutant |
| G-11 | `scored.scores.length === numPlayers` invariant (plan §3) enforced nowhere | KIT-008 | Add to checkStatusDiscipline |
| G-12 | Plan §5.2's "asserted in the contract test" manifest constraints (`id` equality, `ruleSentence ≤ 90`) have no home in M1 | SPEC-005 | Decide: manifest-aware kit entry point now, or explicitly re-scope to M5 template tests |
| G-13 | `IllegalReplayMoveError` not exported from the package index | WS-008 | Export it |
| G-14 | Kit `runs` default is 20 (plan §4 says 100); `checkDeterminism` uses 10 | KIT-010 | Reviewer accepts the deviation or the defaults are raised |

*Deviation already self-documented by the implementer and endorsed here: `ContractOptions.scoreMonotone` (the kit cannot read a manifest) — keep, but add the missing mutant (KIT-006).*

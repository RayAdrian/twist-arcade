# Plan: wiring the two-player degeneracy probe suite into CI

Authored by Fable (planning pass, 2026-08-12) against `feature/degeneracy-probes`.

**Source of truth:** `docs/plans/platform-corrections.md` C64 and its amendment ("It is not the
mirror probe. It is the whole two-player probe suite"), C65 instance one (the corrected §6 text must
not claim stall/rush are wired — they are not), and the corrected §6 paragraph in
`phase-0-platform-spine.md`.

Provenance is marked **RECOVERED** (traceable to a document or measurement) or **PROPOSED**
(planner's judgement). Presenting a proposed number as recovered would repeat C64's defect.

---

## 0. Verified current state

- `packages/bots/src/probes/stall.ts` and `probes/rush.ts` exist and are real policies.
  `roster.ts` resolves `"stall"` (200-rollout budget, line 96) and `"rush"` (line 98);
  `mirrorAgent(mirrorMove)` (line 57) builds mirror agents — `"mirror"` is deliberately **not**
  name-resolvable, because point symmetry is per-game geometry (lines 63–72).
- `runCiSuite` (`suites.ts:933`) runs **exactly three matchups** (1037–1054): strong-vs-random,
  strong self-play, ruthless-vs-standard. **No probe matchup.**
- `scripts/ci-gates.ts` is the CI entry point (`ci.yml:49`, `nightly.yml:36`); its only probe wiring
  is the solo `safeMove` resolution (163–178). `CI_GAMES = 100`, `NIGHTLY_GAMES = 2000` (51–52).
- The only probe call sites outside the packages are three hand-written Tilt research scripts.
  `tilt-t4-gates.ts` is the working template: mirror as P2 with `mirrorSeats: false`, gate `< 0.4`
  (line 75); stall gated on `capHitRate === 0` (line 96).
- `runMatchup` already supports mirror agents: it tracks `lastMoveBySeat` and feeds
  `mirrorMove(state, lastOppMove, legal)` (`runner.ts:111, 136–137`), and supports `mirrorSeats: false`.
- `manifest.mirrorProbe` (merged at `5f17793`): `evaluateMirrorProbeGate` (`suites.ts:912`) turns
  `{ applicable: false, reason }` into a `mirror-probe: n/a` row, appended by `runCiSuite` in both
  the deferred and normal branches (985, 1083). The symmetric-tag interaction is pinned executably at
  `packages/harness/test/suites.test.ts:1770`.
- `EXCEPTIONABLE_GATES` is an `as const` array deriving `ExceptionableGate` (compiler-enforced, C65).
  **`UnknownExceptionGateError` currently special-cases `"mirror-probe"` as never-fails**
  (`suites.ts:200–216`) — that claim becomes false the moment this plan lands (see §4.6).
- Registered games: crackstep, nine-grids, tilt, mine-run, fadeout. **Crackstep and Mine Run are solo,
  confirmed from their manifests** (`crackstep/manifest.ts:22`, `mine-run/manifest.ts:36`), so the
  two-player shipped set is **Fadeout, Nine Grids, Tilt**.
- `mirrorMove` exports: fadeout, nine-grids, tilt, order-vs-chaos (unregistered, killed at C44).
  **Only Fadeout re-exports it from its package root** (`index.ts:19`); Tilt and Nine Grids do not —
  a wiring gap this plan must close, since the registry has no `loadProbes()` slot and the repo
  convention (Mine Run's `safeMove`) is a package-root export resolved by `scripts/ci-gates.ts`.
- Tags: Nine Grids `["symmetric"]`, Tilt `["rotation", "symmetric"]`, Fadeout `["decay"]` (no
  symmetric tag, but a real `mirrorMove`).

---

## 1. What each probe asserts, and its threshold

Gate rows: `mirror-probe`, `stall-probe`, `rush-probe`.

### 1.1 Mirror — parity score, with proven-draw relief (AMENDED 2026-08-16, closing C81)

**History.** The original binding gated mirror's **win rate** (wins/all games). C81 found that
binding cannot fire on the pathology its own source most emphasises: game-theory-lens §5.4 states
the canonical mirror degeneracy as *"P2 copying P1's move through the center can force a draw (or
worse)"*, and a mirror that draws 100% of its games as P2 scores 0% — a clean pass. Strong-self-play's
draw-rate gate does not catch it either (different matchup).

**Matchup: unchanged.** The game's own `mirrorMove` as P2, `mirrorSeats: false`, vs `ruthless` at the
suite's effective budget, n=100. The implementing branch must show matchup outcomes byte-identical
under fixed seeds — only the gate evaluation and detail string change.

**Metric (two branches, one gate row):**

- **Default: parity score** — `(wins + 0.5·draws)/games` via `agentParityScore`, the SAME function
  rush's input is built from — never a hand-recomposed `winRate + 0.5·drawRate` (algebraically
  identical, but a second derivation is C55's drift shape). A mirror forcing a draw every game now
  scores exactly 50% and fails.
- **Proven-draw relief branch:** when `manifest.solvedValue` is a proven **draw** AND attainment
  reached it, the gate scores **win rate** against the same bands. Deliberately **not** `n/a`: in a
  proven-reached-draw game a mirror that *draws* is health, but a mirror that outright *wins* means
  the strong bot is exploitable by copying — still degeneracy — so the win signal stays live and only
  the draw half-credit is relieved.
- The detail always prints win rate, draw rate, parity, which branch gated, and why.

**Thresholds: same numbers, renamed fields.** `mirrorProbeScoreWarn: 0.40`, `mirrorProbeScoreFail:
0.50`. Verified 2026-08-16: no manifest overrides these fields, so nothing migrates. **This amendment
introduces zero new numeric values.**

**Band provenance, stated honestly:**
- **The numbers 0.40 / 0.50 — RECOVERED** (roadmap.md:258; lens §2.7:200; §3.4:254, all re-verified).
  **Neither source states which metric the numbers bind to.** The old win-rate binding was therefore
  PROPOSED, and so is this one — the recovered label covers the numbers, never the binding.
- **Binding 0.50 to parity — PROPOSED, with derivation:** §2.7's "≥50% → broken" cites §5.4, whose
  pathology is a *forced draw*. Only a draw-inclusive score lets that pathology reach the threshold.
  Strong reasoning, still planner reasoning — calling it RECOVERED would repeat C64.
- **Binding 0.40 to parity — PROPOSED.** The transfer is not derivable; the *direction* is: parity ≥
  win rate always, so this is **monotone-stricter — nothing that passes today can newly pass, and
  nothing failing today can newly pass.** In a healthy symmetric game the shift equals half the
  mirror matchup's draw rate, and a high mirror draw rate in a symmetric game *is* the §5.4
  pathology — the shift is signal, not recalibration.

**Applicability by tag: unchanged** (§4.4 stands). The sources' "broken" claim is scoped to
**symmetric** games; applying the bands to a non-symmetric exporter like Fadeout is
**PROPOSED-by-extension**. Today this forks no behaviour — Fadeout takes the relief branch. A future
non-symmetric game tripping the parity branch is a finding, never a quiet band adjustment (C55).

**Relief mechanism — one source, two consumers (C55).** `runTwoPlayerCiGate` already computes
attainment ONCE via `solvedValueAttainment` and threads it to rush. Mirror consumes **that same
value** — never a second derivation. Task #27 is moving rush's relief source to survive multi-seed
runs; **the invariant pinned here is "one attainment source, both probes read it", whichever source
#27 lands.** Either order is safe; two sources is not.

**Interaction with task #26 — metric lands now, S5 waits.** Nine Grids' mirror row is ~86%
game-internal fallback (221/258, C81), invisible to the harness until #26. Until then its parity
number mostly measures first-legal-vs-ruthless play and its row must carry that caveat. The metric
change does not wait (pure evaluator, monotone-conservative, warn-only at ci). **S5 does wait**:
#26 changes the very distribution that row measures, so a pre-#26 baseline would be enshrined and
immediately invalidated.

**Verification (C77 — the mechanism, separately from the fix):** planted evaluator tests, one per
claim — `(win 0, draw 1.0)` → parity 0.5 → fires; same input with relief → passes; `(win 0.55,
relief)` → fails, proving the win signal survives relief; boundary at exactly 0.40 → warn. Plus a
real-wiring test where a sabotaged threshold trips off a real matchup through the parity path, and
fixed-seed byte-identity on stall/rush rows.

**Honest caveat: "parity without relief false-fires on Fadeout" is a PREDICTION, not a measurement.**
Fadeout's mirror-vs-ruthless draw share has never been run. If Fadeout's mirror mostly *loses* rather
than draws, relief remains correct but "mandatory" downgrades honestly to "cheap insurance."

**Pre-implementation experiment (cheapest refutation).** Mirror matchup ONLY, n=100, two seeds, ci
budgets, tilt/fadeout/nine-grids, printing win rate, draw rate and parity from the SAME outcomes;
~10–20 min locally. **Refutes this recommendation if** healthy symmetric Tilt lands at ≥40% parity —
a false warn on a healthy game means the band transfer is wrong, and the amendment goes back for new
PROPOSED bands, recorded as a finding rather than tuned quietly.

**Recorded, not actioned:** the lens binds the STALL probe to "win/draw rate" (§2.7:181) while §1.2
chose wins/all-games citing the same Fadeout-health concern this amendment solves with relief. The
parity+relief shape would reconcile stall with its source too. Noted so the discrepancy is on the
record rather than rediscovered.


### 1.2 Stall — half recovered, half proposed
Matchup: roster `"stall"` as P2, `mirrorSeats: false`, vs `ruthless`.
- **Assertion A (cap-hit):** fail `> 1%` — RECOVERED (game-theory-lens §3.1:180). Warn `> 0%` —
  PROPOSED (T4's stricter `=== 0`, softened so one noisy cap hit is visible without hard-failing).
- **Assertion B (stalling pays):** stall's win rate. The documented gate ("beats its ladder Elo
  peers'") is **not recoverable as a CI number** — it needs a round-robin Elo no CI tier runs.
  PROPOSED: warn `≥ 20%`, fail `≥ 40%`, **win rate only (wins/all games; not a win+draw metric)**
  — in a proven-draw game like Fadeout, stall drawing against correct play is the correct
  outcome, and a win+draw metric would fire on health. (Reworded post-implementation, stage-6
  review: "draws excluded" reads as wins/decisive — wins/(wins+losses) — a different number in a
  draw-heavy game; the actual metric is wins/all-games, with draws staying in the denominator.)

### 1.3 Rush — PROPOSED by stated analogy
Matchup: roster `"rush"` vs roster `"mcts1k"`, `mirrorSeats: true`. Opponent identity is **RECOVERED**
(§2.7/§3.4: "if rush ≈ MCTS-1k, the game is tactically flat"); `mcts1k` is fixed-budget and untouched
by the C26 override, so it measures identically at both tiers.
Assertion: rush's **score** `(wins + 0.5·draws)/games` — parity claim, so draws are half of parity.
Thresholds: pass `≤ 40%`; warn `40–45%`; fail `≥ 45%` — PROPOSED by analogy to the RECOVERED
MCTS-1k-vs-MCTS-100 row (ship ≥60 / kill <55). **The rush line carries no number anywhere in the
repo; calling 45% recovered would repeat C64's defect.**
**Proven-draw relief:** for a game whose `solvedValue` is a proven, *reached* draw, a parity score is
evidence of nothing — the gate reports `n/a` citing the proof, **reusing the existing
`solvedValueAttainment` computation** rather than re-deriving it (re-deriving is the C55 drift shape).

### 1.4 Severity split — RECOVERED pattern
At suite `"ci"` a probe fail is downgraded to **warn**; at `"nightly"` it fails for real — the same
severity rule `ruthless-vs-standard` already carries. Probe gates do **not** go `n/a` under an active
C26 override: that ruling was about a comparison between two manifest tiers whose gap the override
destroyed; a probe-vs-strong matchup compares no two tiers, and a weaker ci opponent biases the probe
*toward* firing, which is conservative and absorbed by warn severity.

All three measured probe gates join `EXCEPTIONABLE_GATES`, so a justified, reviewable exception can
downgrade a fail — never silently.

---

## 2. Where the computation belongs

**Decision: a separate `runProbeSuite` + pure `evaluateProbeGates` in a new
`packages/harness/src/probes-two-player.ts`, composed with `runCiSuite` inside the harness's
`runGameCiGate`, with probe rows appended to the same per-game report so a probe fail fails the game.**

Does C48's kept-beside reasoning apply? **Partly — and where it does not, that is informative.**
C48 kept `evaluateMirrorProbeGate` beside `evaluateCiGates` because a manifest-only declaration is a
different *kind* of claim than a computed row. Measured probes are the opposite: they ARE computed
self-play numbers. So C48's argument does not forbid folding them in. The reasons to keep them beside
are different and practical:

1. **Byte-identical guarantee.** Leaving `runCiSuite`'s signature, matchups and six rows untouched
   makes C63's fixed-seed diff trivially provable for this change too.
2. **Inputs differ.** The mirror probe needs the game's `mirrorMove`, which lives in the game package,
   is not in the manifest, and is resolved by repo-layout knowledge `scripts/ci-gates.ts` explicitly
   owns (its module doc, lines 12–19 — the `safeMove` precedent). Threading a function-valued hook
   through `runCiSuite` would leak that layer.
3. **The two-layer pattern repeats** the structure every existing lane already has.

---

## 3. Cost, and the ci-vs-nightly split

Anchors (RECOVERED): Tilt @3000 ≈ **273 s** for the 3-matchup ci suite; strong-vs-random **2.1
games/s**, self-play **0.8 games/s** (`tilt-t3-budget-validation.md:52,185,194`). Fadeout @3000
**848 s**, @10k **2,802 s**. Nine Grids @1500 **~17 min**, self-play 9.99 s/game
(`nine-grids/manifest.ts:59–66`).

| game | today (ci, 2P lane) | +mirror +stall | +rush | new total | delta |
|---|---|---|---|---|---|
| Tilt | ~4.5 min | +~96 s | +~25 s | ~7 min | +45% |
| Fadeout | ~14 min | +~7–8 min | +~1.5 min | ~23 min | +65% |
| Nine Grids | ~17 min | +~8–10 min | +~4–6 min | ~29–33 min | +75% |
| **roster** | **~36 min** | | | **~60–63 min** | **+25–30 min** |

Nine Grids carries the widest error bars. **Per C26, step S1 runs a 15-game timing-only pilot before
these numbers are treated as real.**

- **ci:** all three probes, `games: 100`, opponents built from the same C26 in-memory clone
  `runCiSuite` already builds. Warn-on-fail severity.
- **nightly:** same matchups at shipped budgets, fail severity, and **`games: 100` — deliberately not
  `NIGHTLY_GAMES` (2000)**. Probe gates are threshold-margin-bound, not variance-bound: T3 measured
  ~8.5 pp per-reading SD at n=100, and every probe threshold sits ≥40 pp above the healthy reading, so
  n=100 separates pass from fail by ~4–5 SD. 20× the games buys nothing the thresholds need, while at
  Nine Grids' shipped 10k ruthless it would add double-digit hours.
- **C27 deferral is reused, not duplicated:** deferred rows report `"deferred"` with the same reason;
  the probe module refuses an active deferral at nightly with a sibling of
  `TwoPlayerDeferredGateAtNightlyError`.
- **Escape hatch if the PR cost is rejected:** per-game C27 deferral of the whole lane, not a new
  probes-only knob. Nine Grids is the cost driver and its 17-min ci run already strains the PR tier.

**Finding surfaced while costing:** nightly's existing 2,000-game shipped-budget lane extrapolates to
tens of hours for Nine Grids alone. Whether `nightly.yml` completes was not verified by this plan —
it should be, because the probe gates' fail tier lives there. *(Answered after this plan was written:
it does not. See C68 — nightly has never once run.)*

---

## 4. Design details

1. **`thresholds.ts`:** add `mirrorProbeWinRateWarn: 0.40`, `mirrorProbeWinRateFail: 0.50`,
   `stallProbeCapHitFail: 0.01`, `stallProbeWinRateWarn: 0.20`, `stallProbeWinRateFail: 0.40`,
   `rushProbeScoreWarn: 0.40`, `rushProbeScoreFail: 0.45`. Per-manifest overridable like every
   existing threshold.
2. **`probes-two-player.ts`:** pure `evaluateProbeGates(...)`; and
   `runProbeSuite(engine, manifest, { mirrorMove?, seed, games, suite, clock })` returning
   `{ gates, matchups }`. Seeds `` `${seed}:mirror-probe` `` etc. — **one base seed, never a
   per-candidate seed** (C24).
3. **Mirror row exclusivity.** A declaring game runs **no** mirror matchup and gets its `n/a` row from
   the existing `evaluateMirrorProbeGate`; a non-declaring game gets exactly one measured row from the
   probe suite. A test pins "exactly one mirror-probe row in every report, and which producer it came
   from."
4. **`symmetric`-tagged with no `mirrorMove`: refuse loudly** — new `MirrorMoveNotExportedError`, the
   exact posture of `SafeMoveNotExportedError`. **Not a warn:** C64's whole lesson is that "harness
   warns when absent" was claimed and never built, and a warn nobody reads is the same hole with a log
   line in it. A game *not* tagged symmetric with no `mirrorMove` gets an explicit `n/a` row naming the
   reason — visible per C2, never a silent skip. Fadeout shows the rule: the **export** decides whether
   the probe runs; the **tag** decides whether absence is an error.
5. **No existing gate changes.** The stall matchup's cap hits feed `stall-probe` only, **not**
   `worstCapHitRate` — folding them in would change `mean-plies` for shipped games. If probe data
   reveals an existing gate *would* have fired, that is reported as a finding, not wired in.
6. **`UnknownExceptionGateError`'s mirror special case becomes false** once `mirror-probe` can fail.
   Add the three probe gates to `EXCEPTIONABLE_GATES` and rewrite the guidance: `manifest.mirrorProbe`
   for "the probe cannot measure its claim here"; `exceptions[]` for "it measured, it fired, and here
   is why we ship anyway." Leaving the stale text would be C65's defect exactly.
7. **Wiring:** `runGameCiGate`'s two-player arm accepts an optional `mirrorMove`; `scripts/ci-gates.ts`
   gains `resolveMirrorMove(gameId)` in `RunAllGatesDeps`, injected for tests like `resolveSafeMove`.
   `games/tilt/index.ts` and `games/nine-grids/index.ts` add `export { mirrorMove } from "./probes";`.
   Verify `report.ts` renders the new rows — expected generic; verify, do not assume.
8. **Docs:** update §6 to record that enforcement now exists — **only after** the wiring demonstrably
   runs (C65: a correction must not assert wiring that is not yet true).

---

## 5. Sequencing (TDD; stage-3 cases come from a separate Fable pass)

- **S0 — Baseline pin.** Fixed-seed dump of `runCiSuite` gates for fadeout/nine-grids/tilt on `main`
  and on the branch; diff must be empty before and after every step (C63's discipline).
- **S1 — Cost pilot.** 15-game timing-only probe matchups (never a verdict — C26).
- **S2 — Thresholds + pure evaluator**, with a planted violation per threshold, per status, including
  deferral rows and the nightly-active-deferral refusal.
- **S3 — `runProbeSuite`** + a real-wiring test (sabotaged threshold trips off a real matchup).
- **S4 — Composition:** harness `ci-gates.ts`, `scripts/ci-gates.ts`, `index.ts` re-exports,
  `MirrorMoveNotExportedError` (planted: a symmetric-tagged fixture without the export).
- **S5 — The measurement, which is the point of the work. BLOCKED until (a) §1.1's amendment is
  implemented, (b) task #26 (Nine Grids null convention + fallback counting) is merged — a baseline
  recorded before #26 would enshrine a Nine Grids mirror row that #26 immediately invalidates — and
  (c) task #27's relief-source fix has landed OR S5 runs its two seeds as two separate single-seed
  invocations (the `seedCount > 1` relief-withholding gap).** Per game×probe cell record mirror's win
  rate, draw rate AND parity plus which branch gated and the relief state; stall's win rate and
  cap-hit rate; rush's parity and relief state; harness-observed fallback counts (#26); every gate
  status. **Pin the metric version into the baseline document itself** — formulae, threshold field
  names and values, seeds, budgets, and the git SHA — so a future metric change starts a NEW table
  rather than silently reinterpreting this one underneath its readers. Original text: Full probe suite against Fadeout, Nine
  Grids, Tilt at ci budgets, n=100, **two independent seeds**. Record verbatim in
  `docs/research/games/two-player-probe-baseline.md` plus a platform-corrections entry, **whatever the
  numbers say.** A probe firing on a shipped game is the purpose, not an obstacle.
- **S6 — Docs** (§4.8) and nightly severity live.

---

## 6. Honest prediction of what fires

- **Crackstep, Mine Run:** solo, out of scope, unchanged.
- **Tilt:** mirror and stall already measured at this exact configuration — 0.0% / 0.0%, 0 cap hits
  (`tilt-t3-budget-validation.md:196–198`). Rush never measured. Expected: all pass. **Measured
  (C86, mirror-only refutation pass):** 0.0% win, 0.0% draw, 0.0% parity, both seeds — confirms the
  prediction and, since Tilt is the amendment's own falsifiability condition (fixed-CW, not
  reflection-invariant, so mirroring never forces the draw that would inflate parity toward the 40%
  bar), this is what NOT REFUTED looks like.
- **Fadeout:** proven exact draw reached 100% of the time. Mirror/stall cannot *win* against a bot
  playing a proven draw, so those pass near 0% under either metric. Mirror-probe (§1.1 AMENDED
  2026-08-16, closing C81) now scores the draw-inclusive parity score by default, with a
  proven-draw relief branch (win rate instead of parity) reused from rush's own
  `solvedValueAttainment` — **one source, two consumers**. **Rush will hit the proven-draw shape**
  — drawing everything yields a parity-looking score meaning "correctly drawn," not "flat." The
  `n/a`-via-attainment branch exists for exactly this, and its first real exercise is itself a
  finding about gate design. **Measured (C86):** mirror's Fadeout draw rate is 0.0% across 200
  games — it *loses*, it does not draw — so §1.1's own honestly-flagged prediction ("parity without
  relief false-fires on Fadeout") was WRONG, caught by the amendment's own stated uncertainty
  before anything downstream depended on it. Relief remains correct; it downgrades from
  "mandatory" to "cheap insurance," exactly as §1.1 said it would if this happened.
- **Nine Grids — most likely to fire, on rush at ci tier.** Its ci "strong" is the weakest: the
  1,500-rollout override already produced scaled ruthless *losing* to standard at 42% (C26); UTTT's
  must-follow rule makes many replies forced local tactics, which a 1-ply win/block policy converts
  well and shallow MCTS wastes rollouts rediscovering; and its 30% draw rate pads a score-based
  metric toward 45%. Expected shape: **warn at ci, likely recovering at nightly's shipped 10k** — a
  genuine measurement of how thin the ci yardstick is for that game, either way. Mirror-probe's own
  row is a separate, orthogonal concern: at ~90% mirror-fallback rate (C81's 85.7%, #26's 91.5%,
  C86's 88.7%/90.0% — three independently-derived measurements agreeing), the row is mostly
  first-legal-vs-ruthless play under EITHER metric, so a mirror-probe pass/fail here is not
  informative about mirroring regardless of the parity-vs-win-rate binding.
- **The metric change is currently a no-op (C86).** All three games' mirror-vs-ruthless matchups
  measure 0.0% win, 0.0% draw, 0.0% parity — every current mirror-probe row scores 0 and passes
  under either metric. The amendment is protective (closes a blind spot no shipped game exercises
  today), not corrective. It cannot be validated by watching a gate number move; its planted
  evaluator tests are the evidence (§1.1's own verification list, four planted cases plus a
  real-wiring test).

---

## 7. Done means

1. `pnpm harness:ci-gates -- --suite ci` prints `mirror-probe`, `stall-probe`, `rush-probe` rows for
   fadeout, nine-grids and tilt; solo reports byte-identical to before.
2. S0's fixed-seed diff of the pre-existing six rows: empty.
3. Every planted violation fired: each threshold, each status, the symmetric-without-`mirrorMove`
   refusal, the declared-`mirrorProbe` skip (n/a row present, zero mirror matchups), the
   nightly-deferral refusal.
4. The S5 baseline document exists with two-seed numbers for all nine game×probe cells, and any firing
   probe has a platform-corrections entry routed to the orchestrator.
5. §6 no longer describes the enforcement as outstanding, and says only what CI demonstrably runs.

---

## 8. Risks

- **PR wall-clock** (+~70% on the two-player lane). Mitigation: S1 pilot; per-game C27 deferral as the
  sanctioned relief; Nine Grids flagged as the driver.
- **Threshold provenance.** Stall-wins and rush numbers are proposed, not recovered; a false fire on a
  healthy game is possible. Mitigations: warn-only at ci; per-manifest overrides and `exceptions[]`
  (visible, justified); any tuning is a recorded decision, never a quiet edit (C2).
- **n=100 noise near warn bands.** Two-seed replication for any borderline reading.
  *(Sharpened after this plan was written: C71 measured 12.9 pp across-seed SD on Tilt's FPA — 2.6×
  the iid binomial expectation. Two seeds is a floor, not a sufficiency proof.)*
- **Proven-draw attainment reuse.** Re-deriving `solvedValueAttainment` instead of sharing it lets the
  probe relief and `solved-value-reached` drift — the C55 shape.
- **Correction-inherits-defect (C65).** The stage-6 reviewer question to ask: *does this change claim
  any probe is enforced anywhere it does not yet demonstrably run?*

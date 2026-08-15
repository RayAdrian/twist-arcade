// packages/harness/src/suites.ts — the roadmap §6 two-player CI gate table, wired as failing
// assertions (plan §7.5). `pnpm harness suite <gameId> --suite ci|nightly` runs this.
//
// SCOPE: this module owns exactly the gates that are HARNESS-COMPUTED self-play numbers —
// strong-vs-random, first-player win rate, draw rate, mean plies / cap-hit rate, and
// ruthless-vs-standard. The other roadmap §6 CI rows (engine contract suite, redaction
// contract, bundle budget, a11y) are computed by other milestones' own CI steps (M1's testkit,
// the shell team's build/axe steps) — folding them in here would mean this module either
// silently no-ops on them or fakes a result, both worse than each owning its own row.
//
// TWO LAYERS, DELIBERATELY SEPARATE (this is what makes "plant a violation, confirm it fires"
// actually checkable per gate rather than only as one expensive end-to-end blob):
//   1. `evaluateCiGates` — a PURE function over already-computed numbers (`GateInputs`). Every
//      threshold has a test that plants a violation of EXACTLY that number and nothing else,
//      cheaply and deterministically (see suites.test.ts).
//   2. `runCiSuite` — wires `evaluateCiGates` to REAL self-play via `runMatchup`, resolving the
//      "strong" (ruthless tier) / "standard" tier / "random" agents from the game's own
//      manifest + roster.ts. A smaller end-to-end test proves this wiring is real (a
//      deliberately-sabotaged ruthless tier == randomPolicy must trip strong-vs-random for
//      real, not just in the pure evaluator).

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { DifficultyTier, GameManifest, HarnessThresholds, SolvedValueClaim } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "./roster";
import { resolveNamedAgent } from "./roster";
import { runMatchup, type MatchupReport, type RunMatchupOptions } from "./runner";
import { agentWinRate } from "./metrics";

/** `"deferred"` (platform-corrections.md C27) is NOT a fourth flavor of "n/a". `"n/a"` means
 *  "this gate does not apply to this game" (C2/C23/C26 — a claim that will NEVER become a
 *  number, at any tier: a proven-draw's FPA band, a manifest with no "standard" tier, a CI
 *  rollout override that changed the very quantity under comparison). `"deferred"` means the
 *  opposite: the gate DOES apply and WILL be measured for real, just not at THIS tier — too
 *  expensive (see `GameManifest.ciGateBudget.deferGatesToNightly`). Order vs Chaos, Tilt, and
 *  Bid-Tac-Toe (docs/plans/) each name this exact status as a load-bearing dependency for their
 *  own balance-gate reporting at PR tier. */
/** `"unattained"` (platform-corrections.md C57) is a SIXTH status, in `"deferred"`'s family
 *  rather than `"n/a"`'s or `"fail"`'s: the gate applies, self-play genuinely ran, and the
 *  measured number is real — but there is no declared `attainmentBaseline` to call this a
 *  regression FROM, so it is neither a pass nor an actionable-right-now fail. It reports for
 *  exactly one gate, `"solved-value-reached"`, exactly when a proven `solvedValue` was NOT
 *  attained and the manifest never established a baseline (see `solvedValue.attainmentBaseline`'s
 *  own doc in `@twist-arcade/game-spec`). Never confusable with `"pass"` (a different word,
 *  distinct at the report layer — see `report.ts`'s `STATUS_LABEL`) and never something a game
 *  can manufacture to silence the gate (there is no declaration that produces it — it is what
 *  happens in the ABSENCE of one; the one declaration that WOULD be an abuse vector, a baseline
 *  of `0`, is refused outright by `InvalidAttainmentBaselineError`). */
export type GateStatus = "pass" | "fail" | "warn" | "n/a" | "deferred" | "unattained";

export interface GateResult {
  readonly gate: string;
  readonly status: GateStatus;
  readonly detail: string;
  /** Present iff a manifest `exceptions[]` entry matched this gate and downgraded a would-be
   *  "fail" to "warn" (plan §7.5: an exception is visible in review, never a silent pass). */
  readonly exceptionJustification?: string;
  /** Present (and `true`) iff this row was measured across multiple seeds (`GatePrecisionInputs`
   *  supplied a `SeedPrecision` for it) AND the aggregate mean sits within
   *  `provisionalMultiplier(seedCount)` (df-keyed Student's-t, one-sided 95%) standard errors of
   *  the nearest band edge/threshold/floor it is judged against
   *  (platform-corrections.md C71 Part 1 / C80: "provisional within ~10 points of an edge" was a
   *  human convention applied after the fact; this is that same idea, computed from the gate's
   *  OWN measured seed-to-seed spread instead of a fixed point margin). Never present for a
   *  single-seed measurement (`SeedPrecision.se === 0`) or an `"n/a"`/`"deferred"` row — omitted
   *  (never `false`) when it does not apply, matching every other optional qualifier this module
   *  reports (`exceptionJustification`, C57's `"unattained"`). A provisional row can be `"pass"`
   *  OR `"fail"` — the flag says "this verdict is close enough to its own noise floor that a
   *  second measurement could flip it," not which direction it might flip. */
  readonly provisional?: boolean;
}

/** One rate/mean-style two-player gate value's cross-seed precision (platform-corrections.md
 *  C71 Part 1 / C80). `seedCount` independent seeds; `sd` the SAMPLE standard deviation
 *  (Bessel-corrected, ddof=1) of the `seedCount` per-seed values that were averaged into the
 *  `GateInputs` field this precision describes; `se` the standard error of THAT mean
 *  (`sd / sqrt(seedCount)`). See `aggregateAcrossSeeds`'s own doc for why this is computed
 *  ACROSS seeds (never pooled across all `seedCount * gamesPerSeed` games as one binomial
 *  sample) — C71's own finding is that games within one seed's run are correlated, so a pooled
 *  count understates the true noise. `seedCount === 1` (a caller that never opted into
 *  multi-seed measurement) reports `sd: 0, se: 0` — see that function's own doc for why 0 rather
 *  than `NaN` or `undefined`. */
export interface SeedPrecision {
  readonly seedCount: number;
  readonly sd: number;
  readonly se: number;
}

/** Per-gate `SeedPrecision`, one entry per `GateInputs` field that carries real sampling noise
 *  (platform-corrections.md C71 Part 1: "not every gate needs this" — there is deliberately no
 *  entry for `capHitRate`, whose threshold is "any nonzero fails," a structural fact about
 *  whether an event was OBSERVED at all, not a rate being compared to a band). Every field here
 *  is optional because a single-seed `runCiSuite` call (the byte-identical default this module
 *  has always had) never builds one at all — `evaluateCiGates` treats an absent entry for a gate
 *  exactly like a `SeedPrecision` with `se === 0`: no precision suffix printed, never flagged
 *  provisional.
 *
 *  `solved-value-reached`'s own precision is never a separate field here — `evaluateCiGates`
 *  derives it, internally, from whichever of `drawRate`/`firstPlayerWinRate` `solvedValue.value`
 *  selects, because `solvedValueAttainment` already reads its `achieved` number from that exact
 *  same `GateInputs` field. Reusing the SAME `SeedPrecision` object is what keeps the two from
 *  ever disagreeing about how precise the underlying measurement is — the identical discipline
 *  `solvedValueAttainment`'s own doc comment already applies to `attainment` itself (computed
 *  once, consulted by four blocks, never four independent re-derivations). */
export interface GatePrecisionInputs {
  readonly strongVsRandomWinRate?: SeedPrecision;
  readonly firstPlayerWinRate?: SeedPrecision;
  readonly drawRate?: SeedPrecision;
  readonly meanPlies?: SeedPrecision;
  readonly ruthlessVsStandardWinRate?: SeedPrecision;
}

/** Pure aggregation over `seedCount` independent per-seed measurements of the SAME quantity
 *  (platform-corrections.md C71 Part 1 / C80) — exactly the by-hand computation C49 (2 seeds)
 *  and C71 (5 seeds) each did to state a gate's own spread, automated here so every multi-seed
 *  `runCiSuite` call states it, not just a human replication that happened to run twice.
 *
 *  Deliberately NOT a binomial-at-total-games computation: C71's whole finding is that games
 *  within ONE seed's run are correlated (shared seed lineage) — Tilt's own five-seed FPA
 *  replication measured a 12.9pp seed-to-seed sample SD against a 5.0pp binomial-at-n=100
 *  expectation, 2.6x — so treating `seedCount * gamesPerSeed` as one pool of independent trials
 *  understates the true noise. Treating each SEED's own already-computed rate as one sampling
 *  unit needs no assumption about what correlates WITHIN a seed's games; it only assumes seeds
 *  themselves are independent, which `runMatchup`'s own seed derivation guarantees (distinct
 *  base seed strings choose independent RNG streams).
 *
 *  `sd` uses Bessel's correction (`/(seedCount - 1)`, not `/seedCount`) — these are `seedCount`
 *  independent estimates of one population, and n-1 is what makes `se` an unbiased estimator of
 *  the aggregate mean's own standard error, the same convention C49/C71's prose used informally.
 *  `seedCount === 1` reports `sd: 0, se: 0` rather than `NaN`: a single seed's cross-seed
 *  "spread" is genuinely undefined, but this is a real, reachable measurement (the module's own
 *  default), not the poisoned/unreachable case C4's NaN convention exists for — `se: 0` keeps
 *  every downstream `isProvisional` check a well-defined `false` instead of propagating a NaN
 *  through the report. */
export function aggregateAcrossSeeds(perSeedValues: readonly number[]): SeedPrecision & { readonly mean: number } {
  if (perSeedValues.length === 0) {
    throw new RangeError("aggregateAcrossSeeds: at least one per-seed value is required");
  }
  const seedCount = perSeedValues.length;
  const mean = perSeedValues.reduce((a, b) => a + b, 0) / seedCount;
  if (seedCount === 1) {
    return { seedCount, mean, sd: 0, se: 0 };
  }
  const variance = perSeedValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (seedCount - 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(seedCount);
  return { seedCount, mean, sd, se };
}

/** Floors a FRACTION-valued `SeedPrecision`'s `se` at the binomial standard error a single pooled
 *  measurement of `totalGames` trials at rate `precision.mean` would carry
 *  (`sqrt(mean*(1-mean)/totalGames)`) — platform-corrections.md C80 (stage-6 review): at a small
 *  per-seed game count, per-seed rates are coarsely granular (20 games/seed quantizes to 5pp
 *  steps), so a run of chance-identical seed readings reports a cross-seed `sd`/`se` of exactly
 *  ZERO — an unqualified verdict for a mean that could easily sit ON a band edge, the opposite of
 *  what this module's `provisional` flag exists to catch. The binomial term is a floor, never a
 *  replacement: it says "this measurement's precision can be no better than a single pooled
 *  estimate over every game actually played," which is true regardless of how the cross-seed
 *  estimate happened to land. Only ever applies to the FOUR 0-1 fraction fields
 *  (`strongVsRandomWinRate`, `firstPlayerWinRate`, `drawRate`, `ruthlessVsStandardWinRate`) —
 *  `meanPlies` has no binomial model (it is not a proportion of anything) and is never passed
 *  through this function. A game whose bots reach a proven value at EXACTLY 0% or 100% every
 *  single seed (Fadeout's real `solved-value-reached`: 100.0% at every seed, C23) is correctly
 *  UNAFFECTED — `mean*(1-mean)` is 0 at either extreme, so the floor itself is 0 and `se` stays
 *  whatever the (already-zero) cross-seed estimate was. */
export function withBinomialSeFloor<T extends SeedPrecision & { readonly mean: number }>(
  precision: T,
  totalGames: number
): T {
  const binomialSe = Math.sqrt((precision.mean * (1 - precision.mean)) / totalGames);
  if (binomialSe <= precision.se) return precision;
  return { ...precision, se: binomialSe };
}

/** ONE named confidence level, stated correctly and used everywhere in this module: **one-sided
 *  95%** — "the data cannot rule out the true rate sitting on the far side of this edge with at
 *  least 95% one-sided confidence." (Stage-6 review, platform-corrections.md C80: an earlier draft
 *  of this module used the fixed z-critical value 1.645 for this — which IS the correct one-sided
 *  95% *z* value, but the comment on it wrongly called it "one-sided 90%" (that would be 1.282),
 *  and wrongly described a smaller multiplier as "looser… built to over-flag" — a SMALLER
 *  multiplier narrows the window and produces FEWER flags, the opposite of the stated intent.
 *  Both errors are corrected here by naming the one level this module actually uses and being
 *  precise about which direction "wider" cuts.) */
export const PROVISIONAL_CONFIDENCE_LABEL = "one-sided 95%";

/** One-sided 95% Student's-t critical values, keyed by degrees of freedom (`seedCount - 1`), for
 *  df 1-9. `se` (`SeedPrecision.se`) is an ESTIMATE of the true standard error, itself built from
 *  only `seedCount` samples — at `seedCount = 5` (Tilt/C80's own headline number), that is 4
 *  degrees of freedom, where the t-distribution's tail is meaningfully fatter than the normal
 *  z=1.645 the pre-review draft used unconditionally: t(0.95,4) = 2.132, about 30% wider. Using z
 *  there UNDER-states how far a mean can plausibly sit from the true value given only 5 seeds of
 *  evidence, which means the provisional flag UNDER-fires — exactly the failure mode this flag
 *  exists to prevent (a report reads as an unqualified pass/fail when the data cannot support
 *  that confidence). Source: the standard one-tailed-0.05 Student's-t table. */
const T_95_ONE_SIDED_BY_DF: Readonly<Record<number, number>> = {
  1: 6.314,
  2: 2.92,
  3: 2.353,
  4: 2.132,
  5: 2.015,
  6: 1.943,
  7: 1.895,
  8: 1.86,
  9: 1.833,
};

/** The large-sample z fallback for `df >= 10` (`seedCount >= 11`) — the t-distribution converges
 *  to the normal distribution as df grows (t(0.95,9) = 1.833 is already only ~11% wider than
 *  1.645; the gap keeps shrinking past df=9), so this module stops carrying exact table entries
 *  past that point and uses the asymptotic value instead. This is the module's ONLY remaining use
 *  of a bare z-critical value, and it is the correct one-sided 95% value (see
 *  `PROVISIONAL_CONFIDENCE_LABEL`'s own doc for why this needed saying explicitly). */
const T_95_LARGE_SAMPLE_FALLBACK = 1.645;

/** The df-keyed multiplier `isProvisional` uses in place of a single fixed constant
 *  (platform-corrections.md C80, replacing the pre-review `PROVISIONAL_Z`). `seedCount <= 1`
 *  (df <= 0) is unreachable in practice — `isProvisional` short-circuits on `se === 0` before this
 *  is ever called for a single-seed measurement — but returns the large-sample fallback rather
 *  than throwing, since a df this function has never seen a real caller produce is not worth a
 *  refusal here. */
export function provisionalMultiplier(seedCount: number): number {
  const df = seedCount - 1;
  if (df >= 10 || df <= 0) return T_95_LARGE_SAMPLE_FALLBACK;
  return T_95_ONE_SIDED_BY_DF[df] ?? T_95_LARGE_SAMPLE_FALLBACK;
}

/** True iff `mean` sits within `provisionalMultiplier(precision.seedCount)` standard errors of
 *  ANY of `edges` — see that function's own doc, and `PROVISIONAL_CONFIDENCE_LABEL` for the one
 *  confidence level this is judged against. `undefined`/`se === 0` (no multi-seed precision was
 *  supplied, or a single-seed measurement) always returns `false`: there is no spread to judge
 *  "close" against, so this never fires for the module's existing single-seed default. */
function isProvisional(mean: number, precision: SeedPrecision | undefined, edges: readonly number[]): boolean {
  if (!precision || precision.se === 0) return false;
  const multiplier = provisionalMultiplier(precision.seedCount);
  return edges.some((edge) => Math.abs(mean - edge) <= multiplier * precision.se);
}

/** The human-readable precision suffix appended to a rate-style gate's `detail` string when it
 *  was measured across multiple seeds — `""` (no change to `detail` at all) for the module's
 *  existing single-seed default, so a caller that never opts into `seedCount > 1` sees
 *  byte-identical detail text to before C71/C80. `unit: "pp"` (the default) is for the FOUR
 *  fields that are 0-1 fractions (`strongVsRandomWinRate`, `firstPlayerWinRate`, `drawRate`,
 *  `ruthlessVsStandardWinRate`) — `sd`/`se` are scaled ×100 into percentage points, matching
 *  every other number this module already prints as a percentage. `meanPlies` is NOT a
 *  fraction — it is a raw ply count (Tilt's own real numbers: mean ~19 plies) — so `unit:
 *  "plies"` prints `sd`/`se` UNSCALED, in plies, never mislabelled "pp" (an earlier draft of this
 *  function did exactly that: a real multi-seed Tilt run printed "SD=118.2pp" for a quantity
 *  whose actual spread was ~1.18 PLIES, a 100x-misleading unit — caught by running the real
 *  wiring against a real game, not a hand-built fixture, which is why this suffix is unit-aware). */
function precisionSuffix(precision: SeedPrecision | undefined, unit: "pp" | "plies" = "pp"): string {
  if (!precision || precision.seedCount <= 1) return "";
  if (unit === "plies") {
    return ` [seeds=${precision.seedCount}, seed-to-seed SD=${precision.sd.toFixed(2)} plies, SE=${precision.se.toFixed(2)} plies]`;
  }
  return ` [seeds=${precision.seedCount}, seed-to-seed SD=${(precision.sd * 100).toFixed(1)}pp, SE=${(precision.se * 100).toFixed(1)}pp]`;
}

/** `solved-value-reached`'s own precision, DERIVED rather than a separate `GatePrecisionInputs`
 *  field (see that interface's own doc) — `solvedValueAttainment` reads `achieved` from
 *  `inputs.drawRate` (a proven draw) or `inputs.firstPlayerWinRate` (a proven decisive value), so
 *  this reads the matching `SeedPrecision` from the SAME two fields, never a third computation
 *  that could drift from what those two gates themselves report. */
function attainmentPrecision(
  solvedValue: SolvedValueClaim | undefined,
  precision: GatePrecisionInputs | undefined
): SeedPrecision | undefined {
  if (!solvedValue || solvedValue.value === "unknown") return undefined;
  return solvedValue.value === "draw" ? precision?.drawRate : precision?.firstPlayerWinRate;
}

/** Info `evaluateCiGates` needs to decide whether this lane's self-play-derived gates are
 *  deferred to nightly at this run (platform-corrections.md C27). `active` is true only when
 *  suite "ci" actually saw `manifest.ciGateBudget.deferGatesToNightly` — the SAME condition
 *  `runCiSuite` uses to skip running any matchup at all, computed once and threaded through
 *  rather than re-derived, so the gate table and the skipped self-play can never disagree about
 *  whether deferral happened. `reason` is folded verbatim into every deferred row's detail. */
export interface CiGateDeferral {
  readonly active: boolean;
  readonly reason: string;
}

/** Every two-player gate row `evaluateCiGates` owns — ALL SIX can report `"deferred"` when a
 *  `CiGateDeferral` is active. Exactly ONE has a STRUCTURAL "n/a" reason that survives deferral
 *  unconditionally: `ruthless-vs-standard`'s "no standard tier at all" branch, a fact about the
 *  manifest that is true independent of solvedValue, deferral, or self-play. That check stays in
 *  front of the deferral check in its own block below, so that row is never relabelled
 *  "deferred". The other solvedValue-proven n/a branches (`first-player-win-rate`, `draw-rate`,
 *  and `ruthless-vs-standard`'s own proven-draw branch) are **not** structural — since
 *  platform-corrections.md C55, their relief is conditional on `solved-value-reached` actually
 *  passing, which is itself computed from self-play data. Deferral means that data was never
 *  collected this tier, so whether the proof was reached is UNMEASURED, not "known true" — those
 *  branches defer along with everything else, exactly like `solved-value-reached` itself. Named
 *  once here so the nightly abuse guard stays in lockstep with the gate blocks themselves.
 *  NOT exported for deferral-ledger.ts's use (platform-corrections.md C81's A2 finding): a
 *  canonical list here can disagree with what a REAL report actually contains at any given run
 *  (`ruthless-vs-standard`/`solved-value-reached` can independently be `"n/a"` for structural
 *  reasons), so discharge recognition derives "what was measured" from each report's own rows
 *  instead (`measuredGateNames` in deferral-ledger.ts), never from this constant. */
const DEFERRABLE_CI_GATES = [
  "strong-vs-random",
  "first-player-win-rate",
  "draw-rate",
  "mean-plies",
  "ruthless-vs-standard",
  "solved-value-reached",
] as const;

/** `"deferred"`, naming the tier that measures the row for real (C27) — distinct at the report
 *  layer from both `"n/a"` (never measured, at any tier) and a real `"pass"`/`"fail"`/`"warn"`
 *  (measured, right here, right now). Exported so `probes-two-player.ts` reuses this SAME
 *  formatting for its own three probe rows under an active C27 deferral, rather than a second,
 *  independently-worded copy drifting from this one. */
export function deferredGate(gate: string, reason: string): GateResult {
  return { gate, status: "deferred", detail: `measured at nightly (${reason})` };
}

/** Thrown by `evaluateCiGates` when suite `"nightly"` is given an active `CiGateDeferral`
 *  (platform-corrections.md C27's abuse guard). `runCiSuite` structurally never builds an
 *  active deferral at suite "nightly" (it only ever consults
 *  `manifest.ciGateBudget.deferGatesToNightly` when `suite === "ci"`), but this is independent,
 *  defense-in-depth enforcement at the pure evaluator itself: a row deferred at EVERY tier is a
 *  gate that never runs again, and that must be a loud, immediate failure here, not a quiet
 *  status shipped in a "nightly: OK" report nobody double-checks. */
export class TwoPlayerDeferredGateAtNightlyError extends Error {
  constructor(reason: string) {
    super(
      `evaluateCiGates: suite "nightly" was given an ACTIVE deferral (reason: "${reason}") for ` +
        `[${DEFERRABLE_CI_GATES.join(", ")}] (platform-corrections.md C27). A gate deferred at ` +
        "EVERY tier never runs — nightly must measure the full self-play table for real, never " +
        "defer again."
    );
    this.name = "TwoPlayerDeferredGateAtNightlyError";
  }
}

/** The already-computed numbers `evaluateCiGates` gates on — kept separate from `MatchupReport`
 *  so the pure evaluator can be tested with hand-built values, no real self-play required. */
export interface GateInputs {
  strongVsRandomWinRate: number;
  firstPlayerWinRate: number;
  drawRate: number;
  meanPlies: number;
  capHitRate: number;
  /** `null` when the manifest has no `"standard"` tier to compare against — reported as an
   *  explicit "n/a" gate (C2's "a skipped gate and a passed gate must never look the same"
   *  applies here exactly as it does to the solo suites). */
  ruthlessVsStandardWinRate: number | null;
}

/** Exported (was module-private) so `probes-two-player.ts` can validate its OWN exceptions[]
 *  independently, standalone-safe (see `validateExceptions` below), rather than trusting a
 *  caller always ran `evaluateCiGates` first with the same list. */
export interface ManifestException {
  readonly gate: string;
  readonly justification: string;
}

/** Thrown by `evaluateCiGates` when a manifest exception's `justification` is empty (or
 *  whitespace-only). Plan §7.5's whole point is that an exception must be "visible in review,
 *  never a silent pass" — a blank justification defeats that at the REPORT layer, not just in
 *  spirit: `formatCiSuiteTable` prints a bare `[WARN] gate: detail` for an exception with no
 *  text, byte-for-byte indistinguishable from an ordinary (non-excused) warn, so a reviewer has
 *  no way to tell "this fail was deliberately excused" from "this gate just warns". Refusing
 *  loudly here, at the manifest boundary, is cheaper than a reviewer ever discovering the gap. */
export class EmptyExceptionJustificationError extends Error {
  constructor(gate: string) {
    super(
      `evaluateCiGates: manifest exception for gate "${gate}" has an empty justification — an ` +
        'exception must be visible in review (plan §7.5, "never a silent pass"); a blank ' +
        "justification is indistinguishable from an ordinary warn once downgraded."
    );
    this.name = "EmptyExceptionJustificationError";
  }
}

/** The six gate names that actually route through `applyException` below. This is the SINGLE
 *  place they are typed (platform-corrections.md C64): `applyException`'s own `gate` parameter
 *  is typed as `ExceptionableGate`, the union derived FROM this array via `(typeof
 *  EXCEPTIONABLE_GATES)[number]` — so a future gate block that calls `applyException` with a
 *  literal not in this list fails TYPECHECK, at that call site, before the code ever runs. That
 *  is what makes the coupling real instead of aspirational: previously `KNOWN_EXCEPTIONABLE_GATES`
 *  was a second hand-typed literal, checked only against a THIRD hand-typed literal in
 *  suites.test.ts — two places to keep in sync by memory, wearing a comment that claimed
 *  otherwise. Now there is exactly one array, and the compiler is what enforces every
 *  `applyException` call site against it. `KNOWN_EXCEPTIONABLE_GATES` (a `ReadonlySet`, kept for
 *  the runtime membership check below and for `UnknownExceptionGateError`'s message) is derived
 *  from the same array, never re-typed. An `exceptions[]` entry naming a gate outside this set is
 *  silently dead at runtime regardless: it never matches inside `applyException` (which does a
 *  `find((e) => e.gate === gate)` per gate block), so it never downgrades anything, anywhere —
 *  indistinguishable, at the report layer, from a typo nobody caught. `UnknownExceptionGateError`
 *  refuses that up front, same seam as `EmptyExceptionJustificationError`. */
/** WIDENED under docs/plans/degeneracy-probes.md (C64) to include the three two-player
 *  degeneracy probe gates (`probes-two-player.ts`'s own `evaluateProbeGates`, plan §1.4: "all
 *  three measured probe gates join EXCEPTIONABLE_GATES, so a justified, reviewable exception can
 *  downgrade a fail — never silently"). This is what makes `UnknownExceptionGateError`'s former
 *  "mirror-probe" special case (see that class's own doc) FALSE the moment mirror can genuinely
 *  fail: it is no longer an unknown, unexceptionable name — it is now a real, measured gate like
 *  any other in this array. */
const EXCEPTIONABLE_GATES = [
  "strong-vs-random",
  "first-player-win-rate",
  "draw-rate",
  "mean-plies",
  "ruthless-vs-standard",
  "solved-value-reached",
  "mirror-probe",
  "stall-probe",
  "rush-probe",
] as const;

/** The type-level twin of `EXCEPTIONABLE_GATES` — every literal `applyException`'s `gate`
 *  parameter accepts. See that array's own doc for why this is what turns "derived from the call
 *  sites" from a comment into an enforced fact. */
export type ExceptionableGate = (typeof EXCEPTIONABLE_GATES)[number];

export const KNOWN_EXCEPTIONABLE_GATES: ReadonlySet<string> = new Set(EXCEPTIONABLE_GATES);

/** Thrown by `evaluateCiGates` (and standalone by `probes-two-player.ts`'s own
 *  `validateExceptions` call, via the shared `validateExceptions` helper below) when a manifest
 *  exception names a gate that is not one of `KNOWN_EXCEPTIONABLE_GATES` (platform-corrections.md
 *  C63). Same posture, same seam as `EmptyExceptionJustificationError`: an exception that can
 *  never downgrade anything is not a quirky no-op, it is an honesty defect — deferring this
 *  refusal (as a "later" cleanup) is exactly how C48's mirror-probe reasoning rotted unimplemented
 *  across two games before it was finally routed at C62/C63, so it is refused here, now, at the
 *  manifest boundary.
 *
 *  CORRECTED under docs/plans/degeneracy-probes.md (C64/C65): this class used to special-case
 *  `"mirror-probe"` with guidance pointing at `manifest.mirrorProbe` instead, on the claim that
 *  mirror-probe "never reports fail (only n/a), so there is nothing for an exception to
 *  downgrade." That claim is now FALSE — `probes-two-player.ts`'s `evaluateProbeGates` measures a
 *  real mirror-probe win rate whenever a game does NOT declare `manifest.mirrorProbe`, and it CAN
 *  fail (at suite "nightly"; "ci" downgrades to warn structurally, same severity rule as
 *  `ruthless-vs-standard`). `"mirror-probe"` (and its two siblings, `"stall-probe"`/
 *  `"rush-probe"`) are ordinary members of `EXCEPTIONABLE_GATES` now — leaving the old special
 *  case in place would have been exactly the stale-guidance defect C65 itself was about: a
 *  correction that stops being true and nothing acts on it. The two claims stay distinct, as
 *  the plan requires: `manifest.mirrorProbe` says "the probe cannot measure its claim here";
 *  `exceptions[]` says "it measured, it fired, and here is why we ship anyway." */
export class UnknownExceptionGateError extends Error {
  constructor(gate: string) {
    super(
      `evaluateCiGates: manifest exception names gate "${gate}", which does not route through ` +
        "applyException (platform-corrections.md C63) — an exception naming a gate that does not " +
        "exist is silently dead, never downgrading anything, indistinguishable from a typo nobody " +
        `caught. Known exceptionable gates are: ${[...KNOWN_EXCEPTIONABLE_GATES].join(", ")}.`
    );
    this.name = "UnknownExceptionGateError";
  }
}

/** Validates a manifest's `exceptions[]` list up front, before any gate evaluates on the
 *  strength of it — identity (is this a known gate) checked before content (is the
 *  justification blank), same ordering rule `evaluateCiGates` has always used (see its own
 *  comment at the call site below for why that ordering is deliberate). Extracted (was inlined
 *  in `evaluateCiGates` only) so `probes-two-player.ts`'s `evaluateProbeGates` can call this
 *  SAME validation on its own, standalone (its own tests build inputs by hand, with no
 *  `evaluateCiGates` call in the loop at all) — a pure evaluator that silently accepted a dead
 *  exception when tested in isolation would be exactly the kind of quiet gap this module's other
 *  validators (`EmptyExceptionJustificationError`, `MissingSolvedValueProofError`, ...) exist to
 *  rule out everywhere, not just when composed through `runCiSuite`. */
export function validateExceptions(exceptions: readonly ManifestException[]): void {
  for (const exception of exceptions) {
    // C63: a dead exception (naming a gate applyException never sees) must never reach the
    // report layer any more than a blank justification may.
    if (!KNOWN_EXCEPTIONABLE_GATES.has(exception.gate)) {
      throw new UnknownExceptionGateError(exception.gate);
    }
    if (exception.justification.trim() === "") {
      throw new EmptyExceptionJustificationError(exception.gate);
    }
  }
}

/** Applies a manifest exception (if any) to a raw "fail" verdict: downgrades to "warn" with the
 *  justification attached. A raw "pass"/"warn"/"n/a" is returned unchanged — an exception only
 *  ever SOFTENS a fail, it can never manufacture one, and it is applied per gate name (an
 *  exception for gate X must never touch gate Y). Exported so `probes-two-player.ts` applies
 *  the SAME exception mechanism to its three probe gates (now in `EXCEPTIONABLE_GATES`) rather
 *  than a parallel, independently-typed downgrade path. */
export function applyException(
  gate: ExceptionableGate,
  raw: GateStatus,
  detail: string,
  exceptions: readonly ManifestException[],
  provisional = false
): GateResult {
  // `provisional` is spread in ONLY when true (never `provisional: false`) — every existing call
  // site that never passes a 5th argument keeps producing the EXACT SAME GateResult shape as
  // before C71/C80 (no extra key at all), which is what keeps this an additive-only change.
  const provisionalField = provisional ? { provisional: true as const } : {};
  if (raw !== "fail") return { gate, status: raw, detail, ...provisionalField };
  const exception = exceptions.find((e) => e.gate === gate);
  if (!exception) return { gate, status: "fail", detail, ...provisionalField };
  return { gate, status: "warn", detail, exceptionJustification: exception.justification, ...provisionalField };
}

/** Thrown by `evaluateCiGates` when a manifest's `solvedValue` claims a non-"unknown" value with
 *  no `proof` pointer (platform-corrections.md C23: "asserting a value is not proving one" —
 *  the exact confidence that failed on Wrap's predicted-but-unmeasured FPA, and the standard a
 *  "none by construction" balance claim like Bid-Tac-Toe's gets no relief under either). Mirrors
 *  `EmptyExceptionJustificationError`'s posture at the same seam: refused at the manifest
 *  boundary, before any gate is evaluated on the strength of the claim. A game may only receive
 *  gate relief backed by a real, NAMED artifact, never by assertion. */
export class MissingSolvedValueProofError extends Error {
  constructor(value: string) {
    super(
      `evaluateCiGates: manifest.solvedValue.value is "${value}" but carries no "proof" pointer ` +
        "(platform-corrections.md C23: asserting a value is not proving one). Add " +
        "manifest.solvedValue.proof naming the artifact that proves this value (e.g. a solve " +
        "report path and section) before this claim can grant any gate relief."
    );
    this.name = "MissingSolvedValueProofError";
  }
}

/** Thrown by `evaluateCiGates` when a manifest's `solvedValue.attainmentBaseline` is declared
 *  but invalid — `rate` not in `(0, 1]`, or a blank `proof` (platform-corrections.md C57). Same
 *  posture, same seam as `MissingSolvedValueProofError` and `EmptyExceptionJustificationError`:
 *  refused at the manifest boundary, before any gate runs on the strength of the claim.
 *
 *  The `rate <= 0` case is the load-bearing one: a declared `0` baseline would make EVERY future
 *  measurement read as "at or above baseline" (nothing is ever below zero), which would silence
 *  `solved-value-reached`'s regression check forever — exactly the waiver-by-declaration this
 *  status exists to prevent (C57's explicit requirement: "a game must not be able to declare a
 *  0% baseline and thereby silence the gate forever"). A game earns the regression-detecting
 *  `"fail"` behavior only by recording a real, positive, cited attainment rate — never by
 *  asserting a number chosen to duck the gate. */
export class InvalidAttainmentBaselineError extends Error {
  constructor(reason: string) {
    super(
      `evaluateCiGates: manifest.solvedValue.attainmentBaseline is invalid — ${reason} ` +
        "(platform-corrections.md C57). A declared baseline must be a real, previously-measured " +
        "rate in (0, 1] with a non-empty proof pointer naming where it was measured — a 0 rate " +
        "would make every future measurement look like it never fell below baseline, silencing " +
        "the regression check permanently, which is exactly what this refusal exists to prevent."
    );
    this.name = "InvalidAttainmentBaselineError";
  }
}

/** Info `evaluateCiGates` needs to decide whether a CI-suite rollout override has changed the
 *  very quantity `ruthless-vs-standard` compares (platform-corrections.md C26). `active` is
 *  true only when suite "ci" actually substituted `ciGateBudget.twoPlayerCiRollouts` in place
 *  of the shipped `ruthless` budget — the SAME condition `runCiSuite` uses to build the
 *  in-memory clone, computed once and threaded through rather than re-derived, so the gate and
 *  the substitution can never disagree about whether it happened. `ruthlessN`/`standardN` are
 *  the two budgets under comparison, named in the gate's own `n/a` detail so a reader can see
 *  WHY it wasn't measured, not just that it wasn't. */
export interface RuthlessVsStandardBudgets {
  readonly active: boolean;
  readonly ruthlessN: number;
  readonly standardN: number | null;
}

/** Self-play floor for the "solved-value-reached" gate (platform-corrections.md C23's inverted
 *  check): for a game with a PROVEN `solvedValue`, self-play must actually reach that value at a
 *  healthy rate — the real regression signal a decided game needs, and the exact opposite of the
 *  un-corrected `draw-rate`/`first-player-win-rate` gates that failed Fadeout for playing
 *  correctly. Grounded in C23's own sweep: Fadeout's self-play reached the proven draw at
 *  EXACTLY 100% across all six tested points (3,000 through 10,000 rollouts; 25 through 100
 *  games), with zero variance. 0.90 sits comfortably below that observed floor — room for
 *  legitimate noise (a different seed, a minor bot change) — while still catching a real
 *  regression: the orchestrator's own worked example, a drop to 70%, fails this floor by a wide
 *  margin. That is the point: the un-corrected gate would have scored that drop as an
 *  IMPROVEMENT (closer to the "balanced" 35-65% FPA band it was checking instead). */
export const SOLVED_VALUE_SELF_PLAY_FLOOR = 0.9;

/** Whether self-play actually reached a manifest's proven `solvedValue`, at
 *  `SOLVED_VALUE_SELF_PLAY_FLOOR` — the SAME quantity the `solved-value-reached` gate itself
 *  reports (platform-corrections.md C55). Returns `null` when there is no proven value to check
 *  (mirrors that gate's own n/a case). Computed ONCE per `evaluateCiGates` call, directly off
 *  already-computed `inputs` — never off another gate's already-pushed `GateResult` — and
 *  consulted by FOUR blocks below: `first-player-win-rate`, `draw-rate`, `ruthless-vs-standard`,
 *  and `solved-value-reached` itself. Reading from a shared computation rather than four
 *  independent re-derivations is what closes C55: the relief (the first three) and the check
 *  (the fourth) cannot drift apart, because there is only one place that decides "was the proof
 *  reached" and every consumer reads the same answer.
 *
 *  This is also the answer to "can this be circular or order-dependent" (C55's own ask): it is
 *  neither, structurally. `evaluateCiGates` builds `attainment` once, before any gate block
 *  pushes anything to `results`, from `inputs`/`solvedValue` alone — quantities that exist
 *  before gate evaluation starts. No block reads `results` to decide its own status, so the four
 *  blocks that consult `attainment` could be evaluated in ANY order (or even in parallel) and
 *  would produce byte-identical output — there is no dependency edge for a cycle to form on, and
 *  nothing for evaluation order to perturb.
 *
 *  EXPORTED, and its `inputs` parameter WIDENED to `Pick<GateInputs, ...>` (docs/plans/
 *  degeneracy-probes.md §1.3), so `probes-two-player.ts`'s rush-probe reuses this EXACT
 *  computation for its own "proven, reached draw makes a parity score evidence of nothing"
 *  relief — never re-deriving it off a second, independently-computed drawRate/
 *  firstPlayerWinRate pair (the plan's own named C55-shape risk: "re-deriving instead of sharing
 *  it lets the probe relief and solved-value-reached drift"). The composing caller
 *  (`ci-gates.ts`'s `runTwoPlayerCiGate`) computes this ONCE from `runCiSuite`'s own strong-
 *  self-play numbers and threads the result into `runProbeSuite`. */
export function solvedValueAttainment(
  solvedValue: SolvedValueClaim | undefined,
  inputs: Pick<GateInputs, "drawRate" | "firstPlayerWinRate">
): { readonly achieved: number; readonly reached: boolean } | null {
  if (!solvedValue || solvedValue.value === "unknown") return null;
  const achieved =
    solvedValue.value === "draw"
      ? inputs.drawRate
      : solvedValue.value === "p0-win"
        ? inputs.firstPlayerWinRate
        : 1 - inputs.firstPlayerWinRate;
  return { achieved, reached: achieved >= SOLVED_VALUE_SELF_PLAY_FLOOR };
}

/**
 * Pure gate evaluation (see module doc for why this is split from `runCiSuite`). `suite`
 * selects only the ruthless-vs-standard row's severity (warn at PR budget vs hard-fail
 * nightly, per roadmap §6) — every other row's threshold is suite-independent. `solvedValue`
 * (platform-corrections.md C23) is the manifest's proven game-theoretic value, when it has one —
 * omitted (or `{ value: "unknown" }`) leaves every gate below exactly as it was before C23.
 * C55: a proven `solvedValue` only grants n/a relief to the three decisiveness gates when
 * self-play actually REACHES it (`solvedValueAttainment` above) — a game that declares a proof
 * but whose bots never attain it (Bid-Tac-Toe) measures for real instead.
 */
export function evaluateCiGates(
  inputs: GateInputs,
  thresholds: HarnessThresholds,
  exceptions: readonly ManifestException[] = [],
  suite: "ci" | "nightly" = "ci",
  solvedValue?: SolvedValueClaim,
  ruthlessBudgets?: RuthlessVsStandardBudgets,
  deferral?: CiGateDeferral,
  /** platform-corrections.md C71 Part 1 / C80: per-gate cross-seed precision, absent by default
   *  (every existing call site keeps producing byte-identical `GateResult`s — see
   *  `GatePrecisionInputs`'s own doc). When present, the relevant rate/mean-style gate blocks
   *  below append a precision suffix to `detail` and set `provisional` when the aggregate mean
   *  sits within `provisionalMultiplier(seedCount)` standard errors of the edge it is judged
   *  against. */
  precision?: GatePrecisionInputs
): GateResult[] {
  // Validated up front, before any gate runs — an exception with a blank justification or an
  // unknown gate name is rejected regardless of whether it ends up matching a failing gate (see
  // EmptyExceptionJustificationError's own doc for why this must never reach the report layer).
  //
  // C64: identity (does this gate exist) is checked BEFORE content (is the justification blank)
  // — the more useful first error when an exception is broken in both ways at once. An author
  // who mistypes a gate name AND leaves the justification blank should learn the gate name is
  // wrong first; fixing the justification, re-running, and only then discovering the gate name
  // was wrong too is a worse loop than the reverse. Neither check can ever silence the other —
  // this is purely an ordering choice, not a change in what gets refused.
  validateExceptions(exceptions);

  // C23: same posture, same seam — a claimed solved value with no proof is refused before any
  // gate runs on the strength of it.
  if (solvedValue && solvedValue.value !== "unknown" && (!solvedValue.proof || solvedValue.proof.trim() === "")) {
    throw new MissingSolvedValueProofError(solvedValue.value);
  }

  // C57: same posture, same seam — a declared attainmentBaseline is validated before any gate
  // runs on the strength of it. `rate <= 0` is the abuse vector this refusal exists to close
  // (see InvalidAttainmentBaselineError's own doc); `rate > 1` and a blank proof are rejected
  // for the same "a number is evidence about how it was measured" reason (C25) that gates every
  // other declared claim in this module.
  const baseline = solvedValue?.attainmentBaseline;
  if (baseline) {
    if (baseline.rate <= 0) {
      throw new InvalidAttainmentBaselineError(`rate ${baseline.rate} is not greater than 0`);
    }
    if (baseline.rate > 1) {
      throw new InvalidAttainmentBaselineError(`rate ${baseline.rate} exceeds 1 (rates are fractions, not percentages)`);
    }
    if (baseline.proof.trim() === "") {
      throw new InvalidAttainmentBaselineError("proof is empty — a baseline must say where it was measured (C25)");
    }
  }

  // C27's abuse guard: nightly is the ONLY tier allowed to report these six rows as anything
  // other than "deferred" — a caller that hands nightly an active deferral (by accident, or by
  // copy-pasting the ci-tier wiring) gets refused here, loudly, rather than shipping a
  // "nightly: OK" report where the gate never actually ran.
  if (suite === "nightly" && deferral?.active) {
    throw new TwoPlayerDeferredGateAtNightlyError(deferral.reason);
  }

  // C55: computed ONCE, off `inputs`/`solvedValue` alone (never off `results`) — see
  // `solvedValueAttainment`'s own doc for why this rules out any circular or order-dependent
  // outcome among the four blocks below that consult it.
  const attainment = solvedValueAttainment(solvedValue, inputs);
  // C71 Part 1 / C80: the SAME precision object the draw-rate/first-player-win-rate blocks
  // themselves read — see `attainmentPrecision`'s own doc for why this is a derivation, not a
  // fourth `GatePrecisionInputs` field.
  const attPrecision = attainmentPrecision(solvedValue, precision);

  const results: GateResult[] = [];

  {
    if (deferral?.active) {
      results.push(deferredGate("strong-vs-random", deferral.reason));
    } else {
      const pass = inputs.strongVsRandomWinRate >= thresholds.strongVsRandomMinWinRate;
      const p = precision?.strongVsRandomWinRate;
      const provisional = isProvisional(inputs.strongVsRandomWinRate, p, [thresholds.strongVsRandomMinWinRate]);
      results.push(
        applyException(
          "strong-vs-random",
          pass ? "pass" : "fail",
          `${(inputs.strongVsRandomWinRate * 100).toFixed(1)}% (min ${(thresholds.strongVsRandomMinWinRate * 100).toFixed(1)}%)${precisionSuffix(p)}`,
          exceptions,
          provisional
        )
      );
    }
  }

  {
    // C23/C55: for ANY proven solvedValue (draw, p0-win, or p1-win), a "balanced" FPA band is
    // unsatisfiable by construction — a solved game's first-player win rate is a KNOWN quantity
    // (0% for a draw or a p1-win, ~100% for a p0-win), not a design target to hit a range around
    // — BUT only once self-play actually REACHES that value (`attainment.reached`). A declared
    // proof whose bots never attain it (Bid-Tac-Toe, C55) must not silence a currently-meaningful
    // gate. Deferral is checked FIRST: it means self-play never ran at all this tier, so whether
    // the proof was reached is unmeasured, not "known true" — reporting n/a on unmeasured data
    // would be exactly the drift C55 closes, so this defers instead, same as every other
    // self-play-derived row.
    if (deferral?.active) {
      results.push(deferredGate("first-player-win-rate", deferral.reason));
    } else if (attainment && attainment.reached) {
      // Byte-identical to the pre-C55 text on purpose (Fadeout's own real output): the "reached"
      // branch is the UNCHANGED case (C23's original guarantee, still true here), so it carries
      // none of C55's new machinery in its wording — only the withheld branch below, which never
      // existed before C55, gets new text.
      results.push({
        gate: "first-player-win-rate",
        status: "n/a",
        detail: `manifest.solvedValue is a proven "${solvedValue!.value}" (${solvedValue!.proof}) — a balanced-FPA band does not apply to a solved game`,
      });
    } else {
      const [lo, hi] = thresholds.firstPlayerWinRateRange;
      const pass = inputs.firstPlayerWinRate >= lo && inputs.firstPlayerWinRate <= hi;
      const p = precision?.firstPlayerWinRate;
      const provisional = isProvisional(inputs.firstPlayerWinRate, p, [lo, hi]);
      const measured = `${(inputs.firstPlayerWinRate * 100).toFixed(1)}% (band [${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%])${precisionSuffix(p)}`;
      const detail = attainment
        ? // C55: a proof was declared but relief is WITHHELD — self-play never reached it, so
          // this is a real measurement, not a stale n/a. Naming solved-value-reached's own
          // number keeps a reader from mistaking this real fail for a wrong solvedValue claim.
          `${measured} — solvedValue relief withheld: self-play reached the proven "${solvedValue!.value}" only ${(attainment.achieved * 100).toFixed(1)}% of the time (floor ${(SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0)}%, see solved-value-reached)`
        : measured;
      results.push(applyException("first-player-win-rate", pass ? "pass" : "fail", detail, exceptions, provisional));
    }
  }

  {
    // C23/C55: a draw-rate CEILING is unsatisfiable by construction specifically for a proven
    // draw (the true value is 100%) — n/a, citing the proof, but only once self-play actually
    // REACHES that draw (`attainment.reached`). A proven DECISIVE value (p0-win/p1-win) never
    // conflicts with this gate in the first place (a low draw rate is still the expected,
    // checkable outcome there), so `attainment` is only consulted when `value === "draw"`.
    // Deferral checked first, same reasoning as FPA above: unmeasured attainment defers, it is
    // never reported as a "known" n/a.
    const drawAttainment = solvedValue?.value === "draw" ? attainment : null;
    if (deferral?.active) {
      results.push(deferredGate("draw-rate", deferral.reason));
    } else if (drawAttainment && drawAttainment.reached) {
      // Byte-identical to the pre-C55 text on purpose — see the FPA block's own comment above.
      results.push({
        gate: "draw-rate",
        status: "n/a",
        detail: `manifest.solvedValue is a proven draw (${solvedValue!.proof}) — a draw-rate ceiling is unsatisfiable by construction for a drawn game`,
      });
    } else {
      const pass = inputs.drawRate <= thresholds.maxDrawRate;
      const p = precision?.drawRate;
      const provisional = isProvisional(inputs.drawRate, p, [thresholds.maxDrawRate]);
      const measured = `${(inputs.drawRate * 100).toFixed(1)}% (max ${(thresholds.maxDrawRate * 100).toFixed(1)}%)${precisionSuffix(p)}`;
      const detail = drawAttainment
        ? `${measured} — solvedValue relief withheld: self-play reached the proven draw only ${(drawAttainment.achieved * 100).toFixed(1)}% of the time (floor ${(SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0)}%, see solved-value-reached)`
        : measured;
      results.push(applyException("draw-rate", pass ? "pass" : "fail", detail, exceptions, provisional));
    }
  }

  {
    if (deferral?.active) {
      results.push(deferredGate("mean-plies", deferral.reason));
    } else {
      const [lo, hi] = thresholds.pliesRange;
      const inBand = inputs.meanPlies >= lo && inputs.meanPlies <= hi;
      const noCapHits = inputs.capHitRate === 0;
      const pass = inBand && noCapHits;
      const p = precision?.meanPlies;
      // Provisional is judged against the PLIES band only, never against the cap-hit-rate=0
      // threshold — that threshold is structural (platform-corrections.md C71 Part 1: "any cap
      // hit fails" is a fact about whether an event was OBSERVED, not a rate with a confidence
      // interval), so a real cap hit is never softened to "provisional" no matter how close the
      // plies mean sits to its own band edge.
      const provisional = noCapHits && isProvisional(inputs.meanPlies, p, [lo, hi]);
      // "across all matchups" made explicit here (not just self-play) — this IS
      // worstCapHitRate's own aggregation (see its doc comment), and a report that prints a
      // DIFFERENT, self-play-only cap-hit number alongside this one (as an ad hoc debug script
      // did during the C23 investigation) reads as two numbers for one quantity. This is the one
      // number the gate actually uses; it says so.
      const detail = !inBand
        ? `mean ${inputs.meanPlies.toFixed(1)} plies (band [${lo}, ${hi}])${precisionSuffix(p, "plies")}`
        : !noCapHits
          ? `mean ${inputs.meanPlies.toFixed(1)} plies in band, but cap-hit rate ${(inputs.capHitRate * 100).toFixed(2)}% > 0 across all matchups (any cap hit fails)`
          : `mean ${inputs.meanPlies.toFixed(1)} plies, 0 cap hits across all matchups${precisionSuffix(p, "plies")}`;
      results.push(applyException("mean-plies", pass ? "pass" : "fail", detail, exceptions, provisional));
    }
  }

  {
    // C23/C55: "ruthless cannot out-win standard when neither can win" — unsatisfiable by
    // construction specifically for a proven draw, but again only once self-play actually
    // REACHES that draw. A proven decisive value does not have this problem (ruthless SHOULD
    // still out-win standard more often via better search), so `attainment` is only consulted
    // when `value === "draw"`, same as the draw-rate block above.
    const drawAttainment = solvedValue?.value === "draw" ? attainment : null;
    if (inputs.ruthlessVsStandardWinRate === null) {
      // Structural fact independent of solvedValue, deferral, AND self-play: this manifest has
      // no "standard" tier at all, so there is nothing this gate could ever measure, at any
      // tier — n/a, never "deferred". Checked FIRST, ahead of even deferral, because it is the
      // one branch here that is genuinely unconditional.
      results.push({ gate: "ruthless-vs-standard", status: "n/a", detail: "manifest has no \"standard\" tier" });
    } else if (deferral?.active) {
      // There IS a standard tier (the branch above didn't fire), so this row WOULD be a real
      // number if self-play ran — it just didn't, at this tier, so whether a proven draw's
      // relief applies is unmeasured too (same reasoning as draw-rate/FPA above).
      results.push(deferredGate("ruthless-vs-standard", deferral.reason));
    } else if (drawAttainment && drawAttainment.reached) {
      // Byte-identical to the pre-C55 text on purpose — see the FPA block's own comment above.
      results.push({
        gate: "ruthless-vs-standard",
        status: "n/a",
        detail: `manifest.solvedValue is a proven draw (${solvedValue!.proof}) — ruthless cannot out-win standard when neither can win`,
      });
    } else if (ruthlessBudgets?.active) {
      // C26 (Nine Grids): TierBudgetCollapseError's strict-inequality check (ruthlessN >
      // standardN) is NECESSARY but not SUFFICIENT — MCTS strength grows roughly with the
      // LOGARITHM of rollouts, so a budget gap that clears the strict inequality (Nine Grids:
      // 1,500 vs standard's 1,000, a 1.5x gap) can still be a strength difference noise
      // swallows whole, when the SHIPPED gap is 10x (10,000 vs 1,000). The measured number in
      // that case is not a finding about the game — it is an artifact of the CI substitution
      // having changed the very quantity under comparison. Reporting a WARN with that number
      // reads as a real result; it is not one. Reject the temptation to fix this with a ratio
      // threshold instead (rejected in platform-corrections.md C26): any ratio is a guess about
      // how strength scales with rollouts for an unknown game, the exact assumption C22 and C25
      // already punished twice (Wrap's safe ratio was unsafe for Fadeout; a budget proven on a
      // 6x6 fixture didn't transfer to Mine Run's 10x10 board). n/a, naming both budgets, is
      // honest about what CI can and cannot measure — nightly never applies this override, so
      // it keeps measuring the real, shipped 10x (or whatever the manifest actually ships) gap,
      // where the comparison means something.
      results.push({
        gate: "ruthless-vs-standard",
        status: "n/a",
        detail:
          `manifest.ciGateBudget.twoPlayerCiRollouts is active for this CI-suite run — ` +
          `"ruthless" is measured at ${ruthlessBudgets.ruthlessN} rollouts vs "standard"'s shipped ` +
          `${ruthlessBudgets.standardN} — the override has changed the very quantity under ` +
          "comparison, so this gate cannot measure its claim at suite \"ci\" (C26). Nightly " +
          "measures it at the real shipped budgets, where it means something.",
      });
    } else {
      const pass = inputs.ruthlessVsStandardWinRate >= thresholds.ruthlessVsStandardMinWinRate;
      const p = precision?.ruthlessVsStandardWinRate;
      const provisional = isProvisional(inputs.ruthlessVsStandardWinRate, p, [thresholds.ruthlessVsStandardMinWinRate]);
      const measured = `${(inputs.ruthlessVsStandardWinRate * 100).toFixed(1)}% (min ${(thresholds.ruthlessVsStandardMinWinRate * 100).toFixed(1)}%, ${suite})${precisionSuffix(p)}`;
      const detail = drawAttainment
        ? `${measured} — solvedValue relief withheld: self-play reached the proven draw only ${(drawAttainment.achieved * 100).toFixed(1)}% of the time (floor ${(SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0)}%, see solved-value-reached)`
        : measured;
      const provisionalField = provisional ? { provisional: true as const } : {};
      if (pass) {
        results.push({ gate: "ruthless-vs-standard", status: "pass", detail, ...provisionalField });
      } else if (suite === "nightly") {
        results.push(applyException("ruthless-vs-standard", "fail", detail, exceptions, provisional));
      } else {
        // PR-budget ci suite: a below-threshold ruthless-vs-standard WARNS, never hard-fails
        // (roadmap §6) — this is not a manifest exception, it is the gate's own defined
        // severity at this suite tier, so it bypasses applyException entirely.
        results.push({ gate: "ruthless-vs-standard", status: "warn", detail, ...provisionalField });
      }
    }
  }

  {
    // C23's inverted gate: for a game with a PROVEN solvedValue, confirm self-play actually
    // REACHES it at a healthy rate — always present (never silently skipped, C2's rule), n/a
    // when there is no proven value to confirm. That structural n/a check comes before
    // deferral, same ordering rule as every other block above: a game with no proven value has
    // nothing for THIS gate to ever measure, at any tier. C55: reads `attainment` — the SAME
    // shared computation the three decisiveness gates above consult for their own relief — so
    // this gate's verdict and their relief can never disagree about whether the proof was
    // reached (that disagreement, from two independent computations of the same fact, is the
    // defect C55 closes).
    if (!attainment) {
      results.push({ gate: "solved-value-reached", status: "n/a", detail: "no proven manifest.solvedValue — nothing to confirm" });
    } else if (deferral?.active) {
      results.push(deferredGate("solved-value-reached", deferral.reason));
    } else if (attainment.reached) {
      const attProvisional = isProvisional(attainment.achieved, attPrecision, [SOLVED_VALUE_SELF_PLAY_FLOOR]);
      const detail = `self-play reached the proven "${solvedValue!.value}" ${(attainment.achieved * 100).toFixed(1)}% of the time (floor ${(SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0)}%, proof: ${solvedValue!.proof})${precisionSuffix(attPrecision)}`;
      results.push(applyException("solved-value-reached", "pass", detail, exceptions, attProvisional));
    } else {
      // C57: the floor was not met. Two claims a single absolute floor collapsed into the same
      // FAIL — "used to reach it, doesn't now" (a regression, only knowable against a declared
      // `attainmentBaseline`) vs. "has never reached it" (a statement about search adequacy,
      // not a regression) — get different words here, never the same one.
      const achievedPct = (attainment.achieved * 100).toFixed(1);
      const floorPct = (SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0);
      const attProvisional = isProvisional(attainment.achieved, attPrecision, [SOLVED_VALUE_SELF_PLAY_FLOOR]);
      if (baseline) {
        // A real, previously-measured baseline exists (validated non-empty/positive above) —
        // falling short of the floor with one declared IS a regression claim: something this
        // game's bots once did, they no longer do.
        const detail =
          `self-play reached the proven "${solvedValue!.value}" only ${achievedPct}% of the time ` +
          `(floor ${floorPct}%) — regressed from the declared attainmentBaseline of ` +
          `${(baseline.rate * 100).toFixed(1)}% (${baseline.proof}): this game's bots previously ` +
          `attained the value and no longer do (platform-corrections.md C57)${precisionSuffix(attPrecision)}`;
        results.push(applyException("solved-value-reached", "fail", detail, exceptions, attProvisional));
      } else {
        // No baseline was ever declared — there is nothing on record for this to regress FROM,
        // so this is not a regression claim. Real, measured, visibly non-passing — never `"n/a"`
        // (the gate DOES apply and WAS measured) and never `"fail"` (nothing regressed) — C27's
        // `"deferred"` family exists for exactly this shape ("applies, but not measured the way
        // a bare pass implies"); this status is that family's sibling for "applies, WAS measured,
        // and still isn't the shape a bare pass/fail implies".
        const detail =
          `self-play has never reached the proven "${solvedValue!.value}" (${achievedPct}% observed, ` +
          `floor ${floorPct}%) — no manifest.solvedValue.attainmentBaseline declared, so there is ` +
          `no history to regress from; this describes search adequacy for this tree, not a ` +
          `regression (platform-corrections.md C57)${precisionSuffix(attPrecision)}`;
        results.push({
          gate: "solved-value-reached",
          status: "unattained",
          detail,
          ...(attProvisional ? { provisional: true as const } : {}),
        });
      }
    }
  }

  return results;
}

/** Thrown by `runCiSuite` (platform-corrections.md C19/C20) when a scaled-down
 *  `ciGateBudget.twoPlayerCiRollouts` would make the "ruthless" tier's CI-suite measurement
 *  budget equal to or lower than the "standard" tier's own (unscaled) budget. Wrap's exact
 *  finding: at a scaled 1,000, ruthless collided with standard's own 1,000-rollout budget, the
 *  two tiers became indistinguishable, and `ruthless-vs-standard` read a meaningless 50% that
 *  looked like a gate failure. A tier gate is meaningless once two tiers share a budget — this
 *  refuses BEFORE running the matchup, rather than silently reporting that ratio. */
export class TierBudgetCollapseError extends Error {
  constructor(gameId: string, effectiveRuthlessN: number, standardN: number) {
    super(
      `runCiSuite: game "${gameId}"'s CI-suite ruthless rollout budget (${effectiveRuthlessN}, ` +
        `possibly scaled via manifest.ciGateBudget.twoPlayerCiRollouts) is not strictly greater ` +
        `than the "standard" tier's own budget (${standardN}) — ruthless-vs-standard would ` +
        "measure two agents of the same effective strength (platform-corrections.md C19/C20: " +
        "Wrap's scaled-down budget collided with standard's own and the resulting 50% win rate " +
        "was a measurement artifact, not a real result). Raise the scaled budget (or the " +
        "manifest's ciGateBudget.twoPlayerCiRollouts) so ruthless stays strictly above standard."
    );
    this.name = "TierBudgetCollapseError";
  }
}

/** platform-corrections.md C22: `ciGateBudget.twoPlayerCiRollouts` shipped as an OPTIONAL
 *  field with no default, so every registered game silently skipped it and ran the CI suite at
 *  the full shipped `ruthless` budget. Fadeout — a 3x3 board, the smallest game in the
 *  catalogue — measured past 29 minutes on that path. C20's close-out said "make it the
 *  default"; an opt-in knob nobody sets is not a default, it is a comment.
 *
 *  So this module takes the fallback platform-corrections.md explicitly sanctions as
 *  acceptable (the same move C2 made for inapplicable solo gates: require the field and fail
 *  loudly, never silently skip): a game whose shipped `ruthless` budget is already at or below
 *  `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE` needs no override at all (this is the unchanged, safe
 *  pass-through path — a cheap game like a small fixture never has to touch this field). A game
 *  whose shipped budget EXCEEDS that ceiling MUST declare an explicit `ciGateBudget.
 *  twoPlayerCiRollouts` for suite "ci" — its absence is a loud, immediate refusal (this error),
 *  not a silent 30-minute run. Nightly is exempt unconditionally (the plan's "nightly keeps the
 *  full-budget table") — this requirement only ever applies to the fast PR-budget suite.
 *
 *  CORRECTED (C23, platform-corrections.md): this comment originally justified the required-
 *  field fallback by claiming a scaled-down 2,000-rollout run produced "a verdict the FULL
 *  10,000-rollout budget does not produce" — a C6-shaped yardstick-collapse story that was
 *  never actually measured (the 10,000-rollout baseline had been killed twice, unwitnessed,
 *  before that claim was written). A completed, witnessed sweep (100 games at 10,000 / 8,000 /
 *  5,000 / 3,000 rollouts, and 50 / 25 games at 10,000) found IDENTICAL behaviour at every
 *  point: 100% draw rate, 0% first-player win rate, 100% strong-vs-random — because
 *  `remove-first/solid/threefold` is an exact-solved draw (`docs/research/games/fadeout-solve-
 *  report.md` §1.1, 128,170 states, all 9 openings drawn), so EVERY budget reaches the correct
 *  answer. There was no unsafe budget and no weak yardstick. The requirement below still
 *  stands, but on its true (and honestly narrower) justification: an unscaled 10,000-rollout
 *  suite costs 2802s against 3,000 rollouts' 848s for the IDENTICAL verdict — 3.3x cheaper for
 *  the same answer — and a game team should not have to rediscover that by waiting 47 minutes.
 *  It is a cost problem now, not a correctness one; `manifest.solvedValue` (C23) is what fixes
 *  the correctness problem this comment originally (and wrongly) attributed to the budget. */
export const MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE = 3000;

export class MissingCiRolloutBudgetError extends Error {
  constructor(gameId: string, shippedRuthlessN: number) {
    super(
      `runCiSuite: game "${gameId}"'s shipped "ruthless" tier budget (${shippedRuthlessN} rollouts) ` +
        `exceeds ${MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE} — the ceiling below which no CI override is ` +
        "needed — but the manifest declares no manifest.ciGateBudget.twoPlayerCiRollouts " +
        "(platform-corrections.md C22: a budget nobody sets is not a default, it is a comment). " +
        "Running the CI suite unscaled at this budget is a real cost problem, not a correctness " +
        "one (C23: a witnessed sweep found EVERY budget from 3,000 to 10,000 rollouts reaches the " +
        "identical verdict for Fadeout — 3,000 costs 848s against 10,000's 2802s for the same " +
        "answer). Add an explicit manifest.ciGateBudget.twoPlayerCiRollouts, confirmed by a real " +
        "self-play run that the scaled-down budget still separates the tiers (the tier-collapse " +
        "guard checks that structurally) AND still reaches the same self-play verdict the shipped " +
        "budget does — for a game with a manifest.solvedValue claim, that means still reaching the " +
        "proven value at a healthy rate (see SOLVED_VALUE_SELF_PLAY_FLOOR), not an absolute " +
        "'balanced' shape. Nightly is unaffected — this requirement applies only to suite \"ci\"."
    );
    this.name = "MissingCiRolloutBudgetError";
  }
}

export class SuiteFailedError extends Error {
  constructor(failing: readonly Pick<GateResult, "gate" | "status" | "detail">[]) {
    const names = failing.map((g) => `${g.gate} (${g.detail})`).join(", ");
    super(`CI suite failed: ${names}`);
    this.name = "SuiteFailedError";
  }
}

/** The three matchups a single seed's worth of self-play produces (platform-corrections.md
 *  C71 Part 1 / C80's own factoring — see `runSeedMatchups`). */
interface SeedMatchupTriple {
  readonly strongVsRandom: MatchupReport;
  readonly strongSelfPlay: MatchupReport;
  readonly ruthlessVsStandard: MatchupReport | null;
}

export interface CiSuiteReport {
  readonly gameId: string;
  readonly suite: "ci" | "nightly";
  /** True iff no gate has status "fail" ("warn" and "n/a" do not fail the suite). */
  readonly ok: boolean;
  readonly gates: readonly GateResult[];
  /** `null` iff `manifest.ciGateBudget.deferGatesToNightly` is active at this run (C27 — no
   *  self-play ran at all) OR `seedCount > 1` was requested (C71 Part 1 / C80 — there is no
   *  single MatchupReport triple to report; see `seedRuns` instead). Non-null only for the
   *  single-seed (`seedCount` omitted or `1`) case, including every run before C27/C71 existed —
   *  the module's byte-identical default. */
  readonly matchups: SeedMatchupTriple | null;
  /** Present (and one entry per seed) iff `seedCount > 1` was requested — `undefined` for every
   *  single-seed call, including every call site that predates C71/C80 (additive-only field).
   *  `GateInputs`'s rate/mean fields are the MEAN across these; `precision` (below) is their
   *  cross-seed spread. */
  readonly seedRuns?: readonly (SeedMatchupTriple & { readonly seed: string })[];
  /** Present iff `seedCount > 1` was requested — the SAME `GatePrecisionInputs` threaded into
   *  `evaluateCiGates` to produce `gates`' own precision suffixes/`provisional` flags, exposed
   *  here too for a machine-readable consumer that wants the raw numbers without re-parsing
   *  `detail` strings. */
  readonly precision?: GatePrecisionInputs;
}

export interface RunCiSuiteOptions {
  readonly games?: number; // TOTAL across every seed (see `seedCount`); default 200 (PR budget)
  /** `runMatchup` (runner.ts) seeds matchup game *i* as `` `${seed}:${i}` ``. Two calls that
   *  vary THIS string therefore play DIFFERENT games — any measured difference between them
   *  conflates whatever you changed with seed variance, not isolates it (platform-corrections.md
   *  C24: two independent agents, in unrelated worktrees on the same day, both templated the
   *  varying parameter INTO this seed while hand-rolling a budget comparison — a recurrence
   *  across independent authors that never saw each other's code is evidence the INTERFACE makes
   *  the wrong thing natural, not that either agent was careless). Comparing configurations
   *  (e.g. several candidate `ciGateBudget.twoPlayerCiRollouts` values)? Use `compareBudgets`
   *  below, which holds this ONE seed fixed across every candidate so they play the identical
   *  games — never invent a seed per candidate here. */
  readonly seed: string;
  readonly suite?: "ci" | "nightly"; // default "ci"
  readonly clock?: RunMatchupOptions["clock"];
  /** platform-corrections.md C71 Part 1 / C80: the number of INDEPENDENT seeds this suite's
   *  self-play-derived rows are measured across and aggregated over (`aggregateAcrossSeeds`).
   *  `games` (above) is the TOTAL games across every seed, never per-seed — raising `seedCount`
   *  does NOT raise total self-play cost; it reallocates the SAME budget from one seed's games to
   *  more, smaller, independent seeds ("fewer games per seed at equal total cost"). Default `1`
   *  keeps every existing caller's exact single-seed behaviour, byte-identical — this option is
   *  purely additive (see this module's own header doc). `games` must be evenly divisible by
   *  `seedCount` (`NonDivisibleSeedCountError`) — an uneven split would silently give some seeds
   *  more weight than others in an UNweighted per-seed mean, the same "never approximate a split,
   *  refuse instead" posture C24 already took for "never invent a per-candidate seed." */
  readonly seedCount?: number;
}

/** Thrown by `runCiSuite` when `seedCount` is not a positive integer — checked BEFORE the
 *  divisibility guard below, because `%` on a non-integer is not the check that guard exists to
 *  perform (platform-corrections.md C80, stage-6 review): `games: 25, seedCount: 2.5` satisfies
 *  `25 % 2.5 === 0` in JavaScript, then `Array.from({ length: 2.5 })` silently truncates to 2
 *  seeds of 10 games each — 5 games vanish with no error, and the returned report's own
 *  `precision.seedCount` reads `2`, not `2.5`, so nothing about the output even hints a game was
 *  dropped. A negative `seedCount` passes the SAME modulo check (`25 % -5 === 0`) and would only
 *  fail later, inside `Array.from({ length: -5 })`, with a bare `RangeError` naming neither the
 *  game nor which option was invalid. Refused here instead, loudly, before either guard or a
 *  single game runs. */
export class InvalidSeedCountError extends Error {
  constructor(gameId: string, seedCount: number) {
    super(
      `runCiSuite: game "${gameId}"'s seedCount (${seedCount}) must be a positive integer ` +
        "(platform-corrections.md C80) — a non-integer can satisfy the games%seedCount divisibility " +
        "check while still silently dropping games (25 games, seedCount 2.5 => 2 seeds of 10, 5 " +
        "games vanish with no error), and a non-positive value fails later with a misleading bare " +
        "RangeError instead of naming the actual problem."
    );
    this.name = "InvalidSeedCountError";
  }
}

/** Thrown by `runCiSuite` when `games` (the TOTAL across every seed) does not divide evenly by
 *  `seedCount` — see `RunCiSuiteOptions.seedCount`'s own doc for why this refuses rather than
 *  rounds. Never reachable for the default `seedCount: 1` (every integer is divisible by 1). */
export class NonDivisibleSeedCountError extends Error {
  constructor(gameId: string, games: number, seedCount: number) {
    super(
      `runCiSuite: game "${gameId}"'s total games (${games}) is not evenly divisible by ` +
        `seedCount (${seedCount}) — platform-corrections.md C71 Part 1 / C80: an uneven split ` +
        "would silently give some seeds more weight than others in an unweighted per-seed mean. " +
        "Choose a games/seedCount pair that divides evenly."
    );
    this.name = "NonDivisibleSeedCountError";
  }
}

/** One `compareBudgets` result point: the candidate rollout count and the full report a real
 *  `runCiSuite` run produced at that count. */
export interface CompareBudgetsPoint {
  readonly rollouts: number;
  readonly report: CiSuiteReport;
}

/**
 * platform-corrections.md C24's preferred fix: "provide the comparison as a first-class harness
 * helper... so nobody hand-rolls the loop, nobody invents a seed." Runs `runCiSuite` once per
 * candidate in `rolloutCandidates`, ALL under the exact same `opts.seed` + `opts.games` — only
 * `ciGateBudget.twoPlayerCiRollouts` varies between calls, via a fresh in-memory clone per
 * candidate (the shipped `manifest.ciGateBudget` — and every difficulty tier — is never
 * mutated, matching `runCiSuite`'s own C20 discipline). Always `suite: "ci"`: a rollout-budget
 * comparison is a CI-suite-only concept in the first place (nightly ignores the override
 * entirely, so every candidate would report the identical result there).
 *
 * This is exactly the comparison the C22 Fadeout sweep and the Nine Grids pilot each needed and
 * each built by hand, with a seed that varied per candidate — the confound C24 found in both,
 * independently, in one day. This helper makes the correct construction the only one available.
 *
 * platform-corrections.md C80 (stage-6 review): before this, `compareBudgets` had no way to opt
 * into multi-seed measurement — every budget sweep this repo runs (C22, C73-C76) measured each
 * candidate on exactly one seed and printed a report with no precision suffix at all, which reads
 * as a SETTLED number rather than the single-seed measurement C71 spent this whole correction
 * showing cannot be trusted alone. `opts.seedCount`, forwarded verbatim to every candidate's
 * `runCiSuite` call (same as `opts.seed`/`opts.games`), closes that gap: every candidate is
 * measured across the SAME seed count, so the comparison stays apples-to-apples and each point's
 * own report now states its own precision when the caller asks for it. Omitted, this function's
 * behaviour is unchanged (single-seed, byte-identical to every pre-C80 call).
 */
export function compareBudgets<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  rolloutCandidates: readonly number[],
  opts: {
    readonly seed: string;
    readonly games?: number;
    readonly clock?: RunMatchupOptions["clock"];
    readonly seedCount?: number;
  }
): CompareBudgetsPoint[] {
  return rolloutCandidates.map((rollouts) => {
    const candidateManifest: GameManifest = {
      ...manifest,
      ciGateBudget: { ...manifest.ciGateBudget, twoPlayerCiRollouts: rollouts },
    };
    const report = runCiSuite(engine, candidateManifest, {
      seed: opts.seed, // SAME across every candidate — the entire point of this helper
      ...(opts.games !== undefined ? { games: opts.games } : {}),
      suite: "ci",
      ...(opts.clock ? { clock: opts.clock } : {}),
      ...(opts.seedCount !== undefined ? { seedCount: opts.seedCount } : {}),
    });
    return { rollouts, report };
  });
}

/** Exported so `probes-two-player.ts` resolves "standard" the same way `runCiSuite` does. */
export function findTier(manifest: GameManifest, id: DifficultyTier["id"]): DifficultyTier | undefined {
  return manifest.difficultyTiers.find((t) => t.id === id);
}

/** Exported so `probes-two-player.ts` builds its own "ruthless" probe opponent the identical
 *  way `runCiSuite` builds its strong-vs-random/strong-self-play/ruthless-vs-standard agents. */
export function tierAgent<S extends WithEffects, M extends Json>(name: string, tier: DifficultyTier): AgentSpec<S, M> {
  return { kind: "policy", name, policy: tierPolicy<S, M>(tier), budget: tier.budget };
}

/** The "ruthless" tier resolution `runCiSuite` needs (C19/C20/C22/C26), extracted so
 *  `probes-two-player.ts`'s `runProbeSuite` reuses the EXACT same effective budget — "ruthless
 *  at the suite's effective budget" (docs/plans/degeneracy-probes.md §1.1/§3) means the SAME
 *  in-memory-cloned tier `runCiSuite` measures with, never a second, independently-scaled clone.
 *  Pure mechanical extraction of what was previously inlined in `runCiSuite` (verified
 *  byte-identical against S0's fixed-seed baseline) — same errors, same conditions, same order. */
export interface EffectiveRuthlessTier {
  readonly ruthlessTier: DifficultyTier;
  readonly standardTier: DifficultyTier | undefined;
  readonly ciRolloutOverride: number | undefined;
}

export function resolveEffectiveRuthlessTier(
  manifest: GameManifest,
  suite: "ci" | "nightly",
  shippedRuthlessTier: DifficultyTier
): EffectiveRuthlessTier {
  // C19: at suite "ci" only, measure with `ciGateBudget.twoPlayerCiRollouts` rollouts instead
  // of the tier's own shipped budget, via an IN-MEMORY clone — the shipped tier object (what a
  // real player's bot actually uses) is never touched (C20: "the shipped ruthless tier was
  // never touched"). Nightly always uses the tier's real budget unscaled (the plan's "nightly
  // keeps the full-budget table"). A `deadlineMs`-budgeted tier is left alone either way — this
  // override only ever applies to the deterministic `rollouts` budget kind the harness gates
  // with (platform §5.2).
  const ciRolloutOverride = manifest.ciGateBudget?.twoPlayerCiRollouts;

  // C22: a shipped budget expensive enough to matter MUST declare an override for suite "ci" —
  // checked before anything else runs, so an absent override is a loud, immediate refusal
  // (MissingCiRolloutBudgetError) rather than a silent full-cost run. See that error's own doc
  // comment for why this module refuses to just compute-and-trust a scaled number instead.
  if (
    suite === "ci" &&
    ciRolloutOverride === undefined &&
    shippedRuthlessTier.budget.kind === "rollouts" &&
    shippedRuthlessTier.budget.n > MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE
  ) {
    throw new MissingCiRolloutBudgetError(manifest.id, shippedRuthlessTier.budget.n);
  }

  const ruthlessTier =
    suite === "ci" && ciRolloutOverride !== undefined && shippedRuthlessTier.budget.kind === "rollouts"
      ? { ...shippedRuthlessTier, budget: { kind: "rollouts" as const, n: ciRolloutOverride } }
      : shippedRuthlessTier;

  const standardTier = findTier(manifest, "standard");
  // C19/C20: a scaled-down ruthless budget must never collapse onto standard's own budget — a
  // tier gate is meaningless once two tiers share a budget (Wrap's exact finding). Checked
  // BEFORE running anything, so a collapse is a loud refusal, never a silently-meaningless
  // ruthless-vs-standard ratio.
  if (standardTier && ruthlessTier.budget.kind === "rollouts" && standardTier.budget.kind === "rollouts") {
    if (ruthlessTier.budget.n <= standardTier.budget.n) {
      throw new TierBudgetCollapseError(manifest.id, ruthlessTier.budget.n, standardTier.budget.n);
    }
  }

  return { ruthlessTier, standardTier, ciRolloutOverride };
}

/**
 * SHOULD FIX #3: the mean-plies gate's cap-hit rule (roadmap §6: "any playout hitting the ply
 * cap" fails; Fadeout §7 sharpens this to zero under superko, since a cap hit there is an engine
 * bug) must see EVERY matchup this suite actually ran, not just self-play. A game that
 * terminates briskly ruthless-vs-ruthless can still stall out against a genuinely weaker/random
 * opponent that never finds the forcing line and runs to the cap every game — self-play alone
 * would miss that cap hit entirely and let mean-plies pass on a real bug. Takes the max across
 * whichever matchups were actually run (`ruthlessVsStandard` is `null` when the manifest has no
 * "standard" tier). Exported and pure — this module's own "pure evaluation vs real wiring" split
 * (see module doc) applies at this aggregation seam too: testable with hand-built
 * matchup-shaped values, no real self-play required.
 */
export function worstCapHitRate(reports: readonly (Pick<MatchupReport, "metrics"> | null)[]): number {
  const rates = reports
    .filter((r): r is Pick<MatchupReport, "metrics"> => r !== null)
    .map((r) => r.metrics.capHitRate);
  if (rates.length === 0) {
    throw new RangeError("worstCapHitRate: at least one non-null matchup report is required");
  }
  return Math.max(...rates);
}

/** True iff any row is `"deferred"` — the C27 "provisional pass" signal for the two-player
 *  lane, mirroring `solo-gates.ts`'s `hasDeferredGates`: a report can be `ok` (no `"fail"`)
 *  while still not being a FULLY measured green, because self-play was skipped entirely at this
 *  tier. `report.ts`'s `formatCiSuiteTable` checks this to render that distinction. */
export function hasDeferredGates(results: readonly GateResult[]): boolean {
  return results.some((r) => r.status === "deferred");
}

/** True iff any row is `"unattained"` (platform-corrections.md C57) — the same "provisional,
 *  not a full green" signal `hasDeferredGates` provides, for the sibling status: a report can be
 *  `ok` (no `"fail"`) while containing a `solved-value-reached` row that was genuinely measured
 *  and genuinely never met, with no baseline on record to call the shortfall a regression.
 *  `report.ts`'s `formatCiSuiteTable` checks this so the rendered header never reads as a bare,
 *  unqualified "OK" when that is true — the same posture C27 established for `"deferred"`. */
export function hasUnattainedGates(results: readonly GateResult[]): boolean {
  return results.some((r) => r.status === "unattained");
}

/** True iff any row carries `provisional: true` (platform-corrections.md C71 Part 1 / C80) — the
 *  same "provisional, not a fully-settled claim" signal `hasDeferredGates`/`hasUnattainedGates`
 *  provide for their own qualifiers: a report can be `ok` (or genuinely FAILED) while a rate-
 *  style gate's aggregate mean sits within its own measured seed-to-seed noise of the edge it is
 *  judged against — neither a lie (the verdict IS what the aggregate says) nor a settled fact (a
 *  second measurement could flip it). `report.ts`'s `formatCiSuiteTable` checks this so the
 *  rendered header never reads as an unqualified verdict when that is true. */
export function hasProvisionalGates(results: readonly GateResult[]): boolean {
  return results.some((r) => r.provisional === true);
}

// ---------------------------------------------------------------------------------------
// Mirror-probe declaration (platform-corrections.md C48, routed at C62). NOT one of the six
// harness-COMPUTED self-play rows this module's header doc scopes `evaluateCiGates` to — a
// manifest-only declaration with no self-play behind it is a different kind of claim (same
// reasoning as C23's `n/a` for "no standard tier": a structural fact, not a measurement) — so
// this lives as its own small, separately-testable function rather than folded into
// `evaluateCiGates` itself. `runCiSuite` appends its result onto `CiSuiteReport.gates` (below)
// ONLY when non-null, so a manifest that never declares `mirrorProbe` produces a `gates` array
// with the exact same six rows this module has always produced — byte-identical, by
// construction, because the append is conditional on the manifest, not on anything this
// function computes.
// ---------------------------------------------------------------------------------------

/** Thrown when a manifest declares `mirrorProbe: { applicable: false, ... }` but `reason` is
 *  empty or whitespace-only. Same posture, same seam as `EmptyExceptionJustificationError` and
 *  `MissingSolvedValueProofError`: a declaration that silences a probe must be visible and
 *  reviewable (platform-corrections.md C48: "a WARN invites someone to tune away a number that
 *  never meant anything" — the identical hazard applies to a *silent* n/a), refused here, at the
 *  manifest boundary, before any report is built on the strength of the claim. */
export class EmptyMirrorProbeReasonError extends Error {
  constructor(gameId: string) {
    super(
      `evaluateMirrorProbeGate: manifest "${gameId}" declares mirrorProbe.applicable === false ` +
        'but "reason" is empty (or whitespace-only) — platform-corrections.md C48 requires a ' +
        "stated, reviewable reason for taking a probe out of the report, not a bare opt-out."
    );
    this.name = "EmptyMirrorProbeReasonError";
  }
}

/** Thrown by `evaluateMirrorProbeGate` when a declared `mirrorProbe.applicable` is present but is
 *  not the literal `false` the type requires (`GameManifest.mirrorProbe`'s own type is `{
 *  readonly applicable: false; readonly reason: string }` — there is no `applicable: true`
 *  variant to set). The TYPE already promises this can't happen from ordinary TypeScript code;
 *  this closes the gap between that promise and the RUNTIME, for a manifest that reaches this
 *  function through a cast, or a future non-TS path (Phase 2 puts manifests near a database).
 *  Without this check, `evaluateMirrorProbeGate` keyed on presence alone — a smuggled `applicable:
 *  true` would still produce an n/a row whose detail asserts the opposite of what was declared. */
export class InvalidMirrorProbeDeclarationError extends Error {
  constructor(gameId: string, applicable: unknown) {
    super(
      `evaluateMirrorProbeGate: manifest "${gameId}" declares mirrorProbe.applicable as ` +
        `${JSON.stringify(applicable)}, not the literal false the type requires — the ONLY ` +
        'declaration this field supports is opting a probe OUT (there is no "applicable: true" ' +
        "variant; omit mirrorProbe entirely for that). This manifest reached the gate through a " +
        "cast or a non-TS path that bypassed the type — refused here so the runtime matches what " +
        "the type already promises, rather than reporting an n/a row asserting the opposite of " +
        "what was declared."
    );
    this.name = "InvalidMirrorProbeDeclarationError";
  }
}

/**
 * The C48/C62 mechanism: a game may declare, via `manifest.mirrorProbe`, that the mirror-bot
 * degeneracy probe (roadmap §6's design gate, "mirror bot <40% as P2") does not apply to it —
 * "where mirroring is provably not value-preserving, the probe cannot measure its claim" (C48).
 * Returns the declared `n/a` row, citing the reason verbatim, when declared; `null` when the
 * manifest does not declare (the default) — a game that never touches `mirrorProbe` gets no row
 * and no behavior change at all, at any call site. Refuses (`EmptyMirrorProbeReasonError`) a
 * declared-but-blank reason rather than silently accepting it.
 */
export function evaluateMirrorProbeGate(manifest: Pick<GameManifest, "id" | "mirrorProbe">): GateResult | null {
  const decl = manifest.mirrorProbe;
  if (decl === undefined) return null;
  // Runtime must match the type (see InvalidMirrorProbeDeclarationError's own doc) — checked
  // BEFORE the reason check below, so a smuggled `applicable: true` (or any non-`false` value)
  // is refused on its own terms, never masked by (or dependent on) the blank-reason guard.
  if (decl.applicable !== false) {
    throw new InvalidMirrorProbeDeclarationError(manifest.id, decl.applicable);
  }
  if (decl.reason.trim().length === 0) {
    throw new EmptyMirrorProbeReasonError(manifest.id);
  }
  return { gate: "mirror-probe", status: "n/a", detail: `not applicable: ${decl.reason}` };
}

/**
 * Runs the real self-play this gate table needs (strong-vs-random, strong self-play, and
 * ruthless-vs-standard when the manifest has a "standard" tier) and evaluates every gate
 * against the manifest's own threshold overrides (falling back to
 * `DEFAULT_HARNESS_THRESHOLDS`) and exceptions.
 */
/** One seed's worth of the three self-play matchups this suite needs — factored out of
 *  `runCiSuite` so the single-seed path (called once, with `opts.seed`/`games` UNCHANGED) and
 *  the multi-seed path (called `seedCount` times, once per derived seed, with `games/seedCount`
 *  each) share the exact same matchup-construction logic and can never drift apart
 *  (platform-corrections.md C71 Part 1 / C80). The single-seed call site below reproduces the
 *  pre-C80 code verbatim, which is what keeps that path byte-identical. */
function runSeedMatchups<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  ruthless: AgentSpec<S, M>,
  standardTier: DifficultyTier | undefined,
  seed: string,
  games: number,
  clock: RunMatchupOptions["clock"] | undefined
): SeedMatchupTriple {
  const random = resolveNamedAgent<S, M>("random");

  const strongVsRandom = runMatchup(engine, ruthless, random, {
    games,
    seed: `${seed}:strong-vs-random`,
    ...(clock ? { clock } : {}),
  });
  const strongSelfPlay = runMatchup(engine, ruthless, ruthless, {
    games,
    seed: `${seed}:strong-self-play`,
    ...(clock ? { clock } : {}),
  });
  const ruthlessVsStandard = standardTier
    ? runMatchup(engine, ruthless, tierAgent<S, M>("standard", standardTier), {
        games,
        seed: `${seed}:ruthless-vs-standard`,
        ...(clock ? { clock } : {}),
      })
    : null;

  return { strongVsRandom, strongSelfPlay, ruthlessVsStandard };
}

/** The `GateInputs` rate/mean fields (everything except `capHitRate`, which stays structural —
 *  see `worstCapHitRate`) for ONE seed's `SeedMatchupTriple`. */
function seedRates(run: SeedMatchupTriple): {
  strongVsRandom: number;
  firstPlayerWinRate: number;
  drawRate: number;
  meanPlies: number;
  ruthlessVsStandard: number | null;
} {
  return {
    strongVsRandom: agentWinRate(run.strongVsRandom.outcomes, "ruthless"),
    firstPlayerWinRate: run.strongSelfPlay.metrics.firstPlayerWinRate,
    drawRate: run.strongSelfPlay.metrics.drawRate,
    meanPlies: run.strongSelfPlay.metrics.meanPlies,
    ruthlessVsStandard: run.ruthlessVsStandard ? agentWinRate(run.ruthlessVsStandard.outcomes, "ruthless") : null,
  };
}

export function runCiSuite<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: RunCiSuiteOptions
): CiSuiteReport {
  const games = opts.games ?? 200;
  const suite = opts.suite ?? "ci";
  const seedCount = opts.seedCount ?? 1;
  // C80 (stage-6 review): identity/shape (is this a usable seedCount AT ALL) is checked BEFORE
  // the divisibility guard — `%` on a non-integer or negative value is not a meaningful question
  // until this passes (see InvalidSeedCountError's own doc for the exact 2.5-seeds silent-drop
  // this guard exists to catch).
  if (!Number.isInteger(seedCount) || seedCount < 1) {
    throw new InvalidSeedCountError(manifest.id, seedCount);
  }
  if (games % seedCount !== 0) {
    throw new NonDivisibleSeedCountError(manifest.id, games, seedCount);
  }
  const thresholds: HarnessThresholds = { ...DEFAULT_HARNESS_THRESHOLDS, ...manifest.thresholds };
  const exceptions = manifest.exceptions ?? [];

  const shippedRuthlessTier = findTier(manifest, "ruthless");
  if (!shippedRuthlessTier) {
    throw new Error(
      `runCiSuite: manifest "${manifest.id}" has no "ruthless" difficulty tier — the CI gate ` +
        "table's strong-vs-random and strong-self-play rows have no agent to run."
    );
  }

  // C27: at suite "ci" only, `manifest.ciGateBudget.deferGatesToNightly` skips self-play
  // ENTIRELY — not scaled down (that's `twoPlayerCiRollouts` below), skipped, because the
  // manifest has declared this lane unaffordable to measure at all at this tier. Nightly always
  // ignores this field (same rule as `twoPlayerCiRollouts`), enforced structurally by this
  // `suite === "ci"` check — `evaluateCiGates` independently refuses if a caller ever bypasses
  // it and reaches "nightly" with an active deferral anyway (C27's abuse guard).
  const deferral: CiGateDeferral | undefined =
    suite === "ci" && manifest.ciGateBudget?.deferGatesToNightly
      ? { active: true, reason: manifest.ciGateBudget.deferGatesToNightly.reason }
      : undefined;

  if (deferral?.active) {
    // No self-play at all — every field below is UNREACHABLE by construction (every
    // `evaluateCiGates` block checks `deferral?.active` before ever touching `inputs.X` for the
    // rows this deferral covers; see that function's own per-gate comments), and NaN-poisoned
    // rather than a plausible-looking 0/null so a future control-flow bug that DID let one leak
    // through would render as an obviously-broken "NaN%" in a report, never a silent lie (C4).
    // `ruthlessVsStandardWinRate` is the one exception: `null` is a REAL, structural fact ("no
    // standard tier exists") that must survive deferral unchanged — evaluateCiGates's own
    // ruthless-vs-standard block checks that null BEFORE its deferral check for exactly this
    // reason, so a manifest with no standard tier still reports n/a, not "deferred".
    const standardTier = findTier(manifest, "standard");
    const inputs: GateInputs = {
      strongVsRandomWinRate: Number.NaN,
      firstPlayerWinRate: Number.NaN,
      drawRate: Number.NaN,
      meanPlies: Number.NaN,
      capHitRate: Number.NaN,
      ruthlessVsStandardWinRate: standardTier ? Number.NaN : null,
    };
    const baseGates = evaluateCiGates(inputs, thresholds, exceptions, suite, manifest.solvedValue, undefined, deferral);
    // C48/C62: mirror-probe is a manifest-only declaration, orthogonal to deferral (it costs no
    // self-play either way) — appended here too so a deferred-tier report is not the one place
    // a declared game's n/a row silently goes missing.
    const mirrorGate = evaluateMirrorProbeGate(manifest);
    const gates = mirrorGate ? [...baseGates, mirrorGate] : baseGates;
    return {
      gameId: manifest.id,
      suite,
      ok: gates.every((g) => g.status !== "fail"),
      gates,
      matchups: null,
    };
  }

  // C19/C20/C22/C26 budget resolution — extracted to `resolveEffectiveRuthlessTier` (pure
  // mechanical extraction, verified byte-identical against S0's fixed-seed baseline) so
  // `probes-two-player.ts`'s `runProbeSuite` resolves "ruthless at the suite's effective
  // budget" (docs/plans/degeneracy-probes.md §1.1/§3) the identical way, never a second clone.
  const { ruthlessTier, standardTier, ciRolloutOverride } = resolveEffectiveRuthlessTier(
    manifest,
    suite,
    shippedRuthlessTier
  );

  const ruthless = tierAgent<S, M>("ruthless", ruthlessTier);

  // C26: SAME condition as the in-memory clone substitution above (never re-derived
  // differently), so the gate and the substitution can never disagree about whether the
  // override actually applied.
  const ruthlessBudgets: RuthlessVsStandardBudgets = {
    active: suite === "ci" && ciRolloutOverride !== undefined && shippedRuthlessTier.budget.kind === "rollouts",
    ruthlessN: ruthlessTier.budget.kind === "rollouts" ? ruthlessTier.budget.n : 0,
    standardN: standardTier && standardTier.budget.kind === "rollouts" ? standardTier.budget.n : null,
  };

  // C48/C62: see the deferred branch above for why this is appended here rather than folded
  // into evaluateCiGates itself, and why it is conditional on the manifest (never on suite,
  // budget, or anything else computed in this function) — a manifest that never sets
  // `mirrorProbe` gets `mirrorGate === null` and `gates === baseGates`, unchanged.
  const mirrorGate = evaluateMirrorProbeGate(manifest);

  if (seedCount === 1) {
    // C71 Part 1 / C80's byte-identical default path: reproduces the pre-C80 code exactly (via
    // `runSeedMatchups`, called once with `opts.seed`/`games` UNCHANGED — no `:seed0:` infix, no
    // precision object built at all), so every existing caller that never opts into
    // `seedCount > 1` sees the identical report shape and identical numbers it always has.
    const run = runSeedMatchups(engine, ruthless, standardTier, opts.seed, games, opts.clock);
    const rates = seedRates(run);
    const inputs: GateInputs = {
      strongVsRandomWinRate: rates.strongVsRandom,
      firstPlayerWinRate: rates.firstPlayerWinRate,
      drawRate: rates.drawRate,
      // meanPlies deliberately stays self-play-only: it is a shape-of-game statistic (how long a
      // BALANCED game runs), and mixing in a mismatched matchup like ruthless-vs-random would
      // pull it toward whatever that matchup's dynamics happen to be, not the metric roadmap §6
      // means.
      meanPlies: rates.meanPlies,
      // capHitRate does NOT stay self-play-only — see worstCapHitRate's own doc (SHOULD FIX #3).
      capHitRate: worstCapHitRate([run.strongVsRandom, run.strongSelfPlay, run.ruthlessVsStandard]),
      ruthlessVsStandardWinRate: rates.ruthlessVsStandard,
    };

    const baseGates = evaluateCiGates(inputs, thresholds, exceptions, suite, manifest.solvedValue, ruthlessBudgets);
    const gates = mirrorGate ? [...baseGates, mirrorGate] : baseGates;

    return {
      gameId: manifest.id,
      suite,
      ok: gates.every((g) => g.status !== "fail"),
      gates,
      matchups: run,
    };
  }

  // C71 Part 1 / C80: `seedCount` INDEPENDENT seeds, each measured over `games / seedCount`
  // games (the divisibility guard above already confirmed this is exact) — `games` (the caller's
  // TOTAL budget) is unchanged, so total self-play cost stays flat regardless of `seedCount`
  // (the "fewer games per seed at equal total cost" the plan calls for). Each seed's own rates
  // are computed independently; `aggregateAcrossSeeds` below is the ONLY place they are combined.
  const gamesPerSeed = games / seedCount;
  const seedRuns = Array.from({ length: seedCount }, (_, i) => ({
    seed: `${opts.seed}:seed${i}`,
    ...runSeedMatchups(engine, ruthless, standardTier, `${opts.seed}:seed${i}`, gamesPerSeed, opts.clock),
  }));

  const perSeedRates = seedRuns.map((run) => seedRates(run));
  // C80 (stage-6 review): `withBinomialSeFloor` applies ONLY to the four 0-1 FRACTION fields —
  // never `meanPliesAgg` below, which has no binomial model. `games` (this function's own TOTAL
  // budget, not `gamesPerSeed`) is the pooled trial count the floor is judged against.
  const strongVsRandomAgg = withBinomialSeFloor(aggregateAcrossSeeds(perSeedRates.map((r) => r.strongVsRandom)), games);
  const firstPlayerAgg = withBinomialSeFloor(aggregateAcrossSeeds(perSeedRates.map((r) => r.firstPlayerWinRate)), games);
  const drawAgg = withBinomialSeFloor(aggregateAcrossSeeds(perSeedRates.map((r) => r.drawRate)), games);
  const meanPliesAgg = aggregateAcrossSeeds(perSeedRates.map((r) => r.meanPlies));
  // `standardTier` is fixed for the whole call (not per-seed), so either EVERY seed ran
  // ruthless-vs-standard or NONE did — `perSeedRates[i].ruthlessVsStandard` is `null` uniformly
  // in the "no standard tier" case, never a mix.
  const ruthlessVsStandardAgg = standardTier
    ? withBinomialSeFloor(aggregateAcrossSeeds(perSeedRates.map((r) => r.ruthlessVsStandard!)), games)
    : null;

  const inputs: GateInputs = {
    strongVsRandomWinRate: strongVsRandomAgg.mean,
    firstPlayerWinRate: firstPlayerAgg.mean,
    drawRate: drawAgg.mean,
    meanPlies: meanPliesAgg.mean,
    capHitRate: Math.max(
      ...seedRuns.map((run) => worstCapHitRate([run.strongVsRandom, run.strongSelfPlay, run.ruthlessVsStandard]))
    ),
    ruthlessVsStandardWinRate: ruthlessVsStandardAgg ? ruthlessVsStandardAgg.mean : null,
  };

  const precision: GatePrecisionInputs = {
    strongVsRandomWinRate: strongVsRandomAgg,
    firstPlayerWinRate: firstPlayerAgg,
    drawRate: drawAgg,
    meanPlies: meanPliesAgg,
    ...(ruthlessVsStandardAgg ? { ruthlessVsStandardWinRate: ruthlessVsStandardAgg } : {}),
  };

  const baseGates = evaluateCiGates(
    inputs,
    thresholds,
    exceptions,
    suite,
    manifest.solvedValue,
    ruthlessBudgets,
    undefined,
    precision
  );
  const gates = mirrorGate ? [...baseGates, mirrorGate] : baseGates;

  return {
    gameId: manifest.id,
    suite,
    ok: gates.every((g) => g.status !== "fail"),
    gates,
    matchups: null,
    seedRuns,
    precision,
  };
}

/** Throws `SuiteFailedError` iff `report.ok` is false — the actual "wired as a failing
 *  assertion" call site (`cli.ts`'s `harness suite` command uses this to set the process exit
 *  code non-zero). Never called implicitly by `runCiSuite` itself, so a caller that wants the
 *  full report even on failure (e.g. to print it) can always get one. */
export function assertSuiteOk(report: CiSuiteReport): void {
  if (!report.ok) {
    throw new SuiteFailedError(report.gates.filter((g) => g.status === "fail"));
  }
}

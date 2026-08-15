// packages/harness/src/deferral-ledger.ts — the deferral-DISCHARGE mechanism (platform-
// corrections.md C70, C81, closing a gap C27/C68 left open — and REVISED here after C81's
// stage-6 review found the first version self-defeating).
//
// C27 built a real "deferred" gate status: a Strong-dependent solo-chase row (or its two-player
// analogue) that is too expensive to measure at suite "ci" reports `"deferred"`, naming nightly
// as the tier that measures it for real. That is sound cost management and this module does not
// touch it — `evaluateSoloGates`/`evaluateChaseGates`/`evaluateCiGates` are untouched by this
// file, on purpose, so every existing gate's semantics and every existing report's raw shape
// stay byte-identical.
//
// C68 found nightly has never once completed a run (billing, not code). C70's first version of
// this module tracked deferral state in ONE mutable `data/deferral-ledger.json`, written both
// at "ci" (self-registering an observation) and at "nightly" (recording a discharge). C81's
// stage-6 review found the fatal flaw: `nightly.yml` runs in an EPHEMERAL GitHub Actions
// workspace with no commit-back step, so the nightly write was discarded every night. A kept
// promise could never discharge — the mechanism would have turned "nightly never runs" into
// "CI is permanently red and unrecoverable," which is worse than the defect it fixed.
//
// THIS VERSION derives discharge from a COMMITTED ARTIFACT instead of a workspace write —
// exactly certify.ts's own convention (`data/certificates/<gameId>/<day>.json`): a real nightly
// run produces one small, immutable, DATED `DeferralRun` file recording which gate names it
// measured FOR REAL that day, derived from the run's own report rows (never a hardcoded
// canonical list — see the A2 note below). A human commits that file afterward, the same
// documented manual path certify.ts already requires; nothing here assumes CI can write to the
// repo, and nothing here needs it to. Discharge recognition then SCANS whatever `DeferralRun`
// files are actually committed, at read time — there is no mutable ledger blob to lose, and
// tampering means forging an entire dated, reviewable evidence file rather than hand-editing one
// date field.
//
// C81's A2 finding, and how this version avoids it: the FIRST version recorded "what CI
// observed as deferred" on one side and "the hardcoded STRONG_DEPENDENT_CHASE_GATES/
// DEFERRABLE_CI_GATES canonical list" on the other, compared by exact-set equality — but a
// two-player game's `ruthless-vs-standard`/`solved-value-reached` rows can independently be
// `"n/a"` (a structural reason, unrelated to deferral) even while a deferral is active, making
// the ci-observed set a PROPER SUBSET of the canonical list. Exact equality then treated every
// such nightly run as "a different promise," erasing the discharge and springing the age back —
// permanently un-dischargeable, latent only because Mine Run (solo-chase) never hits it. This
// version fixes it two ways: (1) `measuredGateNames` derives "what was measured" from a report's
// OWN rows on BOTH sides, never a separate constant; (2) discharge recognition is COVERAGE
// (`resolveDischargeAnchor`: a run discharges iff its `measuredGates` is a SUPERSET of the
// CURRENTLY deferred names), not exact-set equality — a run that measured more than what is
// deferred today still counts.
//
// THE CORE IDEA: a deferral is anchored to the day it was DECLARED (`GameManifest.ciGateBudget.
// deferGatesToNightly.since` — see that field's own doc), and ages from there until a committed
// `DeferralRun` shows a later day that covered the same gates for real. Three severities:
// "fresh", "stale" (>= DEFERRAL_WARN_DAYS), "overdue" (>= DEFERRAL_FATAL_DAYS, individually
// fatal). A SEPARATE, aggregate rule (DEFERRAL_MATERIAL_FRACTION) additionally fails a report
// when a MAJORITY of a game's real gates have gone stale together, even with no single row
// individually overdue — Mine Run's actual 8/10 shape.
//
// THRESHOLDS, ARGUED (unchanged from C70 — C81's review reproduced and upheld this reasoning):
//   - DEFERRAL_WARN_DAYS = 7. Nightly's own cadence is daily; a single missed night is not
//     evidence of anything, but seven consecutive misses leaves no "someone will notice
//     tomorrow" excuse. This is the point a deferral becomes VISIBLE, not yet build-breaking.
//   - DEFERRAL_FATAL_DAYS = 30. Reuses this codebase's OWN existing 30-day convention
//     (solo-gates.ts's `certifiedBufferDays`) rather than inventing a number. C81's review noted
//     the transfer is warn-on-REMAINING-RUNWAY -> fatal-on-ELAPSED-AGE, which is strictly MORE
//     conservative than the source convention, not a loose analogy. C68's actual blocker
//     (GitHub Actions billing) is fixable in minutes, so 30 days is far more runway than any
//     transient explanation needs.
//   - DEFERRAL_MATERIAL_FRACTION = 0.5. Once a MAJORITY of a game's real (non-"n/a") gates are
//     simultaneously stale-or-worse, "OK" is describing well under half the actual gate table —
//     misleading regardless of whether any individual row has reached the fatal threshold yet.
//
// WHERE THE RECORD LIVES, AND HOW IT DOESN'T GO STALE THE SAME WAY (C70's own question, C81's
// review sharpened the answer):
//   1. It self-registers on the "when did this begin" half. `since` lives in the manifest
//      itself (committed, human-authored, code-reviewed exactly like `reason`) and is read
//      LIVE every time — there is no separate cached "first observed" value that could drift
//      from it or need reconciling. A manifest edit that bumps `since` forward is a normal,
//      reviewable diff in the SAME field that already carries the cost justification — visible
//      to a reviewer directly, rather than something a ledger has to silently defend against.
//   2. Discharge is tamper-evident BY CONSTRUCTION. There is no single mutable "lastDischargedAt"
//      date to hand-edit — discharging a promise requires a whole dated `DeferralRun` file
//      whose `measuredGates` actually covers what was deferred, committed and reviewable like
//      any other evidence artifact in this repo (`data/certificates/`, `docs/research/games/`).
//   3. Its failure mode is asymmetric on purpose. If a nightly run's artifact is never written
//      or never committed (billing outage, someone forgot), the worst case is the deferral
//      keeps aging from `since` — exactly the state C70 exists to surface, not a state that
//      silently looks discharged. A `DeferralRun` that fails validation (malformed shape, an
//      invalid date, a day/filename mismatch) throws LOUDLY (`MalformedDeferralRunError`) rather
//      than being silently ignored or read as some default — C81's A3 finding on the first
//      version was that a malformed `firstObservedAt` produced `NaN` age, both threshold
//      comparisons false, and a silent `"fresh"` verdict: exit 0 on corrupted input. This
//      version has no code path that reaches a numeric comparison without first validating
//      every date it read.
//
// THE DOCUMENTED MANUAL PATH (required by C81's ruling, since the automated one is blocked on
// billing no code change fixes): a human runs `pnpm harness:ci-gates -- --suite nightly
// [--game <id>]` locally (exactly as C70 itself was measured — "run everything locally"), which
// writes `data/deferral-runs/<gameId>/<day>.json` for every game whose manifest still declares
// a deferral, and then commits that file the same way a certified daily gets committed. Nothing
// in nightly.yml needs to change: its existing `pnpm harness:ci-gates -- --suite nightly` step
// still writes the same file into the ephemeral runner's own workspace, harmlessly discarded —
// it is simply no longer load-bearing for anything, since discharge no longer depends on that
// write surviving.

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GameCiGateReport } from "./ci-gates";

export type DeferralLane = "two-player" | "solo-chase";

export const DEFERRAL_WARN_DAYS = 7;
export const DEFERRAL_FATAL_DAYS = 30;
export const DEFERRAL_MATERIAL_FRACTION = 0.5;

export type DeferralSeverity = "fresh" | "stale" | "overdue";

export class InvalidDeferralSinceError extends Error {
  constructor(value: string, context: string) {
    super(`deferral-ledger: invalid UTC date ${JSON.stringify(value)} for ${context} — expected "YYYY-MM-DD".`);
    this.name = "InvalidDeferralSinceError";
  }
}

/** Thrown by `readDeferralRun`/`readAllDeferralRuns` on ANY malformed stored artifact — wrong
 *  shape, an invalid date, an unrecognized `lane`, or (mirroring certify.ts's
 *  `CertificateDayMismatchError`) a `day` that disagrees with the filename it's stored under.
 *  Never caught and defaulted internally: a corrupted evidence file must fail LOUD (C81's A3
 *  finding on the prior version — a malformed date must never read as a quietly-passing
 *  "fresh"). */
export class MalformedDeferralRunError extends Error {
  constructor(gameId: string, day: string, reason: string) {
    super(`deferral-ledger: malformed DeferralRun for "${gameId}" at "${day}" — ${reason}`);
    this.name = "MalformedDeferralRunError";
  }
}

function assertValidIsoDay(value: string, context: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new InvalidDeferralSinceError(value, context);
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function deferralSeverity(ageDays: number): DeferralSeverity {
  if (ageDays >= DEFERRAL_FATAL_DAYS) return "overdue";
  if (ageDays >= DEFERRAL_WARN_DAYS) return "stale";
  return "fresh";
}

export function deferralAgeDays(anchorDay: string, today: string): number {
  assertValidIsoDay(anchorDay, "anchor day");
  assertValidIsoDay(today, "today");
  return Math.max(0, daysBetween(anchorDay, today));
}

export interface GateRowLike {
  readonly name: string;
  readonly status: string;
}

/** Every gate name a report measured FOR REAL — every row that is NOT `"n/a"`. Used on BOTH
 *  sides of discharge recognition (the currently-deferred set at "ci", and what a real nightly
 *  run actually measured) so there is exactly one source of truth for "what counts as this
 *  lane's gates", never a hardcoded list that can drift out of sync with either report (C81's
 *  A2 finding). A nightly report never contains a `"deferred"` row (structurally enforced by
 *  `SoloDeferredGateAtNightlyError`/`TwoPlayerDeferredGateAtNightlyError`), so every non-"n/a"
 *  row there is, by construction, something that WAS measured for real that run. */
export function measuredGateNames(gates: readonly GateRowLike[]): string[] {
  return gates.filter((g) => g.status !== "n/a").map((g) => g.name);
}

// ---------------------------------------------------------------------------------------
// DeferralRun — one committed, immutable, per-day artifact per game (mirrors certify.ts's
// DailyCertificate storage convention line for line: baseDir-injected, atomic write via
// tmp+rename, ENOENT reads as "nothing stored", validate everything read, throw loudly on
// mismatch).
// ---------------------------------------------------------------------------------------

export interface DeferralRun {
  readonly gameId: string;
  readonly lane: DeferralLane;
  /** UTC "YYYY-MM-DD" — the day this run actually happened. */
  readonly day: string;
  /** The tier that produced this run — always "nightly" today (the only tier that ever
   *  measures a deferred lane's gates for real), spelled out rather than assumed. */
  readonly suite: "nightly";
  /** Every gate name this run measured for real (see `measuredGateNames`) — NOT filtered down
   *  to "only the ones some other list says are deferrable"; the full real set, so coverage
   *  checks (`resolveDischargeAnchor`) work regardless of which specific rows happen to be
   *  deferred at any given "ci" run. */
  readonly measuredGates: readonly string[];
}

export function deferralRunPath(baseDir: string, gameId: string, day: string): string {
  return path.join(baseDir, gameId, `${day}.json`);
}

export function defaultDeferralRunsBaseDir(repoRoot: string): string {
  return path.join(repoRoot, "data/deferral-runs");
}

/** Atomic write (tmp file in the same directory, then `rename`) — identical reasoning to
 *  certify.ts's `writeCertificate`: a reader never observes a half-written run. */
export async function writeDeferralRun(baseDir: string, run: DeferralRun): Promise<void> {
  const file = deferralRunPath(baseDir, run.gameId, run.day);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function assertValidDeferralRun(value: unknown, gameId: string, expectedDay: string): asserts value is DeferralRun {
  const fail = (reason: string): never => {
    throw new MalformedDeferralRunError(gameId, expectedDay, reason);
  };
  if (typeof value !== "object" || value === null) fail("not a JSON object");
  const v = value as Record<string, unknown>;
  if (typeof v.gameId !== "string" || v.gameId.length === 0) fail("missing/invalid gameId");
  if (v.gameId !== gameId) fail(`gameId "${String(v.gameId)}" disagrees with the directory it was read from ("${gameId}")`);
  if (v.lane !== "two-player" && v.lane !== "solo-chase") fail(`invalid lane ${JSON.stringify(v.lane)}`);
  if (typeof v.day !== "string") fail("missing day");
  try {
    assertValidIsoDay(v.day as string, "day");
  } catch (err) {
    fail((err as Error).message);
  }
  if (v.day !== expectedDay) fail(`stored day "${String(v.day)}" disagrees with the filename it's stored under ("${expectedDay}.json")`);
  if (v.suite !== "nightly") fail(`invalid suite ${JSON.stringify(v.suite)}`);
  if (!Array.isArray(v.measuredGates) || !(v.measuredGates as unknown[]).every((g) => typeof g === "string")) {
    fail("measuredGates must be a string array");
  }
}

export async function readDeferralRun(baseDir: string, gameId: string, day: string): Promise<DeferralRun | undefined> {
  let raw: string;
  try {
    raw = await readFile(deferralRunPath(baseDir, gameId, day), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MalformedDeferralRunError(gameId, day, "not valid JSON");
  }
  assertValidDeferralRun(parsed, gameId, day);
  return parsed;
}

/** All committed runs for a game, sorted ascending by day (a UTC "YYYY-MM-DD" string, so
 *  lexicographic order is chronological order) — mirrors certify.ts's `readAllCertificates`. */
export async function readAllDeferralRuns(baseDir: string, gameId: string): Promise<DeferralRun[]> {
  let entries: string[];
  try {
    entries = await readdir(path.join(baseDir, gameId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const days = entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  days.sort();
  const runs: DeferralRun[] = [];
  for (const day of days) {
    const run = await readDeferralRun(baseDir, gameId, day);
    if (run) runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------------------
// Discharge recognition and aging — pure, no I/O. `resolveDischargeAnchor`/
// `annotateDeferralAging` take already-loaded `DeferralRun[]` and an already-resolved `today`
// so they stay testable without touching a filesystem.
// ---------------------------------------------------------------------------------------

export interface DischargeAnchor {
  /** UTC "YYYY-MM-DD" — the day age is measured from: the most recent covering run's day, or
   *  `since` (or `today`, if `since` was never set) when nothing has ever discharged it. */
  readonly anchorDay: string;
  /** The specific run that discharges the CURRENTLY-deferred gate set, if any. */
  readonly dischargedBy?: DeferralRun;
}

/**
 * Requirement 1, "a later run recognized as the discharging one": among `runs`, the most recent
 * whose `measuredGates` COVERS every name in `deferredGateNames` (a superset check, not exact
 * equality — see this module's own doc on C81's A2 finding) discharges the deferral; its `day`
 * becomes the age anchor. With no covering run, the anchor is `since` (the manifest-declared
 * day this deferral was committed) or `today` if `since` was never set — the documented,
 * understating-age fallback.
 */
export function resolveDischargeAnchor(
  deferredGateNames: readonly string[],
  runs: readonly DeferralRun[],
  since: string | undefined,
  today: string
): DischargeAnchor {
  assertValidIsoDay(today, "today");
  if (since !== undefined) assertValidIsoDay(since, "since");

  const covering = runs
    .filter((r) => deferredGateNames.every((g) => r.measuredGates.includes(g)))
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const dischargedBy = covering[0];
  if (dischargedBy) return { anchorDay: dischargedBy.day, dischargedBy };
  return { anchorDay: since ?? today };
}

export interface DeferralRowAging {
  readonly gate: string;
  readonly ageDays: number;
  readonly severity: DeferralSeverity;
}

export interface DeferralAgingReport {
  readonly gameId: string;
  /** One row per gate currently reporting `"deferred"` in the evaluated report. */
  readonly rows: readonly DeferralRowAging[];
  /** Count of non-"n/a" rows in the evaluated report — the denominator for materiality. */
  readonly applicableGateCount: number;
  readonly staleOrOverdueCount: number;
  readonly staleOrOverdueFraction: number;
  /** Requirement 2: at least one row individually past DEFERRAL_FATAL_DAYS. */
  readonly anyOverdue: boolean;
  /** Requirement 3: staleOrOverdueFraction >= DEFERRAL_MATERIAL_FRACTION, independent of
   *  whether any single row is individually overdue yet. */
  readonly materialityBreached: boolean;
  /** True iff this report must NOT be treated as an unqualified/provisional pass — the exit
   *  code driver. `anyOverdue || materialityBreached`. */
  readonly forcesFail: boolean;
}

/** The pure core: given an already-evaluated gate row array (untouched — never re-derives or
 *  overrides a single row's `status`), this game's committed discharge evidence, and its
 *  manifest-declared `since`, computes the aging/materiality verdict. Returns `undefined` when
 *  no row is `"deferred"` — a game with no active deferral is completely untouched by this
 *  mechanism. */
export function annotateDeferralAging(
  gameId: string,
  gates: readonly GateRowLike[],
  runs: readonly DeferralRun[],
  since: string | undefined,
  today: string
): DeferralAgingReport | undefined {
  const deferredNames = gates.filter((g) => g.status === "deferred").map((g) => g.name);
  if (deferredNames.length === 0) return undefined;

  const applicableGateCount = gates.filter((g) => g.status !== "n/a").length;
  const { anchorDay } = resolveDischargeAnchor(deferredNames, runs, since, today);
  const ageDays = deferralAgeDays(anchorDay, today);
  const severity = deferralSeverity(ageDays);
  const rows: DeferralRowAging[] = deferredNames.map((gate) => ({ gate, ageDays, severity }));

  const staleOrOverdueCount = severity === "fresh" ? 0 : deferredNames.length;
  const staleOrOverdueFraction = applicableGateCount === 0 ? 0 : staleOrOverdueCount / applicableGateCount;
  const anyOverdue = severity === "overdue";
  const materialityBreached = staleOrOverdueFraction >= DEFERRAL_MATERIAL_FRACTION;

  return {
    gameId,
    rows,
    applicableGateCount,
    staleOrOverdueCount,
    staleOrOverdueFraction,
    anyOverdue,
    materialityBreached,
    forcesFail: anyOverdue || materialityBreached,
  };
}

/** The exit-code combinator: a report that was otherwise `ok` (no `"fail"` row) is no longer
 *  effectively ok once aging forces it — the direct fix for C70's "OK (provisional — …) with
 *  exit code 0" finding. A report that was already not-ok stays not-ok regardless. */
export function effectiveOk(reportOk: boolean, aging: DeferralAgingReport | undefined): boolean {
  return reportOk && !(aging?.forcesFail ?? false);
}

// ---------------------------------------------------------------------------------------
// GameCiGateReport adapters — the two gate lanes name their row fields differently
// (suites.ts's GateResult.gate vs solo-gates.ts's GateResult.name); normalized here to the one
// shape (`GateRowLike`) this module's pure functions consume. solo-puzzle never carries a
// `ciGateBudget.deferGatesToNightly` concern, so it is not a `DeferralLane` at all.
// ---------------------------------------------------------------------------------------

export function laneOfReport(result: GameCiGateReport): DeferralLane | undefined {
  if (result.kind === "two-player") return "two-player";
  if (result.kind === "solo-chase") return "solo-chase";
  return undefined;
}

export function gateRowsFromReport(result: GameCiGateReport): readonly GateRowLike[] {
  if (result.kind === "two-player") return result.report.gates.map((g) => ({ name: g.gate, status: g.status }));
  if (result.kind === "solo-chase") return result.report.gates.map((g) => ({ name: g.name, status: g.status }));
  return [];
}

/** Convenience: `annotateDeferralAging` fed straight from a `GameCiGateReport` + this game's
 *  already-loaded discharge evidence, the way scripts/ci-gates.ts's wiring layer calls it. */
export function annotateDeferralAgingForReport(
  result: GameCiGateReport,
  runs: readonly DeferralRun[],
  since: string | undefined,
  today: string
): DeferralAgingReport | undefined {
  return annotateDeferralAging(result.gameId, gateRowsFromReport(result), runs, since, today);
}

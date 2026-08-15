// packages/harness/src/deferral-ledger.ts — the deferral-DISCHARGE ledger (platform-
// corrections.md C70, closing a gap C27/C68 left open).
//
// C27 built a real "deferred" gate status: a Strong-dependent solo-chase row (or its two-player
// analogue) that is too expensive to measure at suite "ci" reports `"deferred"`, naming nightly
// as the tier that measures it for real. That is sound cost management and this module does not
// touch it — `evaluateSoloGates`/`evaluateChaseGates`/`evaluateCiGates` are untouched by this
// file, on purpose, so every existing gate's semantics and every existing report's raw shape
// stay byte-identical.
//
// C68 then found nightly has never once completed a run (eight attempts, eight failures, all
// GitHub Actions billing, zero code). C70's finding, concrete on Mine Run: 8 of its 10 gates
// have been measured NOWHERE, EVER, and its CI report has printed "OK (provisional — …)" with
// exit code 0 every single time regardless — because nothing checks that "measured at nightly"
// ever actually happened. A deferral is a promise about the future; this module is what checks
// the promise was kept.
//
// THE CORE IDEA: a deferral is anchored to the day it was DECLARED (`GameManifest.ciGateBudget.
// deferGatesToNightly.since` — see that field's own doc for why this is manifest-authored
// rather than inferred from whenever a run first happens to read it), and ages from there until
// a run that actually measures the SAME gate set for real (`recordDischarge`, called only at
// suite "nightly", which structurally never accepts a partial/deferred roster — see
// solo-gates.ts's `SoloDeferredGateAtNightlyError` / suites.ts's `TwoPlayerDeferredGateAtNightlyError`)
// resets the clock. Three severities: "fresh" (recently declared or recently discharged),
// "stale" (visibly overdue, past DEFERRAL_WARN_DAYS), "overdue" (DEFERRAL_FATAL_DAYS+ —
// individually fatal). A SEPARATE, aggregate rule (DEFERRAL_MATERIAL_FRACTION) additionally
// fails a report when a MAJORITY of a game's real gates have gone stale together, even if no
// single row has individually reached "overdue" yet — Mine Run's actual 8/10 shape, which is
// "material" from the day it goes stale, not only after 30 days.
//
// THRESHOLDS, ARGUED (not just picked):
//   - DEFERRAL_WARN_DAYS = 7. Nightly's own cadence is daily; a single missed night (a bad
//     build, a transient blip) is not evidence of anything — but seven consecutive misses is a
//     full week with no plausible "someone will notice tomorrow" excuse left. This is also the
//     point a deferral becomes VISIBLE (a `"stale"` row, and materiality starts counting it),
//     not yet build-breaking on its own.
//   - DEFERRAL_FATAL_DAYS = 30. Reuses this codebase's OWN existing 30-day convention
//     (solo-gates.ts's `certifiedBufferDays`: warn under 30 days of buffer) rather than
//     inventing a new number. Thirty days is far more runway than any plausible transient-infra
//     explanation needs (C68's actual blocker — GitHub Actions billing — is fixable in minutes,
//     not weeks) while still giving a real fix window before a shipped game's central gates are
//     allowed to block on it. Past this point "deferred" and "abandoned" are the same word, and
//     the report must say so.
//   - DEFERRAL_MATERIAL_FRACTION = 0.5. Once a MAJORITY of a game's real (non-"n/a") gates are
//     simultaneously stale-or-worse, "OK" is describing well under half the actual gate table —
//     that claim is misleading regardless of whether any individual row has reached the
//     (further-out) fatal threshold yet. Below half, the report is still meaningfully
//     informative about most of the table even while imperfect, so it stays a provisional OK.
//
// WHERE THE RECORD LIVES, AND HOW IT DOESN'T GO STALE THE SAME WAY (C70's own question):
// `data/deferral-ledger.json`, checked into the repo — greppable, reviewable, survives a fresh
// checkout, needs no CI. Three concrete anti-staleness properties, not just a promise:
//   1. It self-registers. `observeDeferral` is called as a side effect of every ordinary "ci"
//      run (scripts/ci-gates.ts's main()) — nobody has to remember a separate step, the same
//      way certify.ts's certificates are written by running certify, not by hand.
//   2. Its age anchor can only move EARLIER for an unchanged identity, never later (see
//      `resolveEntry` below) — a manifest edit that bumps `since` forward, or a ledger entry
//      that gets regenerated from scratch, can never erase already-recorded age for the SAME
//      promise. Only a materially different gate set (a genuinely new promise) resets the
//      clock, and that is a deliberate, visible choice (a different `gates` array), not a
//      silent one.
//   3. Its failure mode is asymmetric on purpose: if the ledger write is ever skipped or lost,
//      the WORST that happens is the next run re-anchors from `since` (still correct, if
//      `since` is set) or from "today" (understating age — the documented, safe-side fallback).
//      Nothing about losing the ledger can make an aging deferral look MORE fresh than it is
//      relative to its own declared `since`; it can only, at worst, fail to have accumulated
//      extra credit for a discharge that isn't re-derivable any other way. A ledger that goes
//      stale in this scheme rots toward MORE alarm, never toward silently exonerating a promise
//      that was never kept — which is the one direction C70 exists to forbid.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GameCiGateReport } from "./ci-gates";

export type DeferralLane = "two-player" | "solo-chase";

export const DEFERRAL_WARN_DAYS = 7;
export const DEFERRAL_FATAL_DAYS = 30;
export const DEFERRAL_MATERIAL_FRACTION = 0.5;

export type DeferralSeverity = "fresh" | "stale" | "overdue";

/** One tracked deferral per gameId — a game has at most one active `ciGateBudget.
 *  deferGatesToNightly` block (it belongs to exactly one gate lane), so `gameId` alone is a
 *  sufficient ledger key; `lane` is still carried for audit/display and as an identity guard. */
export interface DeferralLedgerEntry {
  readonly gameId: string;
  readonly lane: DeferralLane;
  /** Sorted gate names this deferral covers — the DEFERRABLE_CI_GATES / STRONG_DEPENDENT_
   *  CHASE_GATES list for this lane at observation time. Part of the deferral's IDENTITY: a
   *  later observation with a different gate set is a materially different promise, not the
   *  same one continuing, and resets `firstObservedAt`. */
  readonly gates: readonly string[];
  /** The tier a later run must complete at, for real, to discharge this deferral — always
   *  "nightly" today (the only other suite), spelled out rather than assumed so a reader of a
   *  raw ledger entry never has to infer it. */
  readonly dischargingSuite: "nightly";
  /** UTC "YYYY-MM-DD" this exact identity was first observed — either the manifest's own
   *  declared `since` (preferred) or the day a run first saw it (fallback; understates age). */
  readonly firstObservedAt: string;
  /** UTC "YYYY-MM-DD" of the most recent run that actually measured this identity's gates for
   *  real. Undefined iff this deferral has NEVER been discharged — Mine Run's real state today. */
  readonly lastDischargedAt?: string;
}

export type DeferralLedger = Readonly<Record<string, DeferralLedgerEntry>>;

export class InvalidDeferralSinceError extends Error {
  constructor(value: string, context: string) {
    super(`deferral-ledger: invalid UTC date ${JSON.stringify(value)} for ${context} — expected "YYYY-MM-DD".`);
    this.name = "InvalidDeferralSinceError";
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

function sameGateSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((g, i) => g === bs[i]);
}

export interface DeferralObservation {
  readonly gameId: string;
  readonly lane: DeferralLane;
  /** The gate names THIS observation covers — need not be pre-sorted. */
  readonly gates: readonly string[];
  /** `GameManifest.ciGateBudget.deferGatesToNightly.since`, forwarded verbatim. Omit only for a
   *  deferral that never set it (see that field's own doc for the consequence). */
  readonly since?: string;
}

/** Resolves the ledger entry an observation/discharge should be merged into: reuses the
 *  existing entry (anchor never moves later) when the identity (lane + gate set) is unchanged,
 *  or starts a fresh one (anchored at `since`, discharge history cleared) when it is not — a
 *  materially different gate set is a materially different promise. See this module's own doc
 *  for why "never moves later" is the ledger's core anti-staleness property. */
function resolveEntry(ledger: DeferralLedger, obs: DeferralObservation, today: string): DeferralLedgerEntry {
  assertValidIsoDay(today, "today");
  if (obs.since !== undefined) {
    assertValidIsoDay(obs.since, `manifest.ciGateBudget.deferGatesToNightly.since for "${obs.gameId}"`);
  }

  const gates = [...obs.gates].sort();
  const existing = ledger[obs.gameId];
  const matchesIdentity = existing !== undefined && existing.lane === obs.lane && sameGateSet(existing.gates, gates);

  if (matchesIdentity) {
    const candidates = [existing.firstObservedAt, ...(obs.since !== undefined ? [obs.since] : [])];
    const firstObservedAt = candidates.reduce((a, b) => (a < b ? a : b));
    return { ...existing, gates, firstObservedAt };
  }

  return {
    gameId: obs.gameId,
    lane: obs.lane,
    gates,
    dischargingSuite: "nightly",
    firstObservedAt: obs.since ?? today,
  };
}

/** Records that suite "ci" saw this deferral active this run — the "self-registering" half of
 *  the anti-staleness scheme (this module's own doc, property 1): called as a side effect of an
 *  ordinary CI run, never a separate step a human has to remember. Never touches
 *  `lastDischargedAt`. */
export function observeDeferral(ledger: DeferralLedger, obs: DeferralObservation, today: string): DeferralLedger {
  return { ...ledger, [obs.gameId]: resolveEntry(ledger, obs, today) };
}

/** Records that suite "nightly" measured this identity's gates for real THIS run — recognizing
 *  a later run as "the discharging one" (requirement 1). Safe to call even when no prior
 *  `observeDeferral` ever ran for this identity (nightly running before any CI observation is
 *  not a lost event — the entry is created fresh, already discharged, age 0). */
export function recordDischarge(ledger: DeferralLedger, obs: DeferralObservation, today: string): DeferralLedger {
  const entry = resolveEntry(ledger, obs, today);
  return { ...ledger, [obs.gameId]: { ...entry, lastDischargedAt: today } };
}

/** Days since this deferral was last known to be kept — from `lastDischargedAt` if it has ever
 *  been discharged (a fresh promise renewed nightly reads as ~0 forever), else from
 *  `firstObservedAt` (Mine Run's real, undischarged-since-2026-08-07 case). */
export function deferralAgeDays(entry: DeferralLedgerEntry, today: string): number {
  assertValidIsoDay(today, "today");
  const anchor = entry.lastDischargedAt ?? entry.firstObservedAt;
  return Math.max(0, daysBetween(anchor, today));
}

export function deferralSeverity(ageDays: number): DeferralSeverity {
  if (ageDays >= DEFERRAL_FATAL_DAYS) return "overdue";
  if (ageDays >= DEFERRAL_WARN_DAYS) return "stale";
  return "fresh";
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

export interface GateRowLike {
  readonly name: string;
  readonly status: string;
}

/** The pure core: given an already-evaluated gate row array (untouched — this never re-derives
 *  or overrides a single row's `status`) and this game's ledger entry (if any), computes the
 *  aging/materiality verdict. Returns `undefined` when no row is `"deferred"` — a game with no
 *  active deferral is completely untouched by this mechanism, which is what makes the
 *  byte-identity guard for non-deferring games trivial: nothing downstream needs to special-case
 *  "aging is absent" beyond checking for `undefined`. */
export function annotateDeferralAging(
  gameId: string,
  gates: readonly GateRowLike[],
  ledgerEntry: DeferralLedgerEntry | undefined,
  today: string
): DeferralAgingReport | undefined {
  const deferredNames = gates.filter((g) => g.status === "deferred").map((g) => g.name);
  if (deferredNames.length === 0) return undefined;

  const applicableGateCount = gates.filter((g) => g.status !== "n/a").length;
  // Missing ledger entry for an active deferral (e.g. a dry run that never persisted) is
  // treated as age 0 — the conservative direction: never manufacture alarm from an absence of
  // history, only from a PRESENT, dated one (this module's own doc, "rots toward more alarm,
  // never toward silently exonerating" — but exonerating something with literally no evidence
  // either way is not the same as silently exonerating a KNOWN-aged promise).
  const ageDays = ledgerEntry ? deferralAgeDays(ledgerEntry, today) : 0;
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
 *  effectively ok once aging forces it — this is the direct fix for C70's "OK (provisional — …)
 *  with exit code 0" finding. A report that was already not-ok stays not-ok regardless. */
export function effectiveOk(reportOk: boolean, aging: DeferralAgingReport | undefined): boolean {
  return reportOk && !(aging?.forcesFail ?? false);
}

// ---------------------------------------------------------------------------------------
// GameCiGateReport adapters — the two gate lanes name their row fields differently
// (suites.ts's GateResult.gate vs solo-gates.ts's GateResult.name); normalized here to the one
// shape (`GateRowLike`) this module's pure functions consume. solo-puzzle never carries a
// `ciGateBudget.deferGatesToNightly` concern (manifest.ts's own doc: the field only ever names
// the two-player and solo score-chase lanes), so it is not a `DeferralLane` at all.
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

/** Convenience: `annotateDeferralAging` fed straight from a `GameCiGateReport` + the current
 *  ledger, the way scripts/ci-gates.ts's wiring layer actually calls it. */
export function annotateDeferralAgingForReport(
  result: GameCiGateReport,
  ledger: DeferralLedger,
  today: string
): DeferralAgingReport | undefined {
  return annotateDeferralAging(result.gameId, gateRowsFromReport(result), ledger[result.gameId], today);
}

// ---------------------------------------------------------------------------------------
// Storage — committed JSON at (conventionally) `data/deferral-ledger.json`, mirroring
// certify.ts's own `baseDir`-injected, atomic-write (tmp file + rename) convention exactly:
// this module's ONLY job is get-it-to/from-disk, nothing schema-specific, and a caller-supplied
// path (never a baked-in absolute one) so tests point it at a scratch directory.
// ---------------------------------------------------------------------------------------

export function defaultLedgerPath(repoRoot: string): string {
  return path.join(repoRoot, "data/deferral-ledger.json");
}

export async function readDeferralLedger(filePath: string): Promise<DeferralLedger> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as DeferralLedger;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

/** Serializes with keys sorted (gameId order) so an unchanged ledger re-writes byte-identically
 *  — no git churn from re-running gates when nothing actually changed. Atomic (tmp + rename),
 *  same reasoning as certify.ts's `writeCertificate`: a reader never observes a half-written
 *  ledger. */
export async function writeDeferralLedger(filePath: string, ledger: DeferralLedger): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sortedEntries: Record<string, DeferralLedgerEntry> = {};
  for (const key of Object.keys(ledger).sort()) {
    sortedEntries[key] = ledger[key]!;
  }
  await writeFile(tmp, `${JSON.stringify(sortedEntries, null, 2)}\n`, "utf8");
  await rename(tmp, filePath);
}

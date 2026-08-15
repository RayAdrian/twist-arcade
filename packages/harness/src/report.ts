// packages/harness/src/report.ts — JSON + human-readable table formatting shared by cli.ts's
// `solve`/`run`/`suite` commands. No logic of its own beyond formatting: every number printed
// here was already computed by solve.ts/runner.ts/suites.ts.

import type { SolveResult } from "./solver/solve";
import type { MatchupReport } from "./runner";
import type { CiSuiteReport } from "./suites";
import type { GameCiGateReport } from "./ci-gates";
import type { GateResult as SoloGateResult } from "./solo-gates";
import { DEFERRAL_FATAL_DAYS, DEFERRAL_MATERIAL_FRACTION, DEFERRAL_WARN_DAYS, type DeferralAgingReport } from "./deferral-ledger";

/** Plain `JSON.stringify(value, null, 2)` — every report this package produces is a plain
 *  object with a fixed key order from the code that built it (never from variable insertion
 *  order), so this is already deterministic across runs; no stable-stringify machinery needed
 *  on top (that concern is `@twist-arcade/engine`'s `encode()`'s, for canonical HASHING over
 *  arbitrary game state, not this module's, for one-way human/CI-consumed output). */
export function toReportJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatSolveResult(result: SolveResult): string {
  const lines = [`reachable states: ${result.reachableStates}`, `root value: ${result.rootValue}`, "openings:"];
  for (const opening of result.openings) {
    lines.push(`  ${JSON.stringify(opening.move)}: ${opening.value}`);
  }
  return lines.join("\n");
}

/** Same as `toReportJson`, but drops `throughputGamesPerSec` — the single field a `MatchupReport`
 *  carries that is NOT decision-derived (runner.ts's own doc: search budgets are always
 *  `{kind:"rollouts"}`, so every DECISION is deterministic under a fixed seed; only the elapsed-
 *  time measurement varies run to run with a real Clock). Plan §9's anchor is a byte-identical
 *  JSON artifact under a fixed seed — three identical CLI invocations previously measured
 *  952.38 / 869.57 / 888.89 games/sec, breaking that anchor. JSON-only: `formatMatchupTable`
 *  (the human-readable form) still prints throughput; only the machine-readable artifact drops
 *  it. */
export function toMatchupReportJson(report: MatchupReport): string {
  const deterministic: Omit<MatchupReport, "throughputGamesPerSec"> = {
    agentA: report.agentA,
    agentB: report.agentB,
    metrics: report.metrics,
    outcomes: report.outcomes,
  };
  return JSON.stringify(deterministic, null, 2);
}

export function formatMatchupTable(report: MatchupReport): string {
  const m = report.metrics;
  return [
    `${report.agentA} vs ${report.agentB} — ${m.games} games`,
    `  first-player win rate:   ${(m.firstPlayerWinRate * 100).toFixed(1)}%`,
    `  draw rate:               ${(m.drawRate * 100).toFixed(1)}%`,
    `  win rate by seat:        [${(m.winRateBySeat[0] * 100).toFixed(1)}%, ${(m.winRateBySeat[1] * 100).toFixed(1)}%]`,
    `  plies (mean/median/p95): ${m.meanPlies.toFixed(1)} / ${m.medianPlies} / ${m.p95Plies}`,
    `  mean branching factor:   ${m.meanBranchingFactor.toFixed(2)}`,
    `  cap-hit rate:            ${(m.capHitRate * 100).toFixed(2)}%`,
    `  throughput:              ${report.throughputGamesPerSec.toFixed(1)} games/sec`,
  ].join("\n");
}

// "DEFER" (platform-corrections.md C27) is deliberately as visually distinct from "N/A " and
// "PASS" as every other status already is from every other — the whole point of the status is
// that a human reading this table can tell "doesn't apply" (N/A), "measured, healthy" (PASS),
// and "applies, runs at nightly, not measured here" (DEFER) apart at a glance, never conflating
// the second and third the way C2/C23 exist to prevent for the first and second.
// "NEVER" (platform-corrections.md C57) gets the same "as visually distinct as everything
// else" treatment as "DEFER" got under C27: a reader must be able to tell "measured, genuinely
// never reached, no baseline to regress from" (NEVER) apart from "measured, healthy" (PASS),
// "measured, regressed from a declared baseline" (FAIL), and "doesn't apply" (N/A ) at a glance
// — the exact collapse C57 fixes was two different claims both printing "FAIL".
const STATUS_LABEL: Record<string, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  "n/a": "N/A ",
  deferred: "DEFER",
  unattained: "NEVER",
};

/** C27: a run can be `ok` (no `"fail"` row) while still containing `"deferred"` rows — a
 *  PROVISIONAL pass, not the same claim a fully-measured green makes. Decision (see
 *  `docs/plans/platform-corrections.md` C27 and this module's own report for the full
 *  argument): `ok` stays `true` so CI is not blocked by a gate that is working exactly as
 *  designed, but the rendered header must say so explicitly — "OK" alone, unqualified, would
 *  read identically to a nightly run that measured everything, and a reader has no way to tell
 *  a provisional pass from a real one without opening every row.
 *
 *  C57 extends the same reasoning to `"unattained"` rows: a report can ALSO be `ok` while
 *  `solved-value-reached` genuinely never reached a proven value with no baseline to regress
 *  from — not a failure (nothing regressed), but still not the claim a bare "OK" makes either.
 *  `hasUnattained` defaults to `false` so every existing call site (and `formatSoloGateTable`,
 *  whose lane has no `"unattained"` status at all) keeps its exact prior header text. Both
 *  qualifiers can be present on the same report at once — the header lists whichever apply,
 *  never silently drops one for the other. */
/** `extraNote` (platform-corrections.md C70): an additional provisional-note clause, folded in
 *  alongside `hasDeferred`/`hasUnattained`'s own notes exactly the same way — used by the
 *  aging-aware formatters below to surface a NON-material stale row (visible, but not yet
 *  forcing STALLED) without duplicating this function's note-joining logic. Every EXISTING call
 *  site passes 3 args, so `extraNote` stays `undefined` and this function's output is
 *  byte-identical to before this parameter existed. */
function verdictLabel(ok: boolean, hasDeferred: boolean, hasUnattained = false, extraNote?: string): string {
  if (!ok) return "FAILED";
  const notes: string[] = [];
  if (hasDeferred) notes.push("deferred rows not yet measured at this tier");
  if (hasUnattained) notes.push("a solvedValue row was measured and never attained, with no baseline to regress from — see solved-value-reached");
  if (extraNote) notes.push(extraNote);
  return notes.length === 0 ? "OK" : `OK (provisional — ${notes.join("; ")})`;
}

// ---------------------------------------------------------------------------------------
// platform-corrections.md C70: deferral-discharge aging, rendered. Strictly additive on top of
// the formatters above — every `formatXWithAging(..., undefined)` call delegates straight to
// the un-aged formatter, so a game with no active deferral (`aging` is always `undefined` for
// it — see `annotateDeferralAging`'s own doc) renders byte-identically to before this file
// existed. Only a game with at least one `"deferred"` row is ever affected.
// ---------------------------------------------------------------------------------------

const AGING_SEVERITY_LABEL: Record<DeferralAgingReport["rows"][number]["severity"], string> = {
  fresh: "",
  stale: "STALE",
  overdue: "OVERDUE",
};

function agingRowSuffix(gateName: string, aging: DeferralAgingReport): string {
  const row = aging.rows.find((r) => r.gate === gateName);
  if (!row || row.severity === "fresh") return "";
  const label = AGING_SEVERITY_LABEL[row.severity];
  return ` — undischarged ${row.ageDays}d (${label}; warn>=${DEFERRAL_WARN_DAYS}d, fatal>=${DEFERRAL_FATAL_DAYS}d)`;
}

/** The note folded into a still-provisional (not `forcesFail`) header when some deferred rows
 *  have gone stale but not enough of the table is affected to breach materiality — visible
 *  (requirement 2's "progressively louder"), not yet build-breaking. `undefined` when nothing
 *  is stale yet (nothing to add beyond the base "deferred rows not yet measured" note). */
function agingProvisionalNote(aging: DeferralAgingReport): string | undefined {
  if (aging.staleOrOverdueCount === 0) return undefined;
  return (
    `${aging.staleOrOverdueCount}/${aging.applicableGateCount} deferred gate(s) undischarged ` +
    `past ${DEFERRAL_WARN_DAYS}d`
  );
}

/** The header note when aging FORCES a fail (requirement 2's overdue rows, or requirement 3's
 *  material fraction, or both — named explicitly rather than merged into one vague sentence). */
function agingStalledNote(aging: DeferralAgingReport): string {
  const parts: string[] = [];
  if (aging.materialityBreached) {
    parts.push(
      `${aging.staleOrOverdueCount}/${aging.applicableGateCount} applicable gates ` +
        `(${Math.round(aging.staleOrOverdueFraction * 100)}%) undischarged past ${DEFERRAL_WARN_DAYS}d — ` +
        `at or past the ${Math.round(DEFERRAL_MATERIAL_FRACTION * 100)}% materiality bar (platform-corrections.md C70)`
    );
  }
  if (aging.anyOverdue) {
    const worstAge = Math.max(...aging.rows.map((r) => r.ageDays));
    parts.push(`at least one row undischarged ${worstAge}d, past the ${DEFERRAL_FATAL_DAYS}d fatal threshold`);
  }
  return parts.join("; ");
}

/** Header text for an aging-aware render: a real `"fail"` row (report.ok===false) always keeps
 *  the plain "FAILED" text — aging never needs to argue for a claim the underlying gates
 *  already made for real. Otherwise, `forcesFail` overrides what would have been an
 *  OK/provisional-OK header with "STALLED", and a non-material stale row folds its note into
 *  the ordinary provisional-OK note instead. */
function verdictLabelWithAging(ok: boolean, hasDeferred: boolean, hasUnattained: boolean, aging: DeferralAgingReport): string {
  if (!ok) return "FAILED";
  if (aging.forcesFail) return `STALLED — ${agingStalledNote(aging)}`;
  return verdictLabel(ok, hasDeferred, hasUnattained, agingProvisionalNote(aging));
}

export function formatCiSuiteTable(report: CiSuiteReport): string {
  const hasDeferred = report.gates.some((g) => g.status === "deferred");
  const hasUnattained = report.gates.some((g) => g.status === "unattained");
  const lines = [`CI suite (${report.suite}) for "${report.gameId}" — ${verdictLabel(report.ok, hasDeferred, hasUnattained)}`];
  for (const gate of report.gates) {
    const label = STATUS_LABEL[gate.status] ?? gate.status;
    // Keyed on PRESENCE (`!== undefined`), not truthiness — an empty-string justification must
    // never look identical to "no exception at all" (evaluateCiGates now refuses an empty
    // justification outright, but this formatter stays correct in its own right regardless of
    // what validation the caller did or didn't run).
    const exception = gate.exceptionJustification !== undefined ? ` (exception: ${gate.exceptionJustification})` : "";
    lines.push(`  [${label}] ${gate.gate}: ${gate.detail}${exception}`);
  }
  return lines.join("\n");
}

/**
 * The solo-lane analogue of `formatCiSuiteTable` — same `STATUS_LABEL` mapping (so "N/A " and
 * "DEFER" are as visually distinct from "PASS"/"FAIL"/"WARN" here as they are on the two-player
 * table; C2's whole point is that a skipped gate and a passed gate must never look the same in
 * a report, in EITHER lane's rendering — C27 extends that to "deferred" vs "n/a" vs "pass").
 */
export function formatSoloGateTable(
  gameId: string,
  format: "score-chase" | "daily-puzzle",
  ok: boolean,
  gates: readonly SoloGateResult[]
): string {
  const hasDeferred = gates.some((g) => g.status === "deferred");
  const lines = [`solo-ci (${format}) for "${gameId}" — ${verdictLabel(ok, hasDeferred)}`];
  for (const gate of gates) {
    const label = STATUS_LABEL[gate.status] ?? gate.status;
    lines.push(`  [${label}] ${gate.name}: ${gate.detail}`);
  }
  return lines.join("\n");
}

/** One call site for a CI script driving `runGameCiGate` (ci-gates.ts) across every registered
 *  game: dispatches to the right table formatter by the report's own `kind`, so a caller never
 *  has to re-derive which lane produced a given report. */
export function formatGameCiGateReport(result: GameCiGateReport): string {
  if (result.kind === "two-player") return formatCiSuiteTable(result.report);
  return formatSoloGateTable(result.gameId, result.report.format, result.ok, result.report.gates);
}

/** `formatCiSuiteTable`, extended with deferral-discharge aging (platform-corrections.md C70).
 *  `aging === undefined` (the case for every game with no active deferral, and the ONLY case
 *  for every game before this mechanism existed) delegates straight to `formatCiSuiteTable` —
 *  byte-identical output, not merely equivalent-looking output. */
export function formatCiSuiteTableWithAging(report: CiSuiteReport, aging: DeferralAgingReport | undefined): string {
  if (!aging) return formatCiSuiteTable(report);
  const hasDeferred = report.gates.some((g) => g.status === "deferred");
  const hasUnattained = report.gates.some((g) => g.status === "unattained");
  const verdict = verdictLabelWithAging(report.ok, hasDeferred, hasUnattained, aging);
  const lines = [`CI suite (${report.suite}) for "${report.gameId}" — ${verdict}`];
  for (const gate of report.gates) {
    const label = STATUS_LABEL[gate.status] ?? gate.status;
    const exception = gate.exceptionJustification !== undefined ? ` (exception: ${gate.exceptionJustification})` : "";
    lines.push(`  [${label}] ${gate.gate}: ${gate.detail}${exception}${agingRowSuffix(gate.gate, aging)}`);
  }
  return lines.join("\n");
}

/** `formatSoloGateTable`, extended with deferral-discharge aging — see
 *  `formatCiSuiteTableWithAging`'s own doc for the byte-identity guarantee on `aging ===
 *  undefined`. */
export function formatSoloGateTableWithAging(
  gameId: string,
  format: "score-chase" | "daily-puzzle",
  ok: boolean,
  gates: readonly SoloGateResult[],
  aging: DeferralAgingReport | undefined
): string {
  if (!aging) return formatSoloGateTable(gameId, format, ok, gates);
  const hasDeferred = gates.some((g) => g.status === "deferred");
  const verdict = verdictLabelWithAging(ok, hasDeferred, false, aging);
  const lines = [`solo-ci (${format}) for "${gameId}" — ${verdict}`];
  for (const gate of gates) {
    const label = STATUS_LABEL[gate.status] ?? gate.status;
    lines.push(`  [${label}] ${gate.name}: ${gate.detail}${agingRowSuffix(gate.name, aging)}`);
  }
  return lines.join("\n");
}

/** `formatGameCiGateReport`, extended with deferral-discharge aging — see
 *  `formatCiSuiteTableWithAging`'s own doc for the byte-identity guarantee on `aging ===
 *  undefined`, which is every game with no active deferral. */
export function formatGameCiGateReportWithAging(result: GameCiGateReport, aging: DeferralAgingReport | undefined): string {
  if (result.kind === "two-player") return formatCiSuiteTableWithAging(result.report, aging);
  return formatSoloGateTableWithAging(result.gameId, result.report.format, result.ok, result.report.gates, aging);
}

/** JSON form of a `GameCiGateReport` — plain `JSON.stringify`, same posture as `toReportJson`:
 *  every field here is already a plain, deterministically-ordered object built by ci-gates.ts,
 *  so no extra canonicalization is needed. Kept as its own named export (rather than callers
 *  reaching for `toReportJson` directly) so the M4 CI script's JSON artifact shape has one
 *  documented entry point. */
export function toGameCiGateReportJson(result: GameCiGateReport): string {
  return JSON.stringify(result, null, 2);
}

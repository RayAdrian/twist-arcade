// packages/harness/src/report.ts — JSON + human-readable table formatting shared by cli.ts's
// `solve`/`run`/`suite` commands. No logic of its own beyond formatting: every number printed
// here was already computed by solve.ts/runner.ts/suites.ts.

import type { SolveResult } from "./solver/solve";
import type { MatchupReport } from "./runner";
import type { CiSuiteReport } from "./suites";
import type { GameCiGateReport } from "./ci-gates";
import type { GateResult as SoloGateResult } from "./solo-gates";

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
function verdictLabel(ok: boolean, hasDeferred: boolean, hasUnattained = false): string {
  if (!ok) return "FAILED";
  const notes: string[] = [];
  if (hasDeferred) notes.push("deferred rows not yet measured at this tier");
  if (hasUnattained) notes.push("a solvedValue row was measured and never attained, with no baseline to regress from — see solved-value-reached");
  return notes.length === 0 ? "OK" : `OK (provisional — ${notes.join("; ")})`;
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

/** JSON form of a `GameCiGateReport` — plain `JSON.stringify`, same posture as `toReportJson`:
 *  every field here is already a plain, deterministically-ordered object built by ci-gates.ts,
 *  so no extra canonicalization is needed. Kept as its own named export (rather than callers
 *  reaching for `toReportJson` directly) so the M4 CI script's JSON artifact shape has one
 *  documented entry point. */
export function toGameCiGateReportJson(result: GameCiGateReport): string {
  return JSON.stringify(result, null, 2);
}

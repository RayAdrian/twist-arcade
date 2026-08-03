// packages/harness/src/report.ts — JSON + human-readable table formatting shared by cli.ts's
// `solve`/`run`/`suite` commands. No logic of its own beyond formatting: every number printed
// here was already computed by solve.ts/runner.ts/suites.ts.

import type { SolveResult } from "./solver/solve";
import type { MatchupReport } from "./runner";
import type { CiSuiteReport } from "./suites";

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

const STATUS_LABEL: Record<string, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", "n/a": "N/A " };

export function formatCiSuiteTable(report: CiSuiteReport): string {
  const lines = [`CI suite (${report.suite}) for "${report.gameId}" — ${report.ok ? "OK" : "FAILED"}`];
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

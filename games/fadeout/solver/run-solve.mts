// games/fadeout/solver/run-solve.mts — the actual F2 solve script (plan §2.3: "the solve is a
// script, but its components are testable" — this is that script; raw-engine.ts/
// pass2-superko.ts/solve.ts/strategy.ts are the testable components it composes).
//
// Usage:
//   npx tsx games/fadeout/solver/run-solve.mts [--wall-clock-ms=N] [--max-nodes=N] [--json]
//
// Solves all 8 RulesetConfigs and prints, per config: root value, reachable-state count,
// per-opening table, extracted strategy + quotability judgment, and (for superko configs) the
// budget/exactness status. `docs/research/games/fadeout-solve-report.md` is the human-authored
// write-up (recommendations, cross-checks, discoveries); this script is what generates the raw
// numbers that report cites — re-run it to regenerate/verify them rather than trusting the
// prose alone.
//
// --max-nodes (F2 amendments item 2 — READ BEFORE RE-RUNNING TO CHECK THE REPORT'S NUMBERS):
// without this flag, `solveSuperko`'s budget defaults `maxNodesVisited` to 5,000,000 (see
// pass2-superko.ts's `SuperkoBudget`) even when only `--wall-clock-ms` is passed here — so a
// wall-clock-only invocation of this script silently hits that 5M-node ceiling in well under a
// minute (~130-240k nodes/sec measured, per the solve report) and reports "budget exceeded" far
// short of the wall-clock deadline, NOT because the search ran out of time. The two hard
// (`playThrough: false`) configs' cited 62.2M / 116.2M node counts came from throwaway scripts
// that passed an explicit large node ceiling (never committed) — this script, as originally
// written, could not reproduce them: reading the report's own "re-run to verify" instruction and
// following it literally would have hit the silent 5M cap and produced a materially weaker search
// than what's cited. Pass `--max-nodes=Infinity` (or any explicit large value) to make
// `--wall-clock-ms` the only real ceiling, matching how those numbers were actually produced.
//
// The exact invocation used to (re)confirm the report's §1.5 figures for the two hard configs:
//   npx tsx games/fadeout/solver/run-solve.mts --wall-clock-ms=480000 --max-nodes=Infinity
// (480000ms = 8 minutes, matching §1.5's stated budget). Omitting --max-nodes here would silently
// re-run at the 5M-node ceiling instead and NOT reproduce the cited 62.2M/116.2M figures.

import { allRulesetConfigs } from "../engine";
import { solveConfig } from "./solve";
import { solveRaw } from "./raw-engine";
import { extractStrategy } from "./strategy";

function parseArgs(argv: readonly string[]): { wallClockMs: number; maxNodesVisited: number; json: boolean } {
  let wallClockMs = 8 * 60 * 1000; // plan §2.3's "10 minutes per variant" budget, minus margin
  // No default node ceiling of our own here: `solveSuperko`'s own default (5,000,000, see
  // pass2-superko.ts) exists as a safety valve for CALLERS who pass no budget at all, not as a
  // second, silently-lower ceiling this script should inherit — see the module doc above for why
  // that silent inheritance previously made this script unable to reproduce its own report's
  // numbers. `--wall-clock-ms` is meant to be the one real budget for a full solve run.
  let maxNodesVisited = Number.POSITIVE_INFINITY;
  let json = false;
  for (const arg of argv) {
    const wallClockMatch = /^--wall-clock-ms=(\d+)$/.exec(arg);
    if (wallClockMatch) wallClockMs = Number(wallClockMatch[1]);
    const maxNodesMatch = /^--max-nodes=(\d+|Infinity)$/.exec(arg);
    if (maxNodesMatch) maxNodesVisited = maxNodesMatch[1] === "Infinity" ? Number.POSITIVE_INFINITY : Number(maxNodesMatch[1]);
    if (arg === "--json") json = true;
  }
  return { wallClockMs, maxNodesVisited, json };
}

function main(): void {
  const { wallClockMs, maxNodesVisited, json } = parseArgs(process.argv.slice(2));
  const results = allRulesetConfigs().map((config) => {
    const raw = solveRaw({ decayTiming: config.decayTiming, playThrough: config.playThrough });
    const label = `${config.decayTiming}/${config.playThrough ? "playThrough" : "solid"}/${config.repetition}`;
    const solved = solveConfig(config, {
      wallClockMs,
      maxNodesVisited,
      ...(json
        ? {}
        : {
            onProgress: ({ nodesVisited, elapsedMs }: { nodesVisited: number; elapsedMs: number }) => {
              process.stderr.write(`  [${label}] ${nodesVisited} nodes, ${(elapsedMs / 1000).toFixed(1)}s\n`);
            },
          }),
    });
    const strategy = extractStrategy(raw);
    return { config, solved, strategy };
  });

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }

  for (const { config, solved, strategy } of results) {
    const label = `${config.decayTiming}/${config.playThrough ? "playThrough" : "solid"}/${config.repetition}`;
    process.stdout.write(`\n==== ${label} ====\n`);
    process.stdout.write(`root value: ${solved.rootValue}${solved.exact ? "" : "  (UNPROVEN — budget fallback to C2, see nodesVisited)"}\n`);
    process.stdout.write(`reachable states (raw, upper bound for superko): ${solved.reachableStatesRaw}\n`);
    process.stdout.write(`openings: ${solved.openings.map((o) => `${o.cell}:${o.value}`).join(", ")}\n`);
    if (strategy.hasForcedWin) {
      process.stdout.write(`strategy: ${strategy.description} (${strategy.cells.length} plies, quotable=${strategy.quotable})\n`);
    } else {
      process.stdout.write(`strategy: (none — ${strategy.quotabilityNote})\n`);
    }
    if (solved.nodesVisited !== undefined) {
      process.stdout.write(`superko search: ${solved.nodesVisited} nodes visited\n`);
    }
  }
}

main();

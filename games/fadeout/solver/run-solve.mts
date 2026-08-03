// games/fadeout/solver/run-solve.mts — the actual F2 solve script (plan §2.3: "the solve is a
// script, but its components are testable" — this is that script; raw-engine.ts/
// pass2-superko.ts/solve.ts/strategy.ts are the testable components it composes).
//
// Usage:
//   npx tsx games/fadeout/solver/run-solve.mts [--wall-clock-ms=N] [--json]
//
// Solves all 8 RulesetConfigs and prints, per config: root value, reachable-state count,
// per-opening table, extracted strategy + quotability judgment, and (for superko configs) the
// budget/exactness status. `docs/research/games/fadeout-solve-report.md` is the human-authored
// write-up (recommendations, cross-checks, discoveries); this script is what generates the raw
// numbers that report cites — re-run it to regenerate/verify them rather than trusting the
// prose alone.

import { allRulesetConfigs } from "../engine";
import { solveConfig } from "./solve";
import { solveRaw } from "./raw-engine";
import { extractStrategy } from "./strategy";

function parseArgs(argv: readonly string[]): { wallClockMs: number; json: boolean } {
  let wallClockMs = 8 * 60 * 1000; // plan §2.3's "10 minutes per variant" budget, minus margin
  let json = false;
  for (const arg of argv) {
    const match = /^--wall-clock-ms=(\d+)$/.exec(arg);
    if (match) wallClockMs = Number(match[1]);
    if (arg === "--json") json = true;
  }
  return { wallClockMs, json };
}

function main(): void {
  const { wallClockMs, json } = parseArgs(process.argv.slice(2));
  const results = allRulesetConfigs().map((config) => {
    const raw = solveRaw({ decayTiming: config.decayTiming, playThrough: config.playThrough });
    const label = `${config.decayTiming}/${config.playThrough ? "playThrough" : "solid"}/${config.repetition}`;
    const solved = solveConfig(config, {
      wallClockMs,
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

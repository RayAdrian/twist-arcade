// Investigates the Infinity finding: decomposes runSoloChaseCiGate into its constituent calls
// (random/greedy/strong/always-safe) with per-call timing and RAW scores, for both the
// healthy and degenerate real-10x10-board configs at moveCap=10, seedCount=2, rollouts=750 --
// exactly the parameters that produced healthy=Infinity, degenerate=1.000 in the prior run.
import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { buildSoloRoster, runSoloAgentOverSeeds, pairedSeeds, runAlwaysSafeProbe, alwaysSafeVsStrongRatio } from "@twist-arcade/harness";

function run(label: string, mines: number) {
  console.log(`\n=== ${label} (mines=${mines}) ===`);
  const engine = createMineRun({ width: 10, height: 10, mines, budget: 60 });
  const seeds = pairedSeeds(`diag:${label}`, 2);
  const roster = buildSoloRoster(engine);
  const runOpts = { moveCap: 10, budget: { kind: "rollouts" as const, n: 750 } };

  let strongSummary;
  for (const [name, agent] of [["random", roster.random], ["greedy", roster.greedy], ["strong", roster.strong]] as const) {
    const t0 = Date.now();
    const summary = runSoloAgentOverSeeds(engine, agent, seeds, runOpts);
    console.log(`${name}: ${Date.now() - t0}ms scores=${JSON.stringify(summary.scores)} decisions=${JSON.stringify(summary.decisionsList)} capHitRate=${summary.capHitRate}`);
    if (name === "strong") strongSummary = summary;
  }
  const t0 = Date.now();
  const alwaysSafe = runAlwaysSafeProbe(engine, safeMove, seeds, runOpts);
  console.log(`always-safe: ${Date.now() - t0}ms scores=${JSON.stringify(alwaysSafe.scores)}`);
  console.log(`ratio=${alwaysSafeVsStrongRatio(alwaysSafe, strongSummary!)}`);
}

run("healthy", 20);
run("degenerate", 2);

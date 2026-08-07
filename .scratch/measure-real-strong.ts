// Measures real, untrimmed (moveCap=400, the actual manifest value) single-seed cost of the
// shipped roster.strong on the REAL 10x10/20-mine/60-budget board at ciGateBudget=750,
// logging incrementally per seed (unlike the earlier opaque single-call run) so a stuck/slow
// process is visible, not silent. Coordinator's explicit ask: "measure, don't guess."
import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { buildSoloRoster, playSoloRun, runAlwaysSafeProbe } from "@twist-arcade/harness";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const roster = buildSoloRoster(engine);
const runOpts = { moveCap: 400, budget: { kind: "rollouts" as const, n: 750 } };

const seeds = ["ci:mine-run:ci-0", "ci:mine-run:ci-1"];

console.log(`start: ${new Date().toISOString()}`);
for (const seed of seeds) {
  const t0 = Date.now();
  const result = playSoloRun(engine, roster.strong, seed, runOpts);
  const elapsed = Date.now() - t0;
  console.log(
    `seed=${seed} strong: elapsed=${elapsed}ms (${(elapsed / 1000).toFixed(1)}s) ` +
      `decisions=${result.decisions} finalScore=${result.finalScore} capHit=${result.capHit} ` +
      `avgPerDecision=${(elapsed / Math.max(1, result.decisions)).toFixed(0)}ms`
  );
}

// Cheap for comparison — always-safe never rolls out.
const t0 = Date.now();
const alwaysSafe = runAlwaysSafeProbe(engine, safeMove, seeds, runOpts);
console.log(`always-safe (both seeds): ${Date.now() - t0}ms scores=${JSON.stringify(alwaysSafe.scores)}`);

console.log(`end: ${new Date().toISOString()}`);
console.log("MEASURE_COMPLETE");

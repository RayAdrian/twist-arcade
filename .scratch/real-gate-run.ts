// The REAL, untrimmed Mine Run solo-chase CI gate -- exactly what scripts/ci-gates.ts
// --game mine-run would compute (same dispatcher, same manifest, same safeMove export, same
// CI_SEED_COUNT=100, same suite="ci"), run directly here only because mine-run is not yet
// registered in games/registry.ts (per the brief: gate before UI/registration). No moveCap
// override -- falls back to the real manifest's solo.moveCap (400). Uses the manifest's own
// evidence-based ciGateBudget.soloChaseCiRollouts (750).
import { mineRun } from "@twist-arcade/mine-run";
import { safeMove } from "@twist-arcade/mine-run";
import { mineRunManifest } from "../games/mine-run/manifest";
import { runGameCiGate, formatGameCiGateReport } from "@twist-arcade/harness";

const CI_SEED_COUNT = 100; // matches scripts/ci-gates.ts's own constant, unchanged

async function main() {
  console.log(`starting real gate run: seedCount=${CI_SEED_COUNT}, suite=ci, manifest.ciGateBudget=${JSON.stringify(mineRunManifest.ciGateBudget)}, manifest.solo.moveCap=${mineRunManifest.solo?.moveCap}`);
  console.log(`start time: ${new Date().toISOString()}`);
  const t0 = Date.now();

  const report = await runGameCiGate(mineRun, mineRunManifest, {
    kind: "solo-chase",
    seed: "ci:mine-run:ci",
    seedCount: CI_SEED_COUNT,
    safeMove,
    suite: "ci",
  });

  console.log(`\nend time: ${new Date().toISOString()}`);
  console.log(`elapsed: ${Date.now() - t0}ms`);
  console.log("\n" + formatGameCiGateReport(report));
  console.log(`\nGATE_RUN_COMPLETE ok=${report.ok}`);
}

main().catch((err) => {
  console.error("GATE_RUN_CRASHED", err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});

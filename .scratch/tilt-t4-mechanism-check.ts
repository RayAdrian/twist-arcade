// .scratch/tilt-t4-mechanism-check.ts — throwaway, C41-style plant verification against
// Tilt's REAL manifest+engine (not the shared harness's own generic fixtures): (1) a scaled
// ciGateBudget that collapses onto standard's budget must throw TierBudgetCollapseError before
// any self-play runs; (2) suite "nightly" must ignore the CI override and report a REAL
// ruthless-vs-standard number, not n/a.

import { runCiSuite } from "@twist-arcade/harness";
import { tilt } from "../games/tilt/engine";
import { manifest } from "../games/tilt/manifest";

function main(): void {
  // Plant 1: collapse the CI override onto standard's own 1000-rollout budget.
  const collapsed = { ...manifest, ciGateBudget: { twoPlayerCiRollouts: 1000 } };
  try {
    runCiSuite(tilt, collapsed, { games: 10, seed: "plant-collapse" });
    console.log("[FAIL TO FIRE] TierBudgetCollapseError did NOT throw for a 1000-rollout override");
  } catch (err) {
    console.log(`[FIRED CORRECTLY] ${(err as Error).name}: ${(err as Error).message.slice(0, 140)}...`);
  }

  // Plant 2 (not a violation — a real mechanism check): suite "nightly" must ignore the CI
  // override and produce a REAL ruthless-vs-standard number against Tilt's actual manifest.
  const nightlyReport = runCiSuite(tilt, manifest, { games: 10, seed: "tilt-t4-nightly-mechanism-check", suite: "nightly" });
  const row = nightlyReport.gates.find((g) => g.gate === "ruthless-vs-standard");
  console.log(`nightly ruthless-vs-standard row: status=${row?.status} detail=${row?.detail}`);
  console.log(
    row?.status === "n/a" || row?.status === "deferred"
      ? "[WRONG] nightly should report a REAL pass/fail/warn, not n/a/deferred"
      : "[CORRECT] nightly ignored the CI override and measured for real"
  );
}

main();

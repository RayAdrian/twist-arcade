// scripts/research/order-vs-chaos-ov2-gate-table.ts — OV2 stage 3 (docs/plans/order-vs-
// chaos.md §7): "the gate table at 100 games, config A (6x6, win-5, Order first)." Runs the
// REAL suite "ci" table via runGameCiGate — the same dispatcher a registered game's own CI
// would use — against the manifest AS COMMITTED (so this only produces a meaningful table once
// manifest.ts's ciGateBudget.twoPlayerCiRollouts has been set from the budget-validation
// sweep's evidence; before that it refuses with MissingCiRolloutBudgetError, which is correct,
// not a bug — see manifest.ts's own module doc).
//
// games=100 (DEFAULT_CI_GATE_GAMES, ci-gates.ts) — the plan's own "100-game run" (§7's OV2 row).
// A distinct seed from the budget sweep's — this is a fresh, independent measurement of the
// frozen config, not a replay of the sweep's own numbers.
//
// Run: pnpm tsx scripts/research/order-vs-chaos-ov2-gate-table.ts

import { formatGameCiGateReport, runGameCiGate } from "@twist-arcade/harness";
import { orderVsChaos } from "../../games/order-vs-chaos/engine";
import { manifest } from "../../games/order-vs-chaos/manifest";

const SEED = "ov2-gate-config-a";
const GAMES = 100;

async function main(): Promise<void> {
  const result = await runGameCiGate(orderVsChaos, manifest, {
    kind: "two-player",
    seed: SEED,
    games: GAMES,
    suite: "ci",
  });
  console.log(`config A (6x6, win-5, Order first) — suite "ci", games=${GAMES}, seed="${SEED}"\n`);
  console.log(formatGameCiGateReport(result));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

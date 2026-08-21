// scripts/research/order-vs-chaos-ov2-gate-table-config-b.ts — OV2 §3 ladder execution
// (docs/plans/order-vs-chaos.md §3, §7): config A measured first-player-win-rate 78.0% (100-
// game gate table) / 84.0% (independent n=100 sweep), both above the [35,65] band on the high
// side — the pre-registered kill rule's indicated fallback is config B (Chaos moves first).
//
// Config B is the SAME board/window geometry as config A (6x6, win-5) — only `firstMover`
// changes (ORDER_SEAT -> CHAOS_SEAT). Order is still ALWAYS seat 0 / Chaos ALWAYS seat 1
// (engine.ts's own module doc — firstMover controls tempo, never which seat plays which role).
//
// BUDGET REUSE, FLAGGED (per orchestrator direction): this run reuses the 3,000-rollout budget
// validated for config A (order-vs-chaos-ov2-budget-sweep.ts) rather than re-deriving from
// scratch. This is NOT a C25 violation — C25's rule is that a budget is evidence about the
// BOARD it was measured on, and config B is the literal same board (same 6x6/win-5 window set,
// same 72-wide root branching factor); only which seat opens changes. The cost profile per
// rollout is a function of the search tree's branching/depth, which this swap does not alter.
//
// NOT A PAIRED COMPARISON WITH CONFIG A (C32): changing which seat opens changes the tree the
// search explores from move 1 — config A's and config B's numbers are independent samples of
// different games, not a before/after pair. This script judges B against the band ON ITS OWN;
// it does not diff B against A's numbers.
//
// Run: pnpm tsx scripts/research/order-vs-chaos-ov2-gate-table-config-b.ts

import { formatGameCiGateReport, runGameCiGate } from "@twist-arcade/harness";
import { CHAOS_SEAT, createOrderVsChaosEngine } from "../../games/order-vs-chaos/engine";
import { manifest } from "../../games/order-vs-chaos/manifest";

const SEED = "ov2-gate-config-b";
const GAMES = 100;

async function main(): Promise<void> {
  const configB = createOrderVsChaosEngine({ firstMover: CHAOS_SEAT });
  const result = await runGameCiGate(configB, manifest, {
    kind: "two-player",
    seed: SEED,
    games: GAMES,
    suite: "ci",
  });
  console.log(
    `config B (6x6, win-5, CHAOS first) — suite "ci", games=${GAMES}, seed="${SEED}", ` +
      "budget REUSED from config A's validated sweep (3000 rollouts, same board/window geometry)\n"
  );
  console.log(formatGameCiGateReport(result));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

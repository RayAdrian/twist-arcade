// scripts/research/order-vs-chaos-ov2-cost-pilot.ts — OV2 stage 1 (docs/plans/order-vs-chaos.md
// §4, §7): the 15-game cost pilot. COST ONLY — platform-corrections.md C26: a 15-game pilot is
// never a verdict (Nine Grids' 15-game pilot read a severe second-player advantage on a game
// that measured 46.0% at 100 games; treating that as a result would have killed a balanced
// game). This script prints wall-clock timing per candidate budget and nothing else is read
// from it as a balance signal.
//
// Self-play only (ruthless-tier agent vs itself at each candidate budget) — the cheapest matchup
// shape that still exercises the real search cost, matching what the budget-validation sweep and
// the eventual CI gate both actually pay for per game.
//
// Run: pnpm tsx scripts/research/order-vs-chaos-ov2-cost-pilot.ts

import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "@twist-arcade/harness";
import { runMatchup } from "@twist-arcade/harness";
import { orderVsChaos, type OrderVsChaosMove, type OrderVsChaosState } from "../../games/order-vs-chaos/engine";
import { manifest } from "../../games/order-vs-chaos/manifest";

const GAMES = 15;
const SEED = "ov2-cost-pilot";
// A spread from well under the shipped ruthless budget to it, plus one point above the CI
// ceiling's neighborhood — timing only, chosen to bracket where the validation sweep (stage 2)
// will need to search.
const CANDIDATES = [100, 500, 1000, 2000, 3000, 5000, 8000, 10000];

function agentFor(rollouts: number): AgentSpec<OrderVsChaosState, OrderVsChaosMove> {
  const shippedRuthless = manifest.difficultyTiers.find((t) => t.id === "ruthless");
  if (!shippedRuthless) throw new Error("order-vs-chaos manifest has no ruthless tier");
  const tier = { ...shippedRuthless, budget: { kind: "rollouts" as const, n: rollouts } };
  return { kind: "policy", name: `ruthless@${rollouts}`, policy: tierPolicy(tier), budget: tier.budget };
}

function main(): void {
  console.log(`OV2 cost pilot — ${GAMES} games/candidate, self-play (ruthless-tier vs itself), seed="${SEED}"`);
  console.log("cost only — NOT a balance verdict (C26)\n");

  const rows: { rollouts: number; ms: number; msPerGame: number }[] = [];
  for (const rollouts of CANDIDATES) {
    const agent = agentFor(rollouts);
    const start = Date.now();
    const report = runMatchup(orderVsChaos, agent, agent, { games: GAMES, seed: `${SEED}:${rollouts}` });
    const ms = Date.now() - start;
    rows.push({ rollouts, ms, msPerGame: ms / GAMES });
    console.log(
      `rollouts=${String(rollouts).padStart(6)}  total=${(ms / 1000).toFixed(2)}s  ` +
        `per-game=${(ms / GAMES).toFixed(0)}ms  mean-plies=${report.metrics.meanPlies.toFixed(1)}  ` +
        `throughput=${report.throughputGamesPerSec.toFixed(2)} games/s`
    );
  }

  console.log("\nProjected cost at 100 games x 3 matchups (strong-vs-random, self-play, ruthless-vs-standard):");
  for (const row of rows) {
    const projectedMs = row.msPerGame * 100 * 3;
    console.log(`  rollouts=${String(row.rollouts).padStart(6)}  ~${(projectedMs / 1000 / 60).toFixed(2)} min`);
  }
}

main();

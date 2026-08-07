// scripts/research/order-vs-chaos-ov2-pairing-probe.ts — OV2 stage 4 (docs/plans/order-vs-
// chaos.md §5 item 10, §6 R2/R5, §7): the game-local pairing-bot probe, wired into a real
// matchup. Gate: pairing bot as CHAOS must score <40% vs Strong Order.
//
// The pairing bot (probes.ts's pairingMove) only ever makes sense as Chaos (it answers Order's
// moves; nothing in it models Order's win condition), so this deliberately does NOT use
// runMatchup's default seat-mirroring (mirrorSeats: false) — Order (the shipped "ruthless" tier,
// full budget, "Strong Order") always sits seat 0, the pairing bot always sits seat 1. Order is
// ALWAYS seat 0 in this engine regardless of matchup wiring (engine.ts's own module doc), so this
// is not a departure from the engine's own rules, only from runMatchup's default variance-
// reduction convenience, which would otherwise also play the pairing bot AS Order half the time
// — a shape the probe was never designed to answer (plan §5 item 10 frames it strictly as "the
// game-local 'cheapest disconfirming experiment' for Chaos").
//
// "Strong Order" is the shipped ruthless tier at its FULL budget (10,000 rollouts), not the
// CI-scaled budget — the plan's own wording ("Strong Order") names the real difficulty a player
// would face, and the budget-validation sweep (order-vs-chaos-ov2-budget-sweep.ts) already
// established that the CI-scaled candidate reproduces the 10,000-rollout verdict, so either
// would answer the same question; using the unscaled tier keeps this probe's own claim ("Strong
// Order") literal.
//
// Run: pnpm tsx scripts/research/order-vs-chaos-ov2-pairing-probe.ts

import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "@twist-arcade/harness";
import { agentWinRate, mirrorAgent, runMatchup } from "@twist-arcade/harness";
import { orderVsChaos, type OrderVsChaosMove, type OrderVsChaosState } from "../../games/order-vs-chaos/engine";
import { manifest } from "../../games/order-vs-chaos/manifest";
import { pairingMove } from "../../games/order-vs-chaos/probes";

const GAMES = 100;
const SEED = "ov2-pairing-probe";
const GATE_MAX_CHAOS_WIN_RATE = 0.4;

function main(): void {
  const shippedRuthless = manifest.difficultyTiers.find((t) => t.id === "ruthless");
  if (!shippedRuthless) throw new Error("order-vs-chaos manifest has no ruthless tier");
  const strongOrder: AgentSpec<OrderVsChaosState, OrderVsChaosMove> = {
    kind: "policy",
    name: "strong-order",
    policy: tierPolicy(shippedRuthless),
    budget: shippedRuthless.budget,
  };
  const pairingChaos = mirrorAgent<OrderVsChaosState, OrderVsChaosMove>(pairingMove);

  console.log(
    `OV2 pairing-bot probe — ${GAMES} games, seed="${SEED}", Strong Order (seat 0, ruthless@` +
      `${shippedRuthless.budget.kind === "rollouts" ? shippedRuthless.budget.n : "?"}) vs naive ` +
      "domino-pairing Chaos (seat 1), mirrorSeats=false (pairing bot only ever plays Chaos)"
  );
  console.log(`gate: pairing bot as Chaos < ${(GATE_MAX_CHAOS_WIN_RATE * 100).toFixed(0)}%\n`);

  const start = Date.now();
  const report = runMatchup(orderVsChaos, strongOrder, pairingChaos, {
    games: GAMES,
    seed: SEED,
    mirrorSeats: false,
  });
  const ms = Date.now() - start;

  const chaosWinRate = agentWinRate(report.outcomes, "mirror");
  const orderWinRate = agentWinRate(report.outcomes, "strong-order");

  console.log(`elapsed: ${(ms / 1000).toFixed(1)}s`);
  console.log(`Strong Order (seat 0) win rate: ${(orderWinRate * 100).toFixed(1)}%`);
  console.log(`pairing-bot Chaos (seat 1) win rate: ${(chaosWinRate * 100).toFixed(1)}%`);
  console.log(`draw rate: ${(report.metrics.drawRate * 100).toFixed(1)}% (expected 0% — no draw terminal exists)`);
  console.log(`mean-plies: ${report.metrics.meanPlies.toFixed(2)}, capHitRate: ${(report.metrics.capHitRate * 100).toFixed(2)}%`);

  const pass = chaosWinRate < GATE_MAX_CHAOS_WIN_RATE;
  console.log(
    `\n${pass ? "PASS" : "FAIL"}: pairing-bot Chaos win rate ${(chaosWinRate * 100).toFixed(1)}% ` +
      `${pass ? "<" : ">="} ${(GATE_MAX_CHAOS_WIN_RATE * 100).toFixed(0)}%`
  );
  if (!pass) {
    console.log(
      "A naive pairing bot holding Strong means Chaos has a googleable one-sentence defense " +
        "(plan §5 item 10) — this kills the game independently of the FPA gate."
    );
  }
}

main();

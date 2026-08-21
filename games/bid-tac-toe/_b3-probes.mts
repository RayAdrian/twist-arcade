// Throwaway B3 script: bidding-specific degeneracy probes vs Strong (plan §6.1). "If zero-bot
// or sniper reaches >=45% vs Strong, position-pricing skill is fake and the premise fails
// regardless of FPA." Also runs stock rush for comparison (mirror is reported n/a separately,
// per C48's ruling — bids/star have no reflective analogue).

import { runMatchup, resolveNamedAgent } from "@twist-arcade/harness";
import { tierPolicy } from "@twist-arcade/bots";
import { bidTacToe, STARTING_BUDGET, type BidTacToeMove, type BidTacToeState } from "./engine";
import { allInBotPolicy, constantKPolicy, sniperPolicy, zeroBotPolicy } from "./probes-bidding";
import { manifest } from "./manifest";

const CI_ROLLOUTS = Number(process.argv[2] ?? 2000); // the validated budget from the sweep
const GAMES = Number(process.argv[3] ?? 100);
const SEED = process.argv[4] ?? "b3-probes-seed";

const ruthlessTierDef = manifest.difficultyTiers.find((t) => t.id === "ruthless")!;
const strong = {
  kind: "policy" as const,
  name: "strong",
  policy: tierPolicy<BidTacToeState, BidTacToeMove>({ ...ruthlessTierDef, budget: { kind: "rollouts", n: CI_ROLLOUTS } }),
  budget: { kind: "rollouts" as const, n: CI_ROLLOUTS },
};

const CONSTANT_K = Math.floor(STARTING_BUDGET / 2);

const probes = [
  { name: "zero-bot", policy: zeroBotPolicy() },
  { name: "all-in-bot", policy: allInBotPolicy() },
  { name: `constant-${CONSTANT_K}`, policy: constantKPolicy(CONSTANT_K) },
  { name: "sniper", policy: sniperPolicy() },
];

console.log(`Strong = ruthless tier @ ${CI_ROLLOUTS} rollouts, ${GAMES} games/probe, seed=${SEED}\n`);

for (const { name, policy } of probes) {
  const probeAgent = { kind: "policy" as const, name, policy, budget: { kind: "rollouts" as const, n: 1 } };
  const report = runMatchup(bidTacToe, probeAgent, strong, {
    games: GAMES,
    seed: `${SEED}:${name}`,
    mirrorSeats: true,
  });
  const wins = report.outcomes.filter((o) => o.winnerSeat !== null && o.seatAgent[o.winnerSeat] === name).length;
  const draws = report.outcomes.filter((o) => o.winnerSeat === null).length;
  const winRate = wins / report.outcomes.length;
  const flag = winRate >= 0.45 ? " *** >=45% — PRICING SKILL MAY BE FAKE ***" : "";
  console.log(
    `${name} vs Strong: winRate=${(winRate * 100).toFixed(1)}% (${wins}/${report.outcomes.length}, ${draws} draws), meanPlies=${report.metrics.meanPlies.toFixed(1)}, capHitRate=${(report.metrics.capHitRate * 100).toFixed(1)}%${flag}`
  );
}

// Stock rush for comparison (not bidding-specific, but named in plan §6.1 "plus stock mirror
// and rush").
{
  const rush = resolveNamedAgent<BidTacToeState, BidTacToeMove>("rush");
  const report = runMatchup(bidTacToe, rush, strong, { games: GAMES, seed: `${SEED}:rush`, mirrorSeats: true });
  const wins = report.outcomes.filter((o) => o.winnerSeat !== null && o.seatAgent[o.winnerSeat] === "rush").length;
  const winRate = wins / report.outcomes.length;
  console.log(`rush vs Strong: winRate=${(winRate * 100).toFixed(1)}% (${wins}/${report.outcomes.length})`);
}

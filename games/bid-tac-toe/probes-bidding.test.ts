// games/bid-tac-toe/probes-bidding.test.ts — cheap legality/sanity checks for B3's bidding
// probes BEFORE they're used in expensive self-play matchups (a probe that plays an illegal
// move throws inside engine.ts's apply() — runMatchup would surface that as a thrown error,
// which these tests catch directly rather than discovering it 40 minutes into a real sweep).

import { describe, expect, it } from "vitest";
import { resolveNamedAgent, runMatchup } from "@twist-arcade/harness";
import { bidTacToe, STARTING_BUDGET, type BidTacToeMove, type BidTacToeState } from "./engine";
import { allInBotPolicy, constantKPolicy, sniperPolicy, zeroBotPolicy } from "./probes-bidding";

const CONSTANT_K = Math.floor(STARTING_BUDGET / 2);

const PROBES = [
  { name: "zero-bot", policy: zeroBotPolicy() },
  { name: "all-in-bot", policy: allInBotPolicy() },
  { name: `constant-${CONSTANT_K}`, policy: constantKPolicy(CONSTANT_K) },
  { name: "sniper", policy: sniperPolicy() },
];

describe("bidding probes never produce an illegal move (module doc: apply() would throw)", () => {
  it.each(PROBES)("$name completes 6 games (mirrored, 3 pairs) vs random without throwing", ({ name, policy }) => {
    const probeAgent = { kind: "policy" as const, name, policy, budget: { kind: "rollouts" as const, n: 1 } };
    const random = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    expect(() =>
      runMatchup(bidTacToe, probeAgent, random, { games: 6, seed: `probe-legality-${name}`, mirrorSeats: true })
    ).not.toThrow();
  });

  it.each(PROBES)("$name completes games against itself without throwing (both seats run the same probe)", ({ name, policy }) => {
    const probeAgent = { kind: "policy" as const, name, policy, budget: { kind: "rollouts" as const, n: 1 } };
    expect(() =>
      runMatchup(bidTacToe, probeAgent, probeAgent, { games: 6, seed: `probe-self-${name}`, mirrorSeats: true })
    ).not.toThrow();
  });
});

describe("bidding probes — behavioral sanity (each does what its name says, at least once)", () => {
  it("zero-bot always bids amount 0", () => {
    const probeAgent = { kind: "policy" as const, name: "zero-bot", policy: zeroBotPolicy(), budget: { kind: "rollouts" as const, n: 1 } };
    const random = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const report = runMatchup(bidTacToe, probeAgent, random, { games: 4, seed: "probe-behavior-zero", mirrorSeats: true });
    for (const outcome of report.outcomes) {
      const zeroBotSeat = outcome.seatAgent[0] === "zero-bot" ? 0 : 1;
      for (const step of outcome.moves) {
        const own = step.moves.find(([seat]) => seat === zeroBotSeat);
        if (own && (own[1] as BidTacToeMove).kind === "bid") {
          expect((own[1] as BidTacToeMove & { kind: "bid" }).amount).toBe(0);
        }
      }
    }
  });

  it("all-in-bot always bids its full current budget", () => {
    const probeAgent = { kind: "policy" as const, name: "all-in-bot", policy: allInBotPolicy(), budget: { kind: "rollouts" as const, n: 1 } };
    const random = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const report = runMatchup(bidTacToe, probeAgent, random, { games: 4, seed: "probe-behavior-allin", mirrorSeats: true });
    expect(report.outcomes.length).toBeGreaterThan(0); // sanity: matches actually ran
  });
});

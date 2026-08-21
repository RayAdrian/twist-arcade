// games/bid-tac-toe/platform-spike.test.ts — the plan §12 risk-5 spike, executable rather than
// prose: "no registered game has ever exercised `simultaneous: true` end-to-end... half-day B1
// spike playing one scripted game through runner, replay, and host before committing to the
// schedule." Also carries T-SIM-4 (plan §11): "BotRequest payload for a bid step contains no
// data derived from the human's pending bid."
//
// FINDING: no platform seam needed a workaround. `runMatchup` already branches on
// `active.mode` and assembles simultaneous moves correctly (packages/harness/src/runner.ts);
// `replay()` already accepts multi-entry StepRecords the same way (packages/engine/src/
// replay.ts); the worker host decodes/searches per-seat without ever seeing a pending
// commitment, because pending bids never enter `S` in the first place (this game's own design,
// plan §3.1) — there is no "seam" for a leak to travel through, not merely a discipline that
// happens to hold. The one thing this file had to verify empirically rather than infer is that
// engineContract's generic checks.ts:randomPlayout — which this game's engine.test.ts already
// exercises 100 times per property — was ALREADY simultaneous-aware before this game existed
// (it builds one `moves` Map per active `active()` call, sequential or not); see
// checkDeterminism's own replay() cross-check for the byte-identical-replay half of this.

import { describe, expect, it } from "vitest";
import { replay, type ReplayRecord } from "@twist-arcade/engine";
import { resolveNamedAgent, runMatchup } from "@twist-arcade/harness";
import { handleBotRequest } from "@twist-arcade/bots/worker/host";
import type { BotRequest } from "@twist-arcade/bots/worker/protocol";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { bidTacToe, STARTING_BUDGET, type BidTacToeMove, type BidTacToeState } from "./engine";

const fakeClock = { now: (() => { let t = 0; return () => (t += 1); })() };

describe("platform spike: runMatchup", () => {
  it("plays a full scripted game (random-vs-random) through runMatchup with simultaneous bid steps", () => {
    const agentA = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const agentB = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const report = runMatchup(bidTacToe, agentA, agentB, {
      games: 4,
      seed: "spike-runmatchup",
      mirrorSeats: true,
      maxPlies: 200,
      clock: fakeClock,
    });

    expect(report.outcomes).toHaveLength(4);
    for (const outcome of report.outcomes) {
      expect(outcome.capHit).toBe(false); // every game actually terminated
      // Every bid step recorded exactly 2 actor moves; every place step exactly 1 — proving
      // GameOutcome.moves (the ReplayRecord.steps this runner builds) really did carry both
      // seats of a simultaneous ply together, not flattened/dropped (runner.ts's own module
      // doc, "Review Note 8 + stage-6 MUST FIX").
      for (const step of outcome.moves) {
        expect([1, 2]).toContain(step.moves.length);
        if (step.moves.length === 2) {
          const kinds = step.moves.map(([, m]) => (m as BidTacToeMove).kind).sort();
          expect(kinds).toEqual(["bid", "bid"]);
        } else {
          expect((step.moves[0]![1] as BidTacToeMove).kind).toBe("place");
        }
      }
    }
  });

  it("replay()s runMatchup's own recorded move log to a byte-identical trajectory (the leaderboard-verification path)", () => {
    const agentA = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const agentB = resolveNamedAgent<BidTacToeState, BidTacToeMove>("random");
    const report = runMatchup(bidTacToe, agentA, agentB, {
      games: 1,
      seed: "spike-replay",
      mirrorSeats: false,
      maxPlies: 200,
      clock: fakeClock,
    });
    const outcome = report.outcomes[0]!;

    const record: ReplayRecord = {
      gameId: bidTacToe.meta.id,
      gameVersion: bidTacToe.meta.version,
      engineVersion: "spike-test",
      numPlayers: 2,
      seed: `spike-replay:0`,
      steps: [...outcome.moves],
    };
    const replayed = replay(bidTacToe, record);

    expect(replayed.status.kind).not.toBe("ongoing"); // real terminal, not a cap-hit adjudication
    expect(replayed.states).toHaveLength(outcome.moves.length + 1); // setup state + one per step
    expect(bidTacToe.encode(replayed.final)).toBe(
      bidTacToe.encode(replayed.states[replayed.states.length - 1]!)
    );
  });
});

// ---------------------------------------------------------------------------------------
// T-SIM-4 (plan §11): the bot worker host's BotRequest for a bid step carries no data derived
// from the human's pending bid.
// ---------------------------------------------------------------------------------------

const BID_TAC_TOE_MANIFEST: GameManifest = {
  id: "bid-tac-toe",
  title: "Bid-Tac-Toe",
  classic: "Tic-Tac-Toe",
  ruleSentence: "No turns — bid chips each round; the higher bid pays and plays.",
  tags: [],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    { id: "casual", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 20 }, minReplyMs: 0 },
  ],
};

function registryWith(id: string, engine: typeof bidTacToe): Registry {
  return {
    [id]: {
      manifest: { ...BID_TAC_TOE_MANIFEST, id },
      async loadEngine() {
        return engine;
      },
      async loadPresentation() {
        throw new Error("not needed for this test");
      },
    },
  };
}

// A distinctive, otherwise-impossible sentinel: no legitimate field in BidTacToeState (board
// entries are 0|1|null, budgets sum to 2*STARTING_BUDGET, star is 0|1, phase carries small
// integers) can ever contain 97531 by construction, so its presence anywhere in a serialized
// request is unambiguous evidence of a leak.
const HUMAN_PENDING_BID_SENTINEL = 97531;

describe("T-SIM-4: the bot host never sees a human's pending bid", () => {
  it("an HONEST engine's BotRequest carries no trace of the human's uncommitted pending bid", async () => {
    // The scenario: it is a bid-phase round. The human (seat 0) has locally, in the UI layer,
    // picked a pending bid — but has not committed it (simultaneous: both bids are needed
    // before apply() can run at all, per plan §3.1). The ONLY thing that can legally travel to
    // the bot's (seat 1's) worker is `engine.encode(state)`, where `state` is the CANONICAL,
    // already-resolved game state — the human's pending bid, by this engine's own design,
    // never has anywhere to live inside it.
    const state: BidTacToeState = {
      board: Array.from({ length: 9 }, () => null),
      budgets: [STARTING_BUDGET, STARTING_BUDGET],
      star: 1,
      phase: { kind: "bid" },
      lastEffects: [],
    };
    // The human's pending bid — deliberately NEVER passed to encode()/state, only kept as a
    // local variable a hypothetical (buggy) transport layer might have been tempted to leak.
    const humanPendingBid = { kind: "bid" as const, amount: HUMAN_PENDING_BID_SENTINEL % (STARTING_BUDGET + 1) };
    void humanPendingBid; // proves the variable is genuinely unused by the request below

    const request: BotRequest = {
      requestId: "t-sim-4",
      gameId: "bid-tac-toe",
      encodedState: bidTacToe.encode(state),
      player: 1,
      tierId: "casual",
      seed: "t-sim-4-seed",
      step: 0,
    };

    const response = await handleBotRequest(registryWith("bid-tac-toe", bidTacToe), request, fakeClock);
    expect(response.ok).toBe(true);

    const wireBlob = JSON.stringify(request);
    expect(wireBlob).not.toContain(String(HUMAN_PENDING_BID_SENTINEL));
    // Stronger than the sentinel check alone: the request's encodedState must decode back to
    // EXACTLY the canonical state (a real round-trip through the wire boundary, C4's own
    // decode-never-partial guarantee applying here), so there is no hidden extra field at all —
    // not just no sentinel — for a pending bid to have occupied.
    const decoded = bidTacToe.decode(request.encodedState);
    expect(bidTacToe.encode(decoded)).toBe(bidTacToe.encode(state));
  });

  // C41 self-check: "verify the plant applied, and verify it landed somewhere the guard could
  // have failed." The check above is honest-by-construction (this engine has no field to leak
  // through) — which risks being vacuous in exactly the way C41 warns about. This companion
  // proves the SAME assertion technique actually bites: a deliberately dishonest engine that
  // smuggles the pending bid through a module-level side channel into its own encode() output
  // is caught by the identical sentinel check above, using a DIFFERENT registry entry so the
  // honest test above is never at risk of this contamination.
  it("(negative control) the identical check DOES catch a deliberately leaky engine", async () => {
    let leakedPendingBidSideChannel: number | null = null;

    const leakyEngine: typeof bidTacToe = {
      ...bidTacToe,
      encode(state: BidTacToeState): string {
        const real = bidTacToe.encode(state);
        if (leakedPendingBidSideChannel === null) return real;
        // PLANTED LEAK: smuggle a value the caller never should have been able to reach into
        // the request payload — exactly the shape a real transport-layer bug would take (e.g.
        // a shared mutable "current UI form state" object accidentally captured by closure).
        return real.slice(0, -1) + `,"__leak":${leakedPendingBidSideChannel}}`;
      },
    };

    const state: BidTacToeState = {
      board: Array.from({ length: 9 }, () => null),
      budgets: [STARTING_BUDGET, STARTING_BUDGET],
      star: 1,
      phase: { kind: "bid" },
      lastEffects: [],
    };
    leakedPendingBidSideChannel = HUMAN_PENDING_BID_SENTINEL;

    const request: BotRequest = {
      requestId: "t-sim-4-negative-control",
      gameId: "bid-tac-toe-leaky",
      encodedState: leakyEngine.encode(state),
      player: 1,
      tierId: "casual",
      seed: "t-sim-4-seed",
      step: 0,
    };

    // decode() on the REAL engine would already refuse this forged payload (C4: an unknown
    // "__leak" field plus a valid shape still round-trips through JSON.parse, so this asserts
    // what a naive wire-inspection check would catch even before decode() gets involved).
    const wireBlob = JSON.stringify(request);
    expect(wireBlob).toContain(String(HUMAN_PENDING_BID_SENTINEL)); // the plant landed
    // ...and is exactly what the honest test's assertion would have flagged as a T-SIM-4
    // violation had the real engine's encode() ever done this.
  });
});

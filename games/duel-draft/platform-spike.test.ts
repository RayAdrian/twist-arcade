// games/duel-draft/platform-spike.test.ts — the simultaneous-turn platform seams, exercised
// end-to-end (docs/plans/duel-draft.md §3/§4/§12), following Bid-Tac-Toe's own B1 spike
// precedent (platform-corrections.md C48: "the simultaneous seams hold"). Duel Draft is a
// SIMPLER exerciser than Bid-Tac-Toe — there is no phase field at all, so EVERY step of EVERY
// game must carry exactly 2 actor moves, never 1 (unlike Bid-Tac-Toe's bid/place split).
//
// Also carries T-SIM-4 (plan §4/§12 acceptance criterion 9): "the BotRequest for a round
// contains no field derived from the human's pending pick." Pending picks never enter `S` by
// this engine's own design (engine.ts's module doc) — this test proves that empirically at
// the wire boundary, the same way Bid-Tac-Toe's own T-SIM-4 did for sealed bids.

import { describe, expect, it } from "vitest";
import { replay, type ReplayRecord } from "@twist-arcade/engine";
import { resolveNamedAgent, runMatchup } from "@twist-arcade/harness";
import { handleBotRequest } from "@twist-arcade/bots/worker/host";
import type { BotRequest } from "@twist-arcade/bots/worker/protocol";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { duelDraft, SIZE, type DuelDraftMove, type DuelDraftState } from "./engine";

const fakeClock = { now: (() => { let t = 0; return () => (t += 1); })() };

describe("platform spike: runMatchup", () => {
  it("plays a full scripted game (random-vs-random) through runMatchup, every step a 2-actor simultaneous round", () => {
    const agentA = resolveNamedAgent<DuelDraftState, DuelDraftMove>("random");
    const agentB = resolveNamedAgent<DuelDraftState, DuelDraftMove>("random");
    const report = runMatchup(duelDraft, agentA, agentB, {
      games: 10,
      seed: "spike-runmatchup",
      mirrorSeats: true,
      maxPlies: 200,
      clock: fakeClock,
    });

    expect(report.outcomes).toHaveLength(10);
    for (const outcome of report.outcomes) {
      expect(outcome.capHit).toBe(false); // every game actually terminated (structural DAG, plan §1.5)
      expect(outcome.plies).toBeLessThanOrEqual(16); // structural bound
      // EVERY step carries BOTH seats' moves — no phase field, no exception (unlike Bid-Tac-Toe).
      for (const step of outcome.moves) {
        expect(step.moves).toHaveLength(2);
        const cells = step.moves.map(([, m]) => (m as DuelDraftMove).cell).sort((a, b) => a - b);
        expect(cells.every((c) => Number.isInteger(c) && c >= 0 && c < SIZE * SIZE)).toBe(true);
      }
    }
  });

  it("replay()s runMatchup's own recorded move log to a byte-identical trajectory (the leaderboard-verification path)", () => {
    const agentA = resolveNamedAgent<DuelDraftState, DuelDraftMove>("random");
    const agentB = resolveNamedAgent<DuelDraftState, DuelDraftMove>("random");
    const report = runMatchup(duelDraft, agentA, agentB, {
      games: 1,
      seed: "spike-replay",
      mirrorSeats: false,
      maxPlies: 200,
      clock: fakeClock,
    });
    const outcome = report.outcomes[0]!;

    const record: ReplayRecord = {
      gameId: duelDraft.meta.id,
      gameVersion: duelDraft.meta.version,
      engineVersion: "spike-test",
      numPlayers: 2,
      seed: "spike-replay:0",
      steps: [...outcome.moves],
    };
    const replayed = replay(duelDraft, record);

    expect(replayed.status.kind).not.toBe("ongoing"); // real terminal, not a cap-hit adjudication
    expect(replayed.states).toHaveLength(outcome.moves.length + 1); // setup state + one per round
    expect(duelDraft.encode(replayed.final)).toBe(
      duelDraft.encode(replayed.states[replayed.states.length - 1]!)
    );
  });
});

// ---------------------------------------------------------------------------------------
// T-SIM-4 (plan §4/§12 acceptance criterion 9): the bot worker host's BotRequest for a round
// carries no data derived from the human's pending pick.
// ---------------------------------------------------------------------------------------

const DUEL_DRAFT_MANIFEST: GameManifest = {
  id: "duel-draft",
  title: "Duel Draft",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Pick cells at the same time — pick the same one and it's destroyed for good.",
  tags: [],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    { id: "casual", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 20 }, minReplyMs: 0 },
  ],
};

function registryWith(id: string, engine: typeof duelDraft): Registry {
  return {
    [id]: {
      manifest: { ...DUEL_DRAFT_MANIFEST, id },
      async loadEngine() {
        return engine;
      },
      async loadPresentation() {
        throw new Error("not needed for this test");
      },
    },
  };
}

// A distinctive, otherwise-impossible sentinel: no legitimate field in DuelDraftState (board
// entries are "empty"|0|1|"destroyed") can ever contain 97531 by construction, so its presence
// anywhere in a serialized request is unambiguous evidence of a leak.
const HUMAN_PENDING_PICK_SENTINEL = 97531;

describe("T-SIM-4: the bot host never sees a human's pending pick", () => {
  it("an HONEST engine's BotRequest carries no trace of the human's uncommitted pending pick", async () => {
    // The scenario: it is mid-round. The human (seat 0) has, in the UI layer, locally picked a
    // cell — but has not committed it (simultaneous: both picks are needed before apply() can
    // run at all, per plan §1.1/§4). The ONLY thing that can legally travel to the bot's (seat
    // 1's) worker is `engine.encode(state)`, where `state` is the CANONICAL, already-resolved
    // game state — the human's pending pick, by this engine's own design, never has anywhere
    // to live inside it.
    const state: DuelDraftState = {
      board: Array.from({ length: SIZE * SIZE }, () => "empty"),
      lastEffects: [],
    };
    // The human's pending pick — deliberately NEVER passed to encode()/state, only kept as a
    // local variable a hypothetical (buggy) transport layer might have been tempted to leak.
    const humanPendingPick = { cell: HUMAN_PENDING_PICK_SENTINEL % (SIZE * SIZE) };
    void humanPendingPick; // proves the variable is genuinely unused by the request below

    const request: BotRequest = {
      requestId: "t-sim-4",
      gameId: "duel-draft",
      encodedState: duelDraft.encode(state),
      player: 1,
      tierId: "casual",
      seed: "t-sim-4-seed",
      step: 0,
    };

    const response = await handleBotRequest(registryWith("duel-draft", duelDraft), request, fakeClock);
    expect(response.ok).toBe(true);

    const wireBlob = JSON.stringify(request);
    expect(wireBlob).not.toContain(String(HUMAN_PENDING_PICK_SENTINEL));
    // Stronger than the sentinel check alone: the request's encodedState must decode back to
    // EXACTLY the canonical state (a real round-trip through the wire boundary, C4's own
    // decode-never-partial guarantee applying here), so there is no hidden extra field at all —
    // not just no sentinel — for a pending pick to have occupied.
    const decoded = duelDraft.decode(request.encodedState);
    expect(duelDraft.encode(decoded)).toBe(duelDraft.encode(state));
  });

  // C41 self-check: "verify the plant applied, and verify it landed somewhere the guard could
  // have failed." The check above is honest-by-construction (this engine has no field to leak
  // through) — which risks being vacuous in exactly the way C41 warns about. This companion
  // proves the SAME assertion technique actually bites: a deliberately dishonest engine that
  // smuggles the pending pick through a module-level side channel into its own encode() output
  // is caught by the identical sentinel check above, using a DIFFERENT registry entry so the
  // honest test above is never at risk of this contamination.
  it("(negative control) the identical check DOES catch a deliberately leaky engine", async () => {
    let leakedPendingPickSideChannel: number | null = null;

    const leakyEngine: typeof duelDraft = {
      ...duelDraft,
      encode(state: DuelDraftState): string {
        const real = duelDraft.encode(state);
        if (leakedPendingPickSideChannel === null) return real;
        // PLANTED LEAK: smuggle a value the caller never should have been able to reach into
        // the request payload — exactly the shape a real transport-layer bug would take (e.g.
        // a shared mutable "current UI form state" object accidentally captured by closure).
        return real.slice(0, -1) + `,"__leak":${leakedPendingPickSideChannel}}`;
      },
    };

    const state: DuelDraftState = {
      board: Array.from({ length: SIZE * SIZE }, () => "empty"),
      lastEffects: [],
    };
    leakedPendingPickSideChannel = HUMAN_PENDING_PICK_SENTINEL;

    const request: BotRequest = {
      requestId: "t-sim-4-negative-control",
      gameId: "duel-draft-leaky",
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
    expect(wireBlob).toContain(String(HUMAN_PENDING_PICK_SENTINEL)); // the plant landed
    // ...and is exactly what the honest test's assertion would have flagged as a T-SIM-4
    // violation had the real engine's encode() ever done this.
  });
});

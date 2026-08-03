import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { tinyFog } from "../fixtures/tiny-fog";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { HiddenInformationUnsupportedError, handleBotRequest, UnknownGameError, UnknownTierError } from "../../src/worker/host";
import type { BotRequest } from "../../src/worker/protocol";
import { fakeClock } from "../helpers";

const TTT_MANIFEST: GameManifest = {
  id: "classic-ttt-fixture",
  title: "Classic Tic-Tac-Toe (fixture)",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Get three in a row.",
  tags: [],
  estMinutes: 2,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    { id: "casual", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 250 },
    { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 20 }, minReplyMs: 400 },
    // "ruthless" deliberately uses a deadlineMs budget so the determinism-refusal test below
    // has a tier to point at — a real ruthless tier for a game this small would normally be
    // exact/rollouts, but the wire-format point under test is budget.kind, not this game.
    { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "deadlineMs", ms: 20 }, minReplyMs: 600 },
  ],
};

let loadEngineCalls = 0;

const FOG_MANIFEST: GameManifest = {
  id: "tiny-fog-fixture",
  title: "Tiny Fog (fixture)",
  classic: "Guess",
  ruleSentence: "Guess the secretly-flipped coin.",
  tags: [],
  estMinutes: 1,
  modes: { bot: false, hotseat: false, asyncLink: false },
  players: { min: 1, max: 1 },
  difficultyTiers: [
    { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 20 }, minReplyMs: 400 },
  ],
};

const registry: Registry = {
  "classic-ttt-fixture": {
    manifest: TTT_MANIFEST,
    async loadEngine() {
      loadEngineCalls += 1;
      return classicTicTacToe;
    },
    async loadPresentation() {
      throw new Error("not needed for these tests");
    },
  },
  "tiny-fog-fixture": {
    manifest: FOG_MANIFEST,
    async loadEngine() {
      return tinyFog;
    },
    async loadPresentation() {
      throw new Error("not needed for these tests");
    },
  },
};

function baseRequest(overrides: Partial<BotRequest> = {}): BotRequest {
  const state: TTTState = { board: Array.from({ length: 9 }, () => null), turn: 0, lastEffects: [] };
  return {
    requestId: "req-1",
    gameId: "classic-ttt-fixture",
    encodedState: classicTicTacToe.encode(state),
    player: 0,
    tierId: "standard",
    seed: "worker-test-seed",
    step: 0,
    ...overrides,
  };
}

describe("handleBotRequest (worker host, plan §6 + plan §13's headline determinism acceptance item)", () => {
  it("round-trips the SAME rollouts-budget request twice and returns an IDENTICAL move", async () => {
    const request = baseRequest();
    const first = await handleBotRequest(registry, request, fakeClock());
    const second = await handleBotRequest(registry, request, fakeClock());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.move).toEqual(first.move);
    }
  });

  it("dynamic-imports the engine via the registry's loadEngine() rather than any static import", async () => {
    const before = loadEngineCalls;
    await handleBotRequest(registry, baseRequest({ requestId: "req-dynamic" }), fakeClock());
    expect(loadEngineCalls).toBe(before + 1);
  });

  it("refuses (typed error, ok:false) a deadlineMs tier when the caller asserts determinism is required", async () => {
    const request = baseRequest({ requestId: "req-determinism", tierId: "ruthless" });
    const response = await handleBotRequest(registry, request, fakeClock(), { assertDeterministic: true });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.name).toBe("NonDeterministicBudgetError");
    }
  });

  it("does NOT refuse the same deadlineMs tier when the caller has not asserted determinism (interactive play)", async () => {
    const request = baseRequest({ requestId: "req-interactive", tierId: "ruthless" });
    const response = await handleBotRequest(registry, request, fakeClock());
    expect(response.ok).toBe(true);
  });

  it("returns a typed ok:false for an unknown gameId rather than throwing across the boundary", async () => {
    const response = await handleBotRequest(registry, baseRequest({ gameId: "no-such-game" }), fakeClock());
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.name).toBe(UnknownGameError.name);
    }
  });

  it("returns a typed ok:false for an unknown tierId", async () => {
    const request = baseRequest({ tierId: "casual" });
    // Registry has "casual" — force a miss by pointing at a manifest copy without it.
    const registryMissingTier: Registry = {
      "classic-ttt-fixture": {
        ...registry["classic-ttt-fixture"]!,
        manifest: { ...TTT_MANIFEST, difficultyTiers: TTT_MANIFEST.difficultyTiers.filter((t) => t.id !== "casual") },
      },
    };
    const response = await handleBotRequest(registryMissingTier, request, fakeClock());
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.name).toBe(UnknownTierError.name);
    }
  });

  it("surfaces a malformed encodedState as a typed ok:false rather than an accepted partial state (C4)", async () => {
    const request = baseRequest({ encodedState: "{not json" });
    const response = await handleBotRequest(registry, request, fakeClock());
    expect(response.ok).toBe(false);
  });

  it("preserves requestId on both success and failure responses", async () => {
    const ok = await handleBotRequest(registry, baseRequest({ requestId: "id-ok" }), fakeClock());
    expect(ok.requestId).toBe("id-ok");
    const fail = await handleBotRequest(registry, baseRequest({ requestId: "id-fail", gameId: "nope" }), fakeClock());
    expect(fail.requestId).toBe("id-fail");
  });

  describe("correction C1 (platform-corrections.md): hidden-information games must never reach a state-space Policy through this seam", () => {
    it("refuses a hiddenInformation:true game with a typed error rather than handing tierPolicy the canonical (secret-bearing) state", async () => {
      const fogState = tinyFog.setup(1, rngFromSeed("worker-fog-setup"));
      const request: BotRequest = {
        requestId: "req-fog",
        gameId: "tiny-fog-fixture",
        encodedState: tinyFog.encode(fogState),
        player: 0,
        tierId: "standard",
        seed: "worker-fog-seed",
        step: 0,
      };
      const response = await handleBotRequest(registry, request, fakeClock());
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.name).toBe(HiddenInformationUnsupportedError.name);
      }
    });
  });
});

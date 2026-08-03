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

// A separate manifest/registry entry (not reused by the other tests above) tuned so a
// forced-win position is greedy-dominant enough (300 mcts rollouts) that epsilon=0 always
// finds it, and any softening away from it is unambiguously attributable to `soften` — the
// exact pattern test/tiers.test.ts's own "soften" describe block already uses at the
// tierPolicy level. This exercises the SAME property through the worker wire boundary.
const SOFTEN_MANIFEST: GameManifest = {
  id: "soften-ttt-fixture",
  title: "Classic Tic-Tac-Toe (soften fixture)",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Get three in a row.",
  tags: [],
  estMinutes: 2,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    {
      id: "ruthless",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 300 },
      minReplyMs: 600,
      // Deliberately NO `blunder` field at all — `soften`'s resample is now structural (it
      // excludes the flagged move from the candidate set outright, see tiers.ts's module doc),
      // not a temperature-scaled softmax, so it no longer needs (or should be tested with) a
      // hand-tuned temperature to be reliably observable. `tier.blunder?.temperature` falls
      // back to its documented default (1) here — a review finding on an earlier version of
      // this fixture found temperature 200 was needed to make the OLD softmax-based resample's
      // effect observable at all at this rollout count, which was itself the defect: it meant
      // `soften` was silently inert at the default temperature every other tier uses.
    },
  ],
};

let loadEngineCalls = 0;
let decodeSpyCalls = 0;

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
  "soften-ttt-fixture": {
    manifest: SOFTEN_MANIFEST,
    async loadEngine() {
      return classicTicTacToe;
    },
    async loadPresentation() {
      throw new Error("not needed for these tests");
    },
  },
  "tiny-fog-decode-spy-fixture": {
    manifest: { ...FOG_MANIFEST, id: "tiny-fog-decode-spy-fixture" },
    async loadEngine() {
      // A decode-spying wrapper around tinyFog, registered separately from the plain
      // "tiny-fog-fixture" entry above so this counter is never disturbed by other tests.
      return {
        ...tinyFog,
        decode(encoded: string) {
          decodeSpyCalls += 1;
          return tinyFog.decode(encoded);
        },
      };
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

    it("refuses BEFORE ever calling engine.decode() on the caller's encodedState (pins the ordering, not just the outcome)", async () => {
      // The refusal is currently correctly placed before decode in host.ts, but nothing
      // pinned that ORDERING against regression — a future edit could move the
      // hiddenInformation check after decode() (still returning ok:false, so the "refuses"
      // test above would keep passing) while quietly having already run untrusted input
      // through decode() first. Prove decode() is never even invoked for a refused request.
      const before = decodeSpyCalls;
      const fogState = tinyFog.setup(1, rngFromSeed("worker-fog-decode-spy-setup"));
      const request: BotRequest = {
        requestId: "req-fog-decode-spy",
        gameId: "tiny-fog-decode-spy-fixture",
        encodedState: tinyFog.encode(fogState),
        player: 0,
        tierId: "standard",
        seed: "worker-fog-decode-spy-seed",
        step: 0,
      };
      const response = await handleBotRequest(registry, request, fakeClock());
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.name).toBe(HiddenInformationUnsupportedError.name);
      }
      expect(decodeSpyCalls).toBe(before);
    });
  });

  describe("first-game softening (BotRequest.soften?) — the seam must actually be reachable through this boundary", () => {
    // A forced-win position: X (player 0) has two in a row (cells 0,1) with cell 2 open.
    const twoInARow: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const softenRequest = (step: number, soften?: boolean): BotRequest => ({
      requestId: `req-soften-${step}`,
      gameId: "soften-ttt-fixture",
      encodedState: classicTicTacToe.encode(twoInARow),
      player: 0,
      tierId: "ruthless",
      seed: "worker-soften-seed",
      step,
      ...(soften !== undefined ? { soften } : {}),
    });

    // The predicate isn't itself JSON-plain (it's a function), so it can never travel over a
    // real postMessage — it's supplied here exactly the way the module doc for
    // HandleBotRequestOptions says it must be: resolved INSIDE the worker process, from the
    // calling context's own knowledge of the game, not carried on the wire.
    const flagCell2AsTwistExploiting = (): ((state: TTTState, move: { cell: number }) => boolean) =>
      (_state, move) => move.cell === 2;

    async function countAwayFromWin(soften: boolean | undefined, resolvePredicate: boolean): Promise<number> {
      let away = 0;
      const N = 60;
      for (let step = 0; step < N; step++) {
        // Built conditionally (never `key: undefined`) — exactOptionalPropertyTypes treats a
        // present-but-undefined property differently from an absent one.
        const response = await handleBotRequest(registry, softenRequest(step, soften), fakeClock(), {
          ...(resolvePredicate ? { resolveIsTwistExploitingMove: () => flagCell2AsTwistExploiting() } : {}),
        });
        expect(response.ok).toBe(true);
        if (response.ok && (response.move as { cell: number }).cell !== 2) away += 1;
      }
      return away;
    }

    it("raises epsilon on twist-exploiting moves when the caller both sets soften:true AND supplies a resolver — blunders away from the forced win far more than the unsoftened baseline", async () => {
      const baseline = await countAwayFromWin(undefined, true);
      const softened = await countAwayFromWin(true, true);
      expect(baseline).toBe(0); // unsoftened: always takes the forced win (epsilon 0 base tier)
      expect(softened).toBeGreaterThan(baseline);
    });

    it("soften:true is a no-op when the calling context supplies no resolver — nothing crosses postMessage that could smuggle a predicate in", async () => {
      const withoutResolver = await countAwayFromWin(true, false);
      expect(withoutResolver).toBe(0); // no predicate available -> soften has nothing to flag -> plain greedy play
    });
  });
});

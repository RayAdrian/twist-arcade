import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { handleBotRequest } from "@twist-arcade/bots/worker/host";
import type { BotRequest, BotResponse } from "@twist-arcade/bots/worker/protocol";
import { BotCancelledError, workerBotDriver, type BotMoveRequest, type WorkerLike } from "../src/bot-driver";

// packages/shell/test/worker-bot-driver.test.ts — S2's real bot: `workerBotDriver` is the thin
// postMessage ADAPTER over `packages/bots`'s worker host. Since the concrete `new Worker(...)`
// bootstrap lives at app/bot-worker.ts (app-owned — see bot-driver.ts's own module doc for why),
// this suite proves the adapter itself against a FAKE worker that runs the REAL
// `handleBotRequest` in-process — and, critically, round-trips every message through
// `JSON.parse(JSON.stringify(...))`, simulating the structured-clone boundary a real
// `postMessage` crosses. That round trip is what actually proves determinism survives the wire
// (plan §13's headline acceptance item), not just that the TypeScript types happen to line up.

const MANIFEST: GameManifest = {
  id: "classic-ttt-fixture",
  title: "Classic Tic-Tac-Toe (fixture)",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Get three in a row.",
  tags: [],
  estMinutes: 2,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [{ id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 20 }, minReplyMs: 0 }],
};

const registry: Registry = {
  "classic-ttt-fixture": {
    manifest: MANIFEST,
    async loadEngine() {
      return classicTicTacToe;
    },
    async loadPresentation() {
      throw new Error("not needed for these tests");
    },
  },
};

const clock = { now: () => Date.now() };

/** A fake `Worker` that runs the REAL `handleBotRequest` in-process on `postMessage`, delivering
 *  its response back through every registered "message" listener — with BOTH directions passed
 *  through a JSON round trip, exactly what a real structured-clone boundary would do to a
 *  JSON-plain payload (protocol.ts's own contract). */
function createFakeWorker(): WorkerLike {
  const listeners = new Set<(event: MessageEvent) => void>();
  return {
    postMessage(message: unknown) {
      const wireRequest = JSON.parse(JSON.stringify(message)) as BotRequest;
      queueMicrotask(() => {
        handleBotRequest(registry, wireRequest, clock).then((response) => {
          const wireResponse = JSON.parse(JSON.stringify(response)) as BotResponse;
          const event = { data: wireResponse } as unknown as MessageEvent;
          for (const listener of listeners) listener(event);
        });
      });
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
}

function requestFor(overrides: Partial<BotMoveRequest> = {}): BotMoveRequest {
  const state: TTTState = { board: Array.from({ length: 9 }, () => null), turn: 0, lastEffects: [] };
  return {
    requestId: "req-1",
    gameId: "classic-ttt-fixture",
    encodedState: classicTicTacToe.encode(state),
    player: 0,
    tierId: "standard",
    seed: "seed-1",
    step: 0,
    ...overrides,
  };
}

describe("workerBotDriver — the postMessage adapter over packages/bots' worker host (S2)", () => {
  it("resolves chooseMove with a legal move, produced by the real handleBotRequest pipeline", async () => {
    const driver = workerBotDriver(createFakeWorker());
    const result = await driver.chooseMove(requestFor());
    const state: TTTState = { board: Array.from({ length: 9 }, () => null), turn: 0, lastEffects: [] };
    const legal = classicTicTacToe.legalMoves(state, 0).map((m) => m.cell);
    expect(legal).toContain((result.move as { cell: number }).cell);
  });

  it("determinism survives the (simulated) postMessage/structured-clone round trip: the same rollouts request twice returns an identical move", async () => {
    const driverA = workerBotDriver(createFakeWorker());
    const driverB = workerBotDriver(createFakeWorker());
    const a = await driverA.chooseMove(requestFor());
    const b = await driverB.chooseMove(requestFor());
    expect(b.move).toEqual(a.move);
  });

  it("correlates concurrent requests by requestId instead of cross-wiring their responses", async () => {
    const driver = workerBotDriver(createFakeWorker());
    const [a, b] = await Promise.all([
      driver.chooseMove(requestFor({ requestId: "req-a", step: 0 })),
      driver.chooseMove(requestFor({ requestId: "req-b", step: 1 })),
    ]);
    const expectedA = await handleBotRequest(registry, requestFor({ requestId: "req-a", step: 0 }), clock);
    const expectedB = await handleBotRequest(registry, requestFor({ requestId: "req-b", step: 1 }), clock);
    expect(expectedA.ok).toBe(true);
    expect(expectedB.ok).toBe(true);
    if (expectedA.ok) expect(a.move).toEqual(expectedA.move);
    if (expectedB.ok) expect(b.move).toEqual(expectedB.move);
  });

  it("rejects with the response's typed error name on an ok:false response (e.g. an unknown gameId)", async () => {
    const driver = workerBotDriver(createFakeWorker());
    await expect(driver.chooseMove(requestFor({ gameId: "no-such-game" }))).rejects.toMatchObject({
      name: "UnknownGameError",
    });
  });

  it("cancel() rejects the pending request with BotCancelledError; the worker's later (now-orphaned) response is silently ignored", async () => {
    const driver = workerBotDriver(createFakeWorker());
    const promise = driver.chooseMove(requestFor({ requestId: "cancel-me" }));
    const assertion = expect(promise).rejects.toBeInstanceOf(BotCancelledError);
    driver.cancel("cancel-me");
    await assertion;
    // Let the fake worker's real (now-orphaned) response actually arrive — must not throw/hang.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("dispose() rejects every still-pending request with BotCancelledError", async () => {
    const driver = workerBotDriver(createFakeWorker());
    const a = driver.chooseMove(requestFor({ requestId: "a" }));
    const b = driver.chooseMove(requestFor({ requestId: "b" }));
    driver.dispose();
    await expect(a).rejects.toBeInstanceOf(BotCancelledError);
    await expect(b).rejects.toBeInstanceOf(BotCancelledError);
  });
});

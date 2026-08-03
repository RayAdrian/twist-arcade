// @ts-expect-error — Vite's `?raw` module suffix has no ambient type; only used to grep source.
import botDriverSource from "../src/bot-driver.ts?raw";
import { describe, expect, it, vi } from "vitest";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { rngForSetup } from "@twist-arcade/engine";
import {
  BotCancelledError,
  ScriptExhaustedError,
  scriptedBotDriver,
  stubBotDriver,
  type BotMoveRequest,
} from "../src/bot-driver";

// plan §5.4: the bot seam + the M2 stub. `stubBotDriver` picks uniformly among legal moves,
// deterministically (rngFor(seed + ":bot", step)), with an artificial 250ms delay so pacing UI
// is real — explicitly `// NOT SHIPPABLE`, swapped for the real worker driver in S2.
// `scriptedBotDriver` ships alongside for deterministic tests.

function setupState(): TTTState {
  return classicTicTacToe.setup(2, rngForSetup("seed-1"));
}

function requestFor(overrides: Partial<BotMoveRequest> = {}): BotMoveRequest {
  const state = setupState();
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

describe("stubBotDriver", () => {
  it("is marked NOT SHIPPABLE in its own source (plan §5.4 — the Phase-0-exit gate greps for this)", () => {
    expect(botDriverSource).toMatch(/NOT SHIPPABLE/);
  });

  it("only ever returns a move that is legal for the requested state and player", async () => {
    const driver = stubBotDriver(classicTicTacToe);
    const state = setupState();
    const req = requestFor({ encodedState: classicTicTacToe.encode(state) });
    const promise = driver.chooseMove(req);
    await vi.waitFor(() => {}, { timeout: 1 }).catch(() => {});
    const result = await promise;
    const legal = classicTicTacToe.legalMoves(state, 0).map((m) => m.cell);
    expect(legal).toContain((result.move as TTTMove).cell);
  });

  it("is deterministic: same seed + step ⇒ the same move every time", async () => {
    const driverA = stubBotDriver(classicTicTacToe);
    const driverB = stubBotDriver(classicTicTacToe);
    const resultA = await driverA.chooseMove(requestFor());
    const resultB = await driverB.chooseMove(requestFor());
    expect(resultA.move).toEqual(resultB.move);
  });

  it("picks a different move for a different step (varies with the rng fork)", async () => {
    const driver = stubBotDriver(classicTicTacToe);
    const moves = new Set<number>();
    for (let step = 0; step < 9; step++) {
      const result = await driver.chooseMove(requestFor({ step }));
      moves.add((result.move as TTTMove).cell);
    }
    // Not a strict requirement that every step differs, but across 9 draws over 9 legal cells
    // uniformly, seeing more than one distinct value confirms the step actually forks the rng.
    expect(moves.size).toBeGreaterThan(1);
  });

  it("waits at least ~250ms before resolving (pacing UI must be real)", async () => {
    vi.useFakeTimers();
    try {
      const driver = stubBotDriver(classicTicTacToe);
      let resolved = false;
      driver.chooseMove(requestFor()).then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel() rejects the pending request with BotCancelledError instead of resolving", async () => {
    vi.useFakeTimers();
    try {
      const driver = stubBotDriver(classicTicTacToe);
      const promise = driver.chooseMove(requestFor({ requestId: "cancel-me" }));
      const assertion = expect(promise).rejects.toBeInstanceOf(BotCancelledError);
      driver.cancel("cancel-me");
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose() rejects any still-pending request", async () => {
    vi.useFakeTimers();
    try {
      const driver = stubBotDriver(classicTicTacToe);
      const promise = driver.chooseMove(requestFor());
      const assertion = expect(promise).rejects.toBeInstanceOf(BotCancelledError);
      driver.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores the soften flag (accepts and does not throw) — the modifier is platform-owned (M2)", async () => {
    const driver = stubBotDriver(classicTicTacToe);
    await expect(driver.chooseMove(requestFor({ soften: true }))).resolves.toBeDefined();
  });
});

describe("scriptedBotDriver", () => {
  it("returns the scripted moves in order, one per call", async () => {
    const driver = scriptedBotDriver([{ cell: 4 }, { cell: 0 }, { cell: 8 }]);
    const a = await driver.chooseMove(requestFor({ step: 0 }));
    const b = await driver.chooseMove(requestFor({ step: 1 }));
    const c = await driver.chooseMove(requestFor({ step: 2 }));
    expect([a.move, b.move, c.move]).toEqual([{ cell: 4 }, { cell: 0 }, { cell: 8 }]);
  });

  it("throws ScriptExhaustedError with a clear message once the script runs out", async () => {
    const driver = scriptedBotDriver([{ cell: 4 }]);
    await driver.chooseMove(requestFor());
    await expect(driver.chooseMove(requestFor({ step: 1 }))).rejects.toBeInstanceOf(ScriptExhaustedError);
  });

  it("resolves immediately by default (delayMs 0) so Playwright scripts stay deterministic", async () => {
    vi.useFakeTimers();
    try {
      const driver = scriptedBotDriver([{ cell: 4 }]);
      let resolved = false;
      driver.chooseMove(requestFor()).then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports an optional delay, and cancel() rejects a pending scripted request the same way as the stub", async () => {
    vi.useFakeTimers();
    try {
      const driver = scriptedBotDriver([{ cell: 4 }], 250);
      const promise = driver.chooseMove(requestFor({ requestId: "cancel-me" }));
      const assertion = expect(promise).rejects.toBeInstanceOf(BotCancelledError);
      driver.cancel("cancel-me");
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

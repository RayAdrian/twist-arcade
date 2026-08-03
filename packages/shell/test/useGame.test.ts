import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { replayTo } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { scriptedBotDriver, type BotDriver, type BotMoveRequest } from "../src/bot-driver";
import { useGame } from "../src/useGame";
import { tttDefinition } from "./fixtures/ttt-definition";
import { secretPickDefinition } from "./fixtures/secret-pick";
import { crackstepDefinition } from "./fixtures/crackstep-definition";

// plan §5, §11.1 — the anchors named explicitly by the plan's own testing section, against the
// classic-ttt fixture engine (open info, 2P, sequential) + scriptedBotDriver, plus a
// hidden-info fixture (secret-pick) for the hotseat handoff-gating anchor.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useGame — loop + solo-bot", () => {
  it("advances the loop on active(): human moves, then the bot's scripted reply lands automatically", async () => {
    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "s1",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([{ cell: 4 }]),
      })
    );

    expect(result.current.activeSeat).toBe(0);
    expect(result.current.legal.map((m) => m.cell).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    act(() => result.current.submitMove({ cell: 0 }));

    await waitFor(() => expect(result.current.moveCount).toBe(2));
    expect(result.current.view.board[0]).toBe(0);
    expect(result.current.view.board[4]).toBe(1);
    expect(result.current.activeSeat).toBe(0);
    expect(result.current.legal.map((m) => m.cell).sort()).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  it("illegal submitMove is a no-op (state unchanged) and warns in dev", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "s1",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([]),
      })
    );

    act(() => result.current.submitMove({ cell: 99 } as unknown as TTTMove));

    expect(result.current.moveCount).toBe(0);
    expect(result.current.view.board.every((c) => c === null)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe("useGame — undo (replay-based)", () => {
  it("undo pops back to the human's previous decision point, and encode(state) equals encode(replayTo(record, k))", async () => {
    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "undo-seed",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([{ cell: 4 }, { cell: 5 }]),
      })
    );

    act(() => result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(result.current.moveCount).toBe(2));

    act(() => result.current.submitMove({ cell: 1 }));
    await waitFor(() => expect(result.current.moveCount).toBe(4));

    act(() => result.current.undo());

    expect(result.current.moveCount).toBe(2);
    expect(result.current.activeSeat).toBe(0);
    const replayed = replayTo(classicTicTacToe, result.current.history, 2);
    expect(classicTicTacToe.encode(result.current.view)).toBe(classicTicTacToe.encode(replayed));
  });
});

describe("useGame — input lockout", () => {
  it("sets lockedUntil when the bot's move lands, but not for the human's own move", async () => {
    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "lock-seed",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([{ cell: 4 }]),
      })
    );

    expect(result.current.lockedUntil).toBe(0);

    const before = performance.now();
    act(() => result.current.submitMove({ cell: 0 }));
    // The human's own move must not itself set a lockout — even before the bot replies.
    expect(result.current.lockedUntil).toBe(0);

    await waitFor(() => expect(result.current.moveCount).toBe(2));
    expect(result.current.lockedUntil).toBeGreaterThanOrEqual(before + 250);
  });
});

describe("useGame — hotseat handoff gating (hidden information)", () => {
  it("keeps `view` on the presenting seat until confirmHandoff(), for a hiddenInformation game", async () => {
    const { result } = renderHook(() =>
      useGame({
        definition: secretPickDefinition,
        mode: "hotseat",
        seed: "handoff-seed",
        persist: false,
      })
    );

    expect(result.current.presentingSeat).toBe(0);
    const seat0Secret = result.current.view.mine;

    act(() => result.current.submitMove({ pass: true }));

    // Still showing seat 0's view — the handoff is pending confirmation.
    expect(result.current.presentingSeat).toBe(0);
    expect(result.current.view.mine).toBe(seat0Secret);
    expect(result.current.handoff).toEqual({ pending: true, nextSeat: 1 });

    act(() => result.current.confirmHandoff());

    expect(result.current.presentingSeat).toBe(1);
    expect(result.current.handoff).toBeNull();
    expect(result.current.view.mine).not.toBe(seat0Secret);
  });
});

describe("useGame — first-occurrence callout (once per device)", () => {
  it("fires on first trigger, clears on the next move, and never fires again across a second hook lifetime", async () => {
    const { result, unmount } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "callout-seed-A",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([{ cell: 4 }, { cell: 5 }]),
      })
    );

    act(() => result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(result.current.moveCount).toBe(2));
    expect(result.current.firstOccurrence).toEqual({ text: "First move callout.", anchor: "cell-0" });

    act(() => result.current.submitMove({ cell: 1 }));
    await waitFor(() => expect(result.current.moveCount).toBe(4));
    expect(result.current.firstOccurrence).toBeNull();

    unmount();

    const second = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "callout-seed-B",
        humanSeat: 0,
        persist: false,
        botDriver: scriptedBotDriver([{ cell: 4 }]),
      })
    );

    act(() => second.result.current.submitMove({ cell: 2 }));
    await waitFor(() => expect(second.result.current.moveCount).toBe(2));
    expect(second.result.current.firstOccurrence).toBeNull();
  });
});

describe("useGame — first-game bot softening", () => {
  it("sends soften:true on every bot request of the device's first game, and false after that game ends", async () => {
    const requests: BotMoveRequest[] = [];
    const recordingDriver: BotDriver = {
      chooseMove(req) {
        requests.push(req);
        return Promise.resolve({ move: req.step === 1 ? { cell: 3 } : { cell: 4 } });
      },
      cancel() {},
      dispose() {},
    };

    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "soften-seed",
        humanSeat: 0,
        persist: false,
        botDriver: recordingDriver,
      })
    );

    // Human wins on the top row: 0, 1, 2 with bot replying 3, 4 — a guaranteed short game.
    act(() => result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(result.current.moveCount).toBe(2));
    act(() => result.current.submitMove({ cell: 1 }));
    await waitFor(() => expect(result.current.moveCount).toBe(4));
    act(() => result.current.submitMove({ cell: 2 }));

    await waitFor(() => expect(result.current.status.kind).toBe("won"));
    expect(requests.every((r) => r.soften === true)).toBe(true);
    expect(requests).toHaveLength(2);

    const second = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "soften-seed-2",
        humanSeat: 0,
        persist: false,
        botDriver: recordingDriver,
      })
    );
    act(() => second.result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]?.soften).toBe(false);
  });

  it("never sends soften:true in daily mode, even on the device's first game", async () => {
    const requests: BotMoveRequest[] = [];
    const recordingDriver: BotDriver = {
      chooseMove(req) {
        requests.push(req);
        return Promise.resolve({ move: { cell: 4 } });
      },
      cancel() {},
      dispose() {},
    };

    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "daily-soften-seed",
        humanSeat: 0,
        persist: false,
        tierId: "ruthless",
        daily: { day: "2026-08-03", dayNumber: 1 },
        botDriver: recordingDriver,
      })
    );

    act(() => result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.soften).toBe(false);
  });
});

describe("useGame — daily mode budget assertion", () => {
  it("throws when the resolved tier's budget kind is not `rollouts`", () => {
    expect(() =>
      renderHook(() =>
        useGame({
          definition: tttDefinition,
          mode: "solo-bot",
          seed: "s",
          tierId: "standard", // deadlineMs budget in the fixture manifest
          daily: { day: "2026-08-03", dayNumber: 1 },
          botDriver: scriptedBotDriver([]),
        })
      )
    ).toThrow();
  });

  it("does not throw when the resolved tier's budget kind is `rollouts`", () => {
    expect(() =>
      renderHook(() =>
        useGame({
          definition: tttDefinition,
          mode: "solo-bot",
          seed: "s",
          tierId: "ruthless", // rollouts budget in the fixture manifest
          daily: { day: "2026-08-03", dayNumber: 1 },
          botDriver: scriptedBotDriver([]),
        })
      )
    ).not.toThrow();
  });

  it("reports canUndo === false whenever daily is set, even in solo-bot mode", () => {
    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "s",
        tierId: "ruthless",
        daily: { day: "2026-08-03", dayNumber: 1 },
        botDriver: scriptedBotDriver([{ cell: 4 }]),
      })
    );
    act(() => result.current.submitMove({ cell: 0 }));
    expect(result.current.canUndo).toBe(false);
  });
});

describe("useGame — cancels the in-flight bot request on undo", () => {
  it("calls driver.cancel() with the pending requestId when undo() is invoked mid-flight", async () => {
    let capturedRequestId: string | undefined;
    const cancel = vi.fn();
    const neverResolvingDriver: BotDriver = {
      chooseMove(req) {
        capturedRequestId = req.requestId;
        return new Promise(() => {}); // never settles on its own
      },
      cancel,
      dispose() {},
    };

    const { result } = renderHook(() =>
      useGame({
        definition: tttDefinition,
        mode: "solo-bot",
        seed: "cancel-seed",
        humanSeat: 0,
        persist: false,
        botDriver: neverResolvingDriver,
      })
    );

    act(() => result.current.submitMove({ cell: 0 }));
    await waitFor(() => expect(result.current.botThinking).toBe(true));

    act(() => result.current.undo());

    expect(cancel).toHaveBeenCalledWith(capturedRequestId);
    expect(result.current.botThinking).toBe(false);
  });
});

describe("useGame — solo-single mode", () => {
  it("never dispatches a bot and reflects the single seat's own moves", () => {
    const { result } = renderHook(() =>
      useGame({
        definition: crackstepDefinition,
        mode: "solo-single",
        seed: "solo-seed",
        persist: false,
      })
    );
    expect(result.current.activeSeat).toBe(0);
    expect(result.current.botThinking).toBe(false);

    act(() => result.current.submitMove({ to: 1 }));

    expect(result.current.moveCount).toBe(1);
    expect(result.current.view.pos).toBe(1);
    expect(result.current.activeSeat).toBe(0);
    expect(result.current.botThinking).toBe(false);
  });
});

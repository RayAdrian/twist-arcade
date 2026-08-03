import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { RegistryEntry } from "@twist-arcade/game-spec";
import { GameShell } from "../src/components/GameShell";
import { scriptedBotDriver, type BotDriver } from "../src/bot-driver";
import { tttDefinition, tttManifest } from "./fixtures/ttt-definition";
import { secretPickDefinition, secretPickManifest } from "./fixtures/secret-pick";

// plan §4.1: GameShell composed. Loads manifest sync, engine+presentation async (dynamic
// import behind the registry seam). States: loading (skeleton) / load-error (Retry / Back to
// library, never a blank board) / ready / finished (ResultModal over the dimmed board).

function makeRegistryEntry(opts: { failTimes?: number } = {}): RegistryEntry {
  let attempts = 0;
  return {
    manifest: tttManifest,
    async loadEngine() {
      attempts += 1;
      if (opts.failTimes && attempts <= opts.failTimes) throw new Error("network error");
      return tttDefinition.engine;
    },
    async loadPresentation() {
      return tttDefinition.presentation;
    },
  };
}

function firstCellButton() {
  // The ttt fixture Board renders shell Cells; the empty top-left cell is always legal on turn 1.
  return screen.getAllByRole("gridcell")[0]!;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GameShell — loading and error states", () => {
  it("renders the manifest's rule sentence immediately, before the async load resolves", () => {
    const registryEntry = makeRegistryEntry();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    expect(screen.getByText(tttManifest.ruleSentence)).toBeInTheDocument();
  });

  it("never renders a blank board on load failure — shows Retry / Back to library instead", async () => {
    const registryEntry = makeRegistryEntry({ failTimes: 99 });
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to library/i })).toBeInTheDocument();
  });

  it("Retry re-attempts loading and reaches the ready state once it succeeds", async () => {
    const registryEntry = makeRegistryEntry({ failTimes: 1 });
    const user = userEvent.setup();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
  });
});

describe("GameShell — ready state, solo-bot", () => {
  it("commits a move by clicking a cell, and the bot's scripted reply lands automatically", async () => {
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 4 }])}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });

    await waitFor(() => {
      const cells = screen.getAllByRole("gridcell");
      expect(cells[0]?.textContent).toBe("X");
      expect(cells[4]?.textContent).toBe("O");
    });
  });

  it("hides Undo before any move, and shows it after one (solo-bot, non-daily)", async () => {
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 4 }])}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();

    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument());
  });

  it("opens HowSheet with the rule sentence and frames on 'How?'", async () => {
    const registryEntry = makeRegistryEntry();
    const user = userEvent.setup();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    await user.click(screen.getAllByRole("button", { name: /how/i })[0]!);
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("hides Undo entirely in daily mode even after a move (orchestrator addendum §15.3)", async () => {
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        tierId="ruthless"
        daily={{ day: "2026-08-03", dayNumber: 1 }}
        botDriver={scriptedBotDriver([{ cell: 4 }])}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });
    await waitFor(() => expect(screen.getAllByRole("gridcell")[0]?.textContent).toBe("X"));
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("has no axe violations once ready", async () => {
    const registryEntry = makeRegistryEntry();
    const { container } = render(
      <GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("GameShell — result modal", () => {
  it("opens the ResultModal (with Rematch) after a terminal status, and Rematch starts a fresh game", async () => {
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 3 }, { cell: 5 }])}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    async function clickCell(index: number) {
      const cell = screen.getAllByRole("gridcell")[index]!;
      await act(async () => {
        cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        cell.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
      });
    }

    // Human wins top row: 0, 1, 2; bot replies 3, then 5. Each bot landing sets the 250ms input
    // lockout (plan §7) — real waits (not fake timers) past it between clicks, exactly like a
    // human player who takes a moment to look at the board before their next tap.
    await clickCell(0);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(1);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(2);

    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument(), { timeout: 2000 });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rematch" }));

    await waitFor(() => {
      const cells = screen.getAllByRole("gridcell");
      expect(cells.every((c) => c.textContent === "")).toBe(true);
    });
  });
});

describe("GameShell — bot driver failure shows a retryable error, never a silent hang (C2)", () => {
  it("shows Retry in the StatusLine region after a bot failure, and clicking it recovers (bot lands its move)", async () => {
    let callCount = 0;
    const flakyDriver: BotDriver = {
      chooseMove() {
        callCount += 1;
        if (callCount === 1) return Promise.reject(new Error("bot backend unavailable"));
        return Promise.resolve({ move: { cell: 4 } });
      },
      cancel() {},
      dispose() {},
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={flakyDriver}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });

    // The board must stay legally inert (never a hang) but a Retry affordance must appear —
    // not silence, not a stuck "Bot is thinking…" forever.
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(retryButton);

    await waitFor(() => expect(screen.getAllByRole("gridcell")[4]?.textContent).toBe("O"));
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();

    errorSpy.mockRestore();
  });
});

describe("GameShell — hotseat, hidden-information handoff", () => {
  function secretRegistryEntry(): RegistryEntry {
    return {
      manifest: secretPickManifest,
      async loadEngine() {
        return secretPickDefinition.engine;
      },
      async loadPresentation() {
        return secretPickDefinition.presentation;
      },
    };
  }

  it("shows the blocking PassDeviceInterstitial after a move, and confirming it hands control to the next seat", async () => {
    const registryEntry = secretRegistryEntry();
    const user = userEvent.setup();
    render(
      <GameShell
        gameId={secretPickManifest.id}
        registryEntry={registryEntry}
        manifests={[secretPickManifest]}
        mode="hotseat"
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(1));

    const passCell = screen.getAllByRole("gridcell")[0]!;
    await act(async () => {
      passCell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      passCell.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });

    // secretPickEngine is hiddenInformation: true, so the handoff blocks until confirmed —
    // the board must not be actionable again until the next player says "show board".
    const confirmButton = await screen.findByRole("button", { name: /player 2 — show board/i });
    expect(confirmButton).toBeInTheDocument();

    await user.click(confirmButton);

    await waitFor(() => expect(screen.queryByRole("button", { name: /show board/i })).toBeNull());
  });
});

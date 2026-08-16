import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { BoardProps, GameDefinition, RegistryEntry } from "@twist-arcade/game-spec";
import type { TTTMove, TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
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

  it("wires a 'Describe board' control to describeBoard() — the plan §6.2 readback-on-request affordance (I6)", async () => {
    const registryEntry = makeRegistryEntry();
    const user = userEvent.setup();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    await user.click(screen.getByRole("button", { name: /describe board/i }));

    // describeBoard() composes a boardSummary readback into the polite live region — an empty
    // fresh board has 0 marks per the ttt fixture's own announce() (see ttt-definition.tsx).
    await waitFor(() => expect(screen.getByText(/board has 0 marks\./i)).toBeInTheDocument());
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

  it("Describe board after game end does NOT re-fire the terminal assertive announcement (I7/describeBoard regression)", async () => {
    // Stage-6 re-review: describeBoard() spread `...cur.announcement` forward, carrying the
    // still-populated terminal `assertive` text ("Player 0 won.") into a brand-new announcement
    // object. That object is AriaAnnouncer's I7 `token`, so the identity change plus identical
    // non-empty assertive text is exactly the "repeat this verbatim" signal I7 exists to force
    // through — re-interrupting a screen-reader user's polite readback with "You won" again,
    // every time they press "Describe board" after the game has ended. describeBoard() is a
    // POLITE-only readback and must never touch the assertive channel.
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

    await clickCell(0);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(1);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(2);

    // Terminal status lands: the assertive live region carries the win announcement.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/won/i));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /describe board/i }));

    // The polite region gets the fresh boardSummary readback...
    await waitFor(() => expect(screen.getByText(/board has \d+ marks\./i)).toBeInTheDocument());
    // ...but the assertive region must be cleared, not re-populated with the stale "won" text.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("renders 'Next twist' as a real navigable link to the suggested game's canonical route (C4)", async () => {
    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest, secretPickManifest]}
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
    await clickCell(0);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(1);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(2);

    const link = await screen.findByRole("link", { name: /Next:.*Fixture Secret Pick/ });
    expect(link).toHaveAttribute("href", `/play/${secretPickManifest.id}`);
  });

  it("Share degrades to the failed state instead of crashing when the game's own shareArtifact() body is malformed (I4)", async () => {
    // A >7-total-line shareArtifact() body is a bug in a GAME's presentation, not something the
    // player caused — composeShareArtifact() throws ShareFrameTooLongError for it. Uncaught,
    // this crashed the Share button (an unhandled promise rejection, no UI feedback at all).
    const overLongPresentation = {
      ...tttDefinition.presentation,
      shareArtifact: () => "l1\nl2\nl3\nl4\nl5\nl6", // 6 lines + header + url > 7 total
    };
    const registryEntry: RegistryEntry = {
      manifest: tttManifest,
      async loadEngine() {
        return tttDefinition.engine;
      },
      async loadPresentation() {
        return overLongPresentation;
      },
    };
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
    await clickCell(0);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(1);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(2);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: /Share/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Share/ }));

    await waitFor(() => expect(screen.getByText(/Couldn't share.*long-press to copy/)).toBeInTheDocument());
    // Falls back to at least the raw artifact body (composeShareArtifact itself couldn't be
    // built at all) — the textarea must still show SOMETHING, never be empty.
    expect(screen.getByRole("textbox", { name: "Share text" })).toHaveValue("l1\nl2\nl3\nl4\nl5\nl6");
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

describe("GameShell — hotseat, OPEN-information turn banner (C3)", () => {
  it("renders a non-blocking turn banner naming the now-presenting player, input stays enabled", async () => {
    const registryEntry = makeRegistryEntry();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="hotseat" />);
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });

    // Non-blocking: no "show board" confirm gate (that's the hidden-information variant only).
    expect(await screen.findByText(/pass the device to player 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show board/i })).toBeNull();

    // Input stays enabled — the next player can move immediately, no confirm step required.
    const secondCell = screen.getAllByRole("gridcell")[1]!;
    expect(secondCell).not.toHaveAttribute("aria-disabled", "true");

    // The StatusLine AND the live region (AriaAnnouncer) both carry the actor-named turn phrase
    // — not "Your move." to both players indiscriminately (the underlying bug this banner fix
    // also corrects). Both surfaces render the phrase, hence getAllByText, not getByText.
    expect(screen.getAllByText(/player 2's move\./i).length).toBeGreaterThan(0);
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

describe("GameShell — board prefs.theme derives from the ACTUALLY APPLIED theme (I9)", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("reports 'dark' when the .dark class is applied, even though prefers-color-scheme itself reports light (an explicit ta:settings.theme override — layout.tsx's own precedence, tokens.css's theme bootstrap)", async () => {
    // Simulates layout.tsx's theme-bootstrap script having already applied an EXPLICIT
    // ta:settings.theme override that disagrees with the OS preference — the applied .dark
    // class is the source of truth the board must match, not a fresh, independent
    // prefers-color-scheme read that ignores the override entirely.
    document.documentElement.classList.add("dark");
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, // the OS itself prefers LIGHT — .dark above is the explicit override
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const themeProbePresentation = {
      ...tttDefinition.presentation,
      Board: ({ prefs }: BoardProps<TTTState, TTTMove>) => <div data-testid="theme-probe">{prefs.theme}</div>,
    };
    const registryEntry: RegistryEntry = {
      manifest: tttManifest,
      async loadEngine() {
        return tttDefinition.engine;
      },
      async loadPresentation() {
        return themeProbePresentation;
      },
    };

    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);

    await waitFor(() => expect(screen.getByTestId("theme-probe")).toHaveTextContent("dark"));
    window.matchMedia = originalMatchMedia;
  });
});

describe("GameShell — hotseat Restart confirms after just ONE move (I10, orchestrator ruling)", () => {
  it("confirms hotseat Restart once moveCount >= 1 — destroying a two-player game with one accidental tap is the stronger case for a guard", async () => {
    const registryEntry = makeRegistryEntry();
    const user = userEvent.setup();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="hotseat" />);
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));

    // Before any move: no confirm needed (nothing to lose yet) — Restart fires immediately.
    await user.click(screen.getByRole("button", { name: /restart/i }));
    expect(screen.queryByText("Restart?")).toBeNull();

    // One move in: hotseat's own ruling is >= 1, NOT the solo >= 3 threshold.
    await act(async () => {
      firstCellButton().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      firstCellButton().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
    });
    await waitFor(() => expect(screen.getAllByRole("gridcell")[0]?.textContent).toBe("X"));

    await user.click(screen.getByRole("button", { name: /restart/i }));
    expect(screen.getByText("Restart?")).toBeInTheDocument();
  });

  it("solo-bot Restart still uses the >= 3 threshold, unaffected by the hotseat ruling", async () => {
    const registryEntry = makeRegistryEntry();
    const user = userEvent.setup();
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
    await waitFor(() => expect(screen.getAllByRole("gridcell")[4]?.textContent).toBe("O"));

    // Only 2 total moves so far (human + bot) — solo's threshold is >= 3, so no confirm yet.
    await user.click(screen.getByRole("button", { name: /restart/i }));
    expect(screen.queryByText("Restart?")).toBeNull();
  });
});

describe("GameShell — restart count in the share text is gated to daily/solo contexts (minor)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits the restart line entirely for a casual (non-daily) solo-bot rematch — restartCount reflects 'hit Rematch', not a meaningful retry signal there", async () => {
    // userEvent.setup() installs its OWN navigator.clipboard stub (for keyboard copy/paste
    // emulation) unconditionally — calling it AFTER vi.stubGlobal("navigator", ...) below would
    // silently clobber this test's clipboard mock, so the spy never sees the Share click's write.
    // Setup first, THEN stub navigator, so this test's mock is the one still standing.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 3 }, { cell: 5 }, { cell: 3 }, { cell: 5 }])}
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
    async function winTopRow() {
      await clickCell(0);
      await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
      await new Promise((resolve) => setTimeout(resolve, 260));
      await clickCell(1);
      await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
      await new Promise((resolve) => setTimeout(resolve, 260));
      await clickCell(2);
    }

    await winTopRow();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Rematch" })); // restartCount -> 1
    await waitFor(() => expect(screen.getAllByRole("gridcell").every((c) => c.textContent === "")).toBe(true));

    await winTopRow();
    await waitFor(() => expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).not.toMatch(/restart/i);
  });

  it("defaults the shared URL to an absolute, site-origin-qualified path — never a bare '/play/{id}' (C91: plan §4.4's literal artifacts are domain-qualified, e.g. 'twistarcade.game/d/fadeout')", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 3 }, { cell: 5 }, { cell: 3 }, { cell: 5 }])}
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
    await clickCell(0);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(1);
    await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await clickCell(2);

    await waitFor(() => expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // jsdom's default test origin is "http://localhost:3000" (matching .env.example's own
    // NEXT_PUBLIC_SITE_URL default) — getSiteUrl() falls back to it here since this suite never
    // stubs NEXT_PUBLIC_SITE_URL. The point under test is "origin-qualified", not the exact host.
    expect(writeText.mock.calls[0]?.[0]).toMatch(new RegExp(`https?://[^\\s/]+/play/${tttManifest.id}$`, "m"));
  });

  it("still includes the attempt count (inline on the header, C8) for a daily game (orchestrator addendum §15.3 — comparability is sacred, even in a casual-shaped mode)", async () => {
    // See the identical note in the test above: userEvent.setup() must run BEFORE
    // vi.stubGlobal("navigator", ...) or its own clipboard stub silently wins.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const registryEntry = makeRegistryEntry();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntry}
        manifests={[tttManifest]}
        mode="solo-bot"
        tierId="ruthless"
        daily={{ day: "2026-08-03", dayNumber: 1 }}
        botDriver={scriptedBotDriver([{ cell: 3 }, { cell: 5 }, { cell: 3 }, { cell: 5 }])}
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
    async function winTopRow() {
      await clickCell(0);
      await waitFor(() => expect(screen.getAllByRole("gridcell")[3]?.textContent).toBe("O"));
      await new Promise((resolve) => setTimeout(resolve, 260));
      await clickCell(1);
      await waitFor(() => expect(screen.getAllByRole("gridcell")[5]?.textContent).toBe("O"));
      await new Promise((resolve) => setTimeout(resolve, 260));
      await clickCell(2);
    }

    await winTopRow();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Rematch" })); // restartCount -> 1
    await waitFor(() => expect(screen.getAllByRole("gridcell").every((c) => c.textContent === "")).toBe(true));

    await winTopRow();
    await waitFor(() => expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // C8: the restart count is no longer a separate "N restart(s)" line — it's inline on the
    // header as "· attempt {restarts + 1}" (restartCount 1 -> attempt 2), matching the
    // plan-binding grammar (packages/daily's composeShareText) rather than shell's old format.
    expect(writeText.mock.calls[0]?.[0]).toMatch(/attempt 2/i);
    expect(writeText.mock.calls[0]?.[0]).not.toMatch(/restart/i);
  });
});

describe("GameShell — extraControls (Mine Run's BankBar seam: a game-owned control block below the grid)", () => {
  // mine-run.md §8.1: "directly below [the grid] the BankBar — the game's one custom control."
  // BoardShell's CSS grid cannot safely host a non-cell child (it would become an 11th grid
  // item and risk an ARIA "row" violation), so this is a NEW, additive, optional presentation
  // slot rendered as a SIBLING immediately after BoardShell and before ControlsRow — never
  // inside it. Every existing game (ttt fixture, Fadeout, Crackstep) simply omits it.
  function ExtraControls({ view, onMove }: BoardProps<TTTState, TTTMove>) {
    return (
      <button type="button" onClick={() => onMove({ cell: 0 })}>
        Extra control ({view.board.filter((c) => c !== null).length} marks)
      </button>
    );
  }

  function withExtraControls(): GameDefinition<TTTState, TTTMove, TTTState> {
    return {
      ...tttDefinition,
      presentation: { ...tttDefinition.presentation, extraControls: ExtraControls },
    };
  }

  function registryEntryWithExtraControls(): RegistryEntry {
    const definition = withExtraControls();
    return {
      manifest: definition.manifest,
      async loadEngine() {
        return definition.engine;
      },
      async loadPresentation() {
        return definition.presentation;
      },
    };
  }

  it("renders the game's extraControls block once the game is ready", async () => {
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntryWithExtraControls()}
        manifests={[tttManifest]}
        mode="solo-bot"
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    expect(screen.getByRole("button", { name: /extra control \(0 marks\)/i })).toBeInTheDocument();
  });

  it("extraControls' onMove submits a real move through the same path a Board cell would", async () => {
    const user = userEvent.setup();
    render(
      <GameShell
        gameId={tttManifest.id}
        registryEntry={registryEntryWithExtraControls()}
        manifests={[tttManifest]}
        mode="solo-bot"
        botDriver={scriptedBotDriver([{ cell: 4 }])}
      />
    );
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    await user.click(screen.getByRole("button", { name: /extra control/i }));
    await waitFor(() => expect(screen.getAllByRole("gridcell")[0]?.textContent).toBe("X"));
  });

  it("omitting extraControls (every other game) renders nothing extra and never throws", async () => {
    const registryEntry = makeRegistryEntry();
    render(<GameShell gameId={tttManifest.id} registryEntry={registryEntry} manifests={[tttManifest]} mode="solo-bot" />);
    await waitFor(() => expect(screen.getAllByRole("gridcell").length).toBe(9));
    expect(screen.queryByRole("button", { name: /extra control/i })).toBeNull();
  });
});

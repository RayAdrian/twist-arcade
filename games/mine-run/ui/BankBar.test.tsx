// @vitest-environment jsdom
//
// games/mine-run/ui/BankBar.test.tsx — TDD (CLAUDE.md §3) for the bank/continue decision UI
// (mine-run.md §8.1): the game's one custom control, wired via GamePresentation.extraControls.
// Consolidates the HUD row (mine counts, revealsLeft — lens §1.7's "informed odds") with the
// at-risk streak chip, the vault chip, and the Bank button itself, since `extraControls` is a
// single additive slot rendered once, below the board (see that field's own doc comment in
// packages/game-spec/src/presentation.ts for why it can't literally split above/below the grid).

import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MineRunMove, MineRunView } from "../engine";
import { BankBar } from "./BankBar";

function makeView(overrides: Partial<MineRunView> = {}): MineRunView {
  return {
    width: 10,
    height: 10,
    cells: {},
    minesTotal: 20,
    minesExploded: 2,
    streakLen: 0,
    streakValue: 0,
    nextGain: 1,
    banked: 96,
    revealsLeft: 41,
    lastEffects: [],
    ...overrides,
  };
}

function renderBar(
  view: MineRunView,
  onMove: (m: MineRunMove) => void = vi.fn(),
  opts?: { reducedMotion?: boolean }
) {
  return render(
    <BankBar
      view={view}
      legal={[]}
      onMove={onMove}
      seat={0}
      prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }}
    />
  );
}

describe("BankBar — the informed-odds HUD line (lens §1.7: mine counts always visible)", () => {
  it("shows the mine count summary and reveals-left, always", () => {
    renderBar(makeView({ minesTotal: 20, minesExploded: 2, revealsLeft: 41 }));
    expect(screen.getByText(/20/)).toBeInTheDocument();
    expect(screen.getByText(/2 hit/)).toBeInTheDocument();
    expect(screen.getByText(/41/)).toBeInTheDocument();
  });
});

describe("BankBar — the at-risk streak chip and vault chip (§8.1: the three numbers the push decision needs)", () => {
  it("shows the live at-risk value and the next gain", () => {
    renderBar(makeView({ streakLen: 7, streakValue: 28, nextGain: 8 }));
    const chip = document.querySelector('[data-at-risk="true"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("28");
    expect(chip!.textContent).toContain("+8 next");
  });

  it("shows the banked (vault) total", () => {
    renderBar(makeView({ banked: 96 }));
    expect(screen.getByText(/banked 96/i)).toBeInTheDocument();
  });
});

describe("BankBar — the Bank button (R6: bank requires streakLen >= 1, costs no budget)", () => {
  it("is disabled and reads 'Bank' at streak 0", () => {
    renderBar(makeView({ streakLen: 0, streakValue: 0 }));
    const button = screen.getByRole("button", { name: /^Bank$/ });
    expect(button).toBeDisabled();
  });

  it("is enabled and reads 'Bank {streakValue}' once a streak exists", () => {
    renderBar(makeView({ streakLen: 3, streakValue: 6 }));
    const button = screen.getByRole("button", { name: "Bank 6" });
    expect(button).not.toBeDisabled();
  });

  it("clicking Bank submits the {t:'bank'} move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderBar(makeView({ streakLen: 3, streakValue: 6 }), onMove);
    await user.click(screen.getByRole("button", { name: "Bank 6" }));
    expect(onMove).toHaveBeenCalledWith({ t: "bank" });
  });

  it("clicking the disabled Bank button at streak 0 never submits a move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderBar(makeView({ streakLen: 0, streakValue: 0 }), onMove);
    await user.click(screen.getByRole("button", { name: /^Bank$/ }));
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("BankBar — the C52 safe-move telegraph (existence only, text-only, never colour alone)", () => {
  it("reads 'No proven-safe move right now.' on a view with nothing revealed yet", () => {
    renderBar(makeView({ cells: {} }));
    expect(screen.getByText("No proven-safe move right now.")).toBeInTheDocument();
    expect(document.querySelector('[data-safe-move-status="none"]')).not.toBeNull();
  });

  it("reads 'A safe move is available.' when a revealed 0-count cell forces a neighbor safe", () => {
    // 10x10 view, corner cell 0 revealed at n=0 -> its neighbors (1, 10, 11) are provably safe;
    // 20 mines have 96 other unrevealed background cells to occupy (internally consistent).
    renderBar(makeView({ cells: { 0: { n: 0 } } }));
    expect(screen.getByText("A safe move is available.")).toBeInTheDocument();
    expect(document.querySelector('[data-safe-move-status="available"]')).not.toBeNull();
  });
});

describe("BankBar — bank/wipe narration (mine-run.md §8.2): static content always, animation gated on reduced motion (A11Y-008)", () => {
  it("a just-banked move shows the vault total both under full motion and reduced motion (static content, motion-independent)", () => {
    const bankedEffects: MineRunView["lastEffects"] = [{ type: "banked", points: 28 }];
    renderBar(makeView({ banked: 96, lastEffects: bankedEffects }), vi.fn(), { reducedMotion: false });
    expect(screen.getByText(/banked 96/i)).toBeInTheDocument();
  });

  it("a just-banked move plays the bank-slide animation under FULL motion", () => {
    const bankedEffects: MineRunView["lastEffects"] = [{ type: "banked", points: 28 }];
    renderBar(makeView({ banked: 96, lastEffects: bankedEffects }), vi.fn(), { reducedMotion: false });
    const vault = document.querySelector('[data-vault="true"]') as HTMLElement;
    expect(vault.style.animation).toContain("mine-run-bank-slide");
  });

  it("a just-banked move has NO animation under reduced motion — the static vault number still updates (A11Y-008)", () => {
    const bankedEffects: MineRunView["lastEffects"] = [{ type: "banked", points: 28 }];
    renderBar(makeView({ banked: 96, lastEffects: bankedEffects }), vi.fn(), { reducedMotion: true });
    const vault = document.querySelector('[data-vault="true"]') as HTMLElement;
    expect(vault.style.animation).toBe("");
    expect(screen.getByText(/banked 96/i)).toBeInTheDocument();
  });

  it("a just-wiped move shows a static '-N' note under BOTH motion preferences, and only animates under full motion", () => {
    const explodedEffects: MineRunView["lastEffects"] = [{ type: "exploded", cell: 5, streakLost: 28 }];

    renderBar(makeView({ streakLen: 0, streakValue: 0, lastEffects: explodedEffects }), vi.fn(), { reducedMotion: false });
    expect(screen.getByText("−28")).toBeInTheDocument();
    const wipedFull = document.querySelector('[data-just-wiped="true"]') as HTMLElement;
    expect(wipedFull.style.animation).toContain("mine-run-wipe-drain");
    cleanup();

    renderBar(makeView({ streakLen: 0, streakValue: 0, lastEffects: explodedEffects }), vi.fn(), { reducedMotion: true });
    expect(screen.getByText("−28")).toBeInTheDocument();
    const wipedReduced = document.querySelector('[data-just-wiped="true"]') as HTMLElement;
    expect(wipedReduced.style.animation).toBe("");
  });

  it("no bank/wipe effect in lastEffects -> no animated span rendered at all", () => {
    renderBar(makeView({ lastEffects: [] }));
    expect(document.querySelector('[data-just-wiped="true"]')).toBeNull();
  });
});

describe("BankBar — 'B' bonus-binds Bank (mine-run.md §8.4)", () => {
  it("pressing 'b' submits a bank move when a streak is live", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderBar(makeView({ streakLen: 3, streakValue: 6 }), onMove);
    await user.keyboard("b");
    expect(onMove).toHaveBeenCalledWith({ t: "bank" });
  });

  it("pressing 'b' at streak 0 does nothing (nothing to bank)", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderBar(makeView({ streakLen: 0, streakValue: 0 }), onMove);
    await user.keyboard("b");
    expect(onMove).not.toHaveBeenCalled();
  });
});

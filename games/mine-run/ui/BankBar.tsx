// games/mine-run/ui/BankBar.tsx — the bank/continue decision (mine-run.md §8.1). Mine Run's one
// custom control, wired via GamePresentation.extraControls (packages/game-spec's additive
// slot): rendered as a sibling immediately after the board, never inside BoardShell's grid.
//
// Consolidates, in one component: the informed-odds HUD line (mine count + reveals left — lens
// §1.7: the odds are always on screen, never a guessing game about how many mines exist at
// all), the at-risk streak chip, the vault (banked) chip, and the Bank button. §8.1 puts these
// three numbers ADJACENT to the button that resolves the decision on purpose — the push/bank
// tension IS the game, and every number the decision needs is right here.
//
// "use client" — a keydown listener ('B' bonus-binds Bank, §8.4) and an onClick handler.
"use client";

import { useEffect } from "react";
import type { BoardProps } from "@twist-arcade/game-spec";
import type { MineRunMove, MineRunView } from "../engine";
import { mineCountSummary } from "./board-view";

export function BankBar({ view, onMove }: BoardProps<MineRunView, MineRunMove>) {
  const canBank = view.streakLen >= 1;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!canBank) return;
      if (e.key.toLowerCase() !== "b") return;
      // Never hijack a genuine text-entry context (none exist in this game today, but this is
      // the same defensive posture ControlsRow's own Ctrl/Z binding doesn't need to take since
      // it's a modifier combo; a bare letter key needs it).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      onMove({ t: "bank" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canBank, onMove]);

  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <p className="text-center text-sm text-ink">
        {mineCountSummary(view)} <span aria-hidden="true">{"·"}</span> {view.revealsLeft} reveal
        {view.revealsLeft === 1 ? "" : "s"} left
      </p>
      <div className="flex items-center gap-3">
        {/* At-risk chip: dashed/unsecured outline (never color alone — §8.4) so the STAKE reads
            visually distinct from the vault's solid, secured outline below. */}
        <span
          data-at-risk="true"
          className="rounded border border-dashed border-ink-muted px-3 py-1.5 text-sm text-ink"
        >
          {view.streakValue} <span aria-hidden="true">{"·"}</span> +{view.nextGain} next
        </span>

        <button
          type="button"
          onClick={() => onMove({ t: "bank" })}
          disabled={!canBank}
          className="rounded border border-ink px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:border-ink-muted disabled:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {canBank ? `Bank ${view.streakValue}` : "Bank"}
        </button>

        <span data-vault="true" className="rounded border border-solid border-ink px-3 py-1.5 text-sm text-ink">
          banked {view.banked}
        </span>
      </div>
    </div>
  );
}

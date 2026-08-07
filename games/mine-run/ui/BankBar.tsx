// games/mine-run/ui/BankBar.tsx — the bank/continue decision (mine-run.md §8.1). Mine Run's one
// custom control, wired via GamePresentation.extraControls (packages/game-spec's additive
// slot): rendered as a sibling immediately after the board, never inside BoardShell's grid.
//
// Consolidates, in one component: the informed-odds HUD line (mine count + reveals left — lens
// §1.7: the odds are always on screen, never a guessing game about how many mines exist at
// all), the at-risk streak chip, the vault (banked) chip, the Bank button, and (C52's finding)
// a "safe move available" telegraph. §8.1 puts the three decision numbers ADJACENT to the
// button that resolves the decision on purpose — the push/bank tension IS the game, and every
// number the decision needs is right here.
//
// THE SAFE-MOVE TELEGRAPH (platform-corrections.md C52, orchestrator brief): the exact three-leg
// kill standard found that on the MAJORITY of boards, optimal play and always-banking return the
// identical value — the whole skill edge lives in a minority of boards where pushing genuinely
// pays. An interface that presents every single turn as an agonising gamble misrepresents that
// shape and exhausts the player. `hasProvenSafeMove` (board-view.ts) reports only EXISTENCE, not
// location — a player still has to find the safe cell (the deduction skill mine-run.md §2 wants
// preserved); this only tells them whether this turn's decision is live at all. Text, not colour
// (§8.4's "never colour alone").
//
// BANK/WIPE NARRATION (mine-run.md §8.2, C5): the vault total and the at-risk value are the
// STATIC encodings — always correct, always visible, regardless of motion preference. The
// slide/drain below only RESTATES a change those numbers already show; it is skipped outright
// under `prefs.reducedMotion` (A11Y-008), and the wipe's "-N" note is a real DOM string in both
// cases (grayscale + reduced-motion safe), only its transition timing differs.
//
// "use client" — a keydown listener ('B' bonus-binds Bank, §8.4), an onClick handler, and the
// one-shot CSS keyframe injection below (games/tilt/ui/Board.tsx's own documented pattern; C5:
// plain CSS `@keyframes` only, no animation library, injected once via a module-scope guard).
"use client";

import { useEffect } from "react";
import type { BoardProps } from "@twist-arcade/game-spec";
import type { MineRunMove, MineRunView } from "../engine";
import { hasProvenSafeMove, mineCountSummary } from "./board-view";

const KEYFRAMES = `
@keyframes mine-run-bank-slide {
  0% { transform: scale(1.35); opacity: 0.55; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes mine-run-wipe-drain {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(6px); }
}`;

function injectKeyframesOnce(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("mine-run-bankbar-keyframes")) return;
  const style = document.createElement("style");
  style.id = "mine-run-bankbar-keyframes";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function numberField(effects: MineRunView["lastEffects"], type: string, field: string): number | undefined {
  for (const e of effects) {
    if (e.type !== type) continue;
    const v = e[field];
    if (typeof v === "number") return v;
  }
  return undefined;
}

export function BankBar({ view, onMove, prefs }: BoardProps<MineRunView, MineRunMove>) {
  const canBank = view.streakLen >= 1;

  useEffect(() => {
    injectKeyframesOnce();
  }, []);

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

  // Per-move token (Tilt/Nine Grids' own technique — see BankBar.tsx's module doc): forces the
  // animated spans to REMOUNT exactly once per move, so a CSS `animation` (which only plays on
  // mount/property-change, not on a value simply differing between renders) replays every time
  // lastEffects changes to a new bank/wipe, and never replays on an unrelated re-render.
  const moveToken = view.lastEffects.length > 0 ? JSON.stringify(view.lastEffects) : "opening";
  const justBankedPoints = numberField(view.lastEffects, "banked", "points");
  const justWipedAmount = numberField(view.lastEffects, "exploded", "streakLost");
  const pulseBank = justBankedPoints !== undefined && !prefs.reducedMotion;
  const pulseWipe = justWipedAmount !== undefined && justWipedAmount > 0 && !prefs.reducedMotion;

  const safeMoveExists = hasProvenSafeMove(view);

  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <p className="text-center text-sm text-ink">
        {mineCountSummary(view)} <span aria-hidden="true">{"·"}</span> {view.revealsLeft} reveal
        {view.revealsLeft === 1 ? "" : "s"} left
      </p>

      {/* C52 telegraph: existence only, never which cell — see this file's module doc. Text-only
          (§8.4 "never colour alone"), so it is grayscale- and screen-reader-safe by construction. */}
      <p data-safe-move-status={safeMoveExists ? "available" : "none"} className="text-center text-xs text-ink-muted">
        {safeMoveExists ? "A safe move is available." : "No proven-safe move right now."}
      </p>

      <div className="flex items-center gap-3">
        {/* At-risk chip: dashed/unsecured outline (never color alone — §8.4) so the STAKE reads
            visually distinct from the vault's solid, secured outline below. */}
        <span
          key={`at-risk-${moveToken}`}
          data-at-risk="true"
          className="rounded border border-dashed border-ink-muted px-3 py-1.5 text-sm text-ink"
        >
          {view.streakValue} <span aria-hidden="true">{"·"}</span> +{view.nextGain} next
          {justWipedAmount !== undefined && justWipedAmount > 0 && (
            <span
              data-just-wiped="true"
              className="ml-2"
              style={{ animation: pulseWipe ? "mine-run-wipe-drain 400ms ease-out 1" : undefined }}
            >
              {"−"}
              {justWipedAmount}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={() => onMove({ t: "bank" })}
          disabled={!canBank}
          className="rounded border border-ink px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:border-ink-muted disabled:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {canBank ? `Bank ${view.streakValue}` : "Bank"}
        </button>

        <span
          key={`vault-${moveToken}`}
          data-vault="true"
          className="rounded border border-solid border-ink px-3 py-1.5 text-sm text-ink"
          style={{ display: "inline-block", animation: pulseBank ? "mine-run-bank-slide 300ms ease-out 1" : undefined }}
        >
          banked {view.banked}
        </span>
      </div>
    </div>
  );
}

// packages/shell/src/components/ControlsRow.tsx — plan §4.9. Undo (solo only) · Restart ·
// How? · [game-specific extras]. Undo is HIDDEN, not greyed, where unavailable (hotseat,
// daily solo puzzle, Phase-2 multiplayer — ux-lens §1). Ctrl/Cmd+Z bonus binding when Undo is
// visible. Restart confirms inline (AlertDialog) only when the caller says to
// (`confirmRestart` — solo, >=3 moves on the board; never at a terminal state, since that
// restart is really "rematch" and must stay fast).
//
// "use client" — hooks + click handlers (see board-context.tsx's comment).
"use client";

import { type ReactNode, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

export interface ControlsRowProps {
  canUndo: boolean;
  onUndo?: () => void;
  onRestart(): void;
  onHow(): void;
  /** True: Restart opens an inline "Restart? This game will be lost" confirm first. */
  confirmRestart?: boolean;
  /** Disables Undo/Restart during the 250ms post-state-change input lockout — How? stays
   *  enabled (it never touches game state). */
  disabled?: boolean;
  extras?: ReactNode;
}

// UI direction §3 "Everything else" + the wireframe's Controls row: h-12 print-shop buttons
// (2px ink border, rounded-xl, print shadow 2px 2px 0) that physically press INTO the paper on
// activation (Move 2 — translate(2px,2px) + shadow collapses to 1px 1px 0; this is a
// non-animated state change per §1.2, exempt from motion gating, so it needs no animateSafe
// call and stays correct even under reduced motion/no-JS). `flex-1` on the three fixed-anatomy
// buttons gives the "equal flex" sizing the wireframe calls for.
const buttonClass =
  "flex h-12 flex-1 items-center justify-center gap-1 rounded-xl border-ui border-ink bg-paper-lift px-3 text-sm font-medium text-ink shadow-print-2 active:translate-x-0.5 active:translate-y-0.5 active:shadow-print-1 disabled:cursor-not-allowed disabled:border-ink-muted disabled:text-ink-muted disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function ControlsRow({
  canUndo,
  onUndo,
  onRestart,
  onHow,
  confirmRestart,
  disabled,
  extras,
}: ControlsRowProps) {
  useEffect(() => {
    if (!canUndo || !onUndo) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUndo, onUndo]);

  const restartButton = (
    <button type="button" className={buttonClass} disabled={disabled} onClick={confirmRestart ? undefined : onRestart}>
      ⟳ Restart
    </button>
  );

  return (
    <div className="flex items-center justify-center gap-4">
      {canUndo && (
        <button type="button" className={buttonClass} disabled={disabled} onClick={onUndo}>
          ↩ Undo
        </button>
      )}

      {confirmRestart ? (
        <AlertDialog>
          <AlertDialogTrigger asChild disabled={disabled}>
            {restartButton}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Restart?</AlertDialogTitle>
            <AlertDialogDescription>This game will be lost.</AlertDialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel className={buttonClass}>Cancel</AlertDialogCancel>
              <AlertDialogAction className={buttonClass} onClick={onRestart}>
                Restart
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        restartButton
      )}

      <button type="button" className={buttonClass} onClick={onHow}>
        ? How
      </button>

      {extras}
    </div>
  );
}

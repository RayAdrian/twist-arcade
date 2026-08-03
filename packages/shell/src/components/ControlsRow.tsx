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

const buttonClass =
  "rounded px-3 py-2 text-sm text-ink underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

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

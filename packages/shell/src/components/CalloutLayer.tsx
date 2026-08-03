// packages/shell/src/components/CalloutLayer.tsx — plan §4.15 / §6.3: the first-occurrence
// teaching callout ("Aha-callout", ux-lens §1). Anchored non-modal popover, no focus trap, no
// scrim, role="status". Positioned at the cell the game named via BoardContext's cell
// registry (the anchor-resolution convention, plan §6.3): the game returns the same cellId
// string its Board passed to `Cell`; if that id is unregistered (the cell vanished from the
// DOM, or the game handed back something that was never a real cellId), this degrades to the
// board's top edge rather than throwing. `useGame` owns triggering/dismissing (auto-dismiss on
// the next committed move, once-per-device via callouts.ts) — this component only renders
// whatever it's handed and never manages its own open/closed lifecycle beyond that prop.
//
// "use client" — hooks (see board-context.tsx's comment for why this is per-file, not inherited
// from GameShell alone).
"use client";

import type { Json } from "@twist-arcade/engine";
import { useLayoutEffect, useState } from "react";
import { useBoardContext } from "./board-context";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

export interface CalloutLayerProps {
  /** null: nothing pending (or already dismissed) — renders nothing. */
  firstOccurrence: { text: string; anchor: Json } | null;
}

interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function resolveAnchorRect(
  anchor: Json,
  getCellElement: (cellId: string) => HTMLElement | undefined,
  boardEl: HTMLElement | null
): AnchorRect | null {
  const target = typeof anchor === "string" ? getCellElement(anchor) : undefined;
  // Degraded fallback (plan §6.3): unregistered/non-string anchor -> the board's top edge,
  // never a throw. Only give up entirely if there isn't even a board element to fall back to.
  const el = target ?? boardEl;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: target ? rect.width : rect.width, height: target ? rect.height : 0 };
}

export function CalloutLayer({ firstOccurrence }: CalloutLayerProps) {
  const board = useBoardContext();
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const anchor = firstOccurrence?.anchor;

  useLayoutEffect(() => {
    if (!firstOccurrence) {
      setRect(null);
      return;
    }
    setRect(resolveAnchorRect(firstOccurrence.anchor, board.getCellElement, board.boardEl));
    // `board.getCellElement` is intentionally omitted (a new closure every render, over an
    // otherwise-stable registry ref) — but `board.boardEl` is NOT: on first mount it is still
    // null (BoardShell's grid-div ref callback fires during the same commit but its resulting
    // setState lands one render later than this layout effect), so this effect must re-run
    // once boardEl actually arrives, or the fallback path would resolve against a null board
    // forever. Games' Cells registering themselves (also a passive effect) settle before that
    // second pass reaches here, so re-running here also picks up a since-registered anchor.
  }, [firstOccurrence, anchor, board.boardEl]);

  if (!firstOccurrence || !rect) return null;

  return (
    <Popover open modal={false} onOpenChange={() => {}}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        role="status"
        side="top"
        // Never blocks input, never traps focus (plan §4.15): prevent Radix's default
        // open/close focus management from moving focus into or out of the callout at all —
        // it is a status announcement, not an interactive surface.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // No scrim, and outside interaction (a tap on the board itself) must never be
        // intercepted by the callout — `useGame` dismisses it on the next committed move.
        onInteractOutside={(e) => e.preventDefault()}
      >
        {firstOccurrence.text}
      </PopoverContent>
    </Popover>
  );
}

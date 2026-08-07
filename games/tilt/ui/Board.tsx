// games/tilt/ui/Board.tsx — the real Tilt board (docs/plans/tilt.md §6), replacing the scaffold
// placeholder now that T1-T4 are green and reviewed (C15/C28 gate-before-UI satisfied).
//
// GATE STATUS: T2 kill-test sweep (C45) and T4's gate table (C49) both passed on real 100-game
// samples; ciGateBudget.twoPlayerCiRollouts is set with provenance. Authorized for UI.
//
// INTERACTIVE-CELL DESIGN — see ui/board-view.ts's own module doc for the full reasoning: this
// renders the full 7x7 disc grid (49 real Cells, `boardDimensions`={rows:7,cols:7} in index.ts),
// with exactly ONE real, enabled drop target per non-full column (that column's current
// lowest-empty-row), at the STANDARD 48px floor — relying on BoardShell's zoom/pan mechanism
// (Nine Grids' own precedent) rather than plan §12.1's sub-48px/two-tap-commit exception, since
// no cell here ever needs to render below 48px. Flagged for review as a documented deviation
// from §12.1's literal "column strip" framing, not a silent workaround.
//
// JUST-MOVED MARKERS (plan §6.1, load-bearing, reduced-motion's real answer): every cell whose
// disc the most recent re-fall displaced gets a STATIC marker (an outline ring + `data-just-
// moved` attribute), driven directly by `view.lastEffects`'s `moved` entries — present in the
// DOM regardless of motion preference, because it is derived from state, not from an animation.
// The one-shot settle PULSE below only RESTATES that same static fact (C5) and is skipped
// entirely under `prefers-reduced-motion`, mirroring Nine Grids' own send-pulse gate exactly
// (games/nine-grids/ui/Board.tsx) — including the same per-ply React `key` technique (never a
// ref-compared "previous vs current" flag; see that file's module doc for the real, observed
// browser bug that motivated it: a second, unrelated commit erased a ref-based flag before
// paint).
//
// C5: no animation library here — plain CSS `@keyframes` only, injected once. The whole-board
// CW rotation itself is NOT animated in this pass (documented gap, not silently skipped): every
// fact it would narrate (the tilt happened, N pieces resettled, where they ended up) is already
// fully readable statically without it — the settle pulse below narrates only the PER-DISC
// just-moved fact, restating the static marker, never the sole carrier of it.
"use client";

import { useEffect } from "react";
import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { TiltMove, TiltState } from "../engine";
import { SIZE } from "../engine";
import { buildCellPresentations, glyphFor, justMovedCells } from "./board-view";

const TILT_BOARD_LABEL = "Tilt board";

const KEYFRAMES = `
@keyframes tilt-settle-pulse {
  0% { transform: scale(1.35); opacity: 0.55; }
  100% { transform: scale(1); opacity: 1; }
}`;

function injectKeyframesOnce(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("tilt-keyframes")) return;
  const style = document.createElement("style");
  style.id = "tilt-keyframes";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function DiscGlyph({
  disc,
  justMoved,
  pulse,
}: {
  disc: 0 | 1;
  justMoved: boolean;
  /** True only when `justMoved && !reducedMotion` — see this file's module doc. */
  pulse: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-just-moved={justMoved ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "70%",
        height: "70%",
        borderRadius: "50%",
        fontSize: "1.4em",
        lineHeight: 1,
        color: disc === 0 ? "var(--accent-p1, #0b3d91)" : "var(--accent-p2, #7a3200)",
        outline: justMoved ? "2px solid currentColor" : undefined,
        outlineOffset: justMoved ? 2 : undefined,
        animation: pulse ? "tilt-settle-pulse 220ms cubic-bezier(0,0,0.2,1) 1" : undefined,
      }}
    >
      {glyphFor(disc)}
    </span>
  );
}

export function Board({ view, legal, prefs }: BoardProps<TiltState, TiltMove>) {
  useEffect(() => {
    injectKeyframesOnce();
  }, []);

  const legalKeys = new Set(legal.map((m) => moveToCellId(m)));
  const justMoved = justMovedCells(view.lastEffects);
  const presentations = buildCellPresentations(view.grid, { size: SIZE, winLength: 4 });
  // Per-PLY token (Nine Grids' own technique — see this file's module doc): empty only at the
  // true opening position (`lastEffects` still `[]`); a real `apply()` always appends at least a
  // `placed` effect, so this changes exactly once per genuine move.
  const plyToken = view.lastEffects.length > 0 ? JSON.stringify(view.lastEffects) : "opening";

  return (
    <>
      {presentations.map((c) => {
        const cellJustMoved = justMoved.has(c.row * SIZE + c.col);
        const pulse = cellJustMoved && !prefs.reducedMotion;
        const occupant =
          c.disc !== null ? (
            <DiscGlyph key={plyToken} disc={c.disc} justMoved={cellJustMoved} pulse={pulse} />
          ) : undefined;

        if (!c.isDropTarget) {
          // Decorative, non-interactive cell — never wired to a real move (see module doc).
          const id = `tilt-disc-${c.row}-${c.col}`;
          return (
            <Cell
              key={id}
              id={id}
              row={c.row}
              col={c.col}
              occupant={occupant}
              accessibleName={
                cellJustMoved ? `${c.accessibleName.replace(/\.$/, "")}, just resettled by the tilt.` : c.accessibleName
              }
              disabled
            />
          );
        }
        const move: TiltMove = { column: c.col };
        const id = moveToCellId(move);
        return (
          <Cell
            key={id}
            id={id}
            row={c.row}
            col={c.col}
            occupant={occupant}
            accessibleName={c.accessibleName}
            disabled={!legalKeys.has(id)}
          />
        );
      })}
    </>
  );
}

export { TILT_BOARD_LABEL };

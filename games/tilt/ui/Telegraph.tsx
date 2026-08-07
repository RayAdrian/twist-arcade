// games/tilt/ui/Telegraph.tsx — the tilt telegraph (docs/plans/tilt.md §6.1/§6.2), rendered via
// GamePresentation.extraControls: "a persistent chrome element — countdown '⟳ 3 / 2 / 1'
// stepping at each turn advance, plus a direction marker on the board edge that will become the
// new floor. Visible from ply 1." AUTHORITATIVE AND STATIC — the countdown numeral and the
// arrow glyph are both text, not color, so this survives the grayscale-screenshot test and
// `prefers-reduced-motion` identically (there is no motion here to reduce: this component never
// animates, it just re-renders the current count on every state change).
//
// Rendered as a sibling immediately after the board (game-spec's `extraControls` contract),
// never inside the grid itself — this is chrome around the board, not a board cell.
"use client";

import type { BoardProps } from "@twist-arcade/game-spec";
import { TILT_PERIOD, type TiltMove, type TiltState } from "../engine";
import { NEW_FLOOR_ARROW, pliesUntilNextTilt, telegraphText } from "./board-view";

export function Telegraph({ view }: BoardProps<TiltState, TiltMove>) {
  const remaining = pliesUntilNextTilt(view.grid, TILT_PERIOD);
  const text = telegraphText(view.grid, TILT_PERIOD, "cw");

  return (
    <div
      role="status"
      aria-hidden="true" // the SAME information is already in announce()'s live-region text
      // (plan §6.3.1's proximity phrase) — a sighted+screen-reader user would otherwise hear it
      // twice, same reasoning as CountdownBadge.tsx's own aria-hidden.
      data-testid="tilt-telegraph"
      data-plies-until-tilt={remaining}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5em",
        marginTop: "0.5em",
        padding: "0.35em 0.75em",
        border: "1px solid var(--ink-muted, #5b5347)",
        borderRadius: "6px",
        fontSize: "0.95em",
        fontWeight: 600,
        color: "var(--ink, #262019)",
      }}
    >
      <span aria-hidden="true">⟳</span>
      <span data-testid="tilt-countdown-value">{remaining}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="tilt-floor-marker">
        new floor {NEW_FLOOR_ARROW} right
      </span>
      <span style={{ display: "none" }}>{text}</span>
    </div>
  );
}

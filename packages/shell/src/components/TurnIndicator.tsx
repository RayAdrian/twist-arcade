// packages/shell/src/components/TurnIndicator.tsx — plan §4.8. Player glyph + name chips;
// the active seat is marked by weight + underline AND (elsewhere) the StatusLine words —
// never a colored dot alone. Hidden entirely in solo-single mode (replaced by ScoreHUD);
// that composition decision belongs to GameShell, not this component.
//
// Material restyle (design 2a): the active seat's chip becomes a filled ink-bordered box (its
// own print-shadow) with a small blinking marker dot; the inactive seat stays a plain outlined
// chip. `font-bold`/`underline` (the pre-existing, tested contract — TurnIndicator.test.tsx
// asserts the active `<li>`'s className matches `/font-bold|underline/`) are both KEPT on the
// active `<li>` so this stays true; the blink dot is an ADDITIONAL cue layered on top, never a
// replacement for the words/weight (color/motion alone is never the sole signal — ux-lens §2).
// The dot's `ta-blink` animation is covered by the app-wide `prefers-reduced-motion` blanket
// (app/globals.css), same as the loading-state grid's use of the same class.

import type { ReactNode } from "react";

export interface TurnIndicatorSeat {
  glyph: ReactNode;
  label: string;
  active: boolean;
}

export interface TurnIndicatorProps {
  seats: TurnIndicatorSeat[];
}

export function TurnIndicator({ seats }: TurnIndicatorProps) {
  return (
    <ul className="flex items-center justify-center gap-4">
      {seats.map((seat) => (
        <li
          key={seat.label}
          aria-current={seat.active ? "true" : undefined}
          className={
            seat.active
              ? "flex items-center gap-2 rounded-lg border-ui border-ink bg-accent-p1 px-3 py-1.5 font-bold text-paper underline decoration-2 underline-offset-4 shadow-print-2"
              : "flex items-center gap-2 rounded-lg border-ui border-ink-muted px-3 py-1.5 text-ink-muted"
          }
        >
          <span aria-hidden="true" className="font-display text-lg leading-none">
            {seat.glyph}
          </span>
          <span className="font-mono text-xs uppercase tracking-wide">{seat.label}</span>
          {seat.active && <span aria-hidden="true" className="ta-blink h-1.5 w-1.5 rounded-full bg-marker" />}
        </li>
      ))}
    </ul>
  );
}

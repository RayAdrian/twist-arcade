// packages/shell/src/components/TurnIndicator.tsx — plan §4.8. Player glyph + name chips;
// the active seat is marked by weight + underline AND (elsewhere) the StatusLine words —
// never a colored dot alone. Hidden entirely in solo-single mode (replaced by ScoreHUD);
// that composition decision belongs to GameShell, not this component.

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
              ? "flex items-center gap-1 font-bold underline decoration-2 underline-offset-4"
              : "flex items-center gap-1 text-ink-muted"
          }
        >
          <span aria-hidden="true">{seat.glyph}</span>
          <span>{seat.label}</span>
        </li>
      ))}
    </ul>
  );
}

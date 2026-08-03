// packages/shell/src/components/ScoreHUD.tsx — plan §7.1. The HUD two-player games don't
// have; replaces TurnIndicator in solo mode (that composition choice belongs to GameShell).
//
// Numbers are ALWAYS rendered as static text — the "200ms count transition" polish described
// in the plan is a pure CSS/visual enhancement layered on top of this same static value at
// the call site; reduced-motion users must see the identical number either way, so this
// component intentionally carries no animation state of its own.

export interface ScoreHUDProps {
  score?: number;
  par?: number;
  movesUsed: number;
  moveBudget?: number;
  banked?: number;
}

export function ScoreHUD({ score, par, movesUsed, moveBudget, banked }: ScoreHUDProps) {
  const parts: string[] = [];

  if (par !== undefined) {
    parts.push(`moves ${movesUsed} · par ${par}`);
  } else if (score !== undefined) {
    parts.push(`score ${score}`);
    if (moveBudget !== undefined) parts.push(`${movesUsed} / ${moveBudget} moves`);
  } else {
    parts.push(`${movesUsed} moves`);
  }

  if (banked !== undefined) parts.push(`banked ${banked}`);

  return <p className="text-center text-sm font-medium text-ink">{parts.join(" · ")}</p>;
}

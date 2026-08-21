// games/crackstep/ui/SidePanel.tsx — design 2a's "Floor left" readout + material legend,
// rendered via GamePresentation.extraControls (packages/game-spec/src/presentation.ts): a
// game-owned control block, sibling to BoardShell/Board, never inside the board grid itself
// (that seam already exists for Mine Run's BankBar — this is Crackstep's first use of it).
//
// Pure presentation over `view` — no engine changes, no new game state. "Floor left" and the
// legend both restate facts already computable from the redacted view (`tilesRemaining`,
// `view.tiles`), the same helpers `index.ts`'s announce()/textureLine() already use.
//
// No hooks, no event handlers — this can be a plain function component; GameShell renders it
// inside the same client boundary as everything else in the play route, so no "use client"
// directive is needed on this file itself.

import type { BoardProps } from "@twist-arcade/game-spec";
import type { CrackstepMove, CrackstepState, TileKind } from "../engine";
import { tilesRemaining } from "./board-view";

const LEGEND: { key: TileKind | "rubble"; swatch: string; label: string; fate: string }[] = [
  { key: "crumble", swatch: "#b98a52", label: "wood", fate: "crumbles when you leave" },
  { key: "stone", swatch: "#cfcabe", label: "stone", fate: "holds forever" },
  { key: "rubble", swatch: "#4a4238", label: "rubble", fate: "gone for good" },
  { key: "hole", swatch: "#171310", label: "hole", fate: "never was floor" },
];

export function SidePanel({ view }: BoardProps<CrackstepState, CrackstepMove>) {
  const totalWalkable = view.tiles.filter((t) => t !== "hole").length;
  const remaining = tilesRemaining(view);
  const remainingFraction = totalWalkable > 0 ? remaining / totalWalkable : 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border-ui border-ink bg-paper-lift p-4 shadow-print-2">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Floor left</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="relative block h-3.5 flex-1 overflow-hidden rounded-full border-ui border-ink bg-paper-zine">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-accent-p2"
              style={{ width: `${Math.round(remainingFraction * 100)}%` }}
            />
          </span>
          <span className="font-mono text-sm font-semibold text-ink">{remaining}</span>
        </div>
      </div>

      <ul className="grid gap-2 border-t-hairline border-ink pt-3 text-sm text-ink">
        {LEGEND.map((row) => (
          <li key={row.key} className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-sm border border-ink" style={{ background: row.swatch }} />
            <span>
              <span className="font-medium">{row.label}</span> — {row.fate}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

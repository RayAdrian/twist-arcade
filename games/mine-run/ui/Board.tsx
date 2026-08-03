// games/mine-run/ui/Board.tsx — the board slot (mine-run.md §8.1/§8.4). Rendered INSIDE the
// shell's <BoardShell> (GameShell composes that wrapper); renders ONLY the width*height <Cell>s
// themselves, no wrapping grid of its own, so BoardShell's CSS grid still sees flat grid items
// (games/fadeout/ui/Board.tsx's own convention).
//
// THE MANDATORY TWO-TAP CONFIRM FLOW (mine-run.md §8.4, orchestrator addendum O2). The 32px
// cell-size exception (below the shell's 48px floor — Cell.tsx's `minCellPx` seam) is granted
// CONDITIONALLY on every reveal committing via two taps, on every platform, not just touch: a
// mis-tap here doesn't cost a turn, it hits a mine and wipes an unbanked streak. This uses the
// shell's own `Cell` `armed`/`onArm` seam (packages/shell/src/components/Cell.tsx) rather than
// hand-rolling gesture handling — Board owns exactly one piece of state (`armed: number | null`,
// which cell is currently staged) and lets Cell's own tap/keyboard machinery do the rest:
//   - a tap/Enter on an unarmed cell calls `onArm` (arms it, does NOT submit a move at all —
//     not even a rejected one; see Cell.tsx's `tryCommit`)
//   - a tap/Enter on the ALREADY-armed cell falls through to Cell's normal commit, submitting
//     the real `{t:"reveal", cell}` move
//   - tapping a DIFFERENT cell while one is armed re-arms the new cell instead (armed is a
//     single piece of Board state; every other cell's own `armed` prop is simply false)
// `effectiveArmed` derives the displayed armed cell PURELY from render-time data (is this index
// still a legal reveal target?) rather than an effect: the instant a committed reveal takes that
// cell out of `legal` (revealed cells are never legal reveal targets again, win or mine), the
// stale index stops matching any rendered cell's `armed` prop on its own — no separate reset
// needed, and nothing can leave a phantom "armed" cell rendered as such.
//
// Never colour alone (§8.4): revealed vs hidden is fill/text content, not hue; the numeral IS
// the count encoding (classic minesweeper number-colours kept as the sacrificial third channel);
// exploded is a glyph (💥), never a bare colour swap.
//
// "use client" — renders shell's Cell (hooks) and owns `armed` state itself; this file is under
// games/**/ui/** and therefore covered by eslint's board-path animation boundary (C5): plain
// CSS/inline styles only, no animation library.
"use client";

import { useState } from "react";
import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { MineRunMove, MineRunView } from "../engine";
import { buildCellPresentations } from "./board-view";

/** The sanctioned exception (mine-run.md §8.4/O2): 10 columns at 320px = 32px cells, below the
 *  shell's 48px design-gate floor. Conditional on the two-tap flow this whole file implements —
 *  never used without it. */
export const MINE_RUN_MIN_CELL_PX = 32;

/** Classic minesweeper number colours (ux-lens §8.4's "sacrificial third channel" — the numeral
 *  itself is the real, hue-independent encoding; colour is a bonus, never load-bearing). Chosen
 *  to read clearly on both themes' ink-on-paper ground; 0 never renders a numeral at all
 *  (an empty revealed cell shows no glyph, matching classic minesweeper). */
const NUMBER_CLASS: Readonly<Record<number, string>> = {
  1: "text-[#1157c2]",
  2: "text-[#1a7d3d]",
  3: "text-[#b3261e]",
  4: "text-[#4b2e83]",
  5: "text-[#7a3200]",
  6: "text-[#0c7c8c]",
  7: "text-ink",
  8: "text-ink-muted",
};

function NumberGlyph({ n }: { n: number }) {
  return <span aria-hidden="true" className={`text-sm font-bold ${NUMBER_CLASS[n] ?? "text-ink"}`}>{n}</span>;
}

function ExplodedGlyph() {
  return (
    <span aria-hidden="true" className="text-base leading-none">
      {"\u{1F4A5}"}
    </span>
  );
}

// Mine Run's grid has no per-cell motion of its own (no age steps, no pulse — `prefs` is part
// of every Board's contract but genuinely unneeded here; the vault-drain/bank-slide animation
// mine-run.md §8.2 describes lives in the BankBar's own component, which does read `prefs`).
export function Board({ view, legal }: BoardProps<MineRunView, MineRunMove>) {
  const [armed, setArmed] = useState<number | null>(null);
  const cells = buildCellPresentations(view);

  const legalReveal = new Set<number>();
  for (const m of legal) {
    if (m.t === "reveal") legalReveal.add(m.cell);
  }

  // Pure render-time derivation (see this file's header comment) — no effect required: an
  // armed index that has left `legalReveal` (because it was just revealed, or the run ended)
  // simply stops matching any cell's `armed` prop on the very next render.
  const effectiveArmed = armed !== null && legalReveal.has(armed) ? armed : null;

  return (
    <>
      {cells.map((c) => {
        const move: MineRunMove = { t: "reveal", cell: c.cell };
        const id = moveToCellId(move);
        const disabled = !legalReveal.has(c.cell);
        const isArmed = effectiveArmed === c.cell;

        const occupant = !c.revealed
          ? undefined
          : c.exploded
            ? <ExplodedGlyph />
            : c.n && c.n > 0
              ? <NumberGlyph n={c.n} />
              : undefined;

        const accessibleName = isArmed ? `${c.accessibleName} Staged — tap again to reveal.` : c.accessibleName;

        return (
          <Cell
            key={c.cell}
            id={id}
            row={c.row}
            col={c.col}
            occupant={occupant}
            armed={isArmed}
            onArm={() => setArmed(c.cell)}
            accessibleName={accessibleName}
            disabled={disabled}
            minCellPx={MINE_RUN_MIN_CELL_PX}
          />
        );
      })}
    </>
  );
}

// games/mine-run/ui/Board.tsx — the board slot (mine-run.md §8.1/§8.4). Rendered INSIDE the
// shell's <BoardShell> (GameShell composes that wrapper); renders ONLY the width*height <Cell>s
// themselves, no wrapping grid of its own, so BoardShell's CSS grid still sees flat grid items
// (games/fadeout/ui/Board.tsx's own convention).
//
// STANDARD 48px CELLS, BoardShell'S ZOOM/PAN — NOT the plan's sub-48px/two-tap-commit exception.
// mine-run.md §8.4/O2 pre-authorized a 32px cell floor conditioned on mandatory two-tap commit,
// reasoning "10 columns at 320px = 32px cells... under the 48px design-gate line." That was true
// on its own terms but incomplete: even AT 32px, the board's natural width (10*32 + 9*4 = 356px)
// still overflows BoardShell's 320px-viewport frame (~288px) by 24% — the exception shrank the
// per-cell floor without ever making the board actually fit, so some overflow-handling mechanism
// (scroll/pan) was always going to be required regardless of which floor was chosen.
//
// platform-corrections.md C50 later withdrew the analogous exception granted to Tilt (7 columns,
// ~41px) once the team found BoardShell's natural-size zoom/pan mechanism (built for Nine Grids'
// 9x9/81-cell board, C38) already solves exactly this shape of problem for free, with zero
// per-cell shrinkage: BoardShell sizes its grid to `cols*48 + (cols-1)*4` and the frame becomes a
// scrollable pan region when that exceeds the viewport-constrained box (pure CSS, no JS layout
// measurement). C50's own ruling: "An unused accessibility exception sitting on the books is a
// hazard... the next team to hit a tight layout will cite it as precedent for shrinking a target,
// and the precedent will be wrong, because the case that justified it turned out to have a better
// answer." Mine Run's 10x10 board is exactly that next tight layout.
//
// THE ARITHMETIC (done here, before building, per standing instruction): at the standard 48px
// floor, natural size = 10*48 + 9*4 = 516px, against a ~288px frame at a 320px viewport — 79%
// over (worse than Nine Grids' 61%-over 9x9, which BoardShell's mechanism already handles). This
// file therefore renders every cell at the shell's DEFAULT 48px floor (no `minCellPx` override
// passed to `Cell`, matching Nine Grids and Tilt) and commits a reveal on a SINGLE tap/Enter, like
// every other game's board — no `armed`/`onArm` staging. Flagged as a documented deviation from
// mine-run.md §8.4/O2 for review, not a silent workaround (Tilt's own Board.tsx module doc uses
// identical framing for the same withdrawal).
//
// Never colour alone (§8.4): revealed vs hidden is fill/text content, not hue; the numeral IS
// the count encoding (classic minesweeper number-colours kept as the sacrificial third channel);
// exploded is a glyph (💥), never a bare colour swap.
//
// "use client" — renders shell's Cell (hooks); this file is under games/**/ui/** and therefore
// covered by eslint's board-path animation boundary (C5): plain CSS/inline styles only, no
// animation library. Mine Run's grid itself has no per-cell motion (no age steps, no pulse — the
// vault-drain/bank-slide narration mine-run.md §8.2 describes lives in BankBar.tsx, which is the
// component that actually owns the bank/wipe state transition).
"use client";

import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { MineRunMove, MineRunView } from "../engine";
import { buildCellPresentations } from "./board-view";

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

// `onMove`/`seat`/`prefs` are part of every Board's BoardProps contract but unused here:
// BoardShell owns the commit path (`onCellAction` decodes `id` back into a move via GameShell's
// wiring, mirroring Fadeout/Nine Grids/Tilt's own Board components), and this board has no
// per-seat or per-motion-preference rendering of its own (see this file's module doc).
export function Board({ view, legal }: BoardProps<MineRunView, MineRunMove>) {
  const cells = buildCellPresentations(view);

  const legalReveal = new Set<number>();
  for (const m of legal) {
    if (m.t === "reveal") legalReveal.add(m.cell);
  }

  return (
    <>
      {cells.map((c) => {
        const move: MineRunMove = { t: "reveal", cell: c.cell };
        const id = moveToCellId(move);
        const disabled = !legalReveal.has(c.cell);

        const occupant = !c.revealed
          ? undefined
          : c.exploded
            ? <ExplodedGlyph />
            : c.n && c.n > 0
              ? <NumberGlyph n={c.n} />
              : undefined;

        return (
          <Cell
            key={c.cell}
            id={id}
            row={c.row}
            col={c.col}
            occupant={occupant}
            accessibleName={c.accessibleName}
            disabled={disabled}
          />
        );
      })}
    </>
  );
}

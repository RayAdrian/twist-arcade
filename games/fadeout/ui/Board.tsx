// games/fadeout/ui/Board.tsx — the board slot (plan §5, ux-lens §10's ownership table: "board
// layout & piece rendering using shared Cells; the decay/telegraph visuals via shared tokens").
// Rendered INSIDE the shell's <BoardShell> (GameShell composes that wrapper — see
// packages/shell/src/components/GameShell.tsx); this component renders ONLY the 9 <Cell>s
// themselves, no wrapping grid of its own, so BoardShell's CSS grid still sees flat grid items.
//
// Uses shell's `Cell` for ALL tap-target/focus/badge/ghost machinery (never hand-rolled) — see
// the task brief's own instruction and Cell.tsx's header comment. `onMove` (BoardProps) is
// deliberately UNUSED here: it exists as an escape hatch for boards that bypass BoardShell's own
// registry (see useGame.ts's submitMove() comment); this Board commits exclusively through
// Cell's built-in id-based BoardShell.commit() path, so calling it too would double-submit.
//
// "use client" — renders shell's Cell, which itself needs a client boundary (hooks); this file
// is under games/**/ui/** and is therefore ALSO covered by eslint's board-path animation
// boundary (framer-motion/gsap/motion-react are statically banned here — plain CSS/Web
// Animations API only, per platform-corrections.md C5).
"use client";

import { useEffect } from "react";
import type { PlayerId } from "@twist-arcade/engine";
import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { FadeoutMove, FadeoutState } from "../engine";
import { buildCellPresentations, glyphFor } from "./board-view";

// Plain CSS keyframes for the final-turn pulse (ux-lens §2/§9: "a single soft pulse... once,
// then static"; dropped entirely under reduced motion — see PulsingGlyph below). No animation
// library: C5 bans framer-motion/gsap/motion-react on this exact path.
const PULSE_KEYFRAMES = `
@keyframes fadeout-final-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}`;

function GlyphMark({ player, muted }: { player: PlayerId; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`text-2xl font-bold ${player === 0 ? "text-accent-p1" : "text-accent-p2"} ${muted ? "opacity-70" : ""}`}
    >
      {glyphFor(player)}
    </span>
  );
}

/** Wraps `GlyphMark` in the one-shot pulse animation exactly when this cell has just entered
 *  its final turn (countdown === 1).
 *
 *  Minor (stage-6 F3 review): this doc previously claimed the caller keys the map on
 *  `${cell}-${countdown}` to force a fresh mount — no such key exists anywhere in this file
 *  (Board's map below keys on `c.cell` alone). What ACTUALLY makes the pulse play exactly once
 *  is `occupant`'s conditional in `Board()`: the moment `c.countdown` becomes 1, that branch
 *  swaps the rendered element from `<GlyphMark>` to `<PulsingGlyph>` — a change in component
 *  TYPE at that position in the tree, which React always treats as unmount-old/mount-new
 *  regardless of any key. The freshly-mounted node is what starts the CSS animation; a later
 *  re-render that leaves countdown at 1 keeps rendering the SAME `<PulsingGlyph pulse>` (same
 *  type, unchanged `style` string), which React does not remount and the browser does not
 *  restart. Plan §5.1 says this class of animation should key off `view.lastEffects`, not a
 *  state diff — this implementation satisfies "once, then static" via the element-type switch
 *  instead, which is observably different from the plan's own rule in one case: resuming a
 *  persisted game mid-final-turn (countdown already 1 on the very first render after reload)
 *  mounts `<PulsingGlyph>` fresh and replays the pulse once, whereas a `lastEffects`-keyed
 *  implementation would not (no effect happened on that render). Not fixed here — flagged so
 *  the gap is documented rather than silently relied upon. */
function PulsingGlyph({ player, pulse }: { player: PlayerId; pulse: boolean }) {
  useEffect(() => {
    if (!pulse || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent = PULSE_KEYFRAMES;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [pulse]);

  return (
    <span
      className="inline-block"
      style={pulse ? { animation: "fadeout-final-pulse 600ms cubic-bezier(0,0,0.2,1) 1" } : undefined}
    >
      <GlyphMark player={player} />
    </span>
  );
}

export function Board({ view, legal, prefs }: BoardProps<FadeoutState, FadeoutMove>) {
  const cells = buildCellPresentations(view);
  const legalSet = new Set(legal.map((m) => m.cell));

  return (
    <>
      {cells.map((c) => {
        const id = moveToCellId({ cell: c.cell } satisfies FadeoutMove);
        const disabled = !legalSet.has(c.cell);
        const occupant =
          c.occupant === null
            ? undefined
            : prefs.reducedMotion || c.countdown !== 1
              ? <GlyphMark player={c.occupant} />
              : <PulsingGlyph player={c.occupant} pulse />;
        const ghost = c.ghost === undefined ? undefined : <GlyphMark player={c.ghost} muted />;

        return (
          <Cell
            key={c.cell}
            id={id}
            row={c.row}
            col={c.col}
            occupant={occupant}
            {...(c.ageStep !== undefined ? { ageStep: c.ageStep } : {})}
            {...(c.countdown !== undefined ? { countdown: c.countdown } : {})}
            ghost={ghost}
            accessibleName={c.accessibleName}
            disabled={disabled}
          />
        );
      })}
    </>
  );
}

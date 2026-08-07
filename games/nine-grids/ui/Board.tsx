// games/nine-grids/ui/Board.tsx — the REAL Nine Grids board, replacing the deliberate 57-line
// engine-only placeholder this file used to be (see git history / CHECKLIST.md — the placeholder
// rendered 81 flat Cells addressed by raw (board,cell) pairs with no macro/micro layout, no
// active-board highlighting, no closed-board styling, and was in fact double-nested inside its
// own inner grid rather than BoardShell's — never actually correct even for what little it drew).
//
// GATE STATUS (platform-corrections.md C16): Nine Grids passed its CI gate on a real 100-game
// sample (FPA 40.0%, draws 30.0%, mean-plies 49.8, zero cap hits) — gate-before-UI is satisfied,
// this file is authorised.
//
// THE ONE THING THIS BOARD HAS TO GET RIGHT (ux-lens §8-9, this game's own test plan Area SEND/
// FREE/A11Y): Ultimate Tic-Tac-Toe is "which board am I sent to" — a player who can't see that
// instantly can't play. So:
//   1. Macro/micro structure reads as boundaries, not a flat undifferentiated 9x9 (see
//      board-view.ts's module doc for the GLOBAL row-major cell order this depends on).
//   2. The active (confined) board is visually DISTINCT from the free-move state (all open
//      boards eligible) — solid brush border vs. dashed border, never mere enabled/disabled.
//   3. Closed sub-boards (won/drawn) get distinct, STATIC treatment: a macro-scale glyph (won)
//      or a hatch pattern (drawn) at the board's own center cell — WIN-008, glyph not hue alone.
//   4. Every one of the above facts is ALSO in each cell's accessibleName (board-view.ts) — a
//      screen-reader user re-inspecting the board later must be able to discover them without
//      waiting for the next live-region announcement (A11Y-005/006).
//
// CELL-SIZE ARITHMETIC (reported before this file was built, per the task brief): a flat 9x9
// grid at the 46px... no — at the 48px hard floor needs 9*48 + 8*4(gap) = 464px of width/height.
// The viewport-constrained frame at a 320px viewport is `min(320-32, 52svh)` = 288px in the
// worst case (portrait, ample height) — 464 > 288, so the flat grid genuinely does not fit.
// ux-lens §7 forbids shrinking the targets and prescribes "zoom/pan regions... or a different
// layout" instead. This build takes the zoom/pan route (packages/shell/src/components/
// BoardShell.tsx now sizes its grid to its NATURAL minimum and lets the viewport-constrained
// frame scroll/pan, per that file's own module comment) rather than a two-tap macro/micro
// picker: the test plan's FREE-005/A11Y-006 UI cases require "ALL open boards actionable"
// SIMULTANEOUSLY, which a picker (only 9 cells actionable at a time, gated behind a board-
// selection tap) cannot satisfy but a pannable flat grid can — every legal cell is a real,
// enabled, ≥48px `gridcell` in the DOM at all times, some merely requiring a scroll/pan to reach
// on the narrowest viewports. This is a structural platform change (BoardShell), reported as a
// finding rather than silently building around it, since no prior game needed it.
//
// C5: no animation library here, ever — this directory (games/*/ui) is board state, not chrome.
// The one-shot "send" pulse below RESTATES a fact the static border style already shows (which
// board is active/free-eligible) — under `prefers-reduced-motion` it is skipped outright (see
// the reduced-motion tests in Board.test.tsx, including a PLANTED violation proving a test
// fails if that gate is deleted).
//
// WHY THIS IS A REMOUNT (React `key`), NOT A ref-compared "previous vs current" flag: an
// earlier revision tracked `prevActiveBoard` in a `useRef`, updated in a `useEffect`, and
// computed `justSent = prev !== view.activeBoard`. VERIFIED BROKEN against the real app (not
// hypothesized): `useGame.ts`'s `dispatchBotIfNeeded` fires a SECOND `setInternal` (setting
// `botThinking: true`) synchronously right after the move's own `setInternal`, and — confirmed
// by instrumenting an actual render log in a real browser — these are NOT batched into one
// commit; React commits the move's render (activeBoard changed, `justSent` correctly true),
// runs the ref-updating effect, and THEN commits the `botThinking` render, by which point the
// ref already matches the current value and `justSent` reads false — the animation is applied
// and erased before the browser ever paints it. Real observed log (2026-08-07):
//   render {renderNo: 2, prev: null, cur: 7, justSent: true}
//   effect updating ref {from: null, to: 7}
//   render {renderNo: 3, prev: 7, cur: 7, justSent: false}   <- erased before paint
// Keying the pulse-bearing element by a per-PLY token (`view.lastEffects`, which only changes
// on a genuine `apply()` — never on an unrelated state field like `botThinking`) sidesteps the
// whole class of bug: React only remounts (and only then does the CSS animation start) when the
// key actually changes, and an unrelated re-render with the SAME key never un-starts a CSS
// animation already playing in the browser, no matter how many extra commits happen in between.
"use client";

import { useEffect } from "react";
import type { PlayerId } from "@twist-arcade/engine";
import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { NineGridsMove, NineGridsState } from "../engine";
import { buildCellPresentations, glyphFor, type CellPresentation } from "./board-view";

const KEYFRAMES = `
@keyframes ng-send-pulse {
  0% { box-shadow: 0 0 0 6px rgba(38, 32, 25, 0.28); }
  100% { box-shadow: 0 0 0 0 rgba(38, 32, 25, 0); }
}`;

function injectKeyframesOnce(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("nine-grids-keyframes")) return;
  const style = document.createElement("style");
  style.id = "nine-grids-keyframes";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// Colorblind/grayscale-safe: hue is never the only carrier. Closed-board fills use the SAME two
// player accents Fadeout already ships (blue/orange, never red/green — design-tokens.ts), plus a
// PATTERN (diagonal hatch for a draw — texture, not a third hue) so grayscale still separates
// "won by X" / "won by O" / "drawn" from each other and from "open".
// `PlayerId` is a plain `number` (not a `0|1` literal union — see @twist-arcade/engine's
// types.ts, and Fadeout's own board-view.ts `glyphFor` comment for the full rationale), so this
// is a ternary rather than a `Record<0|1,...>` indexed by one directly — Nine Grids is a fixed
// 2-player game (`meta.maxPlayers === 2`), so the ternary is exhaustive by construction.
function wonTintFor(player: PlayerId): string {
  return player === 0 ? "rgba(11, 61, 145, 0.16)" : "rgba(122, 50, 0, 0.16)"; // accentP1/P2 @ low alpha
}
const DRAWN_PATTERN =
  "repeating-linear-gradient(45deg, rgba(38,32,25,0.14) 0 2px, transparent 2px 8px)";

interface CellFaceProps {
  presentation: CellPresentation;
  /** False only at the opening position (`view.lastEffects` still empty) — see this file's
   *  module doc for why this drives the pulse via a REMOUNT key at the call site, not a flag
   *  compared against a previous render. */
  hasMoved: boolean;
  reducedMotion: boolean;
}

function GlyphMark({ player, size }: { player: PlayerId; size: "normal" | "macro" }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontWeight: 700,
        fontSize: size === "macro" ? "2.5em" : "1.2em",
        color: "var(--ink, #262019)",
        lineHeight: 1,
      }}
    >
      {glyphFor(player)}
    </span>
  );
}

function CellFace({ presentation, hasMoved, reducedMotion }: CellFaceProps) {
  const { boardStatus, mark, isActiveBoard, isFreeMoveEligible, isBoardCenter } = presentation;

  if (boardStatus.kind !== "open") {
    // Closed board: static tint + pattern fills the WHOLE cell (every one of the board's 9
    // physical Cells, so the closed block reads as one solid region), and the macro-scale glyph
    // (WIN-008: "glyph, not hue alone") renders ONCE, at the board's own center cell, regardless
    // of which local cell actually completed the line.
    const won = boardStatus.kind === "won";
    const background = won ? wonTintFor(boardStatus.winner) : DRAWN_PATTERN;
    return (
      <div
        aria-hidden="true"
        data-board-status={won ? `won-${boardStatus.winner}` : "full"}
        style={{ position: "absolute", inset: 0, background }}
      >
        {isBoardCenter && won && <GlyphMark player={boardStatus.winner} size="macro" />}
        {isBoardCenter && !won && (
          <span aria-hidden="true" style={{ fontSize: "1.6em", color: "var(--ink-muted, #5b5347)" }}>
            ▦
          </span>
        )}
        {!isBoardCenter && mark !== null && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.55 }}>
            <GlyphMark player={mark} size="normal" />
          </span>
        )}
      </div>
    );
  }

  // Open board: the confinement fact is carried by BORDER STYLE (weight + solid/dashed), never
  // by disabled-state alone (SEND-011/A11Y-005) — a texture/weight difference survives grayscale
  // and reduced motion equally.
  const confinement: "active" | "free" | "elsewhere" = isActiveBoard ? "active" : isFreeMoveEligible ? "free" : "elsewhere";
  const border =
    confinement === "active" ? "3px solid var(--ink, #262019)" : confinement === "free" ? "2px dashed var(--ink, #262019)" : "1px solid var(--ink-muted, #5b5347)";
  const opacity = confinement === "elsewhere" ? 0.55 : 1;
  const pulse = hasMoved && !reducedMotion && confinement !== "elsewhere";

  return (
    <div
      aria-hidden="true"
      data-confinement={confinement}
      style={{
        position: "absolute",
        inset: 0,
        border,
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: pulse ? "ng-send-pulse 300ms cubic-bezier(0,0,0.2,1) 1" : undefined,
      }}
    >
      {mark !== null && <GlyphMark player={mark} size="normal" />}
    </div>
  );
}

// `onMove` is deliberately NOT destructured — see Fadeout's Board.tsx for the full rationale
// (this board is built entirely from `Cell`, which commits through BoardContext -> BoardShell ->
// GameShell, the same path `onMove` would otherwise reach via `moveToCellId`).
export function Board({ view, legal, prefs }: BoardProps<NineGridsState, NineGridsMove>) {
  useEffect(() => {
    injectKeyframesOnce();
  }, []);

  const legalKeys = new Set(legal.map((m) => moveToCellId(m)));
  const cells = buildCellPresentations(view);

  // Per-PLY token (see this file's module doc for why this replaced a ref-compared flag): empty
  // only at the true opening position (`setup()` returns `lastEffects: []`); a genuine `apply()`
  // always appends at least a `placed` effect, so this changes exactly once per real move and
  // never on an unrelated re-render (e.g. `botThinking` flipping) that leaves the move log
  // untouched. `null` (not just falsy) so `hasMoved` below can't be confused with an accidental
  // empty-string key collision.
  const plyToken = view.lastEffects.length > 0 ? JSON.stringify(view.lastEffects) : null;

  return (
    <>
      {cells.map((c) => {
        const move: NineGridsMove = { board: c.board, cell: c.cell };
        const id = moveToCellId(move);
        return (
          <Cell
            key={id}
            id={id}
            row={c.globalRow}
            col={c.globalCol}
            occupant={
              <CellFace
                key={plyToken ?? "opening"}
                presentation={c}
                hasMoved={plyToken !== null}
                reducedMotion={prefs.reducedMotion}
              />
            }
            accessibleName={c.accessibleName}
            disabled={!legalKeys.has(id)}
          />
        );
      })}
    </>
  );
}


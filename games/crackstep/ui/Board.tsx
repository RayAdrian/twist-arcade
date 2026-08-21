// games/crackstep/ui/Board.tsx — typed against BoardProps<V, M> (plan §5.3, §7).
//
// Uses `@twist-arcade/shell`'s `Cell` (the >=48px floor, focus/keyboard-nav registration) and
// `moveToCellId` (the cellId <-> move convention `GameShell` relies on) rather than a bare
// <button> — a move here IS the target cell index (engine.ts's `CrackstepMove = number`), so
// `moveToCellId(cell)` is exactly the cellId every walkable Cell renders under.
//
// C5 (platform-corrections.md): no animation library here, ever — this directory (games/*/ui)
// is board state, not chrome. Every one of the five tile states (§7.1) is fully readable from a
// STATIC render; the CSS transitions/keyframes below only ever RESTATE a fact the plain colour +
// texture already shows (the crumble-drop restates "this cell just became rubble"; the dust puff
// restates nothing new at all and is dropped outright under reduced motion, per C5's own rule
// that a state change must never depend on motion to be perceived).
//
// Rubble-vs-stone-vs-wood is deliberately TEXTURE-first (orchestrator addendum §13 #1's binding
// review gate): plank grain + fracture seams (wood) vs. chamfered corners + rivet dots (stone)
// vs. scattered irregular dots (rubble) vs. a flat fill (hole, never was floor) — four value
// bands plus two genuinely different dot/line PATTERNS, verified against an actual grayscale
// screenshot (see games/crackstep/ui/Board.test.tsx and the session's screenshot check).
"use client";

import { useEffect, useRef } from "react";
import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { CrackstepMove, CrackstepState } from "../engine";
import { buildCellPresentations, type CellPresentation } from "./board-view";
import { MATERIAL_COLORS } from "./materials";

const KEYFRAMES = `
@keyframes crackstep-crumble-drop {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  60% { transform: translateY(4px) scale(0.92); opacity: 0.6; }
  100% { transform: translateY(6px) scale(0.85); opacity: 0; }
}
@keyframes crackstep-dust {
  0% { opacity: 0; transform: translateY(0) scale(0.6); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-10px) scale(1.3); }
}
`;

function injectKeyframesOnce(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("crackstep-keyframes")) return;
  const style = document.createElement("style");
  style.id = "crackstep-keyframes";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// Grayscale-verified 4-band palette (mid-warm / light / dark / darkest) — deliberately NOT the
// sole carrier of material identity; texture (below) carries that on its own (§13 #1).
interface TileFaceProps {
  presentation: CellPresentation;
  justCrumbled: boolean;
  ghost: boolean;
  reducedMotion: boolean;
}

function TileFace({ presentation, justCrumbled, ghost, reducedMotion }: TileFaceProps) {
  const { state, tile } = presentation;

  if (state === "hole") {
    return <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: MATERIAL_COLORS.hole }} />;
  }

  if (state === "crumbled") {
    return (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: MATERIAL_COLORS.crumbled,
          // Rubble: irregular scattered dots — distinct PATTERN from stone's 4 symmetric
          // corner rivets, and from the hole's flat fill (survives grayscale on texture alone).
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 0 2px, transparent 3px)," +
            "radial-gradient(circle at 65% 55%, rgba(255,255,255,0.14) 0 2px, transparent 3px)," +
            "radial-gradient(circle at 40% 75%, rgba(255,255,255,0.16) 0 1.5px, transparent 2.5px)," +
            "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.12) 0 1.5px, transparent 2.5px)",
          border: ghost ? "1px dashed rgba(255,255,255,0.55)" : undefined,
          animation: justCrumbled && !reducedMotion ? "crackstep-crumble-drop 400ms ease-out" : undefined,
        }}
      >
        {justCrumbled && !reducedMotion && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -6,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 14,
              animation: "crackstep-dust 400ms ease-out",
            }}
          >
            💨
          </span>
        )}
      </div>
    );
  }

  const isStone = tile === "stone";
  const isCurrentCrumbling = state === "current" && !isStone;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background: isStone ? MATERIAL_COLORS.stone : MATERIAL_COLORS.crumbling,
        clipPath: isStone ? "polygon(8% 0,92% 0,100% 8%,100% 92%,92% 100%,8% 100%,0 92%,0 8%)" : undefined,
        backgroundImage: isStone
          ? // Stone: chamfered slab + 4 corner "rivets" — reads as a different MATERIAL, never
            // a colour variant of wood (orchestrator addendum §13 #1's binding gate).
            "radial-gradient(circle at 18% 18%, rgba(0,0,0,0.35) 0 2px, transparent 3px)," +
              "radial-gradient(circle at 82% 18%, rgba(0,0,0,0.35) 0 2px, transparent 3px)," +
              "radial-gradient(circle at 18% 82%, rgba(0,0,0,0.35) 0 2px, transparent 3px)," +
              "radial-gradient(circle at 82% 82%, rgba(0,0,0,0.35) 0 2px, transparent 3px)"
          : // Wooden plank: grain stripes + two faint fracture seams.
            "repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 10px)," +
              "linear-gradient(160deg, transparent 46%, rgba(0,0,0,0.15) 47%, transparent 48%)," +
              "linear-gradient(20deg, transparent 66%, rgba(0,0,0,0.12) 67%, transparent 68%)",
        transform: isCurrentCrumbling ? "translateY(2px)" : undefined,
        boxShadow: isCurrentCrumbling ? "inset 0 3px 4px rgba(0,0,0,0.35)" : undefined,
        transition: reducedMotion ? undefined : "transform 150ms ease-out",
      }}
    >
      {isCurrentCrumbling && (
        // The imminent telegraph's authoritative channel (plan §7.2): a radiating crack
        // pattern, always-on (no countdown — the tile ALWAYS falls when you leave it), survives
        // grayscale as PATTERN rather than hue.
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(45deg, transparent 48%, rgba(0,0,0,0.45) 49%, rgba(0,0,0,0.45) 51%, transparent 52%)," +
              "linear-gradient(-45deg, transparent 48%, rgba(0,0,0,0.45) 49%, rgba(0,0,0,0.45) 51%, transparent 52%)",
          }}
        />
      )}
      {state === "current" && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          🧍
        </span>
      )}
    </div>
  );
}

// `onMove` is deliberately NOT destructured — this board is built entirely from `Cell`
// components, which commit through BoardContext -> BoardShell.onCellAction -> GameShell, the
// same path `onMove` would otherwise reach via `moveToCellId` (Fadeout's Board.tsx convention).
export function Board({ view, legal, prefs }: BoardProps<CrackstepState, CrackstepMove>) {
  useEffect(() => {
    injectKeyframesOnce();
  }, []);

  const cells = buildCellPresentations(view);
  const legalSet = new Set(legal);

  const crumbledEffect = view.lastEffects.find((e) => e.type === "crumbled");
  const justCrumbledCell = crumbledEffect ? (crumbledEffect.cell as number) : undefined;

  // The "holds a dashed ghost for exactly one move before settling" rule (plan §7.3) needs to
  // compare THIS render's just-crumbled cell against the PREVIOUS render's — a ref, updated
  // after paint, is exactly that one-render memory; `view` changing on the next move is what
  // drives the next re-render that reads it.
  const ghostRef = useRef<number | undefined>(undefined);
  const ghostCell = ghostRef.current;
  useEffect(() => {
    ghostRef.current = justCrumbledCell;
  }, [justCrumbledCell]);

  return (
    <>
      {cells.map((c) => {
        if (c.state === "hole") {
          // Never a Cell: holes are never a legal target and never the current position, so
          // they never need tap-target/focus/keyboard-nav machinery — a flat, non-interactive
          // pit, exactly per plan §7.1 ("never was floor").
          return (
            <div key={c.cell} aria-hidden="true" style={{ position: "relative", aspectRatio: "1 / 1", background: MATERIAL_COLORS.hole }} />
          );
        }
        const move: CrackstepMove = c.cell;
        return (
          <Cell
            key={c.cell}
            id={moveToCellId(move)}
            row={c.row}
            col={c.col}
            occupant={
              <TileFace
                presentation={c}
                justCrumbled={c.cell === justCrumbledCell}
                ghost={c.cell === ghostCell && c.state === "crumbled"}
                reducedMotion={prefs.reducedMotion}
              />
            }
            accessibleName={c.accessibleName}
            disabled={!legalSet.has(c.cell)}
          />
        );
      })}
    </>
  );
}

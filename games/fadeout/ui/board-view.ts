// games/fadeout/ui/board-view.ts — pure telegraph logic behind Board.tsx (plan §5, ux-lens §2).
// No React here on purpose: every static encoding (ageStep, the countdown badge, the ghost
// outline, accessible names) is a pure function of FadeoutState, so it is tested in isolation
// (board-view.test.ts) before Board.tsx ever wires it to a shell Cell. Board.tsx is the ONLY
// consumer; this module never imports react.
//
// Badge/opacity/accessible-name counting is the ONE shared formula the plan pins in three
// places (§5.1: "the badge, announce(), and the heuristic never drift apart") — reused directly
// from engine-internal.ts's `remainingLife` rather than re-derived here.

import type { PlayerId } from "@twist-arcade/engine";
import type { FadeoutState } from "../engine";
import { DEFAULT_BOARD_SIZE, DEFAULT_CAP, get2, remainingLife } from "../engine-internal";

/** Shape-first identity (ux-lens §2/§8): X vs O, never color alone. */
export const GLYPH: readonly [string, string] = ["X", "O"];
/** The share-artifact's per-move symbol (plan §8). */
export const EMOJI: readonly [string, string] = ["❌", "⭕"];

/** `PlayerId` is a plain `number` (not a `0|1` literal union — see @twist-arcade/engine's
 *  types.ts), so indexing a 2-tuple like GLYPH/EMOJI by one directly widens to
 *  `string | undefined` under this repo's `noUncheckedIndexedAccess`. Fadeout is a fixed
 *  2-player game (`meta.maxPlayers === 2`), so the ternary is exhaustive by construction, not
 *  a guess — this is the one place that narrows, so every call site gets a real `string`. */
export function glyphFor(player: PlayerId): string {
  return player === 0 ? GLYPH[0] : GLYPH[1];
}

export function emojiFor(player: PlayerId): string {
  return player === 0 ? EMOJI[0] : EMOJI[1];
}

const ROW_NAME = ["top", "middle", "bottom"] as const;
const COL_NAME = ["left", "center", "right"] as const;

/** "top left" / "middle center" / ... — the exact wording ux-lens §8's own live-region example
 *  uses ("Bot placed O, middle center."). One name per cell, all 9 distinct. */
export function boardPositionName(cell: number): string {
  const row = Math.floor(cell / DEFAULT_BOARD_SIZE);
  const col = cell % DEFAULT_BOARD_SIZE;
  return `${ROW_NAME[row]} ${COL_NAME[col]}`;
}

/** The coarser "center"/"corner"/"edge" classification plan §8's textureLine trigger table
 *  names cells by ("Cell names: centre / the corners / the edges in plain words"). */
export function boardCellNamePlain(cell: number): "center" | "corner" | "edge" {
  const center = Math.floor((DEFAULT_BOARD_SIZE * DEFAULT_BOARD_SIZE) / 2);
  if (cell === center) return "center";
  const row = Math.floor(cell / DEFAULT_BOARD_SIZE);
  const col = cell % DEFAULT_BOARD_SIZE;
  const isCorner = (row === 0 || row === DEFAULT_BOARD_SIZE - 1) && (col === 0 || col === DEFAULT_BOARD_SIZE - 1);
  return isCorner ? "corner" : "edge";
}

/** Owner + cell of the mark that decayed THIS ply, or null. Solid (non-playThrough) rulesets
 *  can only ever decay the MOVER's own overflow (never a displacement), so there is at most one
 *  `decayed` effect per apply — this is a real invariant of the frozen config, not an assumption
 *  (see engine-internal.ts's transition(): the `playThrough` displacement branch is dead when
 *  `config.playThrough === false`, which is FADEOUT_RULESET_CONFIG). */
export function ghostCellOf(view: FadeoutState): { cell: number; player: PlayerId } | null {
  for (const effect of view.lastEffects) {
    if (effect.type === "decayed" && typeof effect.cell === "number" && (effect.player === 0 || effect.player === 1)) {
      return { cell: effect.cell, player: effect.player };
    }
  }
  return null;
}

export interface CellPresentation {
  cell: number;
  row: number;
  col: number;
  occupant: PlayerId | null;
  /** Cell's `ageStep` prop — undefined (nothing to render) for an empty cell. */
  ageStep?: 0 | 1 | 2;
  /** The owner's remaining OWN placements before this mark vanishes (plan §5.1's shared
   *  formula) — undefined unless <= 2 (badge/pulse threshold; opacity is an enhancement, this
   *  count is authoritative per ux-lens §2). */
  countdown?: number;
  /** The glyph of a mark that vacated this (now-empty) cell THIS ply. */
  ghost?: PlayerId;
  accessibleName: string;
}

function ageStepFor(remaining: number): 0 | 1 | 2 {
  if (remaining <= 1) return 2; // final turn — 40%-floor opacity (Cell's ageStep 2)
  if (remaining === 2) return 1; // age-2 — 65%-floor opacity (Cell's ageStep 1)
  return 0; // fresh / age-1 — full opacity
}

function pendingChangeClause(countdown: number | undefined): string {
  if (countdown === undefined) return "";
  return `, fades in ${countdown} turn${countdown === 1 ? "" : "s"}`;
}

/** Builds all 9 cells' presentation data from the current view — the one function Board.tsx
 *  maps onto shell `Cell`s. Pure; safe to call on every render. */
export function buildCellPresentations(view: FadeoutState): CellPresentation[] {
  const totalCells = DEFAULT_BOARD_SIZE * DEFAULT_BOARD_SIZE;
  const ghost = ghostCellOf(view);
  const out: CellPresentation[] = [];

  for (let cell = 0; cell < totalCells; cell++) {
    const row = Math.floor(cell / DEFAULT_BOARD_SIZE);
    const col = cell % DEFAULT_BOARD_SIZE;

    let occupant: PlayerId | null = null;
    let index = -1;
    for (const p of [0, 1] as const) {
      const i = view.queues[p].indexOf(cell);
      if (i !== -1) {
        occupant = p;
        index = i;
        break;
      }
    }

    if (occupant === null) {
      out.push({
        cell,
        row,
        col,
        occupant: null,
        ...(ghost && ghost.cell === cell ? { ghost: ghost.player } : {}),
        accessibleName: `Row ${row + 1}, column ${col + 1}. Empty.`,
      });
      continue;
    }

    const queueLength = get2(view.queues, occupant).length;
    const remaining = remainingLife(index, queueLength, DEFAULT_CAP);
    const countdown = remaining <= 2 ? remaining : undefined;
    const ageStep = ageStepFor(remaining);
    const glyph = glyphFor(occupant);

    out.push({
      cell,
      row,
      col,
      occupant,
      ageStep,
      ...(countdown !== undefined ? { countdown } : {}),
      accessibleName: `Row ${row + 1}, column ${col + 1}. ${glyph}${pendingChangeClause(countdown)}.`,
    });
  }

  return out;
}

/** Full-board readback (ux-lens §8: "full-board readback... on decay events") — occupied cells
 *  only, in the same "fades in N turn(s)" wording the badge/accessible-name use. */
export function boardSummaryText(view: FadeoutState): string {
  const cells = buildCellPresentations(view).filter((c) => c.occupant !== null);
  if (cells.length === 0) return "Board: empty.";
  const parts = cells.map((c) => `${glyphFor(c.occupant!)} ${boardPositionName(c.cell)}${pendingChangeClause(c.countdown)}`);
  return `Board: ${parts.join(", ")}.`;
}

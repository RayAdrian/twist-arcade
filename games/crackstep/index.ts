// games/crackstep/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`/`loadSolver`)
// — never import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).
//
// Deliberately does NOT import ./solver (or @twist-arcade/harness) anywhere in this module or
// anything it pulls in: the registry's `loadSolver` is a SEPARATE dynamic-import entry point
// precisely so a route that only plays the game (loadEngine + loadPresentation) never drags the
// solver's heavier dependency into its bundle. The share artifact's 🟥 "provably unsolvable"
// marker reuses board.ts's pure reachability/dead-end helpers directly (no harness import
// needed) rather than reaching for solver.ts's heuristic.

import type { Effect, ReplayRecord } from "@twist-arcade/engine";
import { replay } from "@twist-arcade/engine";
import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { moveToCellId, timelineToBody } from "@twist-arcade/shell";
import { deadEndReservationCount, neighbors, unreachableUnvisitedCount } from "./board";
import { crackstep, type CrackstepMove, type CrackstepState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";
import { boardSummaryText, positionName, tilesRemaining } from "./ui/board-view";

function movedEffect(effects: readonly Effect[]): Effect | undefined {
  return effects.find((e) => e.type === "moved");
}

function crumbledEffect(effects: readonly Effect[]): Effect | undefined {
  return effects.find((e) => e.type === "crumbled");
}

function announceMoved(ev: Extract<GameEvent<CrackstepState>, { kind: "moved" }>): string {
  const moved = movedEffect(ev.effects);
  if (!moved) return "";
  const width = moved.width as number;
  const to = moved.to as number;
  let s = `Moved to ${positionName(to, width)}.`;
  const crumbled = crumbledEffect(ev.effects);
  if (crumbled) {
    const from = moved.from as number;
    s += ` The tile behind you at ${positionName(from, width)} crumbled.`;
  }
  return s;
}

/**
 * The only "about to change" fact in Crackstep is deterministic and singular (plan §7.2): the
 * tile underfoot falls the instant you leave it — unless it's stone, which never does. No
 * countdown exists because there is no countdown; this is what a screen-reader user gets in
 * place of the sighted crack-texture/warm-color/sag telegraph (C5's own governing rule: motion
 * may only restate a static fact, so the FACT itself must be spoken here, not merely implied).
 */
function announceImminent(ev: Extract<GameEvent<CrackstepState>, { kind: "imminent" }>): string {
  const onStone = ev.view.tiles[ev.view.pos] === "stone";
  if (onStone) return "";
  const remaining = tilesRemaining(ev.view);
  return `This tile will crumble when you leave it. ${remaining} tile${remaining === 1 ? "" : "s"} left.`;
}

function announceStatus(ev: Extract<GameEvent<CrackstepState>, { kind: "status" }>): string {
  if (ev.status.kind === "won") return "Floor crossed!";
  // "Stranded" — never "lost" (ux-lens/plan §7.5's vocabulary rule: this is a legible mistake,
  // not a bug or a loss). The richer "N tiles out of reach" count lives in textureLine() below,
  // which (unlike this event) receives the final view.
  if (ev.status.kind === "lost") return "Stranded.";
  return "";
}

function announce(ev: GameEvent<CrackstepState>): string {
  switch (ev.kind) {
    case "moved":
      return announceMoved(ev);
    case "imminent":
      return announceImminent(ev);
    case "boardSummary":
      return boardSummaryText(ev.view);
    case "status":
      return announceStatus(ev);
  }
}

// --- firstOccurrence — two teachable "firsts" (orchestrator addendum §13 #2: the array form) ---

function firstCrumbleAnchor(ev: GameEvent<CrackstepState>): string {
  if (ev.kind !== "moved") return "";
  const crumbled = crumbledEffect(ev.effects);
  const cell = crumbled ? (crumbled.cell as number) : undefined;
  return cell === undefined ? "" : moveToCellId(cell as CrackstepMove);
}

function firstStoneSurvivalAnchor(ev: GameEvent<CrackstepState>): string {
  if (ev.kind !== "moved") return "";
  const moved = movedEffect(ev.effects);
  const from = moved ? (moved.from as number) : undefined;
  return from === undefined ? "" : moveToCellId(from as CrackstepMove);
}

const firstOccurrence: NonNullable<GamePresentation<CrackstepState, CrackstepMove, CrackstepState>["firstOccurrence"]> = [
  {
    flagKey: "crackstep-first-crumble",
    trigger(ev) {
      return ev.kind === "moved" && crumbledEffect(ev.effects) !== undefined;
    },
    text: "The tile crumbled behind you — every wooden tile falls when you leave it.",
    anchor: firstCrumbleAnchor,
  },
  {
    flagKey: "crackstep-first-stone-survival",
    // Every move departs the CURRENT tile, which is either "crumble" (engine.ts's apply()
    // ALWAYS emits a "crumbled" effect leaving one, unconditionally) or "stone" (which NEVER
    // does). So the absence of a "crumbled" effect on a "moved" event is exactly "the departed
    // tile was stone and survived" — no board geometry needed to detect it, and the very first
    // move (leaving the start tile, always crumbling per plan §1.1) can never mis-fire this.
    trigger(ev) {
      return ev.kind === "moved" && crumbledEffect(ev.effects) === undefined;
    },
    text: "Stone doesn't crumble — cross it as often as you like.",
    anchor: firstStoneSurvivalAnchor,
  },
];

// --- shareArtifact — the emoji move-timeline (solo-games-lens §6, plan §9) ---------------

/** 🟥's "necessary-condition checker" (plan §9): the SAME two prunes solver.ts's admissible
 *  heuristic uses (board.ts's pure helpers — no solver/harness import here), applied to a
 *  REPLAYED state. Sound (never cries doom falsely) but incomplete (may lag the true fatal
 *  move) — v1 accepts that, per the plan's own acceptance of this tradeoff. */
function provablyDoomed(state: CrackstepState): boolean {
  if (unreachableUnvisitedCount(state.tiles, state.crumbled, state.visited, state.width, state.height, state.pos) > 0) {
    return true;
  }
  return deadEndReservationCount(state.tiles, state.crumbled, state.visited, state.width, state.height, state.pos) > 1;
}

function shareArtifact(record: ReplayRecord, finalView: CrackstepState): string {
  const { states } = replay(crackstep, record);
  const finalStatus = crackstep.status(finalView);

  let doomFired = false;
  const symbols = record.steps.map((_step, i) => {
    const before = states[i]!;
    const after = states[i + 1]!;
    const isLastStep = i === record.steps.length - 1;
    const visitedNew = tilesRemaining(before) - tilesRemaining(after) === 1;

    if (isLastStep) {
      if (finalStatus.kind === "won") return "✅";
      if (finalStatus.kind === "lost") return "💥";
      // Still ongoing (a share triggered mid-run, not expected in practice) — fall through to
      // the ordinary per-move marking rather than a terminal glyph that would be a lie.
    }
    if (!doomFired && provablyDoomed(after)) {
      doomFired = true;
      return "🟥";
    }
    return visitedNew ? "🟩" : "🟨";
  });

  const detours = symbols.filter((s) => s === "🟨").length;
  const statLine =
    finalStatus.kind === "won"
      ? detours === 0
        ? "every tile, no wasted step"
        : `${detours} detour${detours === 1 ? "" : "s"} along the way`
      : "the floor crumbles behind you";

  return `${timelineToBody(symbols)}\n${statLine}`;
}

// --- textureLine — the one-line "stranded" story (plan §7.5), lost-only ------------------

/**
 * "That last pocket needed a bridge you'd already dropped" fires when EVERY unreached tile
 * borders at least one crumbled cell (the stranding was caused by a crumble cutting off a
 * region, not merely by the board's own holes/edges) — plan §7.5's literal template.
 */
function textureLine(finalView: CrackstepState): string {
  const status = crackstep.status(finalView);
  if (status.kind !== "lost") return "";

  const remaining = tilesRemaining(finalView);
  if (remaining === 1) return "One tile short — the floor beat you by a step";

  let everyUnreachedBordersACrumble = true;
  for (let i = 0; i < finalView.tiles.length; i++) {
    if (finalView.tiles[i] === "hole" || finalView.visited[i]) continue;
    const bordersCrumble = neighbors(i, finalView.width, finalView.height).some((n) => finalView.crumbled[n]);
    if (!bordersCrumble) {
      everyUnreachedBordersACrumble = false;
      break;
    }
  }
  if (everyUnreachedBordersACrumble) return "That last pocket needed a bridge you'd already dropped";

  return "";
}

// --- howSheetFrames — the 3-step "How?" strip (step off -> stone survives -> cross it all) ---

const howSheetFrames: GamePresentation<CrackstepState, CrackstepMove, CrackstepState>["howSheetFrames"] = [
  {
    title: "Step off, it falls",
    body: "Step off a wooden tile and it crumbles behind you — gone for good, no going back.",
  },
  {
    title: "Stone survives",
    body: "Stone tiles never crumble. Cross them as many times as you like — your safety net.",
  },
  {
    title: "Cross it all",
    body: "Visit every tile before you run out of moves. Save dead-end pockets for last.",
  },
];

export const presentation: GamePresentation<CrackstepState, CrackstepMove, CrackstepState> = {
  Board,

  boardDimensions(view: CrackstepState): { rows: number; cols: number } {
    return { rows: view.height, cols: view.width };
  },

  announce,
  firstOccurrence,
  shareArtifact,
  howSheetFrames,
  textureLine,
};

export const definition: GameDefinition<CrackstepState, CrackstepMove, CrackstepState> = {
  manifest,
  engine: crackstep,
  presentation,
};

export { crackstep, manifest };
export { solver } from "./solver";

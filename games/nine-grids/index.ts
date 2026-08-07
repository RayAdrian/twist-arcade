// games/nine-grids/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { nineGrids, type NineGridsMove, type NineGridsState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";

// Engine-only pass (see ui/Board.tsx's module doc and CHECKLIST.md): boardDimensions is real
// data (this board really is a fixed 9x9 grid of cells), but announce/shareArtifact/
// howSheetFrames below are still TODO placeholders — the real per-event UX copy is later,
// UI-stage work.
export const presentation: GamePresentation<NineGridsState, NineGridsMove, NineGridsState> = {
  Board,

  boardDimensions(_view: NineGridsState) {
    return { rows: 9, cols: 9 };
  },

  announce(ev: GameEvent<NineGridsState>): string {
    // TODO(you): a real per-event sentence fragment for the shell's live region (ux-lens §9),
    // including calling out a board being won/closed and the free-move-anywhere case.
    switch (ev.kind) {
      case "moved":
        return "Move played.";
      case "imminent":
        return "";
      case "boardSummary":
        return `Player ${ev.view.toMove === 0 ? "X" : "O"} to move.`;
      case "status":
        return "";
    }
  },

  shareArtifact(_record, _finalView): string {
    // TODO(you): an emoji move-timeline BODY only (<=7 lines) — the shell owns the frame.
    return "TODO: share artifact body";
  },

  howSheetFrames: [
    { title: "TODO", body: "TODO: how-to-play frame 1" },
    { title: "TODO", body: "TODO: how-to-play frame 2" },
    { title: "TODO", body: "TODO: how-to-play frame 3" },
  ],
};

export const definition: GameDefinition<NineGridsState, NineGridsMove, NineGridsState> = {
  manifest,
  engine: nineGrids,
  presentation,
};

export { nineGrids, manifest };

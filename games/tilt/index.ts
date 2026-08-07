// games/tilt/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { tilt, type TiltMove, type TiltState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";

// TODO(you): every string/number below is a placeholder. See CHECKLIST.md for what "done"
// looks like for each of these.
export const presentation: GamePresentation<TiltState, TiltMove, TiltState> = {
  Board,

  boardDimensions(_view: TiltState) {
    // TODO(you): return your board's real (rows, cols) once it has real geometry.
    return { rows: 1, cols: 1 };
  },

  announce(ev: GameEvent<TiltState>): string {
    // TODO(you): a real per-event sentence fragment for the shell's live region (ux-lens §9,
    // plan §6.3 — tilt proximity, the tilt summary, tilt-created endings). T5 work, not T1/T2's.
    switch (ev.kind) {
      case "moved":
        return "Disc dropped.";
      case "imminent":
        return "";
      case "boardSummary":
        return `${ev.view.grid.filter((c) => c !== null).length} of 49 cells filled.`;
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

export const definition: GameDefinition<TiltState, TiltMove, TiltState> = {
  manifest,
  engine: tilt,
  presentation,
};

export { tilt, manifest };

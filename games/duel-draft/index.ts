// games/duel-draft/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { duelDraft, type DuelDraftMove, type DuelDraftState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";

// TODO(you): every string/number below is a placeholder. See CHECKLIST.md for what "done"
// looks like for each of these.
export const presentation: GamePresentation<DuelDraftState, DuelDraftMove, DuelDraftState> = {
  Board,

  boardDimensions(_view: DuelDraftState) {
    // TODO(you): return your board's real (rows, cols) once it has real geometry.
    return { rows: 1, cols: 1 };
  },

  announce(ev: GameEvent<DuelDraftState>): string {
    // TODO(you): a real per-event sentence fragment for the shell's live region (ux-lens §9).
    // D4 work (plan §11) — the scaffold's placeholder text below is only here so this package
    // typechecks against the REAL engine shape (board, not the scaffold's fictional counter).
    switch (ev.kind) {
      case "moved":
        return "A round resolved.";
      case "imminent":
        return "";
      case "boardSummary": {
        const empty = ev.view.board.filter((c) => c === "empty").length;
        return `${empty} cell${empty === 1 ? "" : "s"} remaining.`;
      }
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

export const definition: GameDefinition<DuelDraftState, DuelDraftMove, DuelDraftState> = {
  manifest,
  engine: duelDraft,
  presentation,
};

export { duelDraft, manifest };

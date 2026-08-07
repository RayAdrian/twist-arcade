// games/order-vs-chaos/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { orderVsChaos, type OrderVsChaosMove, type OrderVsChaosState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";

// TODO(you): every string/number below is a placeholder. See CHECKLIST.md for what "done"
// looks like for each of these.
export const presentation: GamePresentation<OrderVsChaosState, OrderVsChaosMove, OrderVsChaosState> = {
  Board,

  boardDimensions(_view: OrderVsChaosState) {
    // TODO(you): return your board's real (rows, cols) once it has real geometry.
    return { rows: 1, cols: 1 };
  },

  announce(ev: GameEvent<OrderVsChaosState>): string {
    // TODO(you): a real per-event sentence fragment for the shell's live region (ux-lens §9).
    switch (ev.kind) {
      case "moved":
        return "Counter incremented.";
      case "imminent":
        return "";
      case "boardSummary":
        return `${ev.view.board.filter((c) => c !== null).length} of 36 cells filled.`;
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

export const definition: GameDefinition<OrderVsChaosState, OrderVsChaosMove, OrderVsChaosState> = {
  manifest,
  engine: orderVsChaos,
  presentation,
};

export { orderVsChaos, manifest };

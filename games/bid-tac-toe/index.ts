// games/bid-tac-toe/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { bidTacToe, type BidTacToeMove, type BidTacToeState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";

// B1 SCOPE NOTE: this file (and ui/Board.tsx) is NOT built here — gate-before-UI (C16) means
// no board before B3 is green, and this team's brief is the engine only. Everything below is
// kept at the scaffold's own placeholder fidelity, adjusted only enough to typecheck against
// the real BidTacToeState/BidTacToeMove shape (3x3 board, bid/place moves) rather than the
// stamped counter/increment placeholder. Real content is B4's job (plan §9/§10).
export const presentation: GamePresentation<BidTacToeState, BidTacToeMove, BidTacToeState> = {
  Board,

  boardDimensions(_view: BidTacToeState) {
    return { rows: 3, cols: 3 };
  },

  announce(ev: GameEvent<BidTacToeState>): string {
    // TODO(B4): real per-event sentence fragments (ux-lens §9) — bid resolution, star
    // transfer, placement, auction-lost aha-callout (plan §9).
    switch (ev.kind) {
      case "moved":
        return "";
      case "imminent":
        return "";
      case "boardSummary":
        return `Star held by seat ${ev.view.star}. Budgets ${ev.view.budgets[0]}-${ev.view.budgets[1]}.`;
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

export const definition: GameDefinition<BidTacToeState, BidTacToeMove, BidTacToeState> = {
  manifest,
  engine: bidTacToe,
  presentation,
};

export { bidTacToe, manifest };

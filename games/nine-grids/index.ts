// games/nine-grids/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).

import type { Effect } from "@twist-arcade/engine";
import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { boardStatusOf } from "./engine-internal";
import { nineGrids, type NineGridsMove, type NineGridsState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";
import { boardName, boardSummaryText, closedReasonLabel, glyphFor, positionName } from "./ui/board-view";

// C64 (docs/plans/degeneracy-probes.md): the missing half of the mirrorMove wiring gap the plan
// closes — Nine Grids' mirrorMove existed and was tested (probes.ts) but was never re-exported
// from this package root, so scripts/ci-gates.ts's `resolveMirrorMove` (mirroring the `safeMove`
// convention — games/mine-run/index.ts) could never find it via
// `import("@twist-arcade/nine-grids")`. Fadeout already did this (its own index.ts); Tilt and
// Nine Grids did not — this repairs Nine Grids' half.
export { mirrorMove } from "./probes";

// UI pass (platform-corrections.md C16 gate satisfied — see ui/Board.tsx's module doc): real
// announce() strings, replacing the TODO placeholders. Every A11Y test-plan case is tagged
// [SPEC] against those placeholders; this is what turns them from "expected to FAIL today" into
// real, observed-passing UI cases. shareArtifact()/howSheetFrames are a separate, later pass
// (not required by this UI build's brief) and are left as TODO below, unchanged.
//
// COMPOSITION CONTRACT (packages/game-spec/src/presentation.ts, packages/shell/src/announcer.ts):
// the shell composes "what happened -> what's imminent -> board summary -> whose turn", in that
// fixed order, joining non-empty fragments with a single space. This game's OWN two fragments
// map onto that contract as:
//   "moved"    -> what the mover just did (placement + "wins this board" if it closed THIS move)
//   "imminent" -> the SEND consequence: which board the opponent must play in, or why they get a
//                 free move (closed earlier vs. closed by this very move) — carries `view`, so
//                 `view.activeBoard` (already resolved post-move) is read directly rather than
//                 recomputed.
// The shell appends "whose turn" itself (shellTurnPhrase) — neither fragment below repeats it.
// `Effect` (packages/engine/src/types.ts) is deliberately loose — `{type:string} & {[k:string]:
// Json}` — so per-variant fields are NOT narrowed by `type`; a plain `Extract<Effect,{type:...}>`
// resolves to `never` (Effect's `type: string` is never assignable to a literal). Fadeout's own
// board-view.ts sets the convention this mirrors: check `type` then read fields with `typeof`
// guards, returning a locally, concretely typed object rather than trying to narrow `Effect`
// itself.
function placedEffect(effects: readonly Effect[]): { board: number; cell: number } | undefined {
  for (const e of effects) {
    if (e.type === "placed" && typeof e.board === "number" && typeof e.cell === "number") {
      return { board: e.board, cell: e.cell };
    }
  }
  return undefined;
}
function boardWonEffect(effects: readonly Effect[]): { board: number } | undefined {
  for (const e of effects) {
    if (e.type === "boardWon" && typeof e.board === "number") return { board: e.board };
  }
  return undefined;
}
function boardClosedEffect(effects: readonly Effect[]): { board: number } | undefined {
  for (const e of effects) {
    if (e.type === "boardClosed" && typeof e.board === "number") return { board: e.board };
  }
  return undefined;
}

export const presentation: GamePresentation<NineGridsState, NineGridsMove, NineGridsState> = {
  Board,

  boardDimensions(_view: NineGridsState) {
    return { rows: 9, cols: 9 };
  },

  announce(ev: GameEvent<NineGridsState>): string {
    switch (ev.kind) {
      case "moved": {
        // A11Y-001: "names the mover's glyph, where it was placed, ... whose move it is [shell-
        // appended]." A11Y-002: the SAME move can also close the board it was played in — say so
        // here (the "imminent" branch below then explains the SEND consequence of that closure).
        const placed = placedEffect(ev.effects);
        if (!placed) return "";
        const mover = glyphFor(ev.player);
        const placement = `${mover} placed in the ${boardName(placed.board)}, ${positionName(placed.cell)}.`;
        const won = boardWonEffect(ev.effects);
        if (won && won.board === placed.board) return `${placement} ${mover} wins the ${boardName(placed.board)}.`;
        const closed = boardClosedEffect(ev.effects);
        if (closed && closed.board === placed.board) return `${placement} The ${boardName(placed.board)} is full — no winner.`;
        return placement;
      }

      case "imminent": {
        // A11Y-003/SEND-011/FREE-005: the send target, and — for a free move — WHY (closed
        // earlier vs. closed by this very move). Silent once the game has ended (A11Y-004 owns
        // the terminal announcement instead; repeating a send here would be actively wrong — the
        // opponent isn't "sent" anywhere when there is no next move).
        if (nineGrids.status(ev.view).kind !== "ongoing") return "";
        const target = ev.view.activeBoard;
        if (target !== null) return `Play in the ${boardName(target)}.`;
        const placed = placedEffect(ev.effects);
        if (!placed) return "Free move — play in any open board.";
        // The send target is the cell just played (its LOCAL index names the macro board) —
        // engine-internal.ts's transition() rule. Its status, read off the POST-move view, says
        // why it's closed; "closed by THIS move" (placed.board === placed.cell, the only shape
        // that can happen per the test plan's decision-table row 6) gets the "is now closed"
        // phrasing paired with the "moved" fragment's own win/full sentence above, rather than
        // repeating the reason a second time.
        const sendTarget = placed.cell;
        const status = boardStatusOf(ev.view.cells, sendTarget);
        if (sendTarget === placed.board) {
          return `The ${boardName(sendTarget)} is now closed — free move, play in any open board.`;
        }
        return `The ${boardName(sendTarget)} is already closed (${closedReasonLabel(status)}) — free move, play in any open board.`;
      }

      case "boardSummary":
        return boardSummaryText(ev.view);

      case "status": {
        // A11Y-004: announced assertively, once, on the SEPARATE assertive channel (useGame.ts
        // wires `{kind:"status",...}` to `AnnouncementState.assertive` directly — never
        // concatenated with the polite "moved"/"imminent" fragments above).
        if (ev.status.kind === "won") return `${glyphFor(ev.status.winner)} wins — three boards in a row.`;
        if (ev.status.kind === "draw") return "Draw — all nine boards are closed.";
        return "";
      }
    }
  },

  shareArtifact(_record, _finalView): string {
    // TODO(you): an emoji move-timeline BODY only (<=7 lines) — the shell owns the frame. Not in
    // scope for this UI-focused pass (see the task brief) — left as the scaffold's own TODO.
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

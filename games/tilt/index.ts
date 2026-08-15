// games/tilt/index.ts — GameDefinition assembly (plan §5.1), this game's package root.
// Registered dynamically from games/registry.ts (`loadEngine`/`loadPresentation`) — never
// import this file directly from app/** or packages/shell/** (lint-enforced;
// eslint.config.mjs's registrySplittingBoundary).
//
// UI pass (plan §6, gates green per C45/C49): real announce()/boardDimensions/extraControls.
// shareArtifact()/howSheetFrames are OUT OF SCOPE for this pass (plan §7's own "candidates, not
// commitments" — requires a >=500-game sweep before the format freezes) and are left as TODO,
// matching Nine Grids' own convention of shipping the board pass before the share-artifact pass.
//
// ANNOUNCE COMPOSITION (plan §6.3, packages/shell/src/useGame.ts:502-522): "moved"/"imminent"/
// "boardSummary" compose onto the shell's POLITE live region; "status" fires on the SEPARATE
// assertive channel — but both are set in the SAME state update whenever a move ends the game
// (useGame.ts's own branch: `newStatus.kind !== "ongoing"` sets `assertive` from `status` in the
// identical dispatch that sets `polite` from "moved"), so a tilt-ending win is never a separate,
// delayed announcement — it lands in the same render as the tilt summary, on shell's own two-
// channel design. This is the same shape Nine Grids' A11Y-004 already uses for its own board-win
// announcement; Tilt's "moved" case cannot itself see whether the re-fall ended the game (the
// "moved" GameEvent carries `effects` only, no `view`/`status` — see game-spec's own doc), so the
// win/draw fact is composed in "status", immediately adjacent per the dispatch above, never
// omitted.
import type { GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import type { GameDefinition } from "@twist-arcade/game-spec";
import { SIZE, TILT_PERIOD, tilt, type TiltMove, type TiltState } from "./engine";
import { manifest } from "./manifest";
import { Board } from "./ui/Board";
import { boardSummaryText, glyphFor, tiltProximityAnnouncement } from "./ui/board-view";
import { Telegraph } from "./ui/Telegraph";

// C64 (docs/plans/degeneracy-probes.md): the missing half of the mirrorMove wiring gap the plan
// closes — Tilt's mirrorMove existed and was tested (probes.ts, probes.test.ts) but was never
// re-exported from this package root, so scripts/ci-gates.ts's `resolveMirrorMove` (mirroring
// the `safeMove` convention — games/mine-run/index.ts) could never find it via
// `import("@twist-arcade/tilt")`. Fadeout already did this (its own index.ts); Tilt and Nine
// Grids did not — this repairs Tilt's half.
export { mirrorMove } from "./probes";

function movedText(ev: Extract<GameEvent<TiltState>, { kind: "moved" }>): string {
  const placed = ev.effects.find((e) => e.type === "placed");
  if (!placed || typeof placed.column !== "number") return "";
  const mover = glyphFor(ev.player === 0 ? 0 : 1);
  const column = placed.column + 1; // 1-indexed for players
  let text = `${mover} dropped in column ${column}.`;

  const tilted = ev.effects.some((e) => e.type === "tilted");
  if (tilted) {
    const movedCount = ev.effects.filter((e) => e.type === "moved").length;
    text += ` Board tilted clockwise. ${movedCount} piece${movedCount === 1 ? "" : "s"} resettled.`;
  }
  return text;
}

export const presentation: GamePresentation<TiltState, TiltMove, TiltState> = {
  Board,
  extraControls: Telegraph,

  boardDimensions(_view: TiltState) {
    return { rows: SIZE, cols: SIZE };
  },

  announce(ev: GameEvent<TiltState>): string {
    switch (ev.kind) {
      case "moved":
        return movedText(ev);

      case "imminent":
        // Plan §6.3.1: tilt proximity, same counting source as the static telegraph — fires
        // only within 2 plies of the next tilt.
        return tiltProximityAnnouncement(ev.view.grid, TILT_PERIOD);

      case "boardSummary":
        // On-demand full readback ("Describe board"): the current (post-tilt) grid, always.
        return boardSummaryText(ev.view.grid, { size: SIZE, winLength: 4 });

      case "status": {
        // See this file's module doc for why this carries the win/draw text rather than "moved"
        // — the game-ending fact is never omitted, it lands in the same dispatch as the tilt
        // summary above, on the shell's own two-channel (polite/assertive) design.
        if (ev.status.kind === "won") {
          return `${glyphFor(ev.status.winner === 0 ? 0 : 1)} completed four in a row. ${glyphFor(ev.status.winner === 0 ? 0 : 1)} wins.`;
        }
        if (ev.status.kind === "draw") return "Draw.";
        return "";
      }
    }
  },

  shareArtifact(_record, _finalView): string {
    // TODO(you): T7 work (plan §7) — requires a >=500-game distribution sweep before the emoji
    // move-timeline / stat-line format freezes (C12/C18's lesson: every share-artifact claim is
    // a hypothesis until swept against real generated games). Not in scope for this UI pass.
    return "TODO: share artifact body";
  },

  howSheetFrames: [
    { title: "Drop", body: "Drop a disc into any open column — it falls to the bottom." },
    { title: "Watch the countdown", body: "Every 4th turn, the board rotates and every disc falls again." },
    { title: "Four in a row wins", body: "Connect four discs — by dropping, or by the tilt settling them into place." },
  ],
};

export const definition: GameDefinition<TiltState, TiltMove, TiltState> = {
  manifest,
  engine: tilt,
  presentation,
};

export { tilt, manifest };

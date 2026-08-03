// packages/shell/test/fixtures/crackstep-definition.ts — test-only GameDefinition wrapping the
// engine package's mini-crackstep fixture (solo, maxPlayers: 1, perfect information). Used for
// solo-single-mode useGame tests, where a 2-player manifest (like the ttt fixture) would be
// semantically wrong.

import { miniCrackstep, type CrackstepMove, type CrackstepState } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import type { GameDefinition, GameEvent, GameManifest } from "@twist-arcade/game-spec";

export const crackstepManifest: GameManifest = {
  id: miniCrackstep.meta.id,
  title: "Fixture Crackstep",
  classic: "Crackstep",
  ruleSentence: "A solo fixture used only by shell tests.",
  tags: ["fixture"],
  estMinutes: 1,
  modes: { bot: false, hotseat: false, asyncLink: false },
  players: { min: 1, max: 1 },
  difficultyTiers: [],
  solo: { format: "daily-puzzle" },
};

export const crackstepDefinition: GameDefinition<CrackstepState, CrackstepMove, CrackstepState> = {
  manifest: crackstepManifest,
  engine: miniCrackstep,
  presentation: {
    Board: function TestCrackstepBoard() {
      return null;
    },
    announce(ev: GameEvent<CrackstepState>): string {
      if (ev.kind === "status") {
        if (ev.status.kind === "won") return "Reached the goal.";
        if (ev.status.kind === "lost") return "Stranded.";
      }
      return "";
    },
    shareArtifact(): string {
      return "fixture artifact";
    },
    howSheetFrames: [
      { title: "1", body: "one" },
      { title: "2", body: "two" },
      { title: "3", body: "three" },
    ],
  },
};

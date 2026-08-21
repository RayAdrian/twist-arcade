// packages/shell/test/fixtures/ttt-definition.tsx — a test-only GameDefinition wrapping the
// engine package's classic-ttt fixture. NOT a shipped game (no game team owns this); it exists
// solely so useGame/GameShell tests have a real, open-info, 2-player sequential engine to drive
// through the full seam (manifest + engine + presentation), per the plan's own testing section
// (§11.1: "useGame (renderHook + classic-ttt fixture + scripted driver)").

import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { BoardProps, GameDefinition, GameEvent, GameManifest } from "@twist-arcade/game-spec";
import { moveToCellId } from "../../src/cell-id";
import { Cell } from "../../src/components/Cell";

export const tttManifest: GameManifest = {
  id: classicTicTacToe.meta.id,
  title: "Fixture Tic-Tac-Toe",
  classic: "Tic-Tac-Toe",
  ruleSentence: "A plain reference tic-tac-toe used only by shell tests.",
  tags: ["fixture"],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    { id: "casual", policy: { kind: "random" }, budget: { kind: "deadlineMs", ms: 100 }, minReplyMs: 100 },
    { id: "standard", policy: { kind: "random" }, budget: { kind: "deadlineMs", ms: 250 }, minReplyMs: 250 },
    { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 200 }, minReplyMs: 250 },
  ],
};

function moveOf(ev: GameEvent<TTTState>): TTTMove | null {
  return ev.kind === "moved" ? (ev.move as TTTMove) : null;
}

function TestTTTBoard({ view, legal, seat }: BoardProps<TTTState, TTTMove>) {
  return (
    <>
      {view.board.map((mark, i) => {
        const move: TTTMove = { cell: i };
        const row = Math.floor(i / 3);
        const col = i % 3;
        const contents = mark === null ? "Empty." : mark === 0 ? "X." : "O.";
        return (
          <Cell
            key={i}
            id={moveToCellId(move)}
            row={row}
            col={col}
            occupant={mark === null ? undefined : mark === 0 ? "X" : "O"}
            accessibleName={`Row ${row + 1}, column ${col + 1}. ${contents}`}
            disabled={typeof seat === "number" ? !legal.some((m) => m.cell === i) : true}
          />
        );
      })}
    </>
  );
}

export const tttDefinition: GameDefinition<TTTState, TTTMove, TTTState> = {
  manifest: tttManifest,
  engine: classicTicTacToe,
  presentation: {
    Board: TestTTTBoard,
    announce(ev: GameEvent<TTTState>): string {
      switch (ev.kind) {
        case "moved": {
          const move = moveOf(ev);
          return `Player ${ev.player} placed at cell ${move?.cell ?? "?"}.`;
        }
        case "imminent":
          return "";
        case "boardSummary":
          return `Board has ${ev.view.board.filter((c) => c !== null).length} marks.`;
        case "status":
          if (ev.status.kind === "won") return `Player ${ev.status.winner} won.`;
          if (ev.status.kind === "draw") return "Draw.";
          return "";
      }
    },
    firstOccurrence: [
      {
        flagKey: "first-move",
        trigger: (ev) => ev.kind === "moved",
        text: "First move callout.",
        anchor: (ev) => (ev.kind === "moved" ? moveToCellId({ cell: moveOf(ev)?.cell ?? 0 }) : ""),
      },
    ],
    boardDimensions(): { rows: number; cols: number } {
      return { rows: 3, cols: 3 };
    },
    shareArtifact(): string {
      return "fixture artifact";
    },
    howSheetFrames: [
      { title: "1", body: "one" },
      { title: "2", body: "two" },
      { title: "3", body: "three" },
    ],
    // Fixture-only reason line, used by GameShell.test.tsx to prove GameShell actually wires
    // `presentation.textureLine(finalView)` into ResultModal (it previously had no caller).
    textureLine(finalView: TTTState): string {
      return finalView.board.some((c) => c !== null) ? "Fixture texture line." : "";
    },
  },
};

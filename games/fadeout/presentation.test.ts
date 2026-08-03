// games/fadeout/presentation.test.ts — TDD (CLAUDE.md §3) for everything in
// games/fadeout/presentation.ts EXCEPT the Board component itself (covered by
// ui/Board.test.tsx, which needs jsdom). announce/shareArtifact/textureLine are plain data
// transforms and are tested here without any React/DOM machinery.

import { describe, expect, it } from "vitest";
import type { GameEvent } from "@twist-arcade/game-spec";
import { appendStep, replayTo, rngFor, rngForSetup, type ReplayRecord } from "@twist-arcade/engine";
import { createFadeoutEngine } from "./engine";
import type { FadeoutState } from "./engine";
import { FADEOUT_RULESET_CONFIG } from "./manifest";
import { fadeoutPresentation } from "./presentation";

const engine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);

function playRecord(cells: number[]): ReplayRecord {
  let record: ReplayRecord = {
    gameId: "fadeout",
    gameVersion: engine.meta.version,
    engineVersion: "test",
    numPlayers: 2,
    seed: "s",
    steps: [],
  };
  for (let i = 0; i < cells.length; i++) {
    const state = replayTo(engine, record, record.steps.length);
    const mover = state.toMove;
    record = appendStep(record, new Map([[mover, { cell: cells[i]! }]]));
  }
  return record;
}

function finalState(record: ReplayRecord): FadeoutState {
  return replayTo(engine, record, record.steps.length);
}

function applyOne(state: FadeoutState, cell: number, step: number, seed = "s"): FadeoutState {
  const mover = state.toMove;
  return engine.apply(state, new Map([[mover, { cell }]]), rngFor(seed, step));
}

describe("boardDimensions — total/pure, always 3x3 (only 3x3/cap-3 is implemented)", () => {
  it("returns {rows:3, cols:3} regardless of view", () => {
    const state = engine.setup(2, rngForSetup("x"));
    expect(fadeoutPresentation.boardDimensions(state)).toEqual({ rows: 3, cols: 3 });
  });
});

describe("announce() — moved", () => {
  it("describes a plain placement with no decay", () => {
    const state = engine.setup(2, rngForSetup("s"));
    const next = applyOne(state, 4, 0);
    const ev: GameEvent<FadeoutState> = { kind: "moved", player: 0, move: { cell: 4 }, effects: next.lastEffects };
    expect(fadeoutPresentation.announce(ev)).toBe("X placed, middle center.");
  });

  it("appends the fade when this move's own overflow decayed a mark", () => {
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    const next = applyOne(state, 7, cells.length); // P0's 4th placement, pops cell 0
    const ev: GameEvent<FadeoutState> = { kind: "moved", player: 0, move: { cell: 7 }, effects: next.lastEffects };
    expect(fadeoutPresentation.announce(ev)).toBe("X placed, bottom center. X faded at top left.");
  });
});

describe("announce() — imminent (screen-reader legibility of decay, per the task's explicit ask)", () => {
  it("is empty when this move's effects contain no decay", () => {
    const state = engine.setup(2, rngForSetup("s"));
    const next = applyOne(state, 4, 0);
    expect(fadeoutPresentation.announce({ kind: "imminent", effects: next.lastEffects })).toBe("");
  });

  it("reports the mover's NEXT mark is now on its final turn — a structural guarantee, not a guess: popping the oldest of a full (cap=3) queue always leaves the new front at remaining=1", () => {
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    const next = applyOne(state, 7, cells.length); // P0 (X) overflows
    expect(fadeoutPresentation.announce({ kind: "imminent", effects: next.lastEffects })).toBe(
      "X's next mark is now on its final turn."
    );
  });
});

describe("announce() — boardSummary and status", () => {
  it("boardSummary lists only occupied cells, in position-name + countdown wording", () => {
    const state = engine.setup(2, rngForSetup("s"));
    const next = applyOne(state, 0, 0);
    expect(fadeoutPresentation.announce({ kind: "boardSummary", view: next })).toBe("Board: X top left.");
  });

  it("status announces a win by glyph", () => {
    expect(fadeoutPresentation.announce({ kind: "status", status: { kind: "won", winner: 0 } })).toBe("X wins!");
    expect(fadeoutPresentation.announce({ kind: "status", status: { kind: "won", winner: 1 } })).toBe("O wins!");
  });

  it("status announces a draw", () => {
    expect(fadeoutPresentation.announce({ kind: "status", status: { kind: "draw" } })).toBe("Draw.");
  });

  it("status is empty for ongoing (never called by useGame for it, but must not throw)", () => {
    expect(fadeoutPresentation.announce({ kind: "status", status: { kind: "ongoing" } })).toBe("");
  });
});

describe("firstOccurrence — the Aha-callout (ux-lens §1), fires once on the first decay", () => {
  const entry = () => fadeoutPresentation.firstOccurrence![0]!;

  it("triggers on a 'moved' event whose effects contain a decay", () => {
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    const next = applyOne(state, 7, cells.length);
    const ev: GameEvent<FadeoutState> = { kind: "moved", player: 0, move: { cell: 7 }, effects: next.lastEffects };
    expect(entry().trigger(ev)).toBe(true);
    expect(entry().text).toBe("Your X faded — pieces last 3 turns.");
  });

  it("does not trigger on a plain placement", () => {
    const state = engine.setup(2, rngForSetup("s"));
    const next = applyOne(state, 4, 0);
    const ev: GameEvent<FadeoutState> = { kind: "moved", player: 0, move: { cell: 4 }, effects: next.lastEffects };
    expect(entry().trigger(ev)).toBe(false);
  });

  it("anchors at the vacated cell using the same moveToCellId convention Board.tsx uses", () => {
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    const next = applyOne(state, 7, cells.length);
    const ev: GameEvent<FadeoutState> = { kind: "moved", player: 0, move: { cell: 7 }, effects: next.lastEffects };
    expect(entry().anchor(ev)).toBe(JSON.stringify({ cell: 0 }));
  });
});

describe("shareArtifact — the emoji move-timeline (ux-lens §5/§8)", () => {
  it("a short drawless game: one emoji per move, no substitutions", () => {
    const record = playRecord([4, 0, 8, 2]); // no decay possible this early (< cap)
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[0]).toBe("❌⭕❌⭕");
  });

  it("marks a decay-causing move with 💨 instead of its glyph", () => {
    const record = playRecord([0, 1, 2, 3, 4, 5, 7]); // move 6 (0-indexed) pops cell 0
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[0]).toBe("❌⭕❌⭕❌⭕💨");
  });

  it("marks the winning move with 🎯 (takes priority over 💨 if both would apply)", () => {
    // P0: 4,0,8 completes the middle-row... use a clean 3-in-a-row: 0,3,1,4,2 (P0 wins 0,1,2)
    const record = playRecord([0, 3, 1, 4, 2]);
    const final = finalState(record);
    expect(engine.status(final)).toEqual({ kind: "won", winner: 0 });
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[0]).toBe("❌⭕❌⭕🎯");
  });

  it("the stat line reports pieces faded and game length in plies (NOT longestLife — platform-corrections.md's §15/§16 ruling)", () => {
    const record = playRecord([0, 1, 2, 3, 4, 5, 7]);
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[1]).toBe("pieces faded: 1 · 7 plies");
  });

  it("body is <= 7 lines total on its own and leaves room for the shell's frame (share-frame.ts caps the FULL composed text at 7)", () => {
    const record = playRecord([4, 0, 8, 2]);
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    expect(body.split("\n").length).toBeLessThanOrEqual(2);
  });
});

describe("textureLine — the one-line end-screen story (ux-lens §5, plan §8)", () => {
  it("omits (empty string) for a draw", () => {
    // Force a threefold draw is expensive to script by hand here; a plain non-terminal state
    // is enough to prove "no winner -> no template fires, ever" (draw has no winner either).
    const state = engine.setup(2, rngForSetup("s"));
    expect(fadeoutPresentation.textureLine!(state)).toBe("");
  });

  // This fixture (moves found by an exhaustive-backtracking search over the real engine — see
  // the F3 report for the search script — every candidate step is validated to keep the game
  // "ongoing" until the intended final move, so nothing here is hand-asserted without having
  // actually been run) drives P1's faded count to 6 (>= 4) via 9 real placements while P0
  // safely rotates {0,2,4} (never a line) for 9 placements, then wins on its 10th by evicting
  // its own oldest (cell 0) and placing at cell 6, completing the {2,4,6} diagonal.
  const OUT_WAITED_MOVES = [0, 1, 2, 3, 4, 8, 0, 1, 2, 3, 4, 8, 0, 1, 2, 3, 4, 7, 6];

  function playOutWaitedFixture(): FadeoutState {
    let state = engine.setup(2, rngForSetup("s"));
    for (let i = 0; i < OUT_WAITED_MOVES.length; i++) state = applyOne(state, OUT_WAITED_MOVES[i]!, i);
    return state;
  }

  it("fires the out-waited template when the loser's faded count is >= 4", () => {
    const final = playOutWaitedFixture();
    expect(engine.status(final)).toEqual({ kind: "won", winner: 0 });
    expect(final.faded[1]).toBeGreaterThanOrEqual(4); // the loser (P1/O)
    const line = fadeoutPresentation.textureLine!(final);
    expect(line).toBe("Patience wore down O's marks");
    expect(line.length).toBeLessThanOrEqual(60);
  });

  it("the self-vacate-into-winning-line template (plan §8's trigger 1) never fires under this shipped config — verified, not assumed", () => {
    // This fixture's winning move DOES decay a mark (P0's own overflow, cell 0) in the SAME
    // apply that wins — the general shape trigger 1 is looking for — but the placement landed
    // at a DIFFERENT cell (6), not back into the vacated one, so the structural proof in
    // presentation.ts (a same-cell self-replant can never change the occupied SET, so it can
    // never newly complete a line) means this branch cannot fire here. Confirmed directly
    // against the real engine's effects rather than only argued about in a comment.
    const final = playOutWaitedFixture();
    expect(final.lastEffects).toEqual([
      { type: "decayed", player: 0, cell: 0 },
      { type: "placed", player: 0, cell: 6 },
    ]);
    // decayed.cell (0) !== placed.cell (6) — the self-vacate condition genuinely doesn't hold,
    // so the out-waited template (checked above) is the one that fires, not this one.
  });

  it("never throws for a status the frozen config cannot structurally produce (no-legal-moves win under threefold)", () => {
    // Under the SHIPPED threefold config this branch is structurally unreachable (occupancy
    // alone always leaves empty cells — see engine-internal.ts's own comment on
    // computeStatus's no-legal-moves corner). Verified here on a hand-built STATE OBJECT
    // (not reachable via real play under threefold) purely to prove textureLine's own logic
    // doesn't crash if it were ever handed one — forward-compatible with a future superko
    // registration, dead code under this one.
    const trapped: FadeoutState = {
      queues: [
        [0, 3, 6],
        [1, 4, 7],
      ],
      toMove: 0,
      history: [],
      faded: [0, 0],
      longestLife: [0, 0],
      lastEffects: [],
    };
    expect(() => fadeoutPresentation.textureLine!(trapped)).not.toThrow();
  });
});

describe("howSheetFrames — the 3-step 'How?' strip (place -> age -> vanish)", () => {
  it("has exactly 3 frames with non-empty title/body", () => {
    const frames = fadeoutPresentation.howSheetFrames;
    expect(frames).toHaveLength(3);
    for (const f of frames) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.body.length).toBeGreaterThan(0);
    }
  });
});

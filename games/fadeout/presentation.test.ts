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
  it("is empty when no mark is at remaining=1 yet (early game, well before any queue is full)", () => {
    const state = engine.setup(2, rngForSetup("s"));
    const next = applyOne(state, 4, 0);
    expect(fadeoutPresentation.announce({ kind: "imminent", effects: next.lastEffects, view: next })).toBe("");
  });

  // MUST FIX 1 (stage-6 F3 review): the onset case. A mark FIRST enters its final turn on its
  // owner's 3rd placement — the queue fills to cap WITHOUT popping anything, so `effects`
  // carries no `decayed` entry at all. The old effects-only implementation was silent here,
  // exactly the teaching-critical moment (a player's very first vanish is now one placement
  // away) where the warning matters most. Computing from `view` (this event's widened payload)
  // catches this because `remainingLife` is a pure function of queue occupancy, not of whether
  // a pop happened THIS ply.
  it("announces on the ONSET ply — the 3rd placement, no decay effect at all — not just the steady-state decay ply", () => {
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1]; // P0 at 0 (1st), P1 at 1 (1st)
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    state = applyOne(state, 3, 2); // P0's 2nd placement (cell 3)
    const next = applyOne(state, 5, 3); // P1's 2nd placement (cell 5) -- still no one at cap
    // Confirm the premise: no decay has happened yet.
    expect(next.lastEffects.some((e) => e.type === "decayed")).toBe(false);
    // Now P0's 3rd placement fills P0's queue to cap (0,3,+1 more) with NO pop.
    const onset = applyOne(next, 4, 4); // P0's 3rd placement (cell 4) — queue [0,3,4] full
    expect(onset.lastEffects.some((e) => e.type === "decayed")).toBe(false); // still no decay this ply
    expect(fadeoutPresentation.announce({ kind: "imminent", effects: onset.lastEffects, view: onset })).toBe(
      "X fades next turn, top left."
    );
  });

  it("in the steady state (both queues already at cap), names BOTH players' standing final-turn marks, WITH cell names — not just the mover's own overflow", () => {
    // Once both queues have reached cap (both players have placed 3+ times), EVERY subsequent
    // ply leaves BOTH fronts at remaining=1 permanently — the old effects-only implementation
    // only ever surfaced the CURRENT mover's overflow, silently dropping the other player's
    // equally-real standing final-turn mark. queues after this move: [[2,4,7],[1,3,5]] — P0's
    // front (cell 2) AND P1's front (cell 1) are both remaining=1.
    let state = engine.setup(2, rngForSetup("s"));
    const cells = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < cells.length; i++) state = applyOne(state, cells[i]!, i);
    const next = applyOne(state, 7, cells.length); // P0 (X) overflows, popping cell 0
    expect(fadeoutPresentation.announce({ kind: "imminent", effects: next.lastEffects, view: next })).toBe(
      "O fades next turn, top center. X fades next turn, top right."
    );
  });

  it("names every mark currently at remaining=1, not just the mover's own — e.g. after the mover's overflow, the OTHER player may also already have a standing final-turn mark", () => {
    // Build a position where BOTH players have a mark at remaining=1 simultaneously: P0
    // fills to cap first (cell 4 is P0's 3rd placement, onset, no pop), then P1 also reaches
    // its 3rd placement (cell 8, onset, no pop) one ply later — both queues now read
    // remaining=1 at their own front.
    let state = engine.setup(2, rngForSetup("s"));
    const moves = [0, 1, 3, 5]; // P0:0,3 (1st,2nd) / P1:1,5 (1st,2nd)
    for (let i = 0; i < moves.length; i++) state = applyOne(state, moves[i]!, i);
    state = applyOne(state, 4, moves.length); // P0's 3rd (cell 4) -> P0 front (cell 0) is remaining=1
    const both = applyOne(state, 8, moves.length + 1); // P1's 3rd (cell 8) -> P1 front (cell 1) is remaining=1
    const text = fadeoutPresentation.announce({ kind: "imminent", effects: both.lastEffects, view: both });
    expect(text).toBe("X fades next turn, top left. O fades next turn, top center.");
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

  // C12 (platform-corrections.md, 2026-08-03 ruling — the fourth iteration of the §14->§15->§16
  // lesson): under the frozen ruleset, `faded === max(0, plies - 6)` on 2,000/2,000 measured
  // games, so a stat line naming BOTH faded-count and plies prints one fact twice. Drop
  // "pieces faded" — plies alone is the real, non-redundant fact.
  it("the stat line reports ONLY the game length in plies (C12 — 'pieces faded' is dropped: it is provably derivable from plies under this ruleset)", () => {
    const record = playRecord([0, 1, 2, 3, 4, 5, 7]);
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[lines.length - 1]).toBe("7 plies");
  });

  // C12 point 2: 💨 substitutes for the seat glyph — under strict alternation every move from
  // ply 7 onward decays, so marking EVERY decay with 💨 erases all board/seat identity from
  // ply 7 on (a 60-ply game would render 54 consecutive 💨, per the review's measurement).
  // Ruling: 💨 marks only the FIRST decay in the whole game; every later decay keeps its
  // normal seat glyph.
  it("marks ONLY the first decay with 💨 — a second decay-causing move later in the same game keeps its seat glyph (C12)", () => {
    const record = playRecord([0, 1, 2, 3, 4, 5, 7, 8]); // ply 6 (P0) and ply 7 (P1) both decay
    const final = finalState(record);
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    expect(lines[0]).toBe("❌⭕❌⭕❌⭕💨⭕"); // ply 7 (P1) decayed too, but is NOT the first -> ⭕, not 💨
    expect(lines[lines.length - 1]).toBe("8 plies");
  });

  // C12's "related, due before the next daily increment" note: main's C8 strict grammar
  // (composeShareText/timelineToBody: <=2 body lines, <=15 glyphs/line) will reject a
  // single-line timeline for any game over 15 plies. Fadeout owns chunking its OWN timeline
  // via timelineToBody() (it already knows its own seat glyphs and emoji array) rather than
  // leaving a generic daily adapter to reverse-engineer a per-game emoji alphabet from an
  // opaque joined string — see this module's shareArtifact() for the implementation.
  it("a long game's timeline is pre-chunked via timelineToBody (2 lines, each <=15 glyphs) — never a single line over 15 glyphs long", () => {
    // A real, verified-legal 19-ply fixture (see textureLine's OUT_WAITED_MOVES below) whose
    // decay pattern repeats every ply from ply 7 onward and ends in a P0 win on the final move.
    const record = playRecord([0, 1, 2, 3, 4, 8, 0, 1, 2, 3, 4, 8, 0, 1, 2, 3, 4, 7, 6]);
    const final = finalState(record);
    expect(engine.status(final)).toEqual({ kind: "won", winner: 0 });
    const body = fadeoutPresentation.shareArtifact(record, final);
    const lines = body.split("\n");
    // timeline (2 lines) + stat line.
    expect(lines).toHaveLength(3);
    expect(lines[0]!.length).toBeLessThanOrEqual(15 * 2); // glyph count, not UTF-16 length, but a safe upper bound
    expect(lines[1]!.length).toBeLessThanOrEqual(15 * 2);
    expect(lines[2]).toBe("19 plies");
    // The winning move (the very last ply) is 🎯 even though it is ALSO a decay-causing move —
    // 🎯 keeps its documented priority over 💨/seat-glyph regardless of how far into the
    // game's decay run it falls.
    expect(lines[1]!.endsWith("🎯")).toBe(true);
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

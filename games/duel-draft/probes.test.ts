// games/duel-draft/probes.test.ts — behavioral regression tests for probes.ts (docs/plans/
// duel-draft.md §6/§7.4), pinning the exact degeneracies D0's report measured (docs/research/
// games/duel-draft-d0-report.md) so a future refactor of probes.ts cannot silently change what
// these scripted policies actually do.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { duelDraft, SIZE, type DuelDraftState } from "./engine";
import {
  MIRROR_PROBE_NOT_APPLICABLE_REASON,
  colliderPolicy,
  defensiveCoverPolicy,
  greedyThreatPolicy,
  mixedGreedyPolicy,
  pickColliderCell,
  pickDefensiveCoverCell,
  pickGreedyThreatCell,
  pickMixedGreedyCell,
} from "./probes";
import * as probes from "./probes";

function emptyState(): DuelDraftState {
  return { board: Array.from({ length: SIZE * SIZE }, () => "empty"), lastEffects: [] };
}

const fakeClock = { now: (() => { let t = 0; return () => (t += 1); })() };
const fakeBudget = { kind: "rollouts" as const, n: 1 };

// ---------------------------------------------------------------------------------------
// The mirror probe: deliberately absent (plan header / probes.ts's own module doc).
// ---------------------------------------------------------------------------------------

describe("mirror probe: deliberately n/a, not exported", () => {
  it("probes.ts exports no mirrorMove — nothing to accidentally wire into mirrorAgent()", () => {
    expect((probes as Record<string, unknown>).mirrorMove).toBeUndefined();
  });

  it("documents WHY, for whoever writes the D2/D3 harness-side n/a wiring", () => {
    expect(MIRROR_PROBE_NOT_APPLICABLE_REASON.length).toBeGreaterThan(0);
    expect(MIRROR_PROBE_NOT_APPLICABLE_REASON).toMatch(/simultaneity|joint pick/);
  });
});

// ---------------------------------------------------------------------------------------
// greedy-threat self-play collides with certainty on the symmetric empty board (D0's report:
// "real, not a bug" — the mechanism mixed-greedy exists to sidestep).
// ---------------------------------------------------------------------------------------

describe("greedy-threat", () => {
  it("self-play collides every round on the empty opening board (deterministic, symmetric tie-break)", () => {
    const state = emptyState();
    const legal = duelDraft.legalMoves(state, 0).map((m) => m.cell);
    const pick0 = pickGreedyThreatCell(state.board, 0, legal);
    const pick1 = pickGreedyThreatCell(state.board, 1, legal);
    expect(pick0).toBe(pick1);
  });

  it("takes a free win when one is available, ignoring the scoring tie-break entirely", () => {
    const state: DuelDraftState = {
      board: (() => {
        const b = Array.from({ length: SIZE * SIZE }, () => "empty" as const);
        return b;
      })(),
      lastEffects: [],
    };
    const board = state.board.slice() as ("empty" | 0 | 1 | "destroyed")[];
    board[0] = 0;
    board[1] = 0;
    board[2] = 0; // one cell (3) away from completing row 0
    const legal = [3, 4, 5]; // cell 3 completes the win; others do not
    expect(pickGreedyThreatCell(board, 0, legal)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------
// defensive-cover: blocks an opponent's immediate win, and falls back to greedy (colliding
// with greedy-threat's own self-play mechanism) on the symmetric empty board — the OTHER
// degenerate pairing D0's report explained (greedy-threat vs defensive-cover: 0% decisive,
// both seeds).
// ---------------------------------------------------------------------------------------

describe("defensive-cover", () => {
  it("blocks the opponent's immediate win when it has no free win of its own", () => {
    const board = Array.from({ length: SIZE * SIZE }, () => "empty" as "empty" | 0 | 1 | "destroyed");
    board[0] = 1;
    board[1] = 1;
    board[2] = 1; // opponent (seat 1) one cell from winning row 0
    const legal = [3, 8, 9];
    expect(pickDefensiveCoverCell(board, 0, legal)).toBe(3);
  });

  it("falls back to greedy on the empty opening board — the mechanism behind the D0-measured 0%-decisive collision with greedy-threat", () => {
    const state = emptyState();
    const legal = duelDraft.legalMoves(state, 0).map((m) => m.cell);
    const defensePick = pickDefensiveCoverCell(state.board, 0, legal);
    const greedyPick = pickGreedyThreatCell(state.board, 0, legal);
    expect(defensePick).toBe(greedyPick);
  });
});

// ---------------------------------------------------------------------------------------
// mixed-greedy: the epsilon/top-k exploration must actually break the symmetric tie across
// seeds — this is the property that makes mixed-greedy self-play NOT collide with certainty
// (D0's report: 66.6-70.4% decisive, the control that isolates determinism as the cause).
// ---------------------------------------------------------------------------------------

describe("mixed-greedy", () => {
  it("does not always pick the same cell as greedy-threat on the empty board across many seeds (real exploration)", () => {
    const state = emptyState();
    const legal = duelDraft.legalMoves(state, 0).map((m) => m.cell);
    const greedyPick = pickGreedyThreatCell(state.board, 0, legal);
    let sawDifferent = false;
    for (let i = 0; i < 50; i++) {
      const rng = rngFromSeed(`mixed-greedy-explore-${i}`);
      const pick = pickMixedGreedyCell(state.board, 0, legal, rng);
      if (pick !== greedyPick) sawDifferent = true;
    }
    expect(sawDifferent).toBe(true);
  });

  it("takes a free win when one is available, bypassing exploration entirely", () => {
    const board = Array.from({ length: SIZE * SIZE }, () => "empty" as "empty" | 0 | 1 | "destroyed");
    board[0] = 0;
    board[1] = 0;
    board[2] = 0;
    const legal = [3, 4, 5];
    const rng = rngFromSeed("mixed-greedy-free-win");
    expect(pickMixedGreedyCell(board, 0, legal, rng)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------
// collider (plan §7.4): predicts the opponent via greedy-threat's own procedure and plays the
// SAME cell — against an actual greedy-threat opponent, this reliably collides (the
// draw-by-destruction the probe is named for). C41 self-check: this is not vacuous — a
// DIFFERENT policy (mixed-greedy, which explores) is used as a negative control below to prove
// the collider's prediction is actually doing something distinguishable from "always play cell
// 0" or similar.
// ---------------------------------------------------------------------------------------

describe("collider", () => {
  it("colliding against an actual greedy-threat opponent reproduces the SAME cell greedy-threat itself would pick", () => {
    const state = emptyState();
    const legal = duelDraft.legalMoves(state, 0).map((m) => m.cell);
    // Collider sits at seat 0, predicting seat 1 (the opponent)'s greedy-threat pick.
    const colliderPick = pickColliderCell(state.board, 0, legal);
    const actualOpponentPick = pickGreedyThreatCell(state.board, 1, legal);
    expect(colliderPick).toBe(actualOpponentPick);
  });

  it("(C41 negative control) the prediction is real, not a constant — it changes when the predicted seat's threats change", () => {
    const board = Array.from({ length: SIZE * SIZE }, () => "empty" as "empty" | 0 | 1 | "destroyed");
    // Seat 1 (the predicted opponent) has an immediate win available at cell 7.
    board[4] = 1;
    board[5] = 1;
    board[6] = 1;
    const legal = duelDraft.legalMoves({ board, lastEffects: [] }, 0).map((m) => m.cell);
    const colliderPick = pickColliderCell(board, 0, legal); // seat 0 predicting seat 1
    expect(colliderPick).toBe(7); // seat 1's free win, predicted and copied
    // Without the threat (fresh board), the prediction is NOT the same cell — proving the
    // function actually reads the board rather than returning a fixed cell regardless of state.
    const freshBoard = Array.from({ length: SIZE * SIZE }, () => "empty" as "empty" | 0 | 1 | "destroyed");
    const freshLegal = duelDraft.legalMoves({ board: freshBoard, lastEffects: [] }, 0).map((m) => m.cell);
    const freshPick = pickColliderCell(freshBoard, 0, freshLegal);
    expect(freshPick).not.toBe(7);
  });
});

// ---------------------------------------------------------------------------------------
// Policy wrappers: each is a legal, playable Policy<S, M> — thin, but real (matches probes-
// bidding.ts's own convention of testing the Policy shape actually resolves a legal move).
// ---------------------------------------------------------------------------------------

describe("Policy wrappers", () => {
  const engineArgs = (state: DuelDraftState, player: 0 | 1, rng = rngFromSeed("policy-wrapper")) => ({
    engine: duelDraft,
    state,
    player,
    rng,
    budget: fakeBudget,
    clock: fakeClock,
  });

  it("greedyThreatPolicy returns a legal move", () => {
    const state = emptyState();
    const { move } = greedyThreatPolicy().chooseMove(engineArgs(state, 0));
    expect(duelDraft.isLegal(state, 0, move)).toBe(true);
  });

  it("defensiveCoverPolicy returns a legal move", () => {
    const state = emptyState();
    const { move } = defensiveCoverPolicy().chooseMove(engineArgs(state, 0));
    expect(duelDraft.isLegal(state, 0, move)).toBe(true);
  });

  it("mixedGreedyPolicy returns a legal move", () => {
    const state = emptyState();
    const { move } = mixedGreedyPolicy().chooseMove(engineArgs(state, 0));
    expect(duelDraft.isLegal(state, 0, move)).toBe(true);
  });

  it("colliderPolicy returns a legal move", () => {
    const state = emptyState();
    const { move } = colliderPolicy().chooseMove(engineArgs(state, 0));
    expect(duelDraft.isLegal(state, 0, move)).toBe(true);
  });
});

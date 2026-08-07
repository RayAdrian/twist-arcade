// games/mine-run/index.test.ts — the presentation assembly (mine-run.md §8): boardDimensions,
// the announce() dispatch wiring (the pure per-kind logic itself is covered directly in
// ui/announce.test.ts — this file proves the SWITCH routes each GameEvent kind to it), the two
// firstOccurrence triggers/anchors, shareArtifact's real-effects glyph sequence + grammar
// legality against the shell's shared alphabet, and textureLine's one honestly-computable case.
// Mirrors games/tilt/index.test.ts's own "drive real engine.apply(), never hand-mock effects"
// discipline.

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { moveToCellId } from "@twist-arcade/shell";
import { DEFAULT_BUDGET, DEFAULT_HEIGHT, DEFAULT_WIDTH, mineRun } from "./engine";
import type { MineRunMove, MineRunState } from "./engine";
import { definition, mineRunShareSymbols, presentation } from "./index";

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => xs.slice() };

function baseState(mines: number[], revealsLeft: number): MineRunState {
  return {
    mines: [...mines].sort((a, b) => a - b),
    revealed: [],
    exploded: [],
    streakLen: 0,
    streakValue: 0,
    banked: 0,
    revealsLeft,
    lastEffects: [],
  };
}

function apply(state: MineRunState, move: MineRunMove): MineRunState {
  return mineRun.apply(state, new Map([[0, move]]), NO_OP_RNG);
}

describe("presentation.boardDimensions — the frozen 10x10 board (R1: not a tunable, width/height fixed)", () => {
  it("returns the real launch board size regardless of the view passed in (pure/total per the contract)", () => {
    const view = mineRun.playerView(mineRun.setup(1, rngForSetup("dims")), 0);
    expect(presentation.boardDimensions(view)).toEqual({ rows: DEFAULT_HEIGHT, cols: DEFAULT_WIDTH });
  });
});

describe("presentation.announce — dispatches every GameEvent kind (the pure per-kind text is covered in ui/announce.test.ts)", () => {
  it("'moved': routes to movedText", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    const str = presentation.announce({ kind: "moved", player: 0, move: { t: "reveal", cell: 45 }, effects: next.lastEffects });
    expect(str).toBe("Row 5, column 6: 2. Two neighbouring mines.");
  });

  it("'imminent': routes to imminentTrailer", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    const view = mineRun.playerView(next, 0);
    const str = presentation.announce({ kind: "imminent", effects: next.lastEffects, view });
    expect(str).toBe(`Streak 1, worth 1. ${DEFAULT_BUDGET - 1} reveals left.`);
  });

  it("'boardSummary': routes to boardSummaryText", () => {
    const view = mineRun.playerView(mineRun.setup(1, rngForSetup("summary")), 0);
    const str = presentation.announce({ kind: "boardSummary", view });
    expect(str).toContain(`${DEFAULT_WIDTH} by ${DEFAULT_HEIGHT} board.`);
  });

  it("'status': routes to statusText", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "scored", scores: [42] } });
    expect(str).toBe("Run over. Final score 42.");
  });
});

describe("presentation.firstOccurrence — the two teachable firsts (mine-run.md §8.3)", () => {
  const [mineEntry, bankEntry] = presentation.firstOccurrence!;

  it("mine entry fires on a moved event carrying an 'exploded' effect, anchored at that cell's reveal-move id", () => {
    let state = baseState([45, 99], DEFAULT_BUDGET);
    state = apply(state, { t: "reveal", cell: 34 }); // build a streak first, off the mine
    const next = apply(state, { t: "reveal", cell: 45 }); // the mine
    const ev = { kind: "moved" as const, player: 0 as const, move: { t: "reveal", cell: 45 }, effects: next.lastEffects };
    expect(mineEntry!.trigger(ev)).toBe(true);
    expect(mineEntry!.anchor(ev)).toBe(moveToCellId({ t: "reveal", cell: 45 } satisfies MineRunMove));
  });

  it("mine entry does NOT fire on a plain safe reveal", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    const ev = { kind: "moved" as const, player: 0 as const, move: { t: "reveal", cell: 45 }, effects: next.lastEffects };
    expect(mineEntry!.trigger(ev)).toBe(false);
  });

  it("bank entry fires on a moved event carrying a 'banked' effect, with a non-string (degraded-fallback) anchor", () => {
    let state = baseState([34, 46], DEFAULT_BUDGET);
    state = apply(state, { t: "reveal", cell: 45 });
    const next = apply(state, { t: "bank" });
    const ev = { kind: "moved" as const, player: 0 as const, move: { t: "bank" }, effects: next.lastEffects };
    expect(bankEntry!.trigger(ev)).toBe(true);
    expect(typeof bankEntry!.anchor(ev)).not.toBe("string");
  });

  it("bank entry does NOT fire on a plain safe reveal", () => {
    const state = baseState([34, 46], DEFAULT_BUDGET);
    const next = apply(state, { t: "reveal", cell: 45 });
    const ev = { kind: "moved" as const, player: 0 as const, move: { t: "reveal", cell: 45 }, effects: next.lastEffects };
    expect(bankEntry!.trigger(ev)).toBe(false);
  });
});

describe("mineRunShareSymbols / shareArtifact — bare HOUSE_ALPHABET glyphs only (packages/shell/src/share-frame.ts's fixed alphabet)", () => {
  it("emits one 🏦 per bank and one 💥 per mine hit, in order, nothing else", () => {
    const engine = mineRun;
    let state = engine.setup(1, rngForSetup("share-seed"));
    const moves: MineRunMove[] = [];
    let bankedOnce = false;
    let explodedOnce = false;
    for (let step = 0; step < 30 && engine.status(state).kind === "ongoing"; step++) {
      const legal = engine.legalMoves(state, 0);
      let move: MineRunMove | undefined;
      if (!bankedOnce && state.streakLen >= 1) {
        move = { t: "bank" };
        bankedOnce = true;
      } else {
        move = legal.find((m) => m.t === "reveal");
      }
      if (!move) break;
      moves.push(move);
      const wasMine = move.t === "reveal" && state.mines.includes(move.cell);
      state = engine.apply(state, new Map([[0, move]]), rngFor("share-seed", step));
      if (wasMine) explodedOnce = true;
      if (bankedOnce && explodedOnce) break;
    }
    expect(bankedOnce).toBe(true);

    const record = {
      gameId: "mine-run",
      gameVersion: 1,
      engineVersion: "test",
      numPlayers: 1,
      seed: "share-seed",
      steps: moves.map((m) => ({ moves: [[0, m] as [number, MineRunMove]] })),
    };
    const symbols = mineRunShareSymbols(record);
    expect(symbols.length).toBeGreaterThan(0);
    for (const s of symbols) expect(["\u{1F3E6}", "\u{1F4A5}"]).toContain(s);

    const finalView = engine.playerView(state, 0);
    const artifact = presentation.shareArtifact(record, finalView);
    // Grammar legality against the shell's own alphabet (packages/shell/src/share-frame.ts):
    // every character in the body line(s) must be a bare HOUSE_ALPHABET glyph, no digits, no
    // spaces — this is the exact class of mismatch found while implementing (see index.ts's
    // module doc). Body is every line except the last (the stat line).
    const lines = artifact.split("\n");
    const bodyLines = lines.slice(0, -1);
    for (const line of bodyLines) {
      for (const ch of line) {
        if (ch === "\u{2026}") continue; // truncation marker, allowed leading character
        expect(["\u{1F3E6}", "\u{1F4A5}"]).toContain(ch);
      }
    }
    const statLine = lines[lines.length - 1]!;
    expect(statLine.length).toBeLessThanOrEqual(42);
  });

  it("no bank, no mine: the stat line reads 'never lost a point'", () => {
    const record = { gameId: "mine-run", gameVersion: 1, engineVersion: "test", numPlayers: 1, seed: "x", steps: [] as { moves: [number, MineRunMove][] }[] };
    const finalView = mineRun.playerView(mineRun.setup(1, rngForSetup("x")), 0);
    const artifact = presentation.shareArtifact(record, finalView);
    expect(artifact.endsWith("never lost a point")).toBe(true);
  });
});

describe("presentation.textureLine — only the one honestly-computable template (see index.ts's module doc for why the other two are out of reach)", () => {
  it("fires 'Never gambled, never lost' when a terminal view has zero exploded and zero banked", () => {
    const view = mineRun.playerView(mineRun.setup(1, rngForSetup("texture-a")), 0);
    expect(presentation.textureLine!({ ...view, minesExploded: 0, banked: 0 })).toContain("Never gambled");
  });

  it("returns '' once anything has been banked or a mine has been hit", () => {
    const view = mineRun.playerView(mineRun.setup(1, rngForSetup("texture-b")), 0);
    expect(presentation.textureLine!({ ...view, minesExploded: 0, banked: 12 })).toBe("");
    expect(presentation.textureLine!({ ...view, minesExploded: 1, banked: 0 })).toBe("");
  });
});

describe("presentation.howSheetFrames — exactly 3 frames (game-spec's frozen tuple contract)", () => {
  it("has 3 frames, each with a title and body", () => {
    expect(presentation.howSheetFrames).toHaveLength(3);
    for (const f of presentation.howSheetFrames) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.body.length).toBeGreaterThan(0);
    }
  });
});

describe("definition — the assembled GameDefinition matches the manifest/engine this presentation was built for", () => {
  it("wires the real engine and manifest, id-consistent", () => {
    expect(definition.engine).toBe(mineRun);
    expect(definition.manifest.id).toBe(mineRun.meta.id);
    expect(definition.presentation).toBe(presentation);
  });
});

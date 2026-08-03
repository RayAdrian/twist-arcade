// games/mine-run/test/redaction-mutant.test.ts
//
// TDD anchor (docs/plans/mine-run.md §3.2, §10): "Mutant test: a planted variant whose
// apply() emits `{ type: "nearMiss", mineAt: … }` must fail the redaction property." Models a
// realistic future bug shape (a debug/telemetry "warmer/colder" effect that embeds a raw
// unrevealed mine position) and proves engineContract's checkRedaction actually catches it —
// not just that the real engine happens to be clean. Also covers the plan's two other
// structural redaction assertions: "Object.keys(view.cells) ⊆ revealed" across random
// playouts, and that the SHIPPING engine never fails this property.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { checkRedaction } from "@twist-arcade/engine/testkit/checks";
import type { GameEngine } from "@twist-arcade/engine";
import { createMineRun, neighbors, countAdjacentMines } from "../engine";
import type { MineRunCellView, MineRunMove, MineRunState, MineRunView } from "../engine";
import { makeMineRunSecretExtractor } from "../secret";

/**
 * A SECOND, test-local secretExtractor tuned differently from secret.ts's production
 * `makeMineRunSecretExtractor`. That one is anchored to the exact structural JSON shape a
 * leaked mine produces (`"<cell>":{"mine":true}`) plus the literal `"mines":[` field-name
 * fragment (see secret.ts's module doc comment for why it moved away from an earlier,
 * artificially-tagged-string design) — but that structural anchor is specific to how
 * `{mine:true}` cells serialize, so it can only ever catch a leak of THAT shape. The plan's
 * own worked example bug (`{ type: "nearMiss", mineAt: <bare cell index> }`) leaks the RAW
 * number under a DIFFERENT, predictable key — so proving the harness catches *that* shape
 * needs an extractor anchored to the `"mineAt":` key context specifically (the same
 * targeted-to-the-planted-bug approach packages/engine's own mutants.ts uses for its
 * fog/effects-leak mutants: `String(s.secret)` is tailored to THAT fixture's one field name,
 * not a generic-purpose detector either).
 *
 * A first attempt at this extractor used a bare, un-anchored numeric substring search
 * (`:${m},` / `:${m}}` / ...) and it genuinely false-positived: on this 5x5/8-mine board, a
 * mine's cell index is frequently a single digit (0-8), which collides constantly with
 * legitimate `"n":<0-8>` reveal counts elsewhere in the SAME view. Anchoring on the specific
 * `"mineAt":` key eliminates that false-positive class entirely while still catching the
 * exact planted shape.
 */
function makeBareValueSecretExtractor(totalCells: number) {
  return (stateUnknown: unknown, viewer: number): string[] => {
    const state = stateUnknown as MineRunState;
    const safeTotal = totalCells - state.mines.length;
    const safeRevealed = state.revealed.length - state.exploded.length;
    const ongoing = state.revealsLeft > 0 && safeRevealed < safeTotal;
    if (viewer === -1 && !ongoing) return []; // spectator-terminal reveal is explicitly allowed
    const exploded = new Set(state.exploded);
    const tokens: string[] = [];
    for (const m of state.mines) {
      if (exploded.has(m)) continue;
      tokens.push(`"mineAt":${m}}`, `"mineAt":${m},`);
    }
    return tokens;
  };
}

const WIDTH = 5;
const HEIGHT = 5;
const MINES = 8; // dense enough that a random reveal lands adjacent to an unrevealed mine often
const BUDGET = 15;
const TOTAL_CELLS = WIDTH * HEIGHT;

function makeNearMissMutant(): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const base = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
  return {
    ...base,
    apply(state, moves, rng) {
      const real = base.apply(state, moves, rng);
      const move = moves.get(0);
      if (move && move.t === "reveal") {
        const minesSet = new Set(state.mines);
        const revealedSet = new Set(state.revealed);
        if (!minesSet.has(move.cell)) {
          // BUG: leak the position of any adjacent unrevealed mine via a "debug" effect,
          // exactly the shape the plan warns about — a near-miss/warmer-colder hint that
          // embeds the raw secret instead of a redacted signal.
          for (const nb of neighbors(move.cell, WIDTH, HEIGHT)) {
            if (minesSet.has(nb) && !revealedSet.has(nb)) {
              return { ...real, lastEffects: [...real.lastEffects, { type: "nearMiss", mineAt: nb }] };
            }
          }
        }
      }
      return real;
    },
    playerView(state, player) {
      // BUG: playerView still calls the real cell-redaction logic (`cells` stays correctly
      // omission-based — proving the mutant's leak is NOT a broken cell redaction), but
      // forgets to pass lastEffects through the allowlist filter, leaking the nearMiss effect
      // straight out.
      const real = base.playerView(state, player);
      return { ...real, lastEffects: state.lastEffects };
    },
  };
}

/**
 * Reproduces the exact regression the Fable review demonstrated defeats the OLD tagged-token
 * secretExtractor: engine.ts's spectator carve-out guard is
 * `player === null && status.kind !== "ongoing"`; drop the `status.kind !== "ongoing"` conjunct
 * and the FULL mine layout leaks to any spectator, mid-run included. This mutant reimplements
 * playerView's spectator-terminal branch verbatim but gates it on `player === null` alone,
 * exactly mirroring what a one-line regression in engine.ts would produce.
 */
function makeSpectatorCarveOutRegressionMutant(
  width: number,
  height: number,
  mines: number,
  budget: number
): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const base = createMineRun({ width, height, mines, budget });
  return {
    ...base,
    playerView(state, player) {
      if (player !== null) return base.playerView(state, player);

      // BUG: no status check -- this fires even while the run is genuinely ongoing.
      const minesSet = new Set(state.mines);
      const explodedSet = new Set(state.exploded);
      const cells: Record<number, MineRunCellView> = {};
      for (let c = 0; c < width * height; c++) {
        if (minesSet.has(c)) {
          cells[c] = explodedSet.has(c) ? { exploded: true } : { mine: true };
        } else {
          cells[c] = { n: countAdjacentMines(c, minesSet, width, height) };
        }
      }
      const honest = base.playerView(state, player);
      return {
        width,
        height,
        cells,
        minesTotal: minesSet.size,
        minesExploded: explodedSet.size,
        streakLen: state.streakLen,
        streakValue: state.streakValue,
        nextGain: state.streakLen + 1,
        banked: state.banked,
        revealsLeft: state.revealsLeft,
        lastEffects: honest.lastEffects,
      };
    },
  };
}

describe("Mine Run redaction — spectator carve-out regression mutant (must-fix 2)", () => {
  it("the regressed carve-out (player === null alone, dropping the ongoing check) FAILS checkRedaction under the structural secretExtractor", () => {
    const mutant = makeSpectatorCarveOutRegressionMutant(WIDTH, HEIGHT, MINES, BUDGET);
    expect(() =>
      checkRedaction(mutant, {
        runs: 25,
        maxPlies: 30,
        secretExtractor: makeMineRunSecretExtractor(TOTAL_CELLS),
      })
    ).toThrow(/redaction/);
  });

  it("the SHIPPING engine (same board config) never fails checkRedaction under the structural secretExtractor", () => {
    const shipping = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    expect(() =>
      checkRedaction(shipping, {
        runs: 25,
        maxPlies: 30,
        secretExtractor: makeMineRunSecretExtractor(TOTAL_CELLS),
      })
    ).not.toThrow();
  });
});

describe("Mine Run redaction — planted nearMiss mutant", () => {
  it("the nearMiss-leaking mutant FAILS checkRedaction", () => {
    const mutant = makeNearMissMutant();
    expect(() =>
      checkRedaction(mutant, {
        runs: 40,
        maxPlies: 30,
        secretExtractor: makeBareValueSecretExtractor(TOTAL_CELLS),
      })
    ).toThrow(/redaction/);
  });

  it("the SHIPPING engine (same board config) never fails checkRedaction under the bare-value extractor", () => {
    const shipping = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    expect(() =>
      checkRedaction(shipping, {
        runs: 40,
        maxPlies: 30,
        secretExtractor: makeBareValueSecretExtractor(TOTAL_CELLS),
      })
    ).not.toThrow();
  });

  it("the SHIPPING engine also passes under the production (structural) secretExtractor", () => {
    const shipping = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    expect(() =>
      checkRedaction(shipping, {
        runs: 40,
        maxPlies: 30,
        secretExtractor: makeMineRunSecretExtractor(TOTAL_CELLS),
      })
    ).not.toThrow();
  });

  it("structural assertion: Object.keys(view.cells) is always a subset of the revealed set", () => {
    const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    for (let run = 0; run < 15; run++) {
      const seed = `subset-check-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 30) {
        const legal = engine.legalMoves(state, 0);
        const move = legal[step % legal.length]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;

        const view = engine.playerView(state, 0);
        const revealedSet = new Set(state.revealed);
        for (const key of Object.keys(view.cells)) {
          expect(revealedSet.has(Number(key))).toBe(true);
        }
      }
    }
  });

  it("structural assertion (both seats): Object.keys(view.cells) is a subset of the revealed " +
    "set and no value carries mine:true, for player 0 AND an ONGOING spectator (player null) " +
    "-- the mutant test above previously only checked player 0, which cannot detect a leak " +
    "that is specific to the spectator seat", () => {
    const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    for (let run = 0; run < 15; run++) {
      const seed = `subset-check-both-seats-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 30) {
        const legal = engine.legalMoves(state, 0);
        const move = legal[step % legal.length]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;
        if (engine.status(state).kind !== "ongoing") break; // spectator carve-out legitimately fires past this point

        const revealedSet = new Set(state.revealed);
        for (const seat of [0, null] as const) {
          const view = engine.playerView(state, seat);
          for (const key of Object.keys(view.cells)) {
            expect(revealedSet.has(Number(key))).toBe(true);
            expect(view.cells[Number(key)]).not.toEqual({ mine: true });
          }
        }
      }
    }
  });
});

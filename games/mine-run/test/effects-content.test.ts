// games/mine-run/test/effects-content.test.ts
//
// Fable review (should-fix 4): engine.ts's PUBLIC_EFFECT_TYPES allowlist (engine.ts:91-95)
// filters emitted effects by TYPE only. An effect `{type:"revealed", cell: <unrevealed mine>,
// n: ...}` — say from a future flood-adjacent bug that emits a bordering mine's cell under the
// ORDINARY "revealed" type — passes the type filter (it's exactly the allowlisted shape),
// passes the production secretExtractor (its cell number is unremarkable, not a tagged
// string), and passes redaction-mutant.test.ts's own bare-value extractor too (which is
// anchored to the specific "mineAt" key the *other* planted mutant there uses, not this one).
// This file closes the CLASS of bug — any cell echoed via lastEffects that was never actually
// added to `state.revealed` — instead of reacting to one specific key name or effect type.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import type { GameEngine } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import type { MineRunMove, MineRunState, MineRunView } from "../engine";

const WIDTH = 6;
const HEIGHT = 6;
const MINES = 8;
const BUDGET = 20;

/** Every `revealed`/`exploded` effect's `cell` must be a member of `state.revealed` — those
 *  are the only two effect types that carry a cell identity at all, and the state itself is
 *  the ground truth for what has actually been revealed. */
function assertEffectsCellsAreRevealed(state: MineRunState, view: MineRunView): void {
  const revealedSet = new Set(state.revealed);
  for (const effect of view.lastEffects) {
    if (effect.type === "revealed" || effect.type === "exploded") {
      const cell = effect.cell;
      expect(typeof cell).toBe("number");
      expect(revealedSet.has(cell as number)).toBe(true);
    }
  }
}

describe("effects-content: every revealed/exploded effect's cell is actually in state.revealed", () => {
  it("holds across random playouts of the shipping engine, for both the player and a spectator view", () => {
    const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    for (let run = 0; run < 15; run++) {
      const seed = `effects-content-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 30) {
        const legal = engine.legalMoves(state, 0);
        const move = legal[step % legal.length]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;
        assertEffectsCellsAreRevealed(state, engine.playerView(state, 0));
        assertEffectsCellsAreRevealed(state, engine.playerView(state, null));
      }
    }
  });

  it('catches a planted bug that emits a properly-TYPED "revealed" effect for a cell NOT actually in state.revealed', () => {
    const base = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    const mutant: GameEngine<MineRunState, MineRunMove, MineRunView> = {
      ...base,
      apply(state, moves, rng) {
        const real = base.apply(state, moves, rng);
        const move = moves.get(0);
        if (move && move.t === "reveal") {
          const minesSet = new Set(state.mines);
          const revealedAfter = new Set(real.revealed);
          if (!minesSet.has(move.cell)) {
            for (const m of state.mines) {
              if (!revealedAfter.has(m)) {
                // BUG: an ordinary, allowlisted "revealed" effect for a cell that was never
                // actually added to `revealed` — exactly the class should-fix 4 warns about.
                return { ...real, lastEffects: [...real.lastEffects, { type: "revealed", cell: m, n: 0 }] };
              }
            }
          }
        }
        return real;
      },
    };

    const seed = "effects-content-mutant";
    let state = mutant.setup(1, rngForSetup(seed));
    let step = 0;
    let caught = false;
    while (mutant.status(state).kind === "ongoing" && step < 30 && !caught) {
      const legal = mutant.legalMoves(state, 0);
      const move = legal[step % legal.length]!;
      state = mutant.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
      try {
        assertEffectsCellsAreRevealed(state, mutant.playerView(state, 0));
      } catch {
        caught = true;
      }
    }
    expect(caught).toBe(true);
  });

  it("the SHIPPING engine (same board config) never trips the mutant's own detector", () => {
    const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    const seed = "effects-content-mutant-control";
    let state = engine.setup(1, rngForSetup(seed));
    let step = 0;
    while (engine.status(state).kind === "ongoing" && step < 30) {
      const legal = engine.legalMoves(state, 0);
      const move = legal[step % legal.length]!;
      state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
      assertEffectsCellsAreRevealed(state, engine.playerView(state, 0));
    }
  });
});

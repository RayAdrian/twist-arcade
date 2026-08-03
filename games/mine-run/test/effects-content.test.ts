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

/**
 * (should-fix 4 residual, Fable review round-2 finding 4): the two checks above only look at
 * "revealed"/"exploded" effects. Engine.ts's PUBLIC_EFFECT_TYPES allowlist also lets "banked"
 * effects through, and nothing here has ever inspected one — a future `{type:"banked", points,
 * mineAt: <cell>}` (a plausible shape for a "here's what you would have hit" telemetry bug)
 * would pass the type allowlist AND both cell-focused checks above, because neither one
 * inspects "banked" at all. This asserts every effect of EVERY known public type carries
 * *only* its documented keys, so an extra field on any type -- not just a cell smuggled onto
 * "revealed"/"exploded" -- is caught structurally instead of key-by-key.
 */
const ALLOWED_EFFECT_KEYS: Record<string, ReadonlySet<string>> = {
  revealed: new Set(["type", "cell", "n"]),
  exploded: new Set(["type", "cell", "streakLost"]),
  banked: new Set(["type", "points"]),
};

function assertEffectPayloadShape(view: MineRunView): void {
  for (const effect of view.lastEffects) {
    const allowed = ALLOWED_EFFECT_KEYS[effect.type];
    // Every effect reaching a view must be one of the three known public types -- redactEffects
    // drops anything else before it ever gets here (see PUBLIC_EFFECT_TYPES in engine.ts).
    expect(allowed).toBeDefined();
    for (const key of Object.keys(effect)) {
      expect(allowed!.has(key)).toBe(true);
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
        assertEffectPayloadShape(engine.playerView(state, 0));
        assertEffectPayloadShape(engine.playerView(state, null));
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

describe("effects-content: every public effect carries only its documented keys (round-2 finding 4)", () => {
  it("the SHIPPING engine never emits an effect with an undocumented key, across random playouts", () => {
    const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    for (let run = 0; run < 15; run++) {
      const seed = `effects-payload-shape-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 30) {
        const legal = engine.legalMoves(state, 0);
        const move = legal[step % legal.length]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;
        assertEffectPayloadShape(engine.playerView(state, 0));
        assertEffectPayloadShape(engine.playerView(state, null));
      }
    }
  });

  it('catches a planted bug that smuggles an extra "mineAt" key onto an otherwise-legitimate, ' +
    'allowlisted "banked" effect (a shape neither assertEffectsCellsAreRevealed above nor the ' +
    "type allowlist would notice, since \"banked\" carries no cell field at all)", () => {
    const base = createMineRun({ width: WIDTH, height: HEIGHT, mines: MINES, budget: BUDGET });
    const mutant: GameEngine<MineRunState, MineRunMove, MineRunView> = {
      ...base,
      apply(state, moves, rng) {
        const real = base.apply(state, moves, rng);
        const move = moves.get(0);
        if (move && move.t === "bank" && state.mines.length > 0) {
          // BUG: a "helpful" telemetry field bolted onto the legitimate "banked" effect,
          // leaking an unrevealed mine's position under a new key on an allowlisted type.
          const mineAt = state.mines[0]!;
          return {
            ...real,
            lastEffects: real.lastEffects.map((e) => (e.type === "banked" ? { ...e, mineAt } : e)),
          };
        }
        return real;
      },
    };

    const seed = "effects-payload-shape-mutant";
    let state = mutant.setup(1, rngForSetup(seed));
    let step = 0;
    let caught = false;
    while (mutant.status(state).kind === "ongoing" && step < 40 && !caught) {
      const legal = mutant.legalMoves(state, 0);
      const move = legal.find((m) => m.t === "bank") ?? legal[step % legal.length]!;
      state = mutant.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
      try {
        assertEffectPayloadShape(mutant.playerView(state, 0));
      } catch {
        caught = true;
      }
    }
    expect(caught).toBe(true);
  });
});

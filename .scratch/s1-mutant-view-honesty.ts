// Standing instruction: plant a violation against every guard, verify it applies, before
// trusting the guard passed for a real reason. The guard under test is view-honesty.test.ts's
// new riskAwareRolloutSelector coverage (C1) — it must catch a decision function that peeks at
// the real hidden mine layout instead of deriving everything from the honestly-reconstructed
// view. This script builds a deliberately dishonest adapter (reads `state.mines` directly to
// avoid real mines) and confirms it DISAGREES across resampled worlds consistent with the same
// view — proving the "agrees across worlds" assertion is a real check, not vacuous.

import { rngFromSeed, rngForSetup, rngFor } from "@twist-arcade/engine";
import { createMineRun } from "@twist-arcade/mine-run";
import { analyzeFrontier } from "@twist-arcade/mine-run";
import type { MineRunState, MineRunView, MineRunMove } from "@twist-arcade/mine-run";
import { chooseRiskAwareMove } from "../games/mine-run/risk-policy";

const engine = createMineRun({ width: 6, height: 6, mines: 8, budget: 20 });

// Search for a mid-run state with a GENUINELY AMBIGUOUS top candidate (provablySafe empty, best
// posterior > 0) -- the first scripted-opening attempt landed on a state whose lowest-index
// unrevealed cell happened to be provably safe, which made the dishonest peek agree with the
// honest answer VACUOUSLY (both are forced to pick the one cell that's safe in every world). A
// meaningful C1 violation only shows up where the honest policy is reasoning under real
// uncertainty.
let view!: MineRunView;
let found = false;
outer: for (let trial = 0; trial < 100; trial++) {
  const seed = `view-honesty-mutant-search-${trial}`;
  let state = engine.setup(1, rngForSetup(seed));
  for (let step = 0; step < 20 && engine.status(state).kind === "ongoing"; step++) {
    const legal = engine.legalMoves(state, 0).filter((m) => m.t === "reveal");
    if (legal.length === 0) break;
    const move = legal.reduce((min, m) => (m.t === "reveal" && min.t === "reveal" && m.cell < min.cell ? m : min));
    state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
    if (engine.status(state).kind !== "ongoing") break;
    const v = engine.playerView(state, 0);
    const a = analyzeFrontier(v);
    if (a.provablySafe.size === 0 && a.posterior.size > 0) {
      const bestP = Math.min(...a.posterior.values());
      if (bestP > 0.01) {
        view = v;
        found = true;
        console.log(`found genuinely ambiguous state at trial ${trial} step ${step}, bestPosterior=${bestP.toFixed(3)}`);
        break outer;
      }
    }
  }
}
if (!found) throw new Error("could not find a genuinely ambiguous mid-run state in 100 trials");

// MUTANT: a "MoveSelector"-shaped function that, unlike riskAwareRolloutSelector, peeks at the
// real state.mines to avoid ever revealing an actual mine -- a C1 violation (an omniscient
// policy that cannot exist for a real blind player).
function dishonestSelector(realState: MineRunState): MineRunMove {
  const v: MineRunView = engine.playerView(realState, 0);
  const mineSet = new Set(realState.mines); // <-- THE VIOLATION: reads the true secret
  const candidates = Object.keys(v.cells).length; // unused, just to look plausible
  void candidates;
  // Among unrevealed cells, prefer any cell NOT in mineSet (cheating), else fall back to the
  // honest decision.
  const unrevealed: number[] = [];
  for (let c = 0; c < v.width * v.height; c++) {
    if (!(c in v.cells)) unrevealed.push(c);
  }
  // Always peek, regardless of streak -- the earlier version gated this on streakLen===0 and
  // never actually activated (chooseRiskAwareMove landed on the same provably-safe cell 9
  // honestly every time, so the "check" passed for a vacuous reason -- exactly what this
  // planted-violation exercise exists to catch about ITSELF, not just about the real module).
  const safePick = unrevealed.find((c) => !mineSet.has(c));
  if (safePick !== undefined) {
    return { t: "reveal", cell: safePick };
  }
  return chooseRiskAwareMove(v);
}

const worldRngSeeds = ["world-a", "world-b", "world-c", "world-d", "world-e"];
const honestMoves: unknown[] = [];
const dishonestMoves: unknown[] = [];
const sampledMineSets: string[] = [];

for (const s of worldRngSeeds) {
  const sampled = engine.sampleConsistentState!(view, rngFromSeed(s));
  sampledMineSets.push(JSON.stringify(sampled.mines));
  const reView = engine.playerView(sampled, 0);
  honestMoves.push(chooseRiskAwareMove(reView));
  dishonestMoves.push(dishonestSelector(sampled));
}

console.log("distinct sampled worlds:", new Set(sampledMineSets).size, "/", worldRngSeeds.length);
console.log("honest moves:", JSON.stringify(honestMoves));
console.log("dishonest moves:", JSON.stringify(dishonestMoves));

const honestAgree = honestMoves.every((m) => JSON.stringify(m) === JSON.stringify(honestMoves[0]));
const dishonestAgree = dishonestMoves.every((m) => JSON.stringify(m) === JSON.stringify(dishonestMoves[0]));

console.log(`HONEST_AGREES_ACROSS_WORLDS=${honestAgree} (expected true)`);
console.log(`DISHONEST_AGREES_ACROSS_WORLDS=${dishonestAgree} (expected false — the mutant must diverge)`);

if (honestAgree && !dishonestAgree) {
  console.log("MUTANT_CHECK_RESULT PASS — the resampling check can catch a real C1 violation");
} else {
  console.log("MUTANT_CHECK_RESULT FAIL — the check would not have caught this violation");
}

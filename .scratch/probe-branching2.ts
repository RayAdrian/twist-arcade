import { mineRun } from "@twist-arcade/mine-run";
import { rngFromSeed } from "@twist-arcade/engine";

// exact seed the harness's estimateRootBranchingFactor uses
const state = mineRun.setup(1, rngFromSeed("__ci_gate_hidden_info_budget_probe__"));
const legal = mineRun.legalMoves(state, 0);
console.log("harness-exact-seed root legal move count:", legal.length);

// sample a spread of seeds to see the range of root branching factors (initial safe-reveal
// flood fill can vary the count seed to seed).
const seeds = ["a","b","c","d","e","f","g","h","ci:mine-run:ci","mine-run-strong-1","mine-run-strong-2"];
for (const s of seeds) {
  const st = mineRun.setup(1, rngFromSeed(s));
  console.log(s, "->", mineRun.legalMoves(st, 0).length);
}

// S0b wiring-proof sanity check, standing instruction ("plant a violation against every guard,
// verify the plant actually applied before trusting the real check"). The real claim under test
// (docs/plans/mine-run-risk-aware-policy.md §1) is: "pCap = 0 reproduces Always-Safe exactly."
// Before trusting a byte-exact match from the REAL threshold policy, prove the comparison itself
// is capable of catching a real divergence — run a deliberately WRONG pCap=0 variant (step 1
// reveals the lowest-index provably-safe cell directly, skipping chooseSafeMove's "prefer a
// provably-ZERO neighbor" tie-break) and confirm it disagrees with Always-Safe on at least one
// seed. If the mutant were to match anyway, the equivalence check would be vacuous.

import { analyzeFrontier, chooseSafeMove, createMineRun, safeMove } from "@twist-arcade/mine-run";
import type { FrontierAnalysis, MineRunMove, MineRunView } from "@twist-arcade/mine-run";
import { pairedSeeds, playSoloRun } from "@twist-arcade/harness";
import { buildSafeMoveAgent } from "@twist-arcade/harness";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const moveCap = 400;

function minPosterior(analysis: FrontierAnalysis): { cell: number; p: number } {
  let bestCell = -1;
  let bestP = Infinity;
  for (const [cell, p] of [...analysis.posterior.entries()].sort((a, b) => a[0] - b[0])) {
    if (p < bestP) {
      bestP = p;
      bestCell = cell;
    }
  }
  if (bestCell === -1) throw new Error("minPosterior: no candidate — should never happen for an ongoing state");
  return { cell: bestCell, p: bestP };
}

// MUTANT step 1: does NOT delegate to chooseSafeMove — reveals the lowest-index provably-safe
// cell directly, skipping the "prefer a provably-zero neighbor" tie-break chooseSafeMove applies.
function mutantThresholdMove(view: MineRunView, analysis: FrontierAnalysis, T: number, pCap: number): MineRunMove {
  if (analysis.provablySafe.size > 0) {
    const sorted = [...analysis.provablySafe].sort((a, b) => a - b);
    return { t: "reveal", cell: sorted[0]! }; // WRONG on purpose: no zero-neighbor preference
  }
  if (view.streakValue >= T) return { t: "bank" };
  const { cell, p } = minPosterior(analysis);
  if (p <= pCap) return { t: "reveal", cell };
  if (view.streakLen >= 1) return { t: "bank" };
  return { t: "reveal", cell };
}

const seeds = [...pairedSeeds("ci:mine-run:ci", 3), ...pairedSeeds("c29:mine-run:pilot", 5)];

const mutantAgent = buildSafeMoveAgent(engine, (view: MineRunView) =>
  mutantThresholdMove(view, analyzeFrontier(view), 5, 0)
);

console.log("S0b MUTANT CHECK — pCap=0, T=5, step-1 delegation deliberately broken");
let anyMismatch = false;
for (const seed of seeds) {
  const safeResult = playSoloRun(engine, buildSafeMoveAgent(engine, safeMove), seed, { moveCap });
  const mutantResult = playSoloRun(engine, mutantAgent, seed, { moveCap });
  const match = safeResult.finalScore === mutantResult.finalScore && safeResult.decisions === mutantResult.decisions;
  if (!match) anyMismatch = true;
  console.log(
    `seed=${seed} alwaysSafe(score=${safeResult.finalScore},decisions=${safeResult.decisions}) ` +
      `mutant(score=${mutantResult.finalScore},decisions=${mutantResult.decisions}) match=${match}`
  );
}
console.log(`MUTANT_RESULT anyMismatch=${anyMismatch} (expected true — the mutant must diverge somewhere)`);
console.log("S0B_MUTANT_COMPLETE");

// Single-decision timing probe: how long does ONE call to the shipped hidden-info Strong
// policy (determinizedFlatMonteCarloPolicy, greedy rollout, rolloutCapPlies=60) take on the
// REAL 10x10/20-mine/60-budget board, at the opening position, for a few candidate rollout
// budgets? Used to extrapolate full-game / full-seed-count wall-clock WITHOUT burning many
// minutes of CPU on a full multi-seed run.
import { createMineRun } from "@twist-arcade/mine-run";
import { rngFromSeed } from "@twist-arcade/engine";
import { determinizedFlatMonteCarloPolicy, deriveView, greedyMoveSelector } from "@twist-arcade/bots";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const state = engine.setup(1, rngFromSeed("timing-probe"));
const view = deriveView(engine, state, 0);
const clock = { now: () => Date.now() };

const policy = determinizedFlatMonteCarloPolicy({
  rolloutMoveSelector: greedyMoveSelector,
  rolloutCapPlies: 60,
});

for (const n of [50, 150, 300]) {
  const t0 = Date.now();
  const { stats } = policy.chooseMove({
    engine, view, player: 0, rng: rngFromSeed("decision-rng"),
    budget: { kind: "rollouts", n }, clock,
  });
  console.log(`n=${n}: ${Date.now() - t0}ms, rootVisits totalRollouts=${stats.rollouts}`);
}

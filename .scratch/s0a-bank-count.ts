// S0a — docs/plans/mine-run-risk-aware-policy.md §0's pre-registered confirming measurement.
//
// Claim under test (code-read inference, §0): `greedyMoveSelector` (packages/bots/src/
// search-utils.ts:201) applies each candidate move to the (sampled) world and ranks by the
// RESOLVED next state. A reveal's risk is therefore settled before evaluation — a surviving
// reveal is worth ~B+V+gain, banking is worth ~B+V, and the argmax over ~80 candidate cells
// almost always finds a survivor. Prediction: bank is chosen ~0 times across every rollout ply
// in every sampled world, regardless of heuristic() quality.
//
// Method: wrap the REAL, unmodified `greedyMoveSelector` in a counting proxy and hand that proxy
// to `determinizedFlatMonteCarloPolicy` as `rolloutMoveSelector`, with the SAME configuration
// production Strong uses (agents.ts: samplesPerCandidate derived from budget.n/legal.length under
// a rollouts budget, rolloutCapPlies=60, budget.n=750 == manifest.ciGateBudget.soloChaseCiRollouts).
// This is "the current greedy rollouts" verbatim, not a reimplementation — the proxy counts, it
// never changes which move is returned (verified below by an equality check against the
// unwrapped selector on the same draw).
//
// Real launch board (10x10/20 mines/budget 60, moveCap 400 — games/mine-run/manifest.ts) and a
// real seed (ci:mine-run:ci-0) so the numbers are about the actual game, not a fixture.

import { createMineRun } from "@twist-arcade/mine-run";
import { buildViewPolicyAgent, playSoloRun } from "@twist-arcade/harness";
import { determinizedFlatMonteCarloPolicy, greedyMoveSelector } from "@twist-arcade/bots";
import type { MoveSelector } from "@twist-arcade/bots";
import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const moveCap = 400; // real manifest value
const rolloutCapPlies = 60; // STRONG_HIDDEN_INFO_ROLLOUT_CAP_PLIES, agents.ts
const rolloutsBudget = 750; // manifest.ciGateBudget.soloChaseCiRollouts

let totalCalls = 0;
let bankCalls = 0;

// Transparent by construction, not by comparison: this calls the real, unmodified
// `greedyMoveSelector` and returns its result verbatim — there is no reimplementation here for
// a "does it match" check to be meaningful against.
function countingGreedySelector<S extends WithEffects, M extends Json>(
  eng: GameEngine<S, M, unknown>,
  state: S,
  player: PlayerId,
  legal: readonly M[],
  rng: Rng
): M {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chosen = greedyMoveSelector(eng as any, state, player, legal, rng);
  totalCalls += 1;
  const asRecord = chosen as unknown as { t?: string };
  if (asRecord.t === "bank") bankCalls += 1;
  return chosen;
}

const strongLike = determinizedFlatMonteCarloPolicy({
  samplesPerCandidate: 16, // STRONG_HIDDEN_INFO_SAMPLES, agents.ts — inert under a rollouts budget
  rolloutMoveSelector: countingGreedySelector as unknown as MoveSelector<never, never>,
  rolloutCapPlies,
});

const agent = buildViewPolicyAgent(engine, strongLike, "strong-instrumented");

const seeds = ["ci:mine-run:ci-0"];

console.log(`S0a start: ${new Date().toISOString()}`);
console.log(`config: board=10x10/20mines/budget60 moveCap=${moveCap} rolloutCapPlies=${rolloutCapPlies} rolloutsBudget=${rolloutsBudget}`);

for (const seed of seeds) {
  const t0 = Date.now();
  const result = playSoloRun(engine, agent, seed, { moveCap, budget: { kind: "rollouts", n: rolloutsBudget } });
  const elapsed = Date.now() - t0;
  console.log(
    `RESULT seed=${seed} finalScore=${result.finalScore} decisions=${result.decisions} ` +
      `capHit=${result.capHit} elapsedMs=${elapsed}`
  );
  console.log(
    `BANK_COUNT_RUNNING seed=${seed} totalCalls=${totalCalls} bankCalls=${bankCalls} ` +
      `bankFrac=${totalCalls > 0 ? ((bankCalls / totalCalls) * 100).toFixed(4) : "n/a"}%`
  );
}

console.log(`FINAL totalCalls=${totalCalls} bankCalls=${bankCalls}`);
console.log(`FINAL bankFrac=${totalCalls > 0 ? ((bankCalls / totalCalls) * 100).toFixed(4) : "n/a"}%`);
console.log(`S0a end: ${new Date().toISOString()}`);
console.log("S0A_COMPLETE");

// scripts/research/order-vs-chaos-ov2-budget-sweep.ts — OV2 stage 2 (docs/plans/order-vs-chaos.md
// §4, §7): the budget-validation sweep. ONE FIXED SEED across every candidate
// (platform-corrections.md C24 — two independent agents templated the varying parameter INTO
// the seed on the same day and invalidated their own comparisons; this script deliberately
// never does that: `SEED` below is a single literal, threaded unchanged into every
// `runMatchup` call, and only the AGENT (its rollout budget) varies between candidates).
//
// REVISED after the OV2 cost pilot's own result (order-vs-chaos-ov2-cost-pilot.ts, n=15):
// mean-plies across candidates read 28.4, 25.3, 26.1, 22.3, 21.7, 22.6, 24.2, 19.8 —
// non-monotonic across a 19.8-28.4 span. If more search genuinely shortened games there would
// be a trend; there isn't one, which means n=15 is sampling noise wider than any real effect
// (the exact C26 failure mode: a too-small sample read as signal nearly killed Nine Grids on a
// 15-game pilot that disagreed with its own 100-game result). Two consequences:
//
//   1. This sweep runs at n=GAMES=100, never n=15, for every number it reports.
//   2. It compares exactly TWO configurations (the shipped 10,000-rollout baseline and ONE
//      candidate), not a wide multi-point table — each point costs real minutes at n=100, and a
//      Mine Run agent is concurrently running on shared hardware (standing instruction: keep
//      CPU modest). A wide sweep was the original plan here; narrowing to two points is the
//      corrected, cost-aware design.
//
// CRITERION, restated to be honestly answerable at this sample size: "matches the baseline"
// does NOT mean "the two numbers are numerically close" — at n=100 a win-rate's 95% interval is
// roughly +/-10 points (platform-corrections.md C32), so two runs can differ by that much and
// still be the identical underlying answer. It means the candidate reproduces the baseline's
// VERDICT: first-player-win-rate on the SAME SIDE of the [35, 65] band (or both inside it),
// mean-plies inside the gate's own [4, 200] band, and zero cap hits — the actual pass/fail shape
// a real CI gate table would read, not a closeness threshold on the raw numbers. Draw-rate is
// identically 0 here by construction (no draw terminal exists) and cannot discriminate (plan
// §4) — reported, not used as a criterion.
//
// SCOPE DEVIATION FROM `compareBudgets`, STATED EXPLICITLY: the harness's `compareBudgets`
// helper (suites.ts) is the C24-preferred fix and runs the FULL `runCiSuite` (three matchups:
// strong-vs-random, strong self-play, ruthless-vs-standard) per candidate. The C22 criterion
// this sweep exists to satisfy needs only ONE of those three (strong self-play — FPA and
// mean-plies are both self-play-only metrics; see suites.ts's own comment on why meanPlies
// "deliberately stays self-play-only"). Even at just two candidates, the full three-matchup
// table would cost 3x this script's actual runtime for no discriminating benefit toward this
// question. This script calls `runMatchup` directly, ONCE per candidate, self-play only, and
// reproduces `runCiSuite`'s own self-play seed convention (one fixed base seed + a fixed
// suffix; only the agent's budget varies) so the numbers measured here are the same numbers a
// real `runCiSuite` run would report for `firstPlayerWinRate`/`drawRate`/`meanPlies` at that
// budget.
//
// Run: pnpm tsx scripts/research/order-vs-chaos-ov2-budget-sweep.ts

import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "@twist-arcade/harness";
import { runMatchup } from "@twist-arcade/harness";
import { orderVsChaos, type OrderVsChaosMove, type OrderVsChaosState } from "../../games/order-vs-chaos/engine";
import { manifest } from "../../games/order-vs-chaos/manifest";

const GAMES = 100;
const SEED = "ov2-budget-sweep"; // ONE seed, fixed, never templated with `rollouts` (C24).
const BASELINE_ROLLOUTS = 10_000; // the shipped ruthless tier's own budget.
// 3,000 chosen over 2,000 for margin (coordinator's own framing) — the incremental cost is
// small (see the cost pilot's per-game timings) and this is a safety-margin choice, not tuning
// a gate result (no gate has been measured yet at the point this constant is chosen).
const CANDIDATE_ROLLOUTS = 3_000;

// The real gate's own thresholds (game-spec's DEFAULT_HARNESS_THRESHOLDS, unmodified by this
// manifest) — the verdict-match criterion reads these directly rather than re-deriving a
// parallel band, so "verdict" here means exactly what runCiSuite/evaluateCiGates would compute.
const FPA_BAND: readonly [number, number] = [0.35, 0.65];
const PLIES_BAND: readonly [number, number] = [4, 200];

function agentFor(rollouts: number): AgentSpec<OrderVsChaosState, OrderVsChaosMove> {
  const shippedRuthless = manifest.difficultyTiers.find((t) => t.id === "ruthless");
  if (!shippedRuthless) throw new Error("order-vs-chaos manifest has no ruthless tier");
  const tier = { ...shippedRuthless, budget: { kind: "rollouts" as const, n: rollouts } };
  return { kind: "policy", name: `ruthless@${rollouts}`, policy: tierPolicy(tier), budget: tier.budget };
}

interface Row {
  rollouts: number;
  firstPlayerWinRate: number;
  drawRate: number;
  meanPlies: number;
  capHitRate: number;
}

function sideOfBand(fpa: number): "below" | "in" | "above" {
  if (fpa < FPA_BAND[0]) return "below";
  if (fpa > FPA_BAND[1]) return "above";
  return "in";
}

function inPliesBand(plies: number): boolean {
  return plies >= PLIES_BAND[0] && plies <= PLIES_BAND[1];
}

function measure(rollouts: number): Row {
  const agent = agentFor(rollouts);
  const start = Date.now();
  // EXACT convention runCiSuite's own strongSelfPlay call uses (`${seed}:strong-self-play`
  // there; `${SEED}:self-play` here — the suffix text differs since this isn't a runCiSuite
  // call, but the STRUCTURE — one fixed base seed, one fixed suffix, only the agent varies — is
  // identical, which is the property C24 actually cares about).
  const report = runMatchup(orderVsChaos, agent, agent, { games: GAMES, seed: `${SEED}:self-play` });
  const ms = Date.now() - start;
  const row: Row = {
    rollouts,
    firstPlayerWinRate: report.metrics.firstPlayerWinRate,
    drawRate: report.metrics.drawRate,
    meanPlies: report.metrics.meanPlies,
    capHitRate: report.metrics.capHitRate,
  };
  console.log(
    `rollouts=${String(rollouts).padStart(6)}  FPA=${(row.firstPlayerWinRate * 100).toFixed(1)}%  ` +
      `draw=${(row.drawRate * 100).toFixed(1)}%  mean-plies=${row.meanPlies.toFixed(2)}  ` +
      `capHit=${(row.capHitRate * 100).toFixed(2)}%  (${(ms / 1000).toFixed(1)}s)`
  );
  return row;
}

function main(): void {
  console.log(
    `OV2 budget-validation sweep (revised, n=${GAMES}) — self-play only, ONE seed="${SEED}" ` +
      `(C24: never templated with rollouts)`
  );
  console.log(`comparing baseline=${BASELINE_ROLLOUTS} vs candidate=${CANDIDATE_ROLLOUTS}\n`);

  const baseline = measure(BASELINE_ROLLOUTS);
  const candidate = measure(CANDIDATE_ROLLOUTS);

  const baseSide = sideOfBand(baseline.firstPlayerWinRate);
  const candSide = sideOfBand(candidate.firstPlayerWinRate);
  const baseInPlies = inPliesBand(baseline.meanPlies);
  const candInPlies = inPliesBand(candidate.meanPlies);

  console.log(
    `\nbaseline (${BASELINE_ROLLOUTS}): FPA=${(baseline.firstPlayerWinRate * 100).toFixed(1)}% (${baseSide} band) ` +
      `mean-plies=${baseline.meanPlies.toFixed(2)} (${baseInPlies ? "in" : "OUT OF"} [${PLIES_BAND[0]}, ${PLIES_BAND[1]}]) ` +
      `capHit=${(baseline.capHitRate * 100).toFixed(2)}%`
  );
  console.log(
    `candidate (${CANDIDATE_ROLLOUTS}): FPA=${(candidate.firstPlayerWinRate * 100).toFixed(1)}% (${candSide} band) ` +
      `mean-plies=${candidate.meanPlies.toFixed(2)} (${candInPlies ? "in" : "OUT OF"} [${PLIES_BAND[0]}, ${PLIES_BAND[1]}]) ` +
      `capHit=${(candidate.capHitRate * 100).toFixed(2)}%`
  );

  const verdictMatches =
    baseSide === candSide && baseInPlies === candInPlies && candInPlies && candidate.capHitRate === 0;

  console.log(
    `\nverdict match: FPA same side of band (${baseSide === candSide}), mean-plies both ` +
      `${candInPlies ? "in" : "not in"} band (${baseInPlies === candInPlies}), candidate zero cap hits ` +
      `(${candidate.capHitRate === 0}) => ${verdictMatches ? "MATCH" : "NO MATCH"}`
  );

  if (verdictMatches) {
    console.log(`\nCHOSEN: ${CANDIDATE_ROLLOUTS} rollouts reproduces the ${BASELINE_ROLLOUTS}-rollout verdict.`);
  } else {
    console.log(
      `\nNO MATCH — ${CANDIDATE_ROLLOUTS} rollouts does not reproduce the ${BASELINE_ROLLOUTS}-rollout verdict; ` +
        "do not set this as the CI budget. Escalate (try a higher candidate, or if the baseline itself " +
        "is out of band, that is a §3 ladder finding, not a budget problem)."
    );
  }
}

main();

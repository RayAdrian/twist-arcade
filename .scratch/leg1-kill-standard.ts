// Leg 1 of the three-leg kill standard (docs/plans/mine-run-risk-aware-policy.md §5/§6,
// platform-corrections.md C39/C41's ruling). Leg 1's own condition: "every pre-registered
// policy has median <= Always-Safe's (best ratio >= 1.0)" -- checked here at frozen params,
// n=100, on ONE fixed seed root (C24: the compared variable never appears in the seed).
//
// Policies: Always-Safe (frozen baseline) x the S0b threshold grid (7 T x 5 pCap = 35) x
// RiskAware-B (standalone, Tier B) x Random. Strong-new is NOT required for leg 1 (needs S2/S3
// wiring + hours of compute; leg 1 only asks whether ANY view-policy beats Always-Safe).
//
// Per C41: report BOTH metrics for every policy -- the gate's own convention (alwaysSafeMedian /
// policyMedian, hard-fail if >= 0.95, i.e. "ratio" here) AND the paired per-seed win fraction
// (win/loss/tie counts), since S0b showed they can disagree exactly at the threshold that
// matters, and the S1 measurement showed they can also agree right at parity.

import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { riskAwareMove } from "../games/mine-run/risk-policy";
import { analyzeFrontier, chooseSafeMove } from "@twist-arcade/mine-run";
import type { FrontierAnalysis, MineRunMove, MineRunState, MineRunView } from "@twist-arcade/mine-run";
import { buildAgent, buildSafeMoveAgent, pairedSeeds, playSoloRun } from "@twist-arcade/harness";
import type { SoloRunResult } from "@twist-arcade/harness";
import { randomPolicy } from "@twist-arcade/bots";

// ---------------------------------------------------------------------------------------
// Threshold family, identical to s0b-threshold-sweep.ts (already wiring-proven there: pCap=0
// byte-exact-matches Always-Safe across every T, on all 23 of that run's seeds).
// ---------------------------------------------------------------------------------------
function minPosterior(analysis: FrontierAnalysis): { cell: number; p: number } {
  let bestCell = -1;
  let bestP = Infinity;
  for (const [cell, p] of [...analysis.posterior.entries()].sort((a, b) => a[0] - b[0])) {
    if (p < bestP) {
      bestP = p;
      bestCell = cell;
    }
  }
  if (bestCell === -1) throw new Error("minPosterior: no candidate cell");
  return { cell: bestCell, p: bestP };
}

function chooseThresholdMove(view: MineRunView, analysis: FrontierAnalysis, T: number, pCap: number): MineRunMove {
  if (analysis.provablySafe.size > 0) return chooseSafeMove(view, analysis);
  if (view.streakValue >= T) return { t: "bank" };
  const { cell, p } = minPosterior(analysis);
  if (p <= pCap) return { t: "reveal", cell };
  if (view.streakLen >= 1) return { t: "bank" };
  return { t: "reveal", cell };
}

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const moveCap = 400;

function buildThresholdAgent(T: number, pCap: number) {
  return buildSafeMoveAgent(engine, (view: MineRunView) => chooseThresholdMove(view, analyzeFrontier(view), T, pCap));
}

const alwaysSafeAgent = buildSafeMoveAgent(engine, safeMove);
const riskAwareAgent = buildSafeMoveAgent(engine, riskAwareMove);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

// -------------------------------------------------------------------------------------------
// Bridge check FIRST (spec's own precondition, C24/C39/C41): Always-Safe must reproduce
// 849/686/1247 byte-exact on ci:mine-run:ci-{0,1,2} before ANY new number here is trusted.
// -------------------------------------------------------------------------------------------
const bridgeSeeds = ["ci:mine-run:ci-0", "ci:mine-run:ci-1", "ci:mine-run:ci-2"];
const bridgeExpected = [849, 686, 1247];
console.log("=== BRIDGE CHECK ===");
let bridgeOk = true;
for (let i = 0; i < bridgeSeeds.length; i++) {
  const r = playSoloRun(engine, alwaysSafeAgent, bridgeSeeds[i]!, { moveCap });
  const ok = r.finalScore === bridgeExpected[i];
  bridgeOk = bridgeOk && ok;
  console.log(`seed=${bridgeSeeds[i]} score=${r.finalScore} expected=${bridgeExpected[i]} match=${ok}`);
}
console.log(`BRIDGE_CHECK_RESULT ok=${bridgeOk}`);
if (!bridgeOk) {
  console.log("BRIDGE CHECK FAILED — STOPPING. The harness is not measuring what the spec assumes.");
  process.exit(1);
}

// -------------------------------------------------------------------------------------------
// Leg 1: n=100, one fixed seed root (C24), never interpolating the compared variable.
// -------------------------------------------------------------------------------------------
const seeds = pairedSeeds("c29:mine-run:v1", 100); // c29:mine-run:v1-0 .. -99
console.log(`\n=== LEG 1 — n=${seeds.length}, root="c29:mine-run:v1" ===`);

const t0 = Date.now();
const alwaysSafeResults: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, alwaysSafeAgent, s, { moveCap }));
console.log(`Always-Safe: ${Date.now() - t0}ms`);
const alwaysSafeScores = alwaysSafeResults.map((r) => r.finalScore);
const alwaysSafeMedian = median(alwaysSafeScores);
const alwaysSafeCapHits = alwaysSafeResults.filter((r) => r.capHit).length;
console.log(`alwaysSafeMedian=${alwaysSafeMedian} capHits=${alwaysSafeCapHits}/${seeds.length}`);

interface PolicyRow {
  name: string;
  median: number;
  gateRatio: number; // alwaysSafeMedian / policyMedian, hard-fail >= 0.95, healthy <= 0.70
  wins: number;
  losses: number;
  ties: number;
  winFraction: number;
  capHits: number;
}

const rows: PolicyRow[] = [];

function evaluatePolicy(name: string, results: readonly SoloRunResult[]): PolicyRow {
  const scores = results.map((r) => r.finalScore);
  const med = median(scores);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let i = 0; i < seeds.length; i++) {
    const policyScore = results[i]!.finalScore;
    const safeScore = alwaysSafeResults[i]!.finalScore;
    if (policyScore > safeScore) wins += 1;
    else if (policyScore < safeScore) losses += 1;
    else ties += 1;
  }
  const capHits = results.filter((r) => r.capHit).length;
  const row: PolicyRow = {
    name,
    median: med,
    gateRatio: alwaysSafeMedian / med,
    wins,
    losses,
    ties,
    winFraction: wins / seeds.length,
    capHits,
  };
  rows.push(row);
  console.log(
    `${name.padEnd(20)} median=${String(med).padStart(5)} gateRatio=${row.gateRatio.toFixed(4)} ` +
      `win/loss/tie=${wins}/${losses}/${ties} winFraction=${row.winFraction.toFixed(4)} capHits=${capHits}`
  );
  return row;
}

// --- RiskAware-B (standalone Tier B) ---
const t1 = Date.now();
const riskAwareResults: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, riskAwareAgent, s, { moveCap }));
console.log(`RiskAware-B: ${Date.now() - t1}ms`);
evaluatePolicy("RiskAware-B", riskAwareResults);

// --- Random ---
const t2 = Date.now();
const randomAgent = buildAgent(engine, randomPolicy<MineRunState, MineRunMove>(), "random");
const randomResults: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, randomAgent, s, { moveCap }));
console.log(`Random: ${Date.now() - t2}ms`);
evaluatePolicy("Random", randomResults);

// --- Threshold grid (7 T x 5 pCap = 35) ---
const TGrid = [5, 10, 15, 20, 30, 50, Infinity];
const pCapGrid = [0.05, 0.1, 0.15, 0.2, 0.3];
const t3 = Date.now();
for (const T of TGrid) {
  for (const pCap of pCapGrid) {
    const agent = buildThresholdAgent(T, pCap);
    const results: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, agent, s, { moveCap }));
    evaluatePolicy(`T=${T === Infinity ? "inf" : T},pCap=${pCap}`, results);
  }
}
console.log(`threshold grid: ${Date.now() - t3}ms`);
console.log(`\nTOTAL elapsed: ${Date.now() - t0}ms`);

// -------------------------------------------------------------------------------------------
// Leg 1 verdict: "every pre-registered policy has median <= Always-Safe's (best ratio >= 1.0)".
// "best" = lowest gateRatio (the policy closest to, or past, beating Always-Safe).
// -------------------------------------------------------------------------------------------
console.log("\n=== LEG 1 VERDICT ===");
const best = rows.reduce((a, b) => (b.gateRatio < a.gateRatio ? b : a));
console.log(
  `BEST (lowest) gateRatio: ${best.name} gateRatio=${best.gateRatio.toFixed(4)} median=${best.median} ` +
    `winFraction=${best.winFraction.toFixed(4)}`
);
const leg1Fires = best.gateRatio >= 1.0;
console.log(`LEG1_FIRES (every policy median <= AlwaysSafe's) = ${leg1Fires}`);

const beatAlwaysSafeByMedian = rows.filter((r) => r.gateRatio < 1.0);
console.log(`\nPolicies whose OWN median exceeded Always-Safe's (gateRatio < 1.0): ${beatAlwaysSafeByMedian.length} / ${rows.length}`);
for (const r of beatAlwaysSafeByMedian) {
  console.log(`  ${r.name} gateRatio=${r.gateRatio.toFixed(4)} median=${r.median} winFraction=${r.winFraction.toFixed(4)}`);
}

const majorityWinPolicies = rows.filter((r) => r.winFraction > 0.5);
console.log(`\nPolicies beating Always-Safe on a MAJORITY of paired seeds (winFraction > 0.5): ${majorityWinPolicies.length} / ${rows.length}`);
for (const r of majorityWinPolicies) {
  console.log(`  ${r.name} winFraction=${r.winFraction.toFixed(4)} gateRatio=${r.gateRatio.toFixed(4)}`);
}

console.log("LEG1_COMPLETE");

// S0b — docs/plans/mine-run-risk-aware-policy.md §1's threshold-family sweep.
//
// Built from existing exports only, per the spec: analyzeFrontier, chooseSafeMove's decision
// shape, and the harness's solo runner. No new game-local module (that is S1's
// games/mine-run/risk-policy.ts, out of this step's scope).
//
// The two-knob family:
//   1. provably-safe cell exists -> reveal it (delegates to chooseSafeMove's OWN step 1, so the
//      "prefer a provably-zero neighbor" tie-break is byte-identical to Always-Safe's — proven
//      wrong-on-purpose in s0b-mutant-check.ts, which showed a naive lowest-index alternative
//      DOES diverge from Always-Safe on 3/8 seeds, so this delegation is load-bearing, not
//      cosmetic).
//   2. else streakValue >= T -> bank.
//   3. else min posterior p_min <= pCap -> reveal that cell (carry the streak).
//   4. else bank if streakLen >= 1, else reveal the min-posterior cell (streak-0 free probe).
//
// pCap = 0 is claimed to reproduce Always-Safe exactly: after step 1, `provablySafe` is empty,
// so every remaining posterior is > 0, so step 3 never fires at pCap=0 regardless of T — every
// decision falls through to step 4, which is chooseSafeMove's own steps 2-3 verbatim. Proven
// below across every T in the grid, not just asserted.

import { analyzeFrontier, chooseSafeMove, createMineRun, safeMove } from "@twist-arcade/mine-run";
import type { FrontierAnalysis, MineRunMove, MineRunView } from "@twist-arcade/mine-run";
import { buildSafeMoveAgent, pairedSeeds, playSoloRun, type SoloRunResult } from "@twist-arcade/harness";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const moveCap = 400; // real manifest value (games/mine-run/manifest.ts)

function minPosterior(analysis: FrontierAnalysis): { cell: number; p: number } {
  let bestCell = -1;
  let bestP = Infinity;
  for (const [cell, p] of [...analysis.posterior.entries()].sort((a, b) => a[0] - b[0])) {
    if (p < bestP) {
      bestP = p;
      bestCell = cell;
    }
  }
  if (bestCell === -1) {
    throw new Error("minPosterior: no candidate cell — should never happen for an ongoing, reachable state");
  }
  return { cell: bestCell, p: bestP };
}

function chooseThresholdMove(view: MineRunView, analysis: FrontierAnalysis, T: number, pCap: number): MineRunMove {
  if (analysis.provablySafe.size > 0) {
    return chooseSafeMove(view, analysis); // byte-identical delegation to Always-Safe's step 1
  }
  if (view.streakValue >= T) {
    return { t: "bank" };
  }
  const { cell, p } = minPosterior(analysis);
  if (p <= pCap) {
    return { t: "reveal", cell };
  }
  if (view.streakLen >= 1) return { t: "bank" };
  return { t: "reveal", cell };
}

function buildThresholdAgent(T: number, pCap: number) {
  return buildSafeMoveAgent(engine, (view: MineRunView) => chooseThresholdMove(view, analyzeFrontier(view), T, pCap));
}

const alwaysSafeAgent = buildSafeMoveAgent(engine, safeMove);

// -------------------------------------------------------------------------------------------
// Bridge check (spec §1/§5): Always-Safe must reproduce 849/686/1247 byte-exact on
// ci:mine-run:ci-{0,1,2} before any new number is trusted.
// -------------------------------------------------------------------------------------------
const bridgeSeeds = ["ci:mine-run:ci-0", "ci:mine-run:ci-1", "ci:mine-run:ci-2"];
const bridgeExpected = [849, 686, 1247];
console.log("=== BRIDGE CHECK ===");
let bridgeOk = true;
const bridgeResults: SoloRunResult[] = [];
for (let i = 0; i < bridgeSeeds.length; i++) {
  const r = playSoloRun(engine, alwaysSafeAgent, bridgeSeeds[i]!, { moveCap });
  bridgeResults.push(r);
  const ok = r.finalScore === bridgeExpected[i];
  bridgeOk = bridgeOk && ok;
  console.log(`seed=${bridgeSeeds[i]} score=${r.finalScore} expected=${bridgeExpected[i]} decisions=${r.decisions} match=${ok}`);
}
console.log(`BRIDGE_CHECK_RESULT ok=${bridgeOk}`);
if (!bridgeOk) {
  console.log("BRIDGE CHECK FAILED — STOPPING. The harness is not measuring what the spec assumes.");
  process.exit(1);
}

// -------------------------------------------------------------------------------------------
// pCap=0 exact-reproduction proof (the family's boundary member), across EVERY T in the grid,
// on all 23 seeds — not just asserted from the code-read argument above.
// -------------------------------------------------------------------------------------------
const TGrid = [5, 10, 15, 20, 30, 50, Infinity];
const pCapGrid = [0.05, 0.1, 0.15, 0.2, 0.3];
const pilotSeeds = pairedSeeds("c29:mine-run:pilot", 20);
const allSeeds = [...bridgeSeeds, ...pilotSeeds]; // 23 total, per spec §1

console.log("\n=== pCap=0 WIRING PROOF (every T, all 23 seeds) ===");
const alwaysSafeByeSeed = new Map<string, SoloRunResult>();
for (const seed of allSeeds) {
  alwaysSafeByeSeed.set(seed, playSoloRun(engine, alwaysSafeAgent, seed, { moveCap }));
}
let wiringOk = true;
for (const T of TGrid) {
  let tOk = true;
  for (const seed of allSeeds) {
    const safe = alwaysSafeByeSeed.get(seed)!;
    const agent = buildThresholdAgent(T, 0);
    const r = playSoloRun(engine, agent, seed, { moveCap });
    const match =
      r.finalScore === safe.finalScore &&
      r.decisions === safe.decisions &&
      JSON.stringify(r.moveLog) === JSON.stringify(safe.moveLog);
    if (!match) {
      tOk = false;
      wiringOk = false;
      console.log(`  MISMATCH T=${T} seed=${seed} safe=(${safe.finalScore},${safe.decisions}) got=(${r.finalScore},${r.decisions})`);
    }
  }
  console.log(`T=${T === Infinity ? "inf" : T} pCap=0: all 23 seeds byte-exact match Always-Safe = ${tOk}`);
}
console.log(`WIRING_PROOF_RESULT allMatch=${wiringOk}`);

// -------------------------------------------------------------------------------------------
// Full grid: T x pCap on all 23 seeds.
// -------------------------------------------------------------------------------------------
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

console.log("\n=== FULL GRID (T x pCap, n=23) ===");
const alwaysSafeScores = allSeeds.map((s) => alwaysSafeByeSeed.get(s)!.finalScore);
const alwaysSafeMedian = median(alwaysSafeScores);
console.log(`alwaysSafeMedian=${alwaysSafeMedian} (over ${allSeeds.length} seeds)`);
console.log("T,pCap,medianScore,ratioVsAlwaysSafe,winFraction,capHitRate");

interface GridRow {
  T: number;
  pCap: number;
  medianScore: number;
  ratio: number;
  winFraction: number;
  capHitRate: number;
}
const gridRows: GridRow[] = [];

const t0 = Date.now();
for (const T of TGrid) {
  for (const pCap of pCapGrid) {
    const agent = buildThresholdAgent(T, pCap);
    const scores: number[] = [];
    let wins = 0;
    let capHits = 0;
    for (const seed of allSeeds) {
      const r = playSoloRun(engine, agent, seed, { moveCap });
      scores.push(r.finalScore);
      if (r.capHit) capHits += 1;
      const safeScore = alwaysSafeByeSeed.get(seed)!.finalScore;
      if (r.finalScore > safeScore) wins += 1;
    }
    const med = median(scores);
    const row: GridRow = {
      T,
      pCap,
      medianScore: med,
      ratio: med / alwaysSafeMedian,
      winFraction: wins / allSeeds.length,
      capHitRate: capHits / allSeeds.length,
    };
    gridRows.push(row);
    console.log(
      `${T === Infinity ? "inf" : T},${pCap},${med},${row.ratio.toFixed(3)},${row.winFraction.toFixed(3)},${row.capHitRate.toFixed(3)}`
    );
  }
}
console.log(`grid elapsed: ${Date.now() - t0}ms`);

const best = gridRows.reduce((a, b) => (b.medianScore > a.medianScore ? b : a));
console.log(
  `\nBEST_INTERIOR T=${best.T === Infinity ? "inf" : best.T} pCap=${best.pCap} medianScore=${best.medianScore} ` +
    `ratio=${best.ratio.toFixed(3)} winFraction=${best.winFraction.toFixed(3)}`
);
console.log(`ALWAYS_SAFE_MEDIAN=${alwaysSafeMedian}`);

const beatsOnMajority = gridRows.filter((r) => r.winFraction > 0.5);
console.log(`\nInterior members beating Always-Safe on a MAJORITY of seeds (winFraction > 0.5): ${beatsOnMajority.length} / ${gridRows.length}`);
for (const r of beatsOnMajority) {
  console.log(`  T=${r.T === Infinity ? "inf" : r.T} pCap=${r.pCap} winFraction=${r.winFraction.toFixed(3)} ratio=${r.ratio.toFixed(3)}`);
}

console.log("S0B_SWEEP_COMPLETE");

// S1 measurement — docs/plans/mine-run-risk-aware-policy.md §2 model vs Always-Safe, on the
// SAME 23-seed set S0b used (platform-corrections.md C39's ruling: "the §2 survival-discounted
// model prices compounding hazard properly and deserves its own measurement"). Per the
// coordinator's explicit standing ask: report the paired win fraction ALONGSIDE the median
// ratio for everything measured from here — S0b showed a gate reading unpaired medians and a
// paired per-board comparison can disagree exactly at the threshold that matters.
//
// riskAwareMove (risk-policy.ts) uses the default Tier B risk source (analyzeFrontier) — no
// search/rollouts, same cost class as Always-Safe (~3ms/game, C27).

import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { riskAwareMove } from "../games/mine-run/risk-policy";
import { buildSafeMoveAgent, pairedSeeds, playSoloRun, type SoloRunResult } from "@twist-arcade/harness";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const moveCap = 400;

const alwaysSafeAgent = buildSafeMoveAgent(engine, safeMove);
const riskAwareAgent = buildSafeMoveAgent(engine, riskAwareMove);

const bridgeSeeds = ["ci:mine-run:ci-0", "ci:mine-run:ci-1", "ci:mine-run:ci-2"];
const bridgeExpected = [849, 686, 1247];

console.log("=== BRIDGE CHECK (re-verify before trusting this run) ===");
let bridgeOk = true;
for (let i = 0; i < bridgeSeeds.length; i++) {
  const r = playSoloRun(engine, alwaysSafeAgent, bridgeSeeds[i]!, { moveCap });
  const ok = r.finalScore === bridgeExpected[i];
  bridgeOk = bridgeOk && ok;
  console.log(`seed=${bridgeSeeds[i]} score=${r.finalScore} expected=${bridgeExpected[i]} match=${ok}`);
}
console.log(`BRIDGE_CHECK_RESULT ok=${bridgeOk}`);
if (!bridgeOk) {
  console.log("BRIDGE CHECK FAILED — STOPPING.");
  process.exit(1);
}

const pilotSeeds = pairedSeeds("c29:mine-run:pilot", 20);
const allSeeds = [...bridgeSeeds, ...pilotSeeds]; // identical 23-seed set S0b used

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

console.log("\n=== riskAwareMove (Tier B, standalone) vs Always-Safe, n=23 (paired seeds) ===");
console.log("seed,alwaysSafe,riskAware,riskAwareWins,alwaysSafeDecisions,riskAwareDecisions");

const alwaysSafeResults: SoloRunResult[] = [];
const riskAwareResults: SoloRunResult[] = [];
let wins = 0;
let losses = 0;
let ties = 0;

const t0 = Date.now();
for (const seed of allSeeds) {
  const safeR = playSoloRun(engine, alwaysSafeAgent, seed, { moveCap });
  const riskR = playSoloRun(engine, riskAwareAgent, seed, { moveCap });
  alwaysSafeResults.push(safeR);
  riskAwareResults.push(riskR);
  const win = riskR.finalScore > safeR.finalScore;
  const loss = riskR.finalScore < safeR.finalScore;
  if (win) wins += 1;
  else if (loss) losses += 1;
  else ties += 1;
  console.log(
    `${seed},${safeR.finalScore},${riskR.finalScore},${win},${safeR.decisions},${riskR.decisions}` +
      `${riskR.capHit ? ",CAP_HIT_RISK" : ""}${safeR.capHit ? ",CAP_HIT_SAFE" : ""}`
  );
}
console.log(`elapsed: ${Date.now() - t0}ms`);

const alwaysSafeScores = alwaysSafeResults.map((r) => r.finalScore);
const riskAwareScores = riskAwareResults.map((r) => r.finalScore);
const alwaysSafeMedian = median(alwaysSafeScores);
const riskAwareMedian = median(riskAwareScores);
const medianRatio = riskAwareMedian / alwaysSafeMedian; // >1 means riskAware's own median is higher
const gateRatio = alwaysSafeMedian / riskAwareMedian; // the GATE's own convention (alwaysSafeVsStrongRatio shape): <0.95 is healthy
const winFraction = wins / allSeeds.length;

console.log("\n=== SUMMARY ===");
console.log(`alwaysSafeMedian=${alwaysSafeMedian} riskAwareMedian=${riskAwareMedian}`);
console.log(`medianRatio (riskAware/alwaysSafe) = ${medianRatio.toFixed(4)}`);
console.log(`gateRatio (alwaysSafe/riskAware, gate's own convention, healthy<=0.70, fail>=0.95) = ${gateRatio.toFixed(4)}`);
console.log(`PAIRED win/loss/tie = ${wins}/${losses}/${ties} out of ${allSeeds.length}`);
console.log(`PAIRED_WIN_FRACTION = ${winFraction.toFixed(4)}`);
console.log(`alwaysSafeCapHitRate=${alwaysSafeResults.filter((r) => r.capHit).length}/${allSeeds.length}`);
console.log(`riskAwareCapHitRate=${riskAwareResults.filter((r) => r.capHit).length}/${allSeeds.length}`);

console.log("S1_MEASUREMENT_COMPLETE");

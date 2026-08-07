// Leg 2 of the three-leg kill standard (docs/plans/mine-run-risk-aware-policy.md §6 leg 2,
// C37/R3's one-round bound, C42's ruling to proceed to leg 2 after leg 1 did not fire —
// gateRatio 0.9499 sits in the (0.70, 0.95) band: "gate passes, design target missed -> one
// bounded lever-sweep round, then freeze or escalate").
//
// Grid: {18, 20, 22}% mine density x {50, 60, 75} budget on the fixed 10x10 board, MINUS the
// frozen combo (density 20% == mines 20, budget 60 -- already measured as leg 1's own row:
// gateRatio 0.9499, median 729 vs Always-Safe's 692.5, n=100, root "c29:mine-run:v1"). That
// leaves 8 combos, n=40 direction-only, per C37/R3. Best combo (by gateRatio) is then confirmed
// at n=100 on a FRESH derived seed block (C25/C32: each configuration is a different game --
// never reuse a seed root that was compared under a different config, and the n=40 read and an
// n=100 read of a DIFFERENT config are never paired against each other).
//
// Per C41/C42: report BOTH metrics for every combo -- the gate's own ratio
// (alwaysSafeMedian/riskAwareMedian, hard-fail >= 0.95, healthy <= 0.70) AND the paired
// win/loss/tie with ties EXCLUDED from the win fraction (C42: a tie-inclusive fraction made a
// 57% decisive-board edge read as 49%).
//
// Each combo is its OWN game (C25): Always-Safe and RiskAware-B are both re-run fresh on that
// combo's own engine instance, on the identical seed set for that combo (paired within the
// combo), never compared numerically against a different combo's own Always-Safe baseline.

import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { riskAwareMove } from "../games/mine-run/risk-policy";
import { buildSafeMoveAgent, pairedSeeds, playSoloRun } from "@twist-arcade/harness";
import type { SoloRunResult } from "@twist-arcade/harness";

const WIDTH = 10;
const HEIGHT = 10;
const TOTAL_CELLS = WIDTH * HEIGHT;
const moveCap = 400;

const FROZEN = { densityPct: 20, budget: 60 }; // already measured (leg 1 / C42)

const densityGrid = [18, 20, 22];
const budgetGrid = [50, 60, 75];

interface Combo {
  densityPct: number;
  budget: number;
  mines: number;
}

const combos: Combo[] = [];
for (const densityPct of densityGrid) {
  for (const budget of budgetGrid) {
    if (densityPct === FROZEN.densityPct && budget === FROZEN.budget) continue; // frozen combo excluded
    combos.push({ densityPct, budget, mines: Math.round((densityPct / 100) * TOTAL_CELLS) });
  }
}
console.log(`grid size (minus frozen combo) = ${combos.length}`); // expect 8

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

// -------------------------------------------------------------------------------------------
// Bridge check FIRST (spec's own precondition, applies to the FROZEN 10x10/20/60 config only --
// the config leg 1's ci:mine-run:ci-{0,1,2} fixtures were calibrated against). Confirms the
// harness/engine wiring here matches the already-trusted baseline before any NEW config number
// is trusted.
// -------------------------------------------------------------------------------------------
const bridgeEngine = createMineRun({ width: WIDTH, height: HEIGHT, mines: 20, budget: 60 });
const bridgeAgent = buildSafeMoveAgent(bridgeEngine, safeMove);
const bridgeSeeds = ["ci:mine-run:ci-0", "ci:mine-run:ci-1", "ci:mine-run:ci-2"];
const bridgeExpected = [849, 686, 1247];
console.log("=== BRIDGE CHECK (frozen config) ===");
let bridgeOk = true;
for (let i = 0; i < bridgeSeeds.length; i++) {
  const r = playSoloRun(bridgeEngine, bridgeAgent, bridgeSeeds[i]!, { moveCap });
  const ok = r.finalScore === bridgeExpected[i];
  bridgeOk = bridgeOk && ok;
  console.log(`seed=${bridgeSeeds[i]} score=${r.finalScore} expected=${bridgeExpected[i]} match=${ok}`);
}
console.log(`BRIDGE_CHECK_RESULT ok=${bridgeOk}`);
if (!bridgeOk) {
  console.log("BRIDGE CHECK FAILED — STOPPING.");
  process.exit(1);
}

interface ComboResult {
  combo: Combo;
  n: number;
  alwaysSafeMedian: number;
  riskAwareMedian: number;
  gateRatio: number; // alwaysSafeMedian / riskAwareMedian; hard-fail >= 0.95, healthy <= 0.70
  wins: number;
  losses: number;
  ties: number;
  decisiveWinFraction: number; // wins / (wins+losses), ties EXCLUDED (C42)
  tieInclusiveWinFraction: number; // reported for completeness, NOT the primary per C42
}

function runCombo(combo: Combo, seeds: string[]): ComboResult {
  const engine = createMineRun({ width: WIDTH, height: HEIGHT, mines: combo.mines, budget: combo.budget });
  const alwaysSafeAgent = buildSafeMoveAgent(engine, safeMove);
  const riskAwareAgent = buildSafeMoveAgent(engine, riskAwareMove);

  const safeResults: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, alwaysSafeAgent, s, { moveCap }));
  const riskResults: SoloRunResult[] = seeds.map((s) => playSoloRun(engine, riskAwareAgent, s, { moveCap }));

  const safeScores = safeResults.map((r) => r.finalScore);
  const riskScores = riskResults.map((r) => r.finalScore);
  const alwaysSafeMedian = median(safeScores);
  const riskAwareMedian = median(riskScores);

  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let i = 0; i < seeds.length; i++) {
    const s = safeScores[i]!;
    const r = riskScores[i]!;
    if (r > s) wins += 1;
    else if (r < s) losses += 1;
    else ties += 1;
  }
  const decisive = wins + losses;

  return {
    combo,
    n: seeds.length,
    alwaysSafeMedian,
    riskAwareMedian,
    gateRatio: alwaysSafeMedian / riskAwareMedian,
    wins,
    losses,
    ties,
    decisiveWinFraction: decisive === 0 ? 0.5 : wins / decisive,
    tieInclusiveWinFraction: wins / seeds.length,
  };
}

function logResult(label: string, r: ComboResult): void {
  console.log(
    `${label.padEnd(28)} mines=${r.combo.mines}(${r.combo.densityPct}%) budget=${r.combo.budget} n=${r.n} ` +
      `alwaysSafeMedian=${r.alwaysSafeMedian} riskAwareMedian=${r.riskAwareMedian} ` +
      `gateRatio=${r.gateRatio.toFixed(4)} W/L/T=${r.wins}/${r.losses}/${r.ties} ` +
      `decisiveWinFraction=${r.decisiveWinFraction.toFixed(4)} tieInclusive=${r.tieInclusiveWinFraction.toFixed(4)}`
  );
}

// -------------------------------------------------------------------------------------------
// Round 1: n=40 direction-only, ALL 8 non-frozen combos, one fixed seed root shared across
// combos (C24: the swept variable — density/budget — never appears in the seed string itself;
// reusing the identical seed STRINGS across combos is fine and intended, since each combo's own
// engine instance derives a genuinely different board from the same seed string given its own
// mines/budget — this is what makes the comparison paired WITHIN each combo).
// -------------------------------------------------------------------------------------------
const sweepSeeds = pairedSeeds("c37:mine-run:leg2-sweep", 40);
console.log(`\n=== LEG 2 ROUND 1 — n=${sweepSeeds.length}, root="c37:mine-run:leg2-sweep" ===`);

const t0 = Date.now();
const sweepResults: ComboResult[] = combos.map((combo) => runCombo(combo, sweepSeeds));
console.log(`round 1 elapsed: ${Date.now() - t0}ms`);
for (const r of sweepResults) logResult(`density=${r.combo.densityPct}%,budget=${r.combo.budget}`, r);

// "Best" = lowest gateRatio (closest to, or past, beating Always-Safe), per leg 1's own
// convention (leg1-kill-standard.ts).
const best = sweepResults.reduce((a, b) => (b.gateRatio < a.gateRatio ? b : a));
console.log(
  `\nBEST (lowest gateRatio) combo: density=${best.combo.densityPct}% budget=${best.combo.budget} ` +
    `gateRatio=${best.gateRatio.toFixed(4)} decisiveWinFraction=${best.decisiveWinFraction.toFixed(4)}`
);

// -------------------------------------------------------------------------------------------
// Confirmation: best combo only, n=100, on a FRESH derived seed block (C25/C32 — a different
// root from round 1's, and different from leg 1's "c29:mine-run:v1", since that root was
// measured against the FROZEN combo and is not reusable here as a paired comparison).
// -------------------------------------------------------------------------------------------
const confirmSeeds = pairedSeeds("c37:mine-run:leg2-confirm", 100);
console.log(`\n=== LEG 2 CONFIRMATION — n=${confirmSeeds.length}, root="c37:mine-run:leg2-confirm" ===`);
const t1 = Date.now();
const confirmResult = runCombo(best.combo, confirmSeeds);
console.log(`confirmation elapsed: ${Date.now() - t1}ms`);
logResult(`CONFIRM density=${confirmResult.combo.densityPct}%,budget=${confirmResult.combo.budget}`, confirmResult);

// -------------------------------------------------------------------------------------------
// Leg 2 verdict, per §6 leg 2 / C42's ruling: "best config still fails leg 1" means the
// confirmed combo's gateRatio is still >= 1.0 (does not beat Always-Safe's OWN median outright);
// separately report where it sits against the 0.70 design-healthy target and the 0.95 hard-fail
// line, since that is the actual decision surface per §5's table.
// -------------------------------------------------------------------------------------------
console.log("\n=== LEG 2 VERDICT ===");
console.log(`confirmed gateRatio = ${confirmResult.gateRatio.toFixed(4)}`);
console.log(`  <= 0.70 (design-healthy)?  ${confirmResult.gateRatio <= 0.7}`);
console.log(`  < 0.95 (gate hard-fail line)? ${confirmResult.gateRatio < 0.95}`);
console.log(`  >= 1.0 (fails leg 1's own condition)? ${confirmResult.gateRatio >= 1.0}`);
console.log(`LEG1_STILL_FAILS_AT_BEST_CONFIG (gateRatio >= 1.0) = ${confirmResult.gateRatio >= 1.0}`);

console.log("LEG2_COMPLETE");

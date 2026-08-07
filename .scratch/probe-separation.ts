// Quick, small-N sanity probe on the REAL Mine Run board dims (10x10, budget 60), NOT the
// 36-cell test fixture -- to check whether a candidate reduced ciGateBudget.soloChaseCiRollouts
// still separates a healthy config from a degenerate (near-zero mine density) one, and to get
// a per-seed timing sample to extrapolate full CI-scale (100 seeds) wall-clock.
import { createMineRun } from "@twist-arcade/mine-run";
import { safeMove } from "@twist-arcade/mine-run";
import { runSoloChaseCiGate } from "@twist-arcade/harness";
import type { GameManifest } from "@twist-arcade/game-spec";

const manifest: GameManifest = {
  id: "mine-run-probe",
  title: "Mine Run",
  classic: "Minesweeper",
  ruleSentence: "probe fixture, not the real manifest",
  tags: [],
  estMinutes: 3,
  modes: { bot: false, hotseat: false, asyncLink: false },
  players: { min: 1, max: 1 },
  difficultyTiers: [],
  solo: { format: "score-chase", moveCap: 130 },
};

const seedCount = Number(process.argv[2] ?? 6);
const rollouts = Number(process.argv[3] ?? 750);
const moveCapArg = Number(process.argv[4] ?? 130);
manifest.solo!.moveCap = moveCapArg;

const healthy = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const degenerate = createMineRun({ width: 10, height: 10, mines: 2, budget: 60 });

const m = { ...manifest, ciGateBudget: { soloChaseCiRollouts: rollouts } };

console.log(`probe: seedCount=${seedCount} rollouts=${rollouts} (real 10x10 board)`);

let t0 = Date.now();
const healthyReport = runSoloChaseCiGate(healthy, m, {
  seed: "probe:healthy",
  seedCount,
  safeMove,
  suite: "ci",
});
console.log(`healthy alwaysSafeVsStrong=${healthyReport.alwaysSafeVsStrong.toFixed(3)} elapsed=${Date.now() - t0}ms`);

t0 = Date.now();
const degenerateReport = runSoloChaseCiGate(degenerate, m, {
  seed: "probe:degenerate",
  seedCount,
  safeMove,
  suite: "ci",
});
console.log(`degenerate alwaysSafeVsStrong=${degenerateReport.alwaysSafeVsStrong.toFixed(3)} elapsed=${Date.now() - t0}ms`);

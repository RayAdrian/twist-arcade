// packages/game-spec/src/certificate.ts — DailyCertificate (plan §7.7), a first-class
// stored artifact: simultaneously the fairness proof, the difficulty calibration, and the
// share hook ("par"). The actual generate -> solve -> reject -> store pipeline is M3d
// (packages/harness); this milestone owns only the schema.

import type { Json } from "@twist-arcade/engine";

export interface DailyCertificate {
  gameId: string;
  gameVersion: number;
  engineVersion: string; // pinned — a version bump invalidates the buffer for that game
  day: string; // "2026-09-14" (UTC) — the daily slot certified
  seed: string; // dailyFormula(gameId, engineVersion, day) + ":" + nonce
  nonce: number; // how many candidates were rejected before this one
  moveLog: Json[]; // solver solution — CI replays it via verifyCertificate()
  par: number; // L* — published in UI and share artifact
  parKind: "optimal" | "best-in-budget";
  solverNodes: number;
  guessFree?: boolean; // fog games only
  features: {
    forcedMoveFraction: number;
    branchingMean: number;
    deadEndDensity: number; // fraction of 1,000 random playouts reaching unsolvable state
    greedyGap: number | null; // greedy length - L*, null = greedy fails
    zScore: number; // vs the game's 10k-seed calibration distribution
  };
}

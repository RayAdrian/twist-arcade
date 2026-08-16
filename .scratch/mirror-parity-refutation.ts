// .scratch/mirror-parity-refutation.ts — pre-implementation refutation experiment for the
// mirror-metric amendment (docs/plans/degeneracy-probes.md §1.1, amended 2026-08-16;
// docs/plans/platform-corrections.md C81). MEASUREMENT ONLY — does not implement the metric
// change (thresholds.ts / probes-two-player.ts / any gate untouched).
//
// Mirror matchup ONLY (no stall, no rush): the game's own mirrorMove as P2, mirrorSeats: false,
// vs "ruthless" at each game's CI-effective budget (manifest.ciGateBudget.twoPlayerCiRollouts,
// via the SAME production helper `runProbeSuite`'s own mirror row uses —
// `resolveEffectiveRuthlessTier` + `tierAgent`, packages/harness/src/suites.ts — never a second,
// independently-scaled clone, per that helper's own doc comment). n=100, two independent seeds,
// for tilt, fadeout, nine-grids.
//
// Prints, from the SAME outcomes: win rate (agentWinRate), draw rate (MatchupMetrics.drawRate),
// parity score (agentParityScore — the SAME function the amendment proposes binding the gate to),
// and the harness-observed mirrorFallbackRate (MatchupMetrics.mirrorFallbackRate, merged at
// 25e2a36 / C81 task #26) — the only way to know how much of each row was actually mirroring.
//
// `resolveEffectiveRuthlessTier`/`tierAgent`/`findTier` are internal to packages/harness/src/
// suites.ts (not re-exported from the package barrel) — imported directly by relative path, the
// same convention this script's sibling (scripts/research/tilt-t4-gates.ts) already uses for
// game-internal modules (engine/manifest/probes imported straight from source, bypassing each
// game's own package-root index.ts, which pulls in React UI code this script has no use for).
//
// Run: pnpm tsx .scratch/mirror-parity-refutation.ts > docs/research/games/mirror-parity-refutation-2026-08-16.out 2>&1

import {
  agentParityScore,
  agentWinRate,
  mirrorAgent,
  runMatchup,
  type MatchupReport,
} from "@twist-arcade/harness";
import { findTier, resolveEffectiveRuthlessTier, tierAgent } from "../packages/harness/src/suites";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { GameManifest } from "@twist-arcade/game-spec";

import { tilt, type TiltMove, type TiltState } from "../games/tilt/engine";
import { manifest as tiltManifest } from "../games/tilt/manifest";
import { mirrorMove as tiltMirrorMove } from "../games/tilt/probes";

import { createFadeoutEngine, type FadeoutMove, type FadeoutState } from "../games/fadeout/engine";
import { FADEOUT_RULESET_CONFIG, fadeoutManifest } from "../games/fadeout/manifest";
import { mirrorMove as fadeoutMirrorMove } from "../games/fadeout/probes";

import { nineGrids, type NineGridsMove, type NineGridsState } from "../games/nine-grids/engine";
import { manifest as nineGridsManifest } from "../games/nine-grids/manifest";
import { mirrorMove as nineGridsMirrorMove } from "../games/nine-grids/probes";

const GAMES = 100;
const SEEDS = ["mirror-parity-refutation-seed-a", "mirror-parity-refutation-seed-b"] as const;

interface Measurement {
  readonly gameId: string;
  readonly seed: string;
  readonly rollouts: number;
  readonly winRate: number;
  readonly drawRate: number;
  readonly parity: number;
  readonly mirrorFallbackRate: number | null;
  readonly wallClockMs: number;
}

/**
 * Runs the mirror-vs-ruthless matchup ONLY (no stall, no rush — the amendment's refutation
 * experiment is scoped to mirror alone), replicating exactly the construction
 * `runProbeSuite`'s own mirror row uses (probes-two-player.ts:388-416): the SAME in-memory-
 * cloned "ci"-effective ruthless tier `runCiSuite` itself measures with, `mirrorSeats: false`.
 */
function runMirrorProbeOnly<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  mirrorMove: (state: S, lastOppMove: M | null, legalMoves: readonly M[]) => M | null,
  seed: string
): { report: MatchupReport; rollouts: number; wallClockMs: number } {
  const shippedRuthlessTier = findTier(manifest, "ruthless");
  if (!shippedRuthlessTier) {
    throw new Error(`runMirrorProbeOnly: manifest "${manifest.id}" has no "ruthless" difficulty tier`);
  }
  const { ruthlessTier } = resolveEffectiveRuthlessTier(manifest, "ci", shippedRuthlessTier);
  const ruthless = tierAgent<S, M>("ruthless", ruthlessTier);
  const mirror = mirrorAgent<S, M>(mirrorMove);

  const rollouts = ruthlessTier.budget.kind === "rollouts" ? ruthlessTier.budget.n : Number.NaN;

  const start = Date.now();
  const report = runMatchup(engine, ruthless, mirror, {
    games: GAMES,
    seed,
    mirrorSeats: false,
  });
  const wallClockMs = Date.now() - start;

  return { report, rollouts, wallClockMs };
}

function measure<S extends WithEffects, M extends Json, V extends WithEffects>(
  gameId: string,
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  mirrorMove: (state: S, lastOppMove: M | null, legalMoves: readonly M[]) => M | null
): Measurement[] {
  return SEEDS.map((seed) => {
    const { report, rollouts, wallClockMs } = runMirrorProbeOnly(engine, manifest, mirrorMove, seed);
    const winRate = agentWinRate(report.outcomes, "mirror");
    const parity = agentParityScore(report.outcomes, "mirror");
    return {
      gameId,
      seed,
      rollouts,
      winRate,
      drawRate: report.metrics.drawRate,
      parity,
      mirrorFallbackRate: report.metrics.mirrorFallbackRate,
      wallClockMs,
    };
  });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  console.log("Pre-implementation refutation experiment — mirror-metric amendment");
  console.log("docs/plans/degeneracy-probes.md §1.1 (amended 2026-08-16); platform-corrections.md C81");
  console.log("MEASUREMENT ONLY — thresholds.ts / probes-two-player.ts / gates untouched.");
  console.log();
  console.log(`Mirror matchup only (mirrorSeats: false) vs ruthless @ ci-effective budget, n=${GAMES} games, 2 seeds/game.`);
  console.log();

  const overallStart = Date.now();

  const all: Measurement[] = [];
  all.push(...measure("tilt", tilt, tiltManifest, tiltMirrorMove));
  all.push(...measure("fadeout", createFadeoutEngine(FADEOUT_RULESET_CONFIG), fadeoutManifest, fadeoutMirrorMove));
  all.push(...measure("nine-grids", nineGrids, nineGridsManifest, nineGridsMirrorMove));

  const overallWallClockMs = Date.now() - overallStart;

  console.log("game          seed                              rollouts  winRate  drawRate  parity   mirrorFallbackRate  wallClock");
  for (const m of all) {
    console.log(
      `${m.gameId.padEnd(14)}${m.seed.padEnd(34)}${String(m.rollouts).padEnd(10)}` +
        `${pct(m.winRate).padEnd(9)}${pct(m.drawRate).padEnd(10)}${pct(m.parity).padEnd(9)}` +
        `${(m.mirrorFallbackRate === null ? "null" : pct(m.mirrorFallbackRate)).padEnd(20)}` +
        `${(m.wallClockMs / 1000).toFixed(1)}s`
    );
  }
  console.log();
  console.log(`Total wall clock: ${(overallWallClockMs / 1000).toFixed(1)}s`);
  console.log();

  // ---------------------------------------------------------------------------------------
  // Pre-registered verdict, applied as written (degeneracy-probes.md §1.1): REFUTES the
  // amendment if Tilt lands at >=40% parity on EITHER seed. No hedging, no averaging seeds
  // that disagree materially (C47/C71).
  // ---------------------------------------------------------------------------------------
  const tiltRows = all.filter((m) => m.gameId === "tilt");
  const tiltRefutes = tiltRows.some((m) => m.parity >= 0.4);
  console.log("=== Pre-registered verdict: does Tilt refute the amendment? ===");
  for (const m of tiltRows) {
    console.log(`  tilt/${m.seed}: parity ${pct(m.parity)} (win ${pct(m.winRate)}, draw ${pct(m.drawRate)}) — ${m.parity >= 0.4 ? "REFUTES (>=40%)" : "does not refute (<40%)"}`);
  }
  console.log(tiltRefutes ? "VERDICT: REFUTED — Tilt lands >=40% parity on at least one seed." : "VERDICT: NOT REFUTED — Tilt stays below 40% parity on both seeds.");
  console.log();

  const tiltDisagree =
    tiltRows.length === 2 && Math.abs(tiltRows[0]!.parity - tiltRows[1]!.parity) >= 0.1;
  if (tiltDisagree) {
    console.log(
      `NOTE: Tilt's two seeds disagree materially on parity (${pct(tiltRows[0]!.parity)} vs ${pct(tiltRows[1]!.parity)}) — reported separately, not averaged (C47/C71).`
    );
  }

  console.log("=== Informational: Fadeout draw share (prediction check, never gated) ===");
  for (const m of all.filter((x) => x.gameId === "fadeout")) {
    console.log(
      `  fadeout/${m.seed}: win ${pct(m.winRate)}, draw ${pct(m.drawRate)}, parity ${pct(m.parity)} — ` +
        (m.drawRate > m.winRate
          ? "mirror mostly DRAWS (relief is load-bearing, as predicted)"
          : "mirror mostly LOSES rather than draws (relief remains correct but is cheap insurance, not mandatory)")
    );
  }
  console.log();

  console.log("=== Informational: Nine Grids fallback rate (parity caveat) ===");
  for (const m of all.filter((x) => x.gameId === "nine-grids")) {
    const fb = m.mirrorFallbackRate === null ? "null" : pct(m.mirrorFallbackRate);
    console.log(
      `  nine-grids/${m.seed}: parity ${pct(m.parity)} at mirrorFallbackRate ${fb} — ` +
        "this parity number is measured on a row that is overwhelmingly fallback " +
        "(first-legal-vs-ruthless play), not mirroring; report with that caveat, never bare."
    );
  }
}

main();

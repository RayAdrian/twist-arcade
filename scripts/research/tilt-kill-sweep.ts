// scripts/research/tilt-kill-sweep.ts — T2 (docs/plans/tilt.md §5.1). The purpose-built,
// low-budget sweep that runs BEFORE any full gate table, answering "does the mechanic work"
// cheaply. Roster: random, MCTS-100, MCTS-1k. ~200 games per pairing. ONE FIXED SEED shared by
// every matchup (C24: never interpolate a swept parameter into the seed — that was the defect
// that hit both the Fadeout budget sweep and the Nine Grids pilot the same day).
//
// Three matchups, all against the SHIPPED 7x7/win-4/period-4/cw/draw config:
//   1. mcts1k vs random     — strong-vs-random win rate, the R1 kill row
//   2. mcts1k vs mcts1k     — realistic "strong" self-play: draw rate, re-fall-decided %,
//                             double-line frequency, plies/branching (the table's "at MCTS-1k"
//                             qualifiers all point at self-play, not a lopsided random game)
//   3. mcts1k vs mcts100    — the depth check (C44's analogue): if deeper search doesn't
//                             clearly beat shallower, planning through rotations doesn't pay
//                             and the twist is decorative. TREATED AS THE MOST IMPORTANT ROW
//                             per the coordinator's brief.
//
// For each game, `runMatchup` gives us `GameOutcome.moves` (the full StepRecord[] ply log) but
// not the final state directly — replayed here via @twist-arcade/engine's `replay()` (the same
// wire format runMatchup's own seed convention guarantees is valid) to recover the terminal
// grid and lastEffects, which is what "ended by a re-fall" and "double-line" require.
//
// Run: pnpm tsx scripts/research/tilt-kill-sweep.ts

import { replay, type ReplayRecord } from "@twist-arcade/engine";
import { agentWinRate, resolveNamedAgent, runMatchup, type MatchupReport } from "@twist-arcade/harness";
import { tilt, type TiltMove, type TiltState } from "../../games/tilt/engine";
import { hasRun, type Geometry } from "../../games/tilt/engine-internal";

const SEED = "tilt-t2-kill-sweep"; // ONE seed for every matchup below — C24.
const GAMES = 200;
const GEO: Geometry = { size: 7, winLength: 4 };

function replayFinal(matchSeed: string, outcome: MatchupReport["outcomes"][number]): TiltState {
  const record: ReplayRecord = {
    gameId: "tilt",
    gameVersion: tilt.meta.version,
    engineVersion: "n/a", // replay() does not read/validate this field
    numPlayers: 2,
    seed: matchSeed,
    steps: outcome.moves,
  };
  return replay(tilt, record).final;
}

interface DerivedStats {
  decisiveGames: number;
  reFallDecided: number;
  dropDecided: number;
  doubleLineDraws: number;
  totalDraws: number;
}

function deriveStats(report: MatchupReport): DerivedStats {
  let decisiveGames = 0;
  let reFallDecided = 0;
  let dropDecided = 0;
  let doubleLineDraws = 0;
  let totalDraws = 0;

  for (const outcome of report.outcomes) {
    const final = replayFinal(outcome.matchSeed, outcome);
    const endedByTilt = final.lastEffects.some((e) => e.type === "tilted");

    if (outcome.winnerSeat !== null && !outcome.capHit) {
      decisiveGames++;
      if (endedByTilt) reFallDecided++;
      else dropDecided++;
    } else if (!outcome.capHit) {
      // A genuine rules-drawn terminal (not a ply-cap adjudication). Distinguish "double
      // line" (both players' runs completed by the SAME re-fall) from an ordinary full-board
      // no-line draw — only the grid can tell the two apart; capHit games never reach here.
      totalDraws++;
      if (hasRun(final.grid, GEO, 0) && hasRun(final.grid, GEO, 1)) doubleLineDraws++;
    }
  }

  return { decisiveGames, reFallDecided, dropDecided, doubleLineDraws, totalDraws };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a (d=0)" : `${((n / d) * 100).toFixed(1)}%`;
}

function fmtReport(label: string, report: MatchupReport, derived: DerivedStats): string {
  const m = report.metrics;
  const lines: string[] = [];
  lines.push(`--- ${label} (n=${m.games}) ---`);
  lines.push(`  seat0 (${report.agentA}) win rate: ${(m.winRateBySeat[0] * 100).toFixed(1)}%`);
  lines.push(`  seat1 (${report.agentB}) win rate: ${(m.winRateBySeat[1] * 100).toFixed(1)}%`);
  lines.push(`  draw rate: ${(m.drawRate * 100).toFixed(1)}%`);
  lines.push(`  mean plies: ${m.meanPlies.toFixed(1)}  median plies: ${m.medianPlies}  p95: ${m.p95Plies}`);
  lines.push(`  mean branching factor: ${m.meanBranchingFactor.toFixed(2)}`);
  lines.push(`  cap-hit rate: ${(m.capHitRate * 100).toFixed(2)}% (must be 0 — structural termination, plan §1.6)`);
  lines.push(
    `  decisive games: ${derived.decisiveGames} — ended by re-fall: ${derived.reFallDecided} ` +
      `(${pct(derived.reFallDecided, derived.decisiveGames)}), ended by drop: ${derived.dropDecided} ` +
      `(${pct(derived.dropDecided, derived.decisiveGames)})`
  );
  lines.push(
    `  draws: ${derived.totalDraws} — double-line: ${derived.doubleLineDraws} ` +
      `(${pct(derived.doubleLineDraws, m.games)} of ALL games, the §5.1 threshold's own denominator)`
  );
  lines.push(`  throughput: ${report.throughputGamesPerSec.toFixed(1)} games/s`);
  return lines.join("\n");
}

function main(): void {
  const random = resolveNamedAgent<TiltState, TiltMove>("random");
  const mcts100 = resolveNamedAgent<TiltState, TiltMove>("mcts100");
  const mcts1k = resolveNamedAgent<TiltState, TiltMove>("mcts1k");

  console.log(`Tilt T2 kill-test sweep — seed="${SEED}", ${GAMES} games/pairing, shipped 7x7/win4/period4/cw/draw`);
  console.log();

  const strongVsRandom = runMatchup(tilt, mcts1k, random, { games: GAMES, seed: SEED, maxPlies: 60 });
  const strongVsRandomStats = deriveStats(strongVsRandom);
  console.log(fmtReport("mcts1k (strong) vs random", strongVsRandom, strongVsRandomStats));
  console.log();

  const selfPlay = runMatchup(tilt, mcts1k, mcts1k, { games: GAMES, seed: SEED, maxPlies: 60 });
  const selfPlayStats = deriveStats(selfPlay);
  console.log(fmtReport("mcts1k vs mcts1k (self-play)", selfPlay, selfPlayStats));
  console.log();

  const depthCheck = runMatchup(tilt, mcts1k, mcts100, { games: GAMES, seed: SEED, maxPlies: 60 });
  const depthCheckStats = deriveStats(depthCheck);
  console.log(fmtReport("mcts1k vs mcts100 (depth check — C44 analogue)", depthCheck, depthCheckStats));
  console.log();

  // ---------------------------------------------------------------------------------------
  // Kill/flag verdicts, per plan §5.1's table.
  // ---------------------------------------------------------------------------------------
  const strongWinRate = agentWinRate(strongVsRandom.outcomes, "mcts1k");
  const mcts1kVsMcts100WinRate = agentWinRate(depthCheck.outcomes, "mcts1k");
  const reFallPct = selfPlayStats.decisiveGames > 0 ? selfPlayStats.reFallDecided / selfPlayStats.decisiveGames : null;
  const doubleLinePct = selfPlayStats.doubleLineDraws / selfPlay.metrics.games;
  const selfPlayDrawRate = selfPlay.metrics.drawRate;
  const selfPlayMedianPlies = selfPlay.metrics.medianPlies;

  console.log("=== VERDICTS (plan §5.1) ===");

  const r1 = strongWinRate >= 0.9;
  console.log(
    `[${r1 ? "PASS" : "KILL "}] strong-vs-random win rate: ${(strongWinRate * 100).toFixed(1)}% (kill if <90%)`
  );

  if (reFallPct !== null) {
    const flagHigh = reFallPct > 0.6;
    const flagZero = reFallPct === 0;
    const verdict = flagHigh ? "FLAG (tilt decides everything)" : flagZero ? "FLAG (twist is cosmetic)" : "OK";
    console.log(
      `[${verdict === "OK" ? "PASS" : "FLAG "}] decisive games ended by a re-fall: ${(reFallPct * 100).toFixed(1)}% ` +
        `(flag >60% or ~0%) — ${verdict}`
    );
  } else {
    console.log(`[N/A  ] decisive games ended by a re-fall: no decisive games in self-play sample`);
  }

  const doubleLineFlag = doubleLinePct > 0.02;
  console.log(
    `[${doubleLineFlag ? "FLAG " : "PASS"}] double-line frequency: ${(doubleLinePct * 100).toFixed(2)}% ` +
      `(>2% -> measure doubleLine:"mover-wins" too)`
  );

  const drawFlag = selfPlayDrawRate > 0.4;
  console.log(`[${drawFlag ? "FLAG " : "PASS"}] draw rate at MCTS-1k self-play: ${(selfPlayDrawRate * 100).toFixed(1)}% (flag >40%)`);

  const pliesFlag = selfPlayMedianPlies < 10 || selfPlayMedianPlies > 40;
  console.log(
    `[${pliesFlag ? "FLAG " : "PASS"}] median plies (self-play): ${selfPlayMedianPlies} (flag outside 10-40)`
  );

  const r6 = mcts1kVsMcts100WinRate >= 0.55;
  console.log(
    `[${r6 ? "PASS" : "KILL "}] MCTS-1k vs MCTS-100: ${(mcts1kVsMcts100WinRate * 100).toFixed(1)}% ` +
      `(kill if <55% — THE C44 ANALOGUE, most important row)`
  );

  const capHitTotal = strongVsRandom.metrics.capHitRate + selfPlay.metrics.capHitRate + depthCheck.metrics.capHitRate;
  console.log(
    `[${capHitTotal === 0 ? "PASS" : "BUG  "}] cap hits across all three matchups: ${capHitTotal === 0 ? "0 (asserted, plan §1.6)" : "NONZERO — ENGINE BUG"}`
  );

  console.log();
  if (!r1 || !r6) {
    console.log("KILL ROW HIT — stop and escalate to the orchestrator with this data. Do not tune first.");
    process.exitCode = 1;
  } else {
    console.log("No kill row hit. Flags (if any) above are informational — still escalate before tuning.");
  }
}

main();

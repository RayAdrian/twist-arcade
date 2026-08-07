// scripts/research/tilt-t4-gates.ts — T4 (docs/plans/tilt.md §5.2/§5.4/§11): the CI gate table
// at the T3-validated budget (100 games, shipped 7x7/win-4/period-4/cw/draw config), plus the
// mirror and stall probes (§5.4). Reported verbatim — no tuning, per the coordinator's standing
// instruction. `ruthless-vs-standard` is expected to report "n/a" citing the CI-suite rollout
// override (C26) — that is the mechanism working as intended, not a gap.
//
// The engine is NOT registered (games/registry.ts untouched) — this runs directly against the
// game package, exactly like the CI gate table would once C13's `--game` filter can see it.
//
// Run: pnpm tsx scripts/research/tilt-t4-gates.ts > .scratch/tilt-t4-gates.out 2>&1

import { tierPolicy } from "@twist-arcade/bots";
import {
  agentWinRate,
  formatCiSuiteTable,
  formatMatchupTable,
  mirrorAgent,
  resolveNamedAgent,
  runCiSuite,
  runMatchup,
  type AgentSpec,
} from "@twist-arcade/harness";
import { tilt, type TiltMove, type TiltState } from "../../games/tilt/engine";
import { manifest } from "../../games/tilt/manifest";
import { mirrorMove } from "../../games/tilt/probes";

const GAMES = 100;
// The same validated CI budget T3 set in the manifest (3000 rollouts) — used here too so the
// probe opponents are exactly as strong as what the CI gate table itself measures against,
// not the full shipped 10,000 (which would make this script its own, unvalidated cost outlier).
const PROBE_ROLLOUTS = manifest.ciGateBudget?.twoPlayerCiRollouts ?? 3000;

function ruthlessProbeOpponent(): AgentSpec<TiltState, TiltMove> {
  const tier = manifest.difficultyTiers.find((t) => t.id === "ruthless");
  if (!tier) throw new Error("no ruthless tier in manifest");
  return {
    kind: "policy",
    name: "ruthless-probe-opponent",
    policy: tierPolicy<TiltState, TiltMove>(tier),
    budget: { kind: "rollouts", n: PROBE_ROLLOUTS },
  };
}

function main(): void {
  console.log(`Tilt T4 — gate table at the validated ${manifest.ciGateBudget?.twoPlayerCiRollouts}-rollout CI budget`);
  console.log(`${GAMES} games/matchup, shipped 7x7/win-4/period-4/cw/draw config.`);
  console.log();

  // ---------------------------------------------------------------------------------------
  // The CI gate table itself.
  // ---------------------------------------------------------------------------------------
  const ciReport = runCiSuite(tilt, manifest, { games: GAMES, seed: "tilt-t4-ci-gate-table", suite: "ci" });
  console.log(formatCiSuiteTable(ciReport));
  console.log();
  if (ciReport.matchups) {
    console.log(formatMatchupTable(ciReport.matchups.strongVsRandom));
    console.log();
    console.log(formatMatchupTable(ciReport.matchups.strongSelfPlay));
    console.log();
  }

  // ---------------------------------------------------------------------------------------
  // Mirror probe (plan §5.4): mirror as P2 (seat 1) vs the ruthless-tier opponent, gate <40%.
  // mirrorSeats=false — the gate is specifically about mirror IN SEAT 1, not pooled across
  // both seats.
  // ---------------------------------------------------------------------------------------
  const opponent = ruthlessProbeOpponent();
  const mirror = mirrorAgent<TiltState, TiltMove>(mirrorMove);
  const mirrorReport = runMatchup(tilt, opponent, mirror, {
    games: GAMES,
    seed: "tilt-t4-mirror-probe",
    mirrorSeats: false,
  });
  const mirrorWinRate = agentWinRate(mirrorReport.outcomes, "mirror");
  const mirrorGate = mirrorWinRate < 0.4;
  console.log(
    `[${mirrorGate ? "PASS" : "FAIL"}] mirror probe (P2, vs ruthless@${PROBE_ROLLOUTS}): ` +
      `${(mirrorWinRate * 100).toFixed(1)}% win rate (gate: <40%) — plan §5.4 predicted this SHOULD ` +
      "fail-to-win (fixed-CW tilt is not reflection-invariant, so mirroring is not value-preserving here)"
  );
  console.log();

  // ---------------------------------------------------------------------------------------
  // Stall probe (plan §5.4): stalling is structurally impossible; expect a trivial pass
  // (i.e., stall does not survive/degenerate the game — no crash, no cap hit, and it just
  // loses normally like any weak policy would).
  // ---------------------------------------------------------------------------------------
  const stall = resolveNamedAgent<TiltState, TiltMove>("stall");
  const stallReport = runMatchup(tilt, opponent, stall, {
    games: GAMES,
    seed: "tilt-t4-stall-probe",
    mirrorSeats: false,
  });
  const stallWinRate = agentWinRate(stallReport.outcomes, "stall");
  console.log(
    `[${stallReport.metrics.capHitRate === 0 ? "PASS" : "FAIL"}] stall probe (P2, vs ruthless@${PROBE_ROLLOUTS}): ` +
      `${(stallWinRate * 100).toFixed(1)}% win rate, cap-hit rate ${(stallReport.metrics.capHitRate * 100).toFixed(2)}% ` +
      "(expect trivial pass — stalling is structurally impossible, plan §5.4)"
  );

  console.log();
  console.log(`Overall CI suite: ${ciReport.ok ? "OK" : "FAILED"}`);
}

main();

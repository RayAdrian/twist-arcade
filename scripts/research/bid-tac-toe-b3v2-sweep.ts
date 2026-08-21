// scripts/research/bid-tac-toe-b3v2-sweep.ts — the B3v2 post-fix budget sweep
// (docs/plans/bid-tac-toe-budget-sweep.md §3-§5, §11 steps 2-3). PRE-REGISTERED: every
// threshold, ladder value, seed literal, and the selection rule are fixed by that plan and are
// not editable from here.
//
// Instrument: `compareBudgets` (C24's canonical helper — one fixed seed, the swept variable
// structurally excluded from the seed string) over an in-memory `SWEEP_MANIFEST` clone with
// ONE documented deviation from the shipped manifest: standard's budget lowered to 300 for the
// sweep only, so candidates below 1,500 do not trip `TierBudgetCollapseError` (plan §3 point 2
// — the guard protects `ruthless-vs-standard`, which reports "n/a" under this game's proven-draw
// `solvedValue` regardless of the override, per suites.ts's `drawAttainment.reached` branch).
// The plan's other documented deviation ("every tier gets leafEvaluation: true", P1) is already
// true in the shipped manifest (games/bid-tac-toe/manifest.ts, commit e4b7a0f) — this script
// still sets it explicitly on the clone, defensively, so the sweep never silently depends on
// that having stayed true upstream.
//
// Seed: base literal `b3v2-postfix-sweep` (a constant — no budget, no seed count, no config
// flag). `runCiSuite`'s own seedCount>1 branch derives `${seed}:seed${i}` per seed
// (packages/harness/src/suites.ts:1580) — identical across every candidate, since
// `compareBudgets` passes the SAME `opts.seed` to every candidate's `runCiSuite` call
// (suites.ts:1171). Printed below before any budget-dependent work runs, matching the E-A
// instrument's own self-check convention (plan §3's own text).
//
// Run (pilot, single candidate): pnpm tsx scripts/research/bid-tac-toe-b3v2-sweep.ts --budgets=1000
// Run (full ladder):              pnpm tsx scripts/research/bid-tac-toe-b3v2-sweep.ts
//   > docs/research/games/bid-tac-toe-b3v2-sweep.out 2>&1

import type { CiGateResult, CiSuiteReport } from "@twist-arcade/harness";
import { compareBudgets } from "@twist-arcade/harness";
import type { DifficultyTier, GameManifest, PolicySpec } from "@twist-arcade/game-spec";
import { bidTacToe } from "../../games/bid-tac-toe/engine";
import { manifest } from "../../games/bid-tac-toe/manifest";

// Deviation 1 (plan §3), applied defensively and type-safely to whatever kind of policy a tier
// happens to carry — all three of bid-tac-toe's shipped tiers are already `kind: "mcts"`
// (games/bid-tac-toe/manifest.ts), so this is a no-op in practice, but it never widens a
// non-mcts PolicySpec variant's shape (which has no `leafEvaluation` field to set).
function withLeafEvaluation(policy: PolicySpec): PolicySpec {
  return policy.kind === "mcts" ? { ...policy, leafEvaluation: true } : policy;
}

const SEED = "b3v2-postfix-sweep"; // plan §3/§11 — the pre-registered base seed literal, exact.
const GAMES = 300; // plan §5: K=10 seeds x 30 games/seed = 300 games per matchup per candidate.
const SEED_COUNT = 10; // plan §5.
const FULL_LADDER = [800, 1000, 1200, 1400, 1600, 2000, 2500, 3000, 5000, 10000] as const; // plan §4, exact, fixed.

function parseArgs(argv: readonly string[]): { budgets: number[] } {
  let budgets: number[] = FULL_LADDER.slice();
  for (const arg of argv) {
    const m = /^--budgets=(.+)$/.exec(arg);
    if (m) budgets = m[1]!.split(",").map((s) => Number(s.trim()));
  }
  return { budgets };
}

// SWEEP_MANIFEST — plan §3's documented deviations, applied to an in-memory clone only. The
// shipped `manifest` (and every difficulty tier inside it) is never mutated — `compareBudgets`
// itself clones per-candidate on top of THIS clone for `ciGateBudget.twoPlayerCiRollouts`.
const SWEEP_MANIFEST: GameManifest = {
  ...manifest,
  difficultyTiers: manifest.difficultyTiers.map((tier): DifficultyTier => {
    if (tier.id === "standard") {
      // Deviation 2 (plan §3): standard's budget lowered to 300 for the sweep only. Effect
      // audit: under this override, standard's budget feeds ONLY the ruthless-vs-standard
      // matchup, which reports "n/a" for bid-tac-toe (proven draw, C26) regardless of what
      // standard's budget is — no selected-on quantity (solved-value-reached, strong-vs-random)
      // changes.
      return {
        ...tier,
        budget: { kind: "rollouts" as const, n: 300 },
        policy: withLeafEvaluation(tier.policy), // deviation 1, defensive (already true upstream)
      };
    }
    return { ...tier, policy: withLeafEvaluation(tier.policy) }; // deviation 1, defensive
  }),
};

function gate(report: CiSuiteReport, name: string): CiGateResult | undefined {
  return report.gates.find((g) => g.gate === name);
}

function fmtGate(g: CiGateResult | undefined): string {
  if (!g) return "MISSING";
  const prov = g.provisional ? " [PROVISIONAL]" : "";
  return `${g.status}${prov} — ${g.detail}`;
}

function main(): void {
  console.log("=== Bid-Tac-Toe B3v2 post-fix budget sweep ===");
  console.log("docs/plans/bid-tac-toe-budget-sweep.md — PRE-REGISTERED, thresholds/ladder/seeds fixed.");
  console.log(
    `seed="${SEED}" games=${GAMES} seedCount=${SEED_COUNT} (30 games/seed) ladder=[${FULL_LADDER.join(", ")}]`
  );
  console.log("SWEEP_MANIFEST deviations from shipped manifest:");
  console.log("  1. every tier: leafEvaluation=true (already true upstream, commit e4b7a0f — set here defensively)");
  console.log("  2. standard tier budget: 1500 -> 300 (sweep-only; ruthless-vs-standard is n/a for this proven-draw game regardless)");
  console.log();
  console.log("Seed-string check (per-seed derivation, budget must NEVER appear):");
  for (let i = 0; i < SEED_COUNT; i++) {
    console.log(`  seed index ${i} -> "${SEED}:seed${i}" (identical across every candidate budget)`);
  }
  console.log();

  const { budgets } = parseArgs(process.argv.slice(2));
  console.log(`Running candidates: [${budgets.join(", ")}]`);
  console.log();

  const overallStart = Date.now();
  const points = compareBudgets(bidTacToe, SWEEP_MANIFEST, budgets, { seed: SEED, games: GAMES, seedCount: SEED_COUNT });
  const overallElapsedS = ((Date.now() - overallStart) / 1000).toFixed(1);

  const qualifiers: number[] = [];

  for (const point of points) {
    const r = point.report;
    const svr = gate(r, "solved-value-reached");
    const svr_ok = svr?.status === "pass" && !svr.provisional;
    const strong = gate(r, "strong-vs-random");
    const strong_ok = strong?.status === "pass" && !strong.provisional;
    const qualifies = svr_ok && strong_ok;
    if (qualifies) qualifiers.push(point.rollouts);

    console.log(`--- rollouts=${point.rollouts} ---`);
    console.log(`  solved-value-reached:  ${fmtGate(svr)}`);
    console.log(`  strong-vs-random:      ${fmtGate(strong)}`);
    console.log(`  STAGE A QUALIFIES: ${qualifies}`);
    console.log("  (descriptive, never selected on:)");
    console.log(`  first-player-win-rate: ${fmtGate(gate(r, "first-player-win-rate"))}`);
    console.log(`  draw-rate:             ${fmtGate(gate(r, "draw-rate"))}`);
    console.log(`  ruthless-vs-standard:  ${fmtGate(gate(r, "ruthless-vs-standard"))}`);
    console.log(`  mean-plies:            ${fmtGate(gate(r, "mean-plies"))}`);
    console.log();
  }

  console.log(`Total sweep wall-clock: ${overallElapsedS}s`);
  console.log();
  console.log("=== STAGE A QUALIFIERS (mechanical: solved-value-reached AND strong-vs-random, both pass, no provisional) ===");
  if (qualifiers.length === 0) {
    console.log("NONE — no budget qualifies in Stage A.");
  } else {
    console.log(`[${qualifiers.join(", ")}]`);
  }
}

main();

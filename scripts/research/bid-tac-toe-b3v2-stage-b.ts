// scripts/research/bid-tac-toe-b3v2-stage-b.ts — B3v2 Stage B confirmation head-to-head
// (docs/plans/bid-tac-toe-budget-sweep.md §5, §11 step 5). Run at EVERY Stage A qualifier,
// pre-registered, not editable from here.
//
// Candidate (tier path, leafEvaluation: true) vs mctsPolicyLegacy (byte-for-byte pre-DUCT
// max-max, packages/bots/test/support/mcts-legacy.ts, default rolloutCapPlies=200) at the SAME
// budget on both sides. n=200 games x 2 seeds, mirrorSeats=true (runMatchup's default).
//
// SEED FIX (plan §1 point 5, §5): C90's own head-to-head script
// (.scratch/c90-duct-leaf-vs-legacy-head-to-head.mts) built its base seed as
// `c90-h2h-bid-tac-toe-b${budget}-${seed}` — the budget INSIDE the seed string, a C24 confound
// for a cross-budget comparison. Here the base seed passed to `runMatchup` is the fixed literal
// `b3v2-h2h-seed0` / `b3v2-h2h-seed1` UNCHANGED across every candidate budget — `runMatchup`
// derives its own per-game seeds as `${seed}:${i}` (runner.ts's own doc), so the budget never
// enters any seed string at any stage.
//
// Decision rule (plan §5, mechanical): pooled across both seeds, losses <= 10% of games, AND
// W >= L within EACH seed individually (never a single-seed claim, C71).
//
// Run: pnpm tsx scripts/research/bid-tac-toe-b3v2-stage-b.ts --budgets=1000,1200
//   > docs/research/games/bid-tac-toe-b3v2-stage-b.out 2>&1

import { runMatchup, type AgentSpec } from "@twist-arcade/harness";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { mctsPolicy } from "@twist-arcade/bots";
import { bidTacToe, type BidTacToeMove, type BidTacToeState } from "../../games/bid-tac-toe/engine";
import { mctsPolicyLegacy } from "../../packages/bots/test/support/mcts-legacy";

const GAMES = 200; // plan §5: n = 200 x 2 seeds.
const SEEDS = ["b3v2-h2h-seed0", "b3v2-h2h-seed1"] as const; // plan §5, exact literals — budget NEVER appended.

interface CellResult {
  readonly candidateWins: number;
  readonly legacyWins: number;
  readonly draws: number;
  readonly n: number;
  readonly meanPlies: number;
  readonly capHitRate: number;
}

function runCell<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  budget: number,
  seed: string,
  games: number
): CellResult {
  const candidate: AgentSpec<S, M> = {
    kind: "policy",
    name: "candidate",
    policy: mctsPolicy<S, M>({ leafEvaluation: true }), // tier-path configuration under test
    budget: { kind: "rollouts", n: budget },
  };
  const legacy: AgentSpec<S, M> = {
    kind: "policy",
    name: "legacy",
    policy: mctsPolicyLegacy<S, M>(), // default rolloutCapPlies=200 — max-max, as shipped
    budget: { kind: "rollouts", n: budget },
  };

  const report = runMatchup(engine, candidate, legacy, { games, seed }); // seed UNCHANGED — no budget appended

  let candidateWins = 0;
  let legacyWins = 0;
  let draws = 0;
  for (const o of report.outcomes) {
    if (o.winnerSeat === null) {
      draws += 1;
    } else if (o.seatAgent[o.winnerSeat] === "candidate") {
      candidateWins += 1;
    } else {
      legacyWins += 1;
    }
  }

  return {
    candidateWins,
    legacyWins,
    draws,
    n: report.outcomes.length,
    meanPlies: report.metrics.meanPlies,
    capHitRate: report.metrics.capHitRate,
  };
}

function fmtCell(label: string, c: CellResult): string {
  const pct = (x: number): string => ((x / c.n) * 100).toFixed(1);
  return (
    `  ${label}: n=${c.n}  Candidate ${c.candidateWins}W (${pct(c.candidateWins)}%) / ` +
    `${c.draws}D (${pct(c.draws)}%) / Legacy ${c.legacyWins}W (${pct(c.legacyWins)}%)  ` +
    `meanPlies=${c.meanPlies.toFixed(1)} capHitRate=${(c.capHitRate * 100).toFixed(2)}%`
  );
}

function parseArgs(argv: readonly string[]): { budgets: number[] } {
  let budgets: number[] = [];
  for (const arg of argv) {
    const m = /^--budgets=(.+)$/.exec(arg);
    if (m) budgets = m[1]!.split(",").map((s) => Number(s.trim()));
  }
  return { budgets };
}

function main(): void {
  const { budgets } = parseArgs(process.argv.slice(2));
  if (budgets.length === 0) {
    console.error("Stage B: no --budgets= given — pass the Stage A qualifier(s) explicitly. Aborting.");
    process.exit(1);
  }

  console.log("=== Bid-Tac-Toe B3v2 Stage B — confirmation head-to-head vs mctsPolicyLegacy ===");
  console.log("docs/plans/bid-tac-toe-budget-sweep.md §5, §11 step 5.");
  console.log(`games=${GAMES} per seed, seeds=[${SEEDS.join(", ")}], mirrorSeats=true (default), budgets=[${budgets.join(", ")}]`);
  console.log("Seed check: base seed literal is fixed and UNCHANGED across every candidate budget (no budget in the string).");
  console.log();

  let anySurvives = false;

  for (const budget of budgets) {
    console.log(`--- budget=${budget} ---`);
    const cells: CellResult[] = [];
    for (const seed of SEEDS) {
      const start = Date.now();
      const c = runCell<BidTacToeState, BidTacToeMove, BidTacToeState>(bidTacToe, budget, seed, GAMES);
      const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
      cells.push(c);
      console.log(fmtCell(`seed="${seed}"`, c) + `  [${elapsedS}s]`);
      const wGeL = c.candidateWins >= c.legacyWins;
      console.log(`    within-seed W>=L: ${wGeL} (${c.candidateWins} >= ${c.legacyWins})`);
    }
    const pooled = {
      candidateWins: cells.reduce((a, c) => a + c.candidateWins, 0),
      legacyWins: cells.reduce((a, c) => a + c.legacyWins, 0),
      draws: cells.reduce((a, c) => a + c.draws, 0),
      n: cells.reduce((a, c) => a + c.n, 0),
      meanPlies: cells.reduce((a, c) => a + c.meanPlies * c.n, 0) / cells.reduce((a, c) => a + c.n, 0),
      capHitRate: cells.reduce((a, c) => a + c.capHitRate * c.n, 0) / cells.reduce((a, c) => a + c.n, 0),
    };
    console.log(fmtCell("POOLED (both seeds)", pooled));
    const lossRate = pooled.legacyWins / pooled.n;
    const lossOk = lossRate <= 0.10;
    const withinSeedOk = cells.every((c) => c.candidateWins >= c.legacyWins);
    const survives = lossOk && withinSeedOk;
    console.log(`  loss rate: ${(lossRate * 100).toFixed(1)}% (bar: <=10%) => ${lossOk ? "OK" : "FAIL"}`);
    console.log(`  W>=L within every seed: ${withinSeedOk ? "OK" : "FAIL"}`);
    console.log(`  STAGE B SURVIVES at budget=${budget}: ${survives}`);
    console.log();
    if (survives) anySurvives = true;
  }

  console.log(`=== Any budget survives Stage B: ${anySurvives} ===`);
}

main();

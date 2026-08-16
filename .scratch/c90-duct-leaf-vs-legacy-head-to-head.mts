// .scratch/c90-duct-leaf-vs-legacy-head-to-head.mts — C76's mandatory head-to-head protocol,
// run against C90's configuration (docs/plans/platform-corrections.md C76, C90).
//
// WHY THIS RUN: C90 measured the DUCT+leaf-evaluation cell as a COMPONENT metric (oracle
// agreement) — 1.000/1.000 at 1,000 rollouts, degrading to 0.000 by 10,000. C73->C76 already
// established that component agreement and system wins are different things, and the only
// mechanism that ever settled a selection-rule question in this project was a head-to-head,
// not a comparison against random or an oracle (C75/C76). A configuration with perfect oracle
// agreement has not been shown to win a single game until this runs.
//
// CANDIDATE: `mctsPolicy` (current, DUCT selection — packages/bots/src/mcts.ts) with
// `rolloutCapPlies: 0` (leaf evaluation — C90's exact configuration) and this worktree's
// C85-fixed heuristic (games/bid-tac-toe/heuristic.ts, already the checked-out state on
// feature/duct-leaf-eval — see e053644).
// LEGACY: `mctsPolicyLegacy` (packages/bots/test/support/mcts-legacy.ts, byte-for-byte
// dabc6a2, faithfulness re-verified in THIS worktree by
// .scratch/c90-legacy-faithfulness-check.mts before this script was run) at its DEFAULT
// `rolloutCapPlies` (200 — normal rollouts), i.e. max-max exactly as it ships.
//
// BUDGETS {1000, 10000}, MATCHED ON BOTH SIDES — the honest same-budget comparison C76's
// protocol requires, not a race with different clocks.
//
// n=200 PER CELL, TWO INDEPENDENT SEEDS (never a single-seed reading — C71/C47/C71's own
// discipline), mirrorSeats=true (runMatchup's default) so neither search gets a first-move/
// seat advantage. REPORTS W/D/L, NEVER A BARE WIN RATE (C66's lesson, restated in this task's
// brief) — Bid-Tac-Toe is a proven draw at B=8 and draws heavily.
//
// mcts.ts, heuristic.ts, and mcts-legacy.ts are NOT modified by this script or by anything
// that produced it — both policies are called exactly as shipped/ported.
//
// Run: pnpm tsx .scratch/c90-duct-leaf-vs-legacy-head-to-head.mts > docs/research/games/c90-duct-leaf-vs-legacy-head-to-head.out 2>&1
// Optional CLI overrides for a fast pilot before the full run:
//   --games=N          (default 200)
//   --budgets=A,B       (default 1000,10000)
//   --seeds=N           (default 2)
//   --seed-offset=N     (default 0 — lets a resumed/split run pick up later seed indices)

import { runMatchup, type AgentSpec } from "@twist-arcade/harness";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { mctsPolicy } from "@twist-arcade/bots";
import { bidTacToe, type BidTacToeMove, type BidTacToeState } from "../games/bid-tac-toe/engine";
import { mctsPolicyLegacy } from "../packages/bots/test/support/mcts-legacy";

// ---------------------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  games: number;
  budgets: number[];
  seedLabels: string[];
} {
  let games = 200;
  let budgets = [1000, 10000]; // C90's two measured budgets, matched on both sides
  let seedCount = 2;
  let seedOffset = 0;
  for (const arg of argv) {
    const gamesMatch = /^--games=(\d+)$/.exec(arg);
    if (gamesMatch) games = Number(gamesMatch[1]);
    const budgetsMatch = /^--budgets=(.+)$/.exec(arg);
    if (budgetsMatch) budgets = budgetsMatch[1]!.split(",").map((s) => Number(s.trim()));
    const seedsMatch = /^--seeds=(\d+)$/.exec(arg);
    if (seedsMatch) seedCount = Number(seedsMatch[1]);
    const seedOffsetMatch = /^--seed-offset=(\d+)$/.exec(arg);
    if (seedOffsetMatch) seedOffset = Number(seedOffsetMatch[1]);
  }
  // Fixed, named seed labels (C22/C24 style) — a new namespace ("c90-h2h") distinct from
  // C76's original "duct-vs-legacy-seed*" labels, since this is a different candidate
  // configuration (DUCT+leaf, not DUCT+rollout).
  const seedLabels = Array.from({ length: seedCount }, (_, i) => `c90-h2h-seed${i + seedOffset}`);
  return { games, budgets, seedLabels };
}

// ---------------------------------------------------------------------------------------
// Per-cell measurement + W/D/L reporting (never a bare win rate)
// ---------------------------------------------------------------------------------------

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
    policy: mctsPolicy<S, M>({ rolloutCapPlies: 0 }), // DUCT selection + leaf evaluation, C90's cell
    budget: { kind: "rollouts", n: budget },
  };
  const legacy: AgentSpec<S, M> = {
    kind: "policy",
    name: "legacy",
    policy: mctsPolicyLegacy<S, M>(), // default rolloutCapPlies=200 — max-max, normal rollouts, as shipped
    budget: { kind: "rollouts", n: budget },
  };

  const report = runMatchup(engine, candidate, legacy, { games, seed });

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
    `  ${label}: n=${c.n}  Candidate(DUCT+leaf) ${c.candidateWins}W (${pct(c.candidateWins)}%) / ` +
    `${c.draws}D (${pct(c.draws)}%) / Legacy(max-max) ${c.legacyWins}W (${pct(c.legacyWins)}%)  ` +
    `meanPlies=${c.meanPlies.toFixed(1)} capHitRate=${(c.capHitRate * 100).toFixed(2)}%`
  );
}

function pool(cells: readonly CellResult[]): CellResult {
  return {
    candidateWins: cells.reduce((a, c) => a + c.candidateWins, 0),
    legacyWins: cells.reduce((a, c) => a + c.legacyWins, 0),
    draws: cells.reduce((a, c) => a + c.draws, 0),
    n: cells.reduce((a, c) => a + c.n, 0),
    meanPlies: cells.reduce((a, c) => a + c.meanPlies * c.n, 0) / cells.reduce((a, c) => a + c.n, 0),
    capHitRate: cells.reduce((a, c) => a + c.capHitRate * c.n, 0) / cells.reduce((a, c) => a + c.n, 0),
  };
}

function main(): void {
  const { games, budgets, seedLabels } = parseArgs(process.argv.slice(2));
  console.log("C76's head-to-head protocol, run against C90's configuration.");
  console.log("docs/plans/platform-corrections.md C76, C88, C89, C90.");
  console.log(
    `games=${games} per (budget,seed) cell; ${seedLabels.length} seeds; mirrorSeats=true (default).`
  );
  console.log("Candidate = DUCT selection + leaf evaluation (rolloutCapPlies:0), C85-fixed heuristic.");
  console.log("Legacy = mctsPolicyLegacy default (rolloutCapPlies:200) — max-max, as shipped.");
  console.log("Report is W/D/L — never a bare win rate (Bid-Tac-Toe draws heavily).");
  console.log();

  console.log("=== bid-tac-toe: Candidate (DUCT+leaf, C90) vs Legacy (mctsPolicyLegacy, pre-DUCT max-max) ===");
  console.log(`budgets=[${budgets.join(", ")}] seeds=[${seedLabels.join(", ")}] games/seed=${games}`);
  console.log();
  for (const budget of budgets) {
    const cellsForBudget: CellResult[] = [];
    for (const seed of seedLabels) {
      const seedFull = `c90-h2h-bid-tac-toe-b${budget}-${seed}`;
      const start = Date.now();
      const c = runCell<BidTacToeState, BidTacToeMove, BidTacToeState>(bidTacToe, budget, seedFull, games);
      const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
      cellsForBudget.push(c);
      console.log(fmtCell(`rollouts=${budget} seed="${seedFull}"`, c) + `  [${elapsedS}s]`);
    }
    if (cellsForBudget.length > 1) {
      console.log(fmtCell(`rollouts=${budget} POOLED (${cellsForBudget.length} seeds)`, pool(cellsForBudget)));
    }
    console.log();
  }
  console.log("Report only. No ruling made here — the decision belongs to whoever asked for this experiment.");
}

main();

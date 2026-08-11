// games/bid-tac-toe/solver/run-solve.mts — the B2 solve script (docs/plans/bid-tac-toe.md §5).
//
// Usage:
//   npx tsx games/bid-tac-toe/solver/run-solve.mts [--budgets=8,12,16,20] [--json]
//
// Unlike Fadeout's solve (superko's Graph-History-Interaction residue needs a bounded search
// budget and can fail to converge), this game's graph is ACYCLIC (plan §3.2 — every auction
// strictly fills a cell) so backward induction always terminates; there is no wall-clock/node
// ceiling to pass here. Solves each requested budget and prints: root value, purity (saddle
// census), star-holder advantage, the per-first-auction table, reachable-state count, and the
// extracted canonical line. `docs/research/games/bid-tac-toe-solve-report.md` is the
// human-authored write-up; re-run this script to regenerate/verify the numbers it cites.

import { solveBudget } from "./backward-induction";

function parseArgs(argv: readonly string[]): { budgets: number[]; json: boolean } {
  let budgets = [8, 12, 16, 20]; // plan §5's sweep
  let json = false;
  for (const arg of argv) {
    const budgetsMatch = /^--budgets=(.+)$/.exec(arg);
    if (budgetsMatch) budgets = budgetsMatch[1]!.split(",").map((s) => Number(s.trim()));
    if (arg === "--json") json = true;
  }
  return { budgets, json };
}

function main(): void {
  const { budgets, json } = parseArgs(process.argv.slice(2));
  const results = budgets.map((budget) => {
    const start = Date.now();
    if (!json) process.stderr.write(`solving B=${budget}...\n`);
    const result = solveBudget(budget);
    const elapsedMs = Date.now() - start;
    if (!json) process.stderr.write(`  done in ${elapsedMs}ms\n`);
    return { budget, elapsedMs, result };
  });

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }

  for (const { budget, elapsedMs, result } of results) {
    process.stdout.write(`\n==== B=${budget} (${elapsedMs}ms) ====\n`);
    process.stdout.write(
      `root value: ${result.rootValue}${result.pure ? " (PURE — proven exact)" : " (IMPURE somewhere — see saddle census; this is a bound-based approximation, not proven)"}\n`
    );
    process.stdout.write(`star-holder advantage (star=0 hypothetical minus real star=1): ${result.starHolderAdvantage}\n`);
    process.stdout.write(`reachable states: ${result.reachableStates}\n`);
    process.stdout.write(
      `saddle census: ${result.saddleCensus.impureBidNodes}/${result.saddleCensus.totalBidNodes} bid nodes impure ` +
        `(${(result.saddleCensus.impureFraction * 100).toFixed(4)}%)\n`
    );
    process.stdout.write("first-auction table (payment -> value if that seat wins the very first auction):\n");
    for (const row of result.firstAuctionTable) {
      process.stdout.write(`  payment=${row.payment}: seat0 wins -> ${row.valueIfSeat0Wins}, seat1 wins -> ${row.valueIfSeat1Wins}\n`);
    }
    process.stdout.write(`canonical line (${result.canonicalLine.length} steps):\n`);
    for (const step of result.canonicalLine) {
      process.stdout.write(`  [${step.kind}] ${step.detail}\n`);
    }
  }
}

main();

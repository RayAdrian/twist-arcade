// Throwaway B3 diagnostic script — the C36 discipline (mine-run precedent), per the
// coordinator's explicit instruction: ONE real mid-game decision, dumped in full, before any
// theorising and before another multi-budget sweep.

import { rngFromSeed, type Rng } from "@twist-arcade/engine";
import { tierPolicy } from "@twist-arcade/bots";
import { runMatchup } from "@twist-arcade/harness";
import {
  bidTacToe,
  STARTING_BUDGET,
  type BidTacToeBidMove,
  type BidTacToeState,
} from "./engine";
import { manifest } from "./manifest";

const NULL_CLOCK = { now: (() => { let t = 0; return () => (t += 1); })() };

// ---------------------------------------------------------------------------------------
// Step 0: reach a REAL mid-game bid-phase decision by actually playing one self-play game.
// ---------------------------------------------------------------------------------------

const ruthlessTierDef = manifest.difficultyTiers.find((t) => t.id === "ruthless")!;
const strongAgent = {
  kind: "policy" as const,
  name: "strong",
  policy: tierPolicy<BidTacToeState, BidTacToeBidMove>({ ...ruthlessTierDef, budget: { kind: "rollouts", n: 2000 } }),
  budget: { kind: "rollouts" as const, n: 2000 },
};

const report = runMatchup(bidTacToe, strongAgent, strongAgent, {
  games: 1,
  seed: "c36-diagnostic-source-game",
  mirrorSeats: false,
  clock: NULL_CLOCK,
});
const outcome = report.outcomes[0]!;
console.log(`Source game: ${outcome.moves.length} steps, winnerSeat=${outcome.winnerSeat}, capHit=${outcome.capHit}`);

// Replay forward to the SECOND bid-phase step where board has >=2 marks (a genuine mid-game
// decision, not the opening) and BOTH seats still have a real budget left.
let state: BidTacToeState = {
  board: Array.from({ length: 9 }, () => null),
  budgets: [STARTING_BUDGET, STARTING_BUDGET],
  star: 1,
  phase: { kind: "bid" },
  lastEffects: [],
};
let targetState: BidTacToeState | undefined;
for (const step of outcome.moves) {
  const marks = state.board.filter((c) => c !== null).length;
  if (state.phase.kind === "bid" && marks >= 2 && !targetState) {
    targetState = state;
  }
  const movesMap = new Map(step.moves.map(([seat, move]) => [seat, move as unknown as BidTacToeBidMove]));
  state = bidTacToe.apply(state, movesMap as never, rngFromSeed("replay")) as BidTacToeState;
}
if (!targetState) {
  console.log("No mid-game bid decision found in this trajectory — falling back to the opening bid.");
  targetState = {
    board: Array.from({ length: 9 }, () => null),
    budgets: [STARTING_BUDGET, STARTING_BUDGET],
    star: 1,
    phase: { kind: "bid" },
    lastEffects: [],
  };
}

console.log("\nTarget decision state:");
console.log(JSON.stringify(targetState, null, 2));

// ---------------------------------------------------------------------------------------
// Step 1: per-candidate (player 0's row) flat-rollout statistics — mean, SD, terminal-kind
// fractions. Opponent's column sampled UNIFORMLY per rollout (an honest, standard flat-MC
// baseline), then uniform-random continuation to a REAL terminal (this game always reaches
// one quickly — no horizon-cap heuristic is involved anywhere in this diagnostic).
// ---------------------------------------------------------------------------------------

function randomRolloutToTerminal(from: BidTacToeState, rng: Rng): { value: number; kind: "p0-win" | "p1-win" | "draw" | "cap" } {
  let s = from;
  let plies = 0;
  while (bidTacToe.status(s).kind === "ongoing" && plies < 200) {
    const active = bidTacToe.active(s);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const moves = new Map();
    for (const seat of actors) {
      const legal = bidTacToe.legalMoves(s, seat);
      moves.set(seat, legal[rng.int(legal.length)]);
    }
    s = bidTacToe.apply(s, moves as never, rng) as BidTacToeState;
    plies += 1;
  }
  const status = bidTacToe.status(s);
  if (status.kind === "won") return { value: status.winner === 0 ? 1 : -1, kind: status.winner === 0 ? "p0-win" : "p1-win" };
  if (status.kind === "draw") return { value: 0, kind: "draw" };
  return { value: 0, kind: "cap" }; // never observed at this game's scale (mean-plies ~7-10)
}

const K_ROLLOUTS_PER_CANDIDATE = 400;

function movesFor(budget: number, isHolder: boolean): { amount: number; star: boolean }[] {
  const moves: { amount: number; star: boolean }[] = [];
  for (let amount = 0; amount <= budget; amount++) {
    moves.push({ amount, star: false });
    if (isHolder) moves.push({ amount, star: true });
  }
  return moves;
}

if (targetState.phase.kind === "bid") {
  const [b0, b1] = targetState.budgets;
  const holder = targetState.star;
  const rows = movesFor(b0, holder === 0);
  const cols = movesFor(b1, holder === 1);
  console.log(`\nBid node: ${rows.length} rows (seat 0) x ${cols.length} cols (seat 1) = ${rows.length * cols.length} joint arms.`);

  const rng = rngFromSeed("c36-flat-rollout");
  const rowStats: { row: { amount: number; star: boolean }; mean: number; sd: number; kinds: Record<string, number> }[] = [];

  for (const row of rows) {
    const values: number[] = [];
    const kinds: Record<string, number> = { "p0-win": 0, "p1-win": 0, draw: 0, cap: 0 };
    for (let i = 0; i < K_ROLLOUTS_PER_CANDIDATE; i++) {
      const col = cols[rng.int(cols.length)]!;
      const rowMove: BidTacToeBidMove = { kind: "bid", amount: row.amount, ...(row.star ? { star: true } : {}) };
      const colMove: BidTacToeBidMove = { kind: "bid", amount: col.amount, ...(col.star ? { star: true } : {}) };
      const next = bidTacToe.apply(targetState, new Map([[0, rowMove], [1, colMove]]) as never, rng) as BidTacToeState;
      const { value, kind } = randomRolloutToTerminal(next, rng);
      values.push(value);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    rowStats.push({ row, mean, sd: Math.sqrt(variance), kinds });
  }

  console.log(`\nPer-candidate (seat 0 row) flat-rollout stats, ${K_ROLLOUTS_PER_CANDIDATE} rollouts/candidate, opponent column sampled uniformly:`);
  console.log("amount*  mean     sd       p0win  p1win  draw");
  for (const { row, mean, sd, kinds } of rowStats.sort((a, b) => a.row.amount - b.row.amount || Number(a.row.star) - Number(b.row.star))) {
    const label = `${row.amount}${row.star ? "*" : ""}`.padEnd(7);
    console.log(
      `${label} ${mean.toFixed(3).padStart(7)}  ${sd.toFixed(3).padStart(7)}  ${(kinds["p0-win"]! / K_ROLLOUTS_PER_CANDIDATE * 100).toFixed(1).padStart(5)}%  ${(kinds["p1-win"]! / K_ROLLOUTS_PER_CANDIDATE * 100).toFixed(1).padStart(5)}%  ${(kinds["draw"]! / K_ROLLOUTS_PER_CANDIDATE * 100).toFixed(1).padStart(5)}%`
    );
  }
  const bestFlat = rowStats.reduce((best, r) => (r.mean > best.mean ? r : best));
  console.log(`\nFlat-rollout argmax: amount=${bestFlat.row.amount}${bestFlat.row.star ? "*" : ""} (mean=${bestFlat.mean.toFixed(3)})`);

  // -------------------------------------------------------------------------------------
  // Step 2: real MCTS at two budgets on the SAME state, aggregated visit counts per row AND
  // raw per-joint-arm visit counts (coordinator's second ask).
  // -------------------------------------------------------------------------------------
  for (const n of [2000, 10000]) {
    const agent = tierPolicy<BidTacToeState, BidTacToeBidMove>({ id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n }, minReplyMs: 0 });
    const { move, stats } = agent.chooseMove({
      engine: bidTacToe,
      state: targetState,
      player: 0,
      rng: rngFromSeed(`c36-mcts-${n}`),
      budget: { kind: "rollouts", n },
      clock: NULL_CLOCK,
    });
    const rootVisits = stats.rootVisits ?? [];
    const totalArms = rootVisits.length;
    const visitCounts = rootVisits.map((r) => r.visits);
    const minV = Math.min(...visitCounts);
    const maxV = Math.max(...visitCounts);
    const meanV = visitCounts.reduce((a, b) => a + b, 0) / visitCounts.length;
    // Aggregate by seat-0's row (many joint children share the same row).
    const byRow = new Map<string, number>();
    for (const r of rootVisits) {
      const m = r.move as unknown as BidTacToeBidMove;
      const key = `${m.amount}${m.star ? "*" : ""}`;
      byRow.set(key, (byRow.get(key) ?? 0) + r.visits);
    }
    console.log(`\n==== real MCTS @ ${n} rollouts ====`);
    console.log(`chosen move: amount=${(move as BidTacToeBidMove).amount}${(move as BidTacToeBidMove).star ? "*" : ""}`);
    console.log(`total joint arms expanded: ${totalArms} (of ${rows.length * cols.length} possible)`);
    console.log(`per-arm visits: min=${minV} max=${maxV} mean=${meanV.toFixed(1)}`);
    console.log(`per-row (seat 0) aggregated visits: ${Array.from(byRow.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }

  // -------------------------------------------------------------------------------------
  // Step 3: standalone Greedy (no rollout at all) — 1-ply, marginalized uniformly over the
  // opponent's response, ranked by heuristic() of the resulting place-phase state.
  // -------------------------------------------------------------------------------------
  const greedyScores = rows.map((row) => {
    let total = 0;
    for (const col of cols) {
      const rowMove: BidTacToeBidMove = { kind: "bid", amount: row.amount, ...(row.star ? { star: true } : {}) };
      const colMove: BidTacToeBidMove = { kind: "bid", amount: col.amount, ...(col.star ? { star: true } : {}) };
      const next = bidTacToe.apply(targetState!, new Map([[0, rowMove], [1, colMove]]) as never, rngFromSeed("greedy")) as BidTacToeState;
      total += bidTacToe.heuristic!(next, 0);
    }
    return { row, avg: total / cols.length };
  });
  const bestGreedy = greedyScores.reduce((best, r) => (r.avg > best.avg ? r : best));
  console.log(`\n==== standalone Greedy (1-ply, uniform-marginalized heuristic, NO rollout) ====`);
  console.log(`chosen: amount=${bestGreedy.row.amount}${bestGreedy.row.star ? "*" : ""} (avg heuristic=${bestGreedy.avg.toFixed(3)})`);
  console.log("full ranking: " + greedyScores.sort((a, b) => b.avg - a.avg).map((r) => `${r.row.amount}${r.row.star ? "*" : ""}:${r.avg.toFixed(2)}`).join(", "));
} else {
  console.log("Target state landed in the place phase — re-run for a different fallback (should not happen with the mid-game search above).");
}

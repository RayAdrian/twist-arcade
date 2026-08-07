// C56 reproduction: the EXACT failing decision from docs/research/games/bid-tac-toe-b3-report.md
// §2 — board [_,_,O,_,X,_,_,_,_], budgets [7,9], seat 0 holds the star, 160 joint arms — run
// against the FIXED packages/bots/src/mcts.ts (marginal aggregation, C56) instead of the
// original broken one. Reuses the b3-report's own rng seeds where it matters for comparability.
// Game source is a read-only copy of games/bid-tac-toe (still unregistered, owned by the
// bid-tac-toe team's own worktree) — nothing here is committed to this worktree's branch.
import { rngFromSeed, type Rng } from "@twist-arcade/engine";
import { tierPolicy } from "@twist-arcade/bots";
import { bidTacToe, type BidTacToeBidMove, type BidTacToeState } from "./bid-tac-toe-repro/engine";

const NULL_CLOCK = { now: (() => { let t = 0; return () => (t += 1); })() };

// The exact target state from the B3 report §2, constructed directly (not replayed to) —
// board [_,_,O,_,X,_,_,_,_] (O=seat1 at cell 2, X=seat0 at cell 4), budgets [7,9], seat 0
// holds the star, bid phase.
const targetState: BidTacToeState = {
  board: [null, null, 1, null, 0, null, null, null, null],
  budgets: [7, 9],
  star: 0,
  phase: { kind: "bid" },
  lastEffects: [],
};

function randomRolloutToTerminal(from: BidTacToeState, rng: Rng): { value: number; kind: string } {
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
  return { value: 0, kind: "cap" };
}

function movesFor(budget: number, isHolder: boolean): { amount: number; star: boolean }[] {
  const moves: { amount: number; star: boolean }[] = [];
  for (let amount = 0; amount <= budget; amount++) {
    moves.push({ amount, star: false });
    if (isHolder) moves.push({ amount, star: true });
  }
  return moves;
}

const [b0, b1] = targetState.budgets;
const holder = targetState.star;
const rows = movesFor(b0, holder === 0);
const cols = movesFor(b1, holder === 1);
console.log(`Bid node: ${rows.length} rows (seat 0) x ${cols.length} cols (seat 1) = ${rows.length * cols.length} joint arms.`);

// ---- Step 1: honest flat-rollout baseline (same rng seed as the original B3 diagnostic) ----
const K_ROLLOUTS_PER_CANDIDATE = 400;
const rng = rngFromSeed("c36-flat-rollout");
const rowStats: { row: { amount: number; star: boolean }; mean: number }[] = [];
for (const row of rows) {
  const values: number[] = [];
  for (let i = 0; i < K_ROLLOUTS_PER_CANDIDATE; i++) {
    const col = cols[rng.int(cols.length)]!;
    const rowMove: BidTacToeBidMove = { kind: "bid", amount: row.amount, ...(row.star ? { star: true } : {}) };
    const colMove: BidTacToeBidMove = { kind: "bid", amount: col.amount, ...(col.star ? { star: true } : {}) };
    const next = bidTacToe.apply(targetState, new Map([[0, rowMove], [1, colMove]]) as never, rng) as BidTacToeState;
    const { value } = randomRolloutToTerminal(next, rng);
    values.push(value);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  rowStats.push({ row, mean });
}
const sortedFlat = [...rowStats].sort((a, b) => b.mean - a.mean);
console.log("\nFlat-rollout ranking (best to worst):");
console.log(sortedFlat.map((r) => `${r.row.amount}${r.row.star ? "*" : ""}:${r.mean.toFixed(3)}`).join(", "));
const bestFlat = sortedFlat[0]!;
console.log(`Flat-rollout argmax: amount=${bestFlat.row.amount}${bestFlat.row.star ? "*" : ""} (mean=${bestFlat.mean.toFixed(3)})`);

// ---- Step 2: real MCTS (FIXED mcts.ts) at 2000 and 10000, same seeds as the original report ----
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
  const sorted = [...rootVisits].sort((a, b) => b.visits - a.visits);
  console.log(`\n==== FIXED MCTS @ ${n} rollouts ====`);
  console.log(`chosen move: amount=${(move as BidTacToeBidMove).amount}${(move as BidTacToeBidMove).star ? "*" : ""}`);
  console.log(`own-action (marginal) entries: ${rootVisits.length} (one per seat-0 row, NOT per joint arm)`);
  console.log(`marginal visits by row (sorted): ${sorted.map((r) => `${(r.move as BidTacToeBidMove).amount}${(r.move as BidTacToeBidMove).star ? "*" : ""}:${r.visits}`).join(", ")}`);
}

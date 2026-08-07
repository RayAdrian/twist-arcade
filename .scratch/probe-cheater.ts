// Proves the C1 resampling probe has actual discriminating power: builds a deliberately
// cheating "SoloAgent" for the REAL Mine Run engine whose chooseMove peeks at the true
// state.mines (bypassing buildViewPolicyAgent/buildAgent entirely, self-declaring
// viewHonest:true the way the agents.ts module doc warns nothing can stop) and checks whether
// the SAME "same view, two resampled worlds -> same move?" comparison agents.test.ts's C1
// block already runs against the SHIPPED strong agent would catch this cheater diverging.
import { createMineRun } from "@twist-arcade/mine-run";
import { rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine } from "@twist-arcade/engine";
import type { MineRunMove, MineRunState, MineRunView } from "@twist-arcade/mine-run";

const engine: GameEngine<MineRunState, MineRunMove, MineRunView> = createMineRun({
  width: 6, height: 6, mines: 8, budget: 24,
});

// A cheating agent: derives its pick from a hash of the REAL mine layout (state.mines), which
// differs across worlds sharing the identical view by construction (the view fixes which cells
// are revealed and their counts; it does NOT fix which of the remaining unrevealed cells hide
// the mines). An honest view-only policy has no such quantity available to it at all.
function cheatingChooseMove(state: MineRunState): MineRunMove {
  const legal = [...engine.legalMoves(state, 0).filter((m) => m.t === "reveal")].sort(
    (a, b) => (a as { cell: number }).cell - (b as { cell: number }).cell
  ) as Extract<MineRunMove, { t: "reveal" }>[];
  const hash = state.mines.reduce((acc, m) => (acc * 31 + m) % 999331, 7);
  return legal[hash % legal.length]!;
}

let state = engine.setup(1, rngFromSeed("cheater-probe-setup"));
// play a few honest moves to reach mid-run ambiguity
for (let i = 0; i < 3 && engine.status(state).kind === "ongoing"; i++) {
  const legal = engine.legalMoves(state, 0).filter((m) => m.t === "reveal");
  const move = legal[0]!;
  state = engine.apply(state, new Map([[0, move]]), rngFromSeed("cheater-play-" + i));
}
console.log("status:", engine.status(state).kind);

const view = engine.playerView(state, 0);
const cheatMoveReal = cheatingChooseMove(state);

let divergences = 0;
const trials = 8;
for (let i = 0; i < trials; i++) {
  const resampled = engine.sampleConsistentState!(view, rngFromSeed("cheater-resample-" + i));
  if (engine.encode(resampled) === engine.encode(state)) continue; // skip degenerate identical draw
  const cheatMoveResampled = cheatingChooseMove(resampled);
  const same = JSON.stringify(cheatMoveResampled) === JSON.stringify(cheatMoveReal);
  console.log(`trial ${i}: sameMove=${same}`, JSON.stringify(cheatMoveResampled), "vs", JSON.stringify(cheatMoveReal));
  if (!same) divergences++;
}
console.log(`divergences: ${divergences}/${trials}`);
console.log(divergences > 0
  ? "CONFIRMED: the resampling check WOULD catch this cheater (moves diverge across worlds sharing one view)."
  : "NOT CONFIRMED at this seed/board -- try a different config.");

// scripts/research/order-vs-chaos-line-probability.ts — OV0/R1 (docs/plans/order-vs-chaos.md
// §6 R1, §7). The cheapest disconfirming experiment for this game, and it runs BEFORE any
// engine code exists (C31: "Order vs Chaos runs a 10k-board line-probability script before
// anything is built").
//
// Question: sample 10,000 uniformly random FILLED 6x6 boards (each cell independently X or O,
// p=0.5 — this models a random full board, not a reachable self-play trajectory; R1 only needs
// the fill distribution) and measure P(board contains a >=5-in-a-row of either symbol). The
// plan predicts ~0.8 (32 windows x 2*2^-5 => ~2 expected mono windows; Poisson P(none) ~= e^-2
// ~= 0.14, correlations push the true P(>=1) higher than the independence approximation).
//
// Why this matters: if virtually every filled board contains a 5-run, MCTS rollouts (uniform
// random playouts to a terminal) carry NO Chaos signal — every self-play number would measure
// the yardstick (C6), not the game. If the measured probability is >=0.95, STOP and escalate
// before writing an engine (per the brief; do not proceed to OV1 silently).
//
// Run: pnpm tsx scripts/research/order-vs-chaos-line-probability.ts

import { rngFromSeed } from "@twist-arcade/engine";

const SIZE = 6;
const WIN = 5;
const SAMPLES = 10_000;
const SEED = "ov0-r1-line-probability";

type Line = readonly number[]; // cell indices, in order, for one maximal row/col/diagonal

function idx(r: number, c: number): number {
  return r * SIZE + c;
}

/** All maximal lines (rows, columns, both diagonal directions) of length >= WIN. */
function buildLines(): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < SIZE; r++) lines.push(Array.from({ length: SIZE }, (_, c) => idx(r, c)));
  for (let c = 0; c < SIZE; c++) lines.push(Array.from({ length: SIZE }, (_, r) => idx(r, c)));
  // down-right diagonals, keyed by (r - c)
  for (let k = -(SIZE - 1); k <= SIZE - 1; k++) {
    const cells: number[] = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r - k;
      if (c >= 0 && c < SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= WIN) lines.push(cells);
  }
  // down-left (anti) diagonals, keyed by (r + c)
  for (let k = 0; k <= 2 * (SIZE - 1); k++) {
    const cells: number[] = [];
    for (let r = 0; r < SIZE; r++) {
      const c = k - r;
      if (c >= 0 && c < SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= WIN) lines.push(cells);
  }
  return lines;
}

/** All length-WIN consecutive windows across every line — the plan's "windows per line" unit. */
function buildWindows(lines: readonly Line[]): Line[] {
  const windows: Line[] = [];
  for (const line of lines) {
    for (let start = 0; start + WIN <= line.length; start++) {
      windows.push(line.slice(start, start + WIN));
    }
  }
  return windows;
}

function boardHasFiveRun(board: readonly (0 | 1)[], windows: readonly Line[]): boolean {
  for (const window of windows) {
    const first = board[window[0]!]!;
    let mono = true;
    for (let i = 1; i < window.length; i++) {
      if (board[window[i]!] !== first) {
        mono = false;
        break;
      }
    }
    if (mono) return true;
  }
  return false;
}

function main(): void {
  const lines = buildLines();
  const windows = buildWindows(lines);
  // Pencil-check cross-reference (plan §1.3): 32 windows total on 6x6/win-5.
  if (windows.length !== 32) {
    throw new Error(`expected 32 win-windows on 6x6/win-5, got ${windows.length} — check line construction`);
  }

  const rng = rngFromSeed(SEED);
  let hits = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const board: (0 | 1)[] = Array.from({ length: SIZE * SIZE }, () => (rng.next() < 0.5 ? 0 : 1));
    if (boardHasFiveRun(board, windows)) hits++;
  }

  const p = hits / SAMPLES;
  console.log(`OV0/R1 — line-probability on ${SIZE}x${SIZE}, win-${WIN}, ${SAMPLES} uniform random filled boards`);
  console.log(`windows checked per board: ${windows.length} (pencil-check: expect 32)`);
  console.log(`P(contains a >=${WIN}-run) = ${hits}/${SAMPLES} = ${p.toFixed(4)}`);
  console.log(`plan prediction: ~0.8`);
  if (p >= 0.95) {
    console.log(
      "ESCALATE: measured probability >= 0.95 — rollouts carry no Chaos signal at this rate. " +
        "Do not proceed to the engine without orchestrator review (C6)."
    );
  } else {
    console.log("Below the 0.95 escalation threshold — OV1 (engine) may proceed.");
  }
}

main();

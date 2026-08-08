// scripts/research/duel-draft-d0.ts — D0, the kill-test (docs/plans/duel-draft.md §6, §15.1).
// Runs BEFORE any engine code exists. Zero dependency on the platform engine, harness, or bots
// (@twist-arcade/*) — the rules fit in ~15 lines of logic per the plan, so this script reimplements
// them standalone: that independence is the whole point, and it is what lets a kill cost nothing.
//
// The game (plan §1): 4x4 board, no turns. Each round both players secretly pick an empty cell;
// picks resolve together. Distinct picks -> both marks placed. Same pick -> nothing placed, cell
// destroyed permanently. First 4-in-a-row of one's own marks wins; a line containing a destroyed
// cell can never be completed by anyone (this falls out of "own marks only" — never coded as a
// separate rule, exactly as the plan specifies). Termination is structural: every round removes
// >=1 empty cell, so games last 4-16 rounds.
//
// Rungs (plan §6 table):
//   A - random vs random, n=2,000, two seeds. No kill from rung A alone.
//   B - scripted policies (greedy-threat, defensive-cover, mixed-greedy), ~500 games/pairing,
//       two seeds, each vs random and vs each other.
//
// The pre-registered kill rule (plan §6, quoted in full in the header comment above
// evaluateKillRule below) is fixed BEFORE any number below exists and is not renegotiable
// afterwards. The single pre-committed remedy lever is winLength: 3; one re-measurement; a
// second failure is a kill recommendation, never a third configuration.
//
// Run: pnpm tsx scripts/research/duel-draft-d0.ts > .scratch/duel-draft-d0.out 2>&1

// ---------------------------------------------------------------------------------------------
// Seeded RNG — standalone (no @twist-arcade/engine import; see header). FNV-1a string hash seeds
// a mulberry32 generator. Deterministic per (seed) string, which is all D0 needs.
// ---------------------------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly draw: () => number;
  constructor(seed: string) {
    this.draw = mulberry32(hashSeed(seed));
  }
  next(): number {
    return this.draw();
  }
  int(maxExclusive: number): number {
    return Math.floor(this.draw() * maxExclusive);
  }
}

// ---------------------------------------------------------------------------------------------
// Rules logic (~70 lines: board, lines/windows, apply, winner). Plan §1, §2.1.
// ---------------------------------------------------------------------------------------------

const SIZE = 4;
type Cell = "empty" | 0 | 1 | "destroyed";
type Board = Cell[];
type Player = 0 | 1;

function idx(r: number, c: number): number {
  return r * SIZE + c;
}

/** Every maximal row, column, and diagonal (both directions), any length >=1. Rows/cols are
 * always length SIZE; diagonals range from length 1 (corner) up to SIZE (the two main diagonals).
 * winLength:4 only ever uses the length-4 lines; winLength:3 (the remedy lever) also pulls in the
 * length-3-only diagonals, which is where the 24-vs-10 window count comes from. */
function buildMaximalLines(): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < SIZE; r++) lines.push(Array.from({ length: SIZE }, (_, c) => idx(r, c)));
  for (let c = 0; c < SIZE; c++) lines.push(Array.from({ length: SIZE }, (_, r) => idx(r, c)));
  for (let k = -(SIZE - 1); k <= SIZE - 1; k++) {
    const cells: number[] = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r - k;
      if (c >= 0 && c < SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= 1) lines.push(cells);
  }
  for (let k = 0; k <= 2 * (SIZE - 1); k++) {
    const cells: number[] = [];
    for (let r = 0; r < SIZE; r++) {
      const c = k - r;
      if (c >= 0 && c < SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= 1) lines.push(cells);
  }
  return lines;
}

/** All consecutive winLength-cell windows across every maximal line long enough to hold one. */
function buildWindows(lines: readonly number[][], winLength: number): number[][] {
  const windows: number[][] = [];
  for (const line of lines) {
    if (line.length < winLength) continue;
    for (let start = 0; start + winLength <= line.length; start++) {
      windows.push(line.slice(start, start + winLength));
    }
  }
  return windows;
}

function emptyBoard(): Board {
  return Array<Cell>(SIZE * SIZE).fill("empty");
}

function legalCells(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === "empty") out.push(i);
  return out;
}

/** Distinct picks: both marks placed. Same pick: nothing placed, cell destroyed. Plan §1.2. */
function applyRound(board: Board, pick0: number, pick1: number): { collided: boolean } {
  if (pick0 === pick1) {
    board[pick0] = "destroyed";
    return { collided: true };
  }
  board[pick0] = 0;
  board[pick1] = 1;
  return { collided: false };
}

/** Exactly one player completes a line -> that player wins. Both -> draw (plan §1.3, Tilt C45
 * precedent). A window through a destroyed cell can never be all-own-marks, so "line dead" is
 * emergent, never a separate check. */
function checkWinner(board: Board, windows: readonly number[][]): 0 | 1 | "both" | null {
  let p0 = false;
  let p1 = false;
  for (const w of windows) {
    if (w.every((i) => board[i] === 0)) p0 = true;
    if (w.every((i) => board[i] === 1)) p1 = true;
  }
  if (p0 && p1) return "both";
  if (p0) return 0;
  if (p1) return 1;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Scripted policies (plan §6 rung B). A window is "live" for a player if it holds no opposing
// mark and no destroyed cell (plan's own definition, verbatim).
// ---------------------------------------------------------------------------------------------

function isLiveFor(board: Board, window: readonly number[], player: Player): boolean {
  const opp = player === 0 ? 1 : 0;
  return !window.some((i) => board[i] === opp || board[i] === "destroyed");
}

function progressFor(board: Board, window: readonly number[], player: Player): number {
  return window.filter((i) => board[i] === player).length;
}

/** Sum, over every live-for-player window containing `cell`, of (progress-so-far + 1). Rewards
 * cells that advance multiple or more-advanced lines at once — the mechanism that lets a greedy
 * policy stumble into double threats without being told to look for them. */
function scoreCell(board: Board, windows: readonly number[][], player: Player, cell: number): number {
  let score = 0;
  for (const w of windows) {
    if (!w.includes(cell)) continue;
    if (!isLiveFor(board, w, player)) continue;
    score += progressFor(board, w, player) + 1;
  }
  return score;
}

/** A legal cell that completes a live-for-player window right now (progress === winLength-1
 * and this is the window's only empty cell). Null if no such move exists. */
function findImmediateWin(board: Board, windows: readonly number[][], player: Player, legal: readonly number[]): number | null {
  const legalSet = new Set(legal);
  for (const w of windows) {
    if (!isLiveFor(board, w, player)) continue;
    const empties = w.filter((i) => board[i] === "empty");
    if (empties.length === 1 && progressFor(board, w, player) === w.length - 1 && legalSet.has(empties[0]!)) {
      return empties[0]!;
    }
  }
  return null;
}

type Policy = (board: Board, player: Player, legal: readonly number[], rng: Rng, windows: readonly number[][]) => number;

const pickRandom: Policy = (_board, _player, legal, rng) => legal[rng.int(legal.length)]!;

/** greedy-threat attacker: take a free win; else extend your own most-advanced live line(s),
 * tie-broken toward cells that advance the most lines at once (scoreCell), tie-broken by lowest
 * index for determinism. Fully deterministic given a board — which is exactly why greedy-threat
 * vs itself collides every round on the symmetric opening board (see report: this is real, not
 * a bug, and is the reason mixed-greedy exists). */
const pickGreedy: Policy = (board, player, legal, _rng, windows) => {
  const win = findImmediateWin(board, windows, player, legal);
  if (win !== null) return win;
  let best = legal[0]!;
  let bestScore = -1;
  for (const cell of legal) {
    const s = scoreCell(board, windows, player, cell);
    if (s > bestScore) {
      bestScore = s;
      best = cell;
    }
  }
  return best;
};

/** defensive-cover: take a free win; else block the opponent's immediate win; else cover the
 * opponent's most-advanced live line (highest opponent progress among windows touching a legal
 * cell, defense-score tie-break); else play greedily (own offense). */
const pickDefensiveCover: Policy = (board, player, legal, rng, windows) => {
  const opp: Player = player === 0 ? 1 : 0;
  const ownWin = findImmediateWin(board, windows, player, legal);
  if (ownWin !== null) return ownWin;
  const oppWin = findImmediateWin(board, windows, opp, legal);
  if (oppWin !== null) return oppWin;

  let bestCell: number | null = null;
  let bestProgress = -1;
  let bestDefScore = -1;
  for (const cell of legal) {
    let cellBestProgress = -1;
    for (const w of windows) {
      if (!w.includes(cell)) continue;
      if (!isLiveFor(board, w, opp)) continue;
      const p = progressFor(board, w, opp);
      if (p > cellBestProgress) cellBestProgress = p;
    }
    if (cellBestProgress < 0) continue;
    const defScore = scoreCell(board, windows, opp, cell);
    if (cellBestProgress > bestProgress || (cellBestProgress === bestProgress && defScore > bestDefScore)) {
      bestProgress = cellBestProgress;
      bestDefScore = defScore;
      bestCell = cell;
    }
  }
  if (bestCell !== null && bestProgress >= 1) return bestCell;
  return pickGreedy(board, player, legal, rng, windows);
};

const MIXED_EPSILON = 0.2;
const MIXED_TOP_K = 3;

/** mixed-greedy: take a free win; else with probability MIXED_EPSILON play a uniformly random
 * legal cell; else sample uniformly among the top-MIXED_TOP_K legal cells by greedy score. This
 * is the policy that exists specifically so self-play doesn't collide with certainty (plan §6):
 * a deterministic policy facing itself on a symmetric position computes the same pick every
 * round, which is real and is not worked around here — mixed-greedy sidesteps it by construction
 * instead. */
const pickMixedGreedy: Policy = (board, player, legal, rng, windows) => {
  const win = findImmediateWin(board, windows, player, legal);
  if (win !== null) return win;
  if (rng.next() < MIXED_EPSILON) return legal[rng.int(legal.length)]!;
  const scored = legal.map((cell) => ({ cell, score: scoreCell(board, windows, player, cell) }));
  scored.sort((a, b) => b.score - a.score);
  const k = Math.min(MIXED_TOP_K, scored.length);
  return scored[rng.int(k)]!.cell;
};

// ---------------------------------------------------------------------------------------------
// Game loop + matchup harness
// ---------------------------------------------------------------------------------------------

interface GameResult {
  winner: 0 | 1 | null; // null = draw (exhausted or double-win)
  rounds: number;
  collisions: number;
  doubleWin: boolean;
}

const MAX_ROUNDS = 16; // structural bound (plan §1.5): every round removes >=1 of 16 cells.

function playGame(policy0: Policy, policy1: Policy, windows: readonly number[][], seed: string): GameResult {
  const board = emptyBoard();
  const rng = new Rng(seed);
  let rounds = 0;
  let collisions = 0;

  for (;;) {
    const legal = legalCells(board);
    if (legal.length === 0) return { winner: null, rounds, collisions, doubleWin: false };

    const pick0 = policy0(board, 0, legal, rng, windows);
    const pick1 = policy1(board, 1, legal, rng, windows);
    const { collided } = applyRound(board, pick0, pick1);
    rounds++;
    if (collided) collisions++;
    if (rounds > MAX_ROUNDS) {
      throw new Error(`cap exceeded at round ${rounds} — engine bug, not a game outcome (plan §1.5 asserts zero)`);
    }

    if (!collided) {
      const w = checkWinner(board, windows);
      if (w === "both") return { winner: null, rounds, collisions, doubleWin: true };
      if (w === 0 || w === 1) return { winner: w, rounds, collisions, doubleWin: false };
    }
    if (legalCells(board).length === 0) return { winner: null, rounds, collisions, doubleWin: false };
  }
}

interface MatchupStats {
  games: number;
  p0Wins: number;
  p1Wins: number;
  draws: number;
  doubleWinDraws: number;
  decisiveRate: number;
  meanRounds: number;
  meanCollisions: number;
  collisionHistogram: Record<string, number>; // "0","1","2","3","4+"
}

function runMatchup(nameA: string, policyA: Policy, nameB: string, policyB: Policy, n: number, windows: readonly number[][], seedBase: string): MatchupStats {
  let p0Wins = 0;
  let p1Wins = 0;
  let draws = 0;
  let doubleWinDraws = 0;
  let roundsSum = 0;
  let collisionsSum = 0;
  const hist: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0 };

  for (let i = 0; i < n; i++) {
    const seed = `${seedBase}|${nameA}-vs-${nameB}|${i}`;
    const result = playGame(policyA, policyB, windows, seed);
    if (result.winner === 0) p0Wins++;
    else if (result.winner === 1) p1Wins++;
    else {
      draws++;
      if (result.doubleWin) doubleWinDraws++;
    }
    roundsSum += result.rounds;
    collisionsSum += result.collisions;
    const bucket = result.collisions >= 4 ? "4+" : String(result.collisions);
    hist[bucket] = (hist[bucket] ?? 0) + 1;
  }

  return {
    games: n,
    p0Wins,
    p1Wins,
    draws,
    doubleWinDraws,
    decisiveRate: (p0Wins + p1Wins) / n,
    meanRounds: roundsSum / n,
    meanCollisions: collisionsSum / n,
    collisionHistogram: hist,
  };
}

// ---------------------------------------------------------------------------------------------
// Self-test — pinned resolution-table + termination checks, run before any measurement. Plan §3
// "TDD anchors" scaled down for a standalone script: these are the acceptance-criteria-derivable
// behaviors D0 depends on, checked directly rather than assumed.
// ---------------------------------------------------------------------------------------------

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`SELF-TEST FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

function selfTest(): void {
  const lines = buildMaximalLines();

  // Pencil-check: win-4 -> 10 windows (4 rows + 4 cols + 2 main diagonals); win-3 -> 24 windows
  // (plan §1.7 / §6 remedy-lever note). Both numbers are asserted, not eyeballed.
  const windows4 = buildWindows(lines, 4);
  const windows3 = buildWindows(lines, 3);
  assertEq(windows4.length, 10, "win-4 window count");
  assertEq(windows3.length, 24, "win-3 window count");

  // Distinct picks place both marks; same pick destroys and places nothing.
  {
    const b = emptyBoard();
    const { collided } = applyRound(b, 0, 5);
    assertEq(collided, false, "distinct picks: collided flag");
    assertEq(b[0], 0, "distinct picks: seat0 mark placed");
    assertEq(b[5], 1, "distinct picks: seat1 mark placed");
  }
  {
    const b = emptyBoard();
    const { collided } = applyRound(b, 7, 7);
    assertEq(collided, true, "same pick: collided flag");
    assertEq(b[7], "destroyed", "same pick: cell destroyed, nothing placed");
  }

  // One player completes a line -> wins, even though the opponent's simultaneous placement
  // stands elsewhere on the board (plan §1.3).
  {
    const b = emptyBoard();
    for (const i of [0, 1, 2, 3]) b[i] = 0; // seat0 has the top row
    b[15] = 1; // seat1's simultaneous placement stands, doesn't complete anything
    const w = checkWinner(b, windows4);
    assertEq(w, 0, "one-line win: opponent's standing placement doesn't block the win");
  }

  // Both complete a line in the same round -> draw (double-win), never mover-wins (no mover
  // concept exists here) and never seat-0-wins.
  {
    const b = emptyBoard();
    for (const i of [0, 1, 2, 3]) b[i] = 0; // row 0
    for (const i of [4, 5, 6, 7]) b[i] = 1; // row 1
    assertEq(checkWinner(b, windows4), "both", "double-win: both lines complete -> 'both'");
  }

  // A line through a destroyed cell never scores, even with 3 of 4 cells held by one player.
  {
    const b = emptyBoard();
    b[0] = 0;
    b[1] = 0;
    b[2] = 0;
    b[3] = "destroyed";
    assertEq(checkWinner(b, windows4), null, "destroyed-cell line: never completes for anyone");
  }

  // Forced collision at the last empty cell: with exactly one legal cell, both policies must
  // pick it, producing a collision and then an exhausted draw (plan §1.4).
  {
    const b = emptyBoard();
    // Fill 15 of 16 cells with a legal equal-count-ish pattern (exact split doesn't matter for
    // this check), leaving cell 15 empty and no line completed by construction.
    const fillPattern: Cell[] = [0, 1, 0, 1, "destroyed", 0, 1, 0, 1, "destroyed", 0, 1, 0, 1, "destroyed", "empty"];
    for (let i = 0; i < 16; i++) b[i] = fillPattern[i]!;
    assertEq(checkWinner(b, windows4), null, "forced-collision setup: no pre-existing winner");
    const legal = legalCells(b);
    assertEq(legal.length, 1, "forced-collision setup: exactly one empty cell");
    const rng = new Rng("self-test-forced-collision");
    const pick0 = pickGreedy(b, 0, legal, rng, windows4);
    const pick1 = pickGreedy(b, 1, legal, rng, windows4);
    assertEq(pick0, legal[0], "forced collision: seat0 has no choice but the last cell");
    assertEq(pick1, legal[0], "forced collision: seat1 has no choice but the last cell");
    const { collided } = applyRound(b, pick0, pick1);
    assertEq(collided, true, "forced collision: the last round is a collision by construction");
    assertEq(legalCells(b).length, 0, "forced collision: board exhausted after the collision");
  }

  // Structural termination: MAX_ROUNDS=16 must never be exceeded by an honest random game.
  {
    for (let i = 0; i < 200; i++) {
      const result = playGame(pickRandom, pickRandom, windows4, `self-test-termination-${i}`);
      if (result.rounds > 16) throw new Error(`SELF-TEST FAILED: termination sample exceeded 16 rounds (${result.rounds})`);
    }
  }

  console.log("self-test: all pinned resolution/termination checks PASS");
}

// ---------------------------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtRungA(label: string, s: MatchupStats): string {
  const lines: string[] = [];
  lines.push(`--- Rung A: ${label} (n=${s.games}) ---`);
  lines.push(`  decisive rate: ${pct(s.decisiveRate)} (seat0 ${pct(s.p0Wins / s.games)} / seat1 ${pct(s.p1Wins / s.games)})`);
  lines.push(`  draw rate: ${pct(s.draws / s.games)} (double-win among draws: ${s.doubleWinDraws})`);
  lines.push(`  mean rounds: ${s.meanRounds.toFixed(2)}`);
  lines.push(
    `  collisions/game: mean ${s.meanCollisions.toFixed(2)} — histogram 0:${s.collisionHistogram["0"]} 1:${s.collisionHistogram["1"]} ` +
      `2:${s.collisionHistogram["2"]} 3:${s.collisionHistogram["3"]} 4+:${s.collisionHistogram["4+"]}`
  );
  return lines.join("\n");
}

function fmtRungB(label: string, s: MatchupStats): string {
  return (
    `  ${label.padEnd(38)} decisive ${pct(s.decisiveRate).padStart(6)}  ` +
    `draws ${pct(s.draws / s.games).padStart(6)}  meanRounds ${s.meanRounds.toFixed(1).padStart(5)}  ` +
    `meanCollisions ${s.meanCollisions.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------------------------
// Rung runners
// ---------------------------------------------------------------------------------------------

const SEEDS = ["duel-draft-d0-seed-a", "duel-draft-d0-seed-b"];
const RUNG_A_GAMES = 2000;
const RUNG_B_GAMES = 500;

interface RungAResult {
  seed: string;
  stats: MatchupStats;
}

function runRungA(windows: readonly number[][]): RungAResult[] {
  return SEEDS.map((seed) => ({
    seed,
    stats: runMatchup("random", pickRandom, "random", pickRandom, RUNG_A_GAMES, windows, `rungA|${seed}`),
  }));
}

interface RungBPairings {
  greedyVsRandom: MatchupStats;
  greedyVsDefense: MatchupStats;
  mixedVsRandom: MatchupStats;
  mixedVsDefense: MatchupStats;
  defenseVsRandom: MatchupStats;
  greedyVsMixed: MatchupStats;
  greedySelfPlay: MatchupStats;
  defenseSelfPlay: MatchupStats;
  mixedSelfPlay: MatchupStats;
}

interface RungBResult {
  seed: string;
  pairings: RungBPairings;
}

function runRungB(windows: readonly number[][]): RungBResult[] {
  return SEEDS.map((seed) => {
    const base = `rungB|${seed}`;
    const pairings: RungBPairings = {
      greedyVsRandom: runMatchup("greedy", pickGreedy, "random", pickRandom, RUNG_B_GAMES, windows, base),
      greedyVsDefense: runMatchup("greedy", pickGreedy, "defense", pickDefensiveCover, RUNG_B_GAMES, windows, base),
      mixedVsRandom: runMatchup("mixed", pickMixedGreedy, "random", pickRandom, RUNG_B_GAMES, windows, base),
      mixedVsDefense: runMatchup("mixed", pickMixedGreedy, "defense", pickDefensiveCover, RUNG_B_GAMES, windows, base),
      defenseVsRandom: runMatchup("defense", pickDefensiveCover, "random", pickRandom, RUNG_B_GAMES, windows, base),
      greedyVsMixed: runMatchup("greedy", pickGreedy, "mixed", pickMixedGreedy, RUNG_B_GAMES, windows, base),
      greedySelfPlay: runMatchup("greedy", pickGreedy, "greedy", pickGreedy, RUNG_B_GAMES, windows, base),
      defenseSelfPlay: runMatchup("defense", pickDefensiveCover, "defense", pickDefensiveCover, RUNG_B_GAMES, windows, base),
      mixedSelfPlay: runMatchup("mixed", pickMixedGreedy, "mixed", pickMixedGreedy, RUNG_B_GAMES, windows, base),
    };
    return { seed, pairings };
  });
}

function printRungA(results: readonly RungAResult[]): void {
  console.log("=== RUNG A: random vs random ===");
  for (const r of results) {
    console.log(fmtRungA(r.seed, r.stats));
  }
  console.log("No kill from rung A alone (plan §6): random play failing to win is not proof skilled play cannot.");
  console.log();
}

function printRungB(results: readonly RungBResult[]): void {
  console.log("=== RUNG B: scripted policies (~500 games/pairing) ===");
  for (const r of results) {
    console.log(`--- seed: ${r.seed} ---`);
    console.log(fmtRungB("greedy-threat vs random", r.pairings.greedyVsRandom));
    console.log(fmtRungB("greedy-threat vs defensive-cover", r.pairings.greedyVsDefense));
    console.log(fmtRungB("mixed-greedy vs random", r.pairings.mixedVsRandom));
    console.log(fmtRungB("mixed-greedy vs defensive-cover", r.pairings.mixedVsDefense));
    console.log(fmtRungB("defensive-cover vs random", r.pairings.defenseVsRandom));
    console.log(fmtRungB("greedy-threat vs mixed-greedy", r.pairings.greedyVsMixed));
    console.log(fmtRungB("greedy-threat SELF-PLAY", r.pairings.greedySelfPlay));
    console.log(fmtRungB("defensive-cover SELF-PLAY", r.pairings.defenseSelfPlay));
    console.log(fmtRungB("mixed-greedy SELF-PLAY", r.pairings.mixedSelfPlay));
    console.log();
  }
}

// ---------------------------------------------------------------------------------------------
// The pre-registered kill rule, quoted from plan §6 / §15.2:
//
//   KILL if either tail fires on both seeds:
//   1. Every attacker yields <5% decisive against both random and defensive-cover -> 4-in-a-row
//      is practically unreachable, the game is draw-city.
//   2. Defensive-cover forces >=95% draws against the best attacker -> defense is free.
//
// "Attacker" = greedy-threat, mixed-greedy (rung B's two attacking policies; defensive-cover is
// the defender under test in tail 2, not an attacker in tail 1). "Best attacker" for tail 2 =
// whichever attacker has the HIGHER decisive rate against defensive-cover on that seed — the
// tougher test of whether defense is actually free.
// ---------------------------------------------------------------------------------------------

interface KillEvalPerSeed {
  seed: string;
  tail1Fired: boolean; // every attacker <5% decisive vs BOTH random and defensive-cover
  tail1Detail: string;
  tail2Fired: boolean; // defensive-cover forces >=95% draws vs the best (highest-decisive) attacker
  tail2Detail: string;
}

function evaluateKillRulePerSeed(r: RungBResult): KillEvalPerSeed {
  const { pairings } = r;
  const attackers = [
    { name: "greedy-threat", vsRandom: pairings.greedyVsRandom.decisiveRate, vsDefense: pairings.greedyVsDefense.decisiveRate, defenseMatch: pairings.greedyVsDefense },
    { name: "mixed-greedy", vsRandom: pairings.mixedVsRandom.decisiveRate, vsDefense: pairings.mixedVsDefense.decisiveRate, defenseMatch: pairings.mixedVsDefense },
  ];

  const tail1Fired = attackers.every((a) => a.vsRandom < 0.05 && a.vsDefense < 0.05);
  const tail1Detail = attackers.map((a) => `${a.name}: vsRandom=${pct(a.vsRandom)} vsDefense=${pct(a.vsDefense)}`).join("; ");

  const best = attackers.reduce((acc, a) => (a.vsDefense > acc.vsDefense ? a : acc));
  const bestDrawRate = best.defenseMatch.draws / best.defenseMatch.games;
  const tail2Fired = bestDrawRate >= 0.95;
  const tail2Detail = `best attacker vs defense = ${best.name} (decisive ${pct(best.vsDefense)}), defense draw-force rate = ${pct(bestDrawRate)}`;

  return { seed: r.seed, tail1Fired, tail1Detail, tail2Fired, tail2Detail };
}

function printKillEvaluation(evals: readonly KillEvalPerSeed[], winLength: number): { killFired: boolean } {
  console.log(`=== KILL RULE EVALUATION (winLength=${winLength}) ===`);
  for (const e of evals) {
    console.log(`  seed=${e.seed}`);
    console.log(`    tail1 (every attacker <5% decisive vs random AND defense): ${e.tail1Fired ? "FIRED" : "clear"} — ${e.tail1Detail}`);
    console.log(`    tail2 (defense >=95% draw-force vs best attacker):         ${e.tail2Fired ? "FIRED" : "clear"} — ${e.tail2Detail}`);
  }
  const tail1BothSeeds = evals.every((e) => e.tail1Fired);
  const tail2BothSeeds = evals.every((e) => e.tail2Fired);
  const killFired = tail1BothSeeds || tail2BothSeeds;
  console.log(`  tail1 fired on both seeds: ${tail1BothSeeds}`);
  console.log(`  tail2 fired on both seeds: ${tail2BothSeeds}`);
  console.log(`  KILL RULE: ${killFired ? "FIRED" : "clear"}`);
  console.log();
  return { killFired };
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function main(): void {
  selfTest();
  console.log();

  console.log("Duel Draft D0 — kill-test. 4x4 board, plan docs/plans/duel-draft.md §6.");
  console.log(`seeds: ${SEEDS.join(", ")}`);
  console.log();

  // --- winLength: 4 (shipped configuration) ---
  const lines = buildMaximalLines();
  const windows4 = buildWindows(lines, 4);

  const rungA4 = runRungA(windows4);
  printRungA(rungA4);

  const rungB4 = runRungB(windows4);
  printRungB(rungB4);

  const evals4 = rungB4.map((r) => evaluateKillRulePerSeed(r));
  const { killFired: killFired4 } = printKillEvaluation(evals4, 4);

  if (!killFired4) {
    console.log("VERDICT: kill rule did not fire at winLength=4. D0 PASSES. Proceed to D1 (engine).");
    console.log("H2 sketch-prior check (>=20% decisive under scripted attackers): reported per-pairing above —");
    console.log("compare directly against the >=20% sketch prior (plan §5, H2). If the measurement contradicts");
    console.log("the sketch, the measurement wins; that is a note for the record, not a kill condition.");
    return;
  }

  console.log("KILL RULE FIRED at winLength=4. Applying the single pre-committed lever: winLength=3.");
  console.log("Re-running rungs A and B ONCE at winLength=3 (no further tuning, no third configuration).");
  console.log();

  const windows3 = buildWindows(lines, 3);

  const rungA3 = runRungA(windows3);
  printRungA(rungA3);

  const rungB3 = runRungB(windows3);
  printRungB(rungB3);

  const evals3 = rungB3.map((r) => evaluateKillRulePerSeed(r));
  const { killFired: killFired3 } = printKillEvaluation(evals3, 3);

  if (killFired3) {
    console.log("VERDICT: kill rule still fires at winLength=3, the single remedy lever already spent.");
    console.log("RECOMMENDATION: KILL Duel Draft. No third configuration per plan §6/§15.2.");
    process.exitCode = 1;
  } else {
    console.log("VERDICT: winLength=3 clears the kill rule. D0 PASSES under the remedy lever.");
    console.log("Recorded: D3's gate table and manifest must reflect winLength=3, not the originally-shipped 4.");
  }
}

main();

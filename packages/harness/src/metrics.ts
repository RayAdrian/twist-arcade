// packages/harness/src/metrics.ts — pure two-player metric derivation over an array of
// per-game outcomes (plan §7.2). Deliberately engine/policy-free: `runner.ts` is the only
// producer of `GameOutcome[]`, this module is the only consumer that turns them into the
// numbers `suites.ts` gates on and `report.ts` prints. Keeping this pure (no I/O, no clock, no
// rng) is what makes it trivially unit-testable against hand-computed expectations.

import type { PlayerId, StepRecord } from "@twist-arcade/engine";

export interface GameOutcome {
  readonly matchSeed: string;
  /** Agent name occupying seat 0 and seat 1 for this particular game (mirrored-pair games swap
   *  this between the two games sharing a matchSeed — see runner.ts). */
  readonly seatAgent: readonly [string, string];
  /** `null` covers both a genuine rules-drawn terminal AND a ply-cap adjudicated draw (plan
   *  §7.2: "cap-hit rate (200-ply cap, adjudicated draw + logged)") — `capHit` distinguishes
   *  the two when that matters, but both count as a draw for drawRate/winRateBySeat purposes. */
  readonly winnerSeat: PlayerId | null;
  readonly plies: number;
  readonly capHit: boolean;
  /** `legalMoves(...).length` observed immediately before each move actually made this game —
   *  one sample per ply (or per simultaneous actor per ply). Flattened across all games and
   *  averaged for `meanBranchingFactor`. */
  readonly branchingSamples: readonly number[];
  /** Every ply actually played this game, in order — one `StepRecord` per ply (its own
   *  `moves: [PlayerId, Json][]` holds every actor's move for that ply together; 1 entry for a
   *  sequential ply, n for a simultaneous one). Review Note 8: this was previously discarded
   *  entirely, which structurally blocked opening-move concentration, a comeback curve, and any
   *  sign-check that needs to know WHAT was played, not just who won. Stage-6 re-review (MUST
   *  FIX): an earlier version of this field flattened every actor into one indistinguishable
   *  `{ seat, move }[]` log with no ply boundary — lossless for the sequential games the test
   *  suite happened to exercise, but NOT for a `simultaneous: true` engine (which `runMatchup`
   *  accepts), where a flat log can't tell "same ply" from "next ply" without re-simulating
   *  `active()` against the live engine. `StepRecord[]` fixes that: it IS `ReplayRecord.steps`,
   *  for every game class this package's runner plays, not just the sequential ones. Nearly free
   *  to record now; expensive to retrofit once reports downstream have already been consumed
   *  (see runner.ts's own doc on Note 8's retrofit cost — the same reasoning applies to its own
   *  shape). */
  readonly moves: readonly StepRecord[];
}

export interface MatchupMetrics {
  games: number;
  firstPlayerWinRate: number;
  drawRate: number;
  winRateBySeat: readonly [number, number];
  meanPlies: number;
  medianPlies: number;
  p95Plies: number;
  meanBranchingFactor: number;
  capHitRate: number;
}

/** Nearest-rank percentile over an ALREADY-ASCENDING-SORTED array. `p` in [0, 100]. Throws on
 *  an empty array rather than returning NaN (this project's standing rule about not letting
 *  NaN/Infinity silently ride into a JSON report — see @twist-arcade/engine's encode.ts for the
 *  sibling case this mirrors). */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) {
    throw new RangeError("percentile: cannot compute a percentile of an empty array");
  }
  if (p < 0 || p > 100) {
    throw new RangeError(`percentile: p must be in [0, 100], got ${p}`);
  }
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  return sortedAscending[index]!;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) {
    throw new RangeError("mean: cannot average an empty array");
  }
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Derives every plan §7.2 two-player metric this package computes from raw self-play outcomes
 * (ladder/Elo and opening-move concentration are out of this milestone's scope — see the
 * handoff report). Throws on an empty `outcomes` array: a report over zero games has no honest
 * value for any of these ratios, and returning NaN/0 in their place would look like a real
 * (and possibly gate-passing) number instead of the degenerate input it actually is.
 */
export function computeMatchupMetrics(outcomes: readonly GameOutcome[]): MatchupMetrics {
  if (outcomes.length === 0) {
    throw new RangeError("computeMatchupMetrics: outcomes must be non-empty");
  }
  const games = outcomes.length;

  const seat0Wins = outcomes.filter((o) => o.winnerSeat === 0).length;
  const seat1Wins = outcomes.filter((o) => o.winnerSeat === 1).length;
  const draws = outcomes.filter((o) => o.winnerSeat === null).length;
  const capHits = outcomes.filter((o) => o.capHit).length;

  const plies = outcomes.map((o) => o.plies);
  const sortedPlies = plies.slice().sort((a, b) => a - b);
  const branching = outcomes.flatMap((o) => o.branchingSamples);

  return {
    games,
    firstPlayerWinRate: seat0Wins / games,
    drawRate: draws / games,
    winRateBySeat: [seat0Wins / games, seat1Wins / games],
    meanPlies: mean(plies),
    medianPlies: percentile(sortedPlies, 50),
    p95Plies: percentile(sortedPlies, 95),
    meanBranchingFactor: branching.length > 0 ? mean(branching) : 0,
    capHitRate: capHits / games,
  };
}

/**
 * `agentName`'s win rate across `outcomes`, regardless of which seat it occupied in any given
 * game — the ratio every CI gate in roadmap §6 (strong-vs-random, ruthless-vs-standard) is
 * actually stated in terms of. Throws (rather than silently returning 0) if `agentName` never
 * occupied either seat in any outcome — that is a caller passing the wrong name, not a real
 * 0% win rate, and the two must never look the same in a report.
 */
export function agentWinRate(outcomes: readonly GameOutcome[], agentName: string): number {
  const participated = outcomes.filter((o) => o.seatAgent.includes(agentName));
  if (participated.length === 0) {
    throw new RangeError(`agentWinRate: agent "${agentName}" does not appear in any outcome`);
  }
  const wins = participated.filter((o) => {
    if (o.winnerSeat === null) return false;
    return o.seatAgent[o.winnerSeat] === agentName;
  }).length;
  return wins / participated.length;
}

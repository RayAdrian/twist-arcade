// games/mine-run/probes.ts — safeMove (docs/plans/mine-run.md §4.2). Mandatory for every solo
// score chase (platform §6/§7.4: the harness hard-errors without one) — this is the
// Always-Safe policy's move rule.
//
// View-honest by construction: `safeMove` takes a MineRunView, never MineRunState. This is a
// deliberate deviation from the plan's literal `safeMove(state: MineRunState): MineRunMove`
// signature — see the §14 orchestrator addendum (folded from platform-corrections.md C1),
// which promotes view-honesty to a platform-wide, TYPE-SYSTEM-enforced rule and explicitly
// states the preference that hidden-info policies receive `playerView(state, seat)` rather
// than `state` at all. Taking only the view makes peeking at `state.mines` a compile error,
// not a discipline someone has to remember — and it makes the view-honesty resampling test
// (test/view-honesty.test.ts) provable by construction rather than merely observed to hold.
//
// `chooseSafeMove` is split out as its own pure function of (view, analysis) specifically so
// the DECISION ORDERING can be unit-tested against a hand-built FrontierAnalysis, independent
// of csp.ts's own correctness (which is validated separately, against an independent
// brute-force oracle, in test/csp.test.ts).

import { analyzeFrontier } from "./csp";
import type { FrontierAnalysis } from "./csp";
import { neighbors } from "./board";
import type { MineRunMove, MineRunView } from "./engine";

function isKnownSafe(view: MineRunView, analysis: FrontierAnalysis, cell: number): boolean {
  const v = view.cells[cell];
  if (v && "n" in v) return true;
  return analysis.provablySafe.has(cell);
}

/**
 * Pure decision function (plan §4.2's safeMove spec):
 * 1. A provably-safe unrevealed cell, preferring one that is ALSO provably zero (every one of
 *    ITS neighbors is itself either revealed-safe or provably-safe) — that cell would show 0
 *    if revealed in every consistent world, so revealing it can never end a streak build.
 * 2. Else bank, if streakLen >= 1 (Always-Safe never carries a streak into an unproven reveal).
 * 3. Else (streak 0, nothing provable) reveal the minimum-posterior cell — the bot must move,
 *    and probing at streak 0 risks only budget, never points.
 * Ties break on the lowest cell index, for determinism.
 */
export function chooseSafeMove(view: MineRunView, analysis: FrontierAnalysis): MineRunMove {
  if (analysis.provablySafe.size > 0) {
    const sorted = [...analysis.provablySafe].sort((a, b) => a - b);
    for (const cell of sorted) {
      const allNeighborsSafe = neighbors(cell, view.width, view.height).every((nb) => isKnownSafe(view, analysis, nb));
      if (allNeighborsSafe) return { t: "reveal", cell };
    }
    return { t: "reveal", cell: sorted[0]! };
  }

  if (view.streakLen >= 1) return { t: "bank" };

  let bestCell = -1;
  let bestPosterior = Infinity;
  for (const [cell, p] of [...analysis.posterior.entries()].sort((a, b) => a[0] - b[0])) {
    if (p < bestPosterior) {
      bestPosterior = p;
      bestCell = cell;
    }
  }
  if (bestCell === -1) {
    throw new Error(
      "safeMove: no provably-safe cell, no active streak to bank, and no posterior candidate " +
        "to fall back on -- this should never happen for an ongoing, reachable state."
    );
  }
  return { t: "reveal", cell: bestCell };
}

/** The mandatory Always-Safe hook (platform §6/§7.4). */
export function safeMove(view: MineRunView): MineRunMove {
  return chooseSafeMove(view, analyzeFrontier(view));
}

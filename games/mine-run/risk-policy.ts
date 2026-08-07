// games/mine-run/risk-policy.ts — S1: the survival-discounted plan-then-bank model
// (docs/plans/mine-run-risk-aware-policy.md §2, platform-corrections.md C39's ruling to
// proceed). S0a confirmed the in-world greedy-rollout leak (bank chosen 0/504,823 times);
// S0b's hand-built threshold family barely engaged below pCap=0.20 and never reached a
// majority per-seed win against Always-Safe at n=23 — that is a floor on what risk-awareness
// can buy, not a ceiling (C39), so this module prices compounding hazard properly instead of
// a two-knob heuristic.
//
// C1 (view-honesty): every function here consumes MineRunView (or values derived from one) —
// never MineRunState, never state.mines. The risk SOURCE is injected as a plain function
// `(view) => RiskEstimate` so a caller can supply Tier A (cheap, single-point) or Tier B
// (analyzeFrontier's exact joint posteriors) without this module caring which. This step wires
// Tier B (analyzeFrontier) only as the default — §2's own "Recommended assignment" names Tier B
// for "Strong's root and the standalone reference policy" (exactly what this module is used as
// here); Tier A is recommended specifically for Strong's ROLLOUT steps' cost profile, a
// wiring/cost concern for S2/S3 (agents.ts's roster seam, the cost pilot), not this step. The
// injection seam exists so a future Tier A source can be substituted later without touching
// chooseRiskAwareMove's own decision logic.
//
// Where this lives, per the spec's §3 item 1: a pure `chooseRiskAwareMove(view, opts)`; a
// `SafeMoveFn`-shaped export (`riskAwareMove`) so existing agent wiring (buildSafeMoveAgent)
// applies with no adapter; and a `MoveSelector`-shaped export (`riskAwareRolloutSelector`) for
// rollout use. Both shapes are matched STRUCTURALLY, not by importing the type aliases from
// @twist-arcade/harness/@twist-arcade/bots — this package depends on neither (package.json:
// only @twist-arcade/engine, @twist-arcade/game-spec, @twist-arcade/shell). `riskAwareRolloutSelector`'s
// signature is written directly against `GameEngine`/`PlayerId`/`Rng` from @twist-arcade/engine
// (already a dependency here, and the exact same building blocks bots's own MoveSelector<S,M>
// type alias is defined from), so it is call-signature-compatible with MoveSelector<MineRunState,
// MineRunMove> without any import coupling in that direction.

import type { GameEngine, PlayerId, Rng } from "@twist-arcade/engine";
import { analyzeFrontier } from "./csp";
import type { MineRunMove, MineRunState, MineRunView } from "./engine";

/** The minimum shape chooseRiskAwareMove needs from a risk source — a strict subset of
 *  csp.ts's `FrontierAnalysis` (`provablyMine`/`fallbackUsed` are not needed by §2's model).
 *  `analyzeFrontier` already satisfies this shape structurally (a `FrontierAnalysis` is
 *  assignable to a `RiskEstimate` everywhere it's used below), so Tier B needs no adapter. */
export interface RiskEstimate {
  readonly provablySafe: ReadonlySet<number>;
  readonly posterior: ReadonlyMap<number, number>;
}

/** A risk source: view -> per-cell mine-probability estimate. Tier B is `analyzeFrontier`
 *  itself; a future Tier A source (single-point, view-honest) would satisfy this same type. */
export type RiskSource = (view: MineRunView) => RiskEstimate;

export interface ChooseRiskAwareMoveOptions {
  /** Defaults to Tier B (`analyzeFrontier`) — see this module's own doc for why. */
  riskSource?: RiskSource;
}

export interface PlanValue {
  readonly m: number;
  readonly survival: number;
  readonly value: number;
}

/**
 * §2's U(m) scan, exposed on its own so it is unit-testable against the closed-form uniform-p
 * answer independent of chooseRiskAwareMove's move-selection wrapper. `sortedP` is the
 * candidates' posteriors — the CALLER's responsibility to have sorted ascending for a
 * real decision (`p_(1) <= p_(2) <= ...`, §2) — this function itself imposes no ordering
 * requirement and computes every entry unconditionally, in the given order: it never assumes
 * U(m) is unimodal and never stops early (§2: "Scan all m (<= 60 terms — do not assume
 * unimodality; it costs nothing to check all)").
 *
 * `S_m = product_{i=1..m} (1 - p_(i))` (survival to the next bank), `Delta_m = m*k + m(m+1)/2`
 * (added streak value from m more pushes atop a streak already `k` long), `U(m) = S_m * (V +
 * Delta_m)`, so `U(0) = V` exactly (bank now).
 */
export function scanPlanValues(sortedP: readonly number[], streakLen: number, streakValue: number): PlanValue[] {
  const R = sortedP.length;
  const results: PlanValue[] = new Array(R + 1);
  let survival = 1;
  results[0] = { m: 0, survival, value: streakValue };
  for (let m = 1; m <= R; m++) {
    survival *= 1 - sortedP[m - 1]!;
    const delta = m * streakLen + (m * (m + 1)) / 2;
    results[m] = { m, survival, value: survival * (streakValue + delta) };
  }
  return results;
}

/** argmax U(m), ties broken toward the SMALLEST m — the more conservative plan. §2 does not
 *  specify a tie-break; preferring to push less on an exact tie is the reading consistent with
 *  "replan every ply" costing nothing to reconsider on the very next decision. Scans the whole
 *  array unconditionally (no early exit), matching scanPlanValues's own no-shortcut discipline. */
export function bestPlan(plans: readonly PlanValue[]): PlanValue {
  let best = plans[0]!;
  for (const p of plans) {
    if (p.value > best.value) best = p;
  }
  return best;
}

/** Every unrevealed cell's posterior, sorted ascending by probability then by cell index (a
 *  provably-safe cell always carries p=0 in `analyzeFrontier`'s own posterior map, so it sorts
 *  first without a separate branch here — §2: "proven-safe cells have p = 0 and come first").
 *  Tie-break on cell index matches `chooseSafeMove`'s own convention (probes.ts), for
 *  determinism. */
function sortedPosteriorCells(risk: RiskEstimate): number[] {
  return [...risk.posterior.entries()]
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]))
    .map(([cell]) => cell);
}

/**
 * §2's decision function: plan "push m more times, then bank" for every `0 <= m <= R`
 * (`R = min(revealsLeft, candidate count)` — the model prices one candidate cell consumed per
 * hypothetical push; it does not model a flood's multi-cell-per-move gain, a documented,
 * conservative approximation per §2), act on the argmax. Bank if `m* = 0`; else reveal the
 * lowest-posterior candidate (the plan's own `p_(1)` cell), carrying the streak — replanned
 * fresh next ply, never committing to the rest of the hypothetical plan. R8 (engine.ts)
 * auto-banks any live streak at a terminal state, so `m* = R` needs no explicit bank move here —
 * returning the reveal is correct at the horizon edge too.
 *
 * Bank is illegal at streak 0 (engine.ts's `isLegalMove`); `m* = 0` can only be optimal at
 * streak 0 on an exact tie (U(0)=0 against a guaranteed-mine candidate's U(1)=0 — see
 * risk-policy.test.ts), so the fallback below reveals the best candidate anyway, exactly like
 * `chooseSafeMove`'s own "streak-0 free probe" branch.
 */
export function chooseRiskAwareMove(view: MineRunView, opts: ChooseRiskAwareMoveOptions = {}): MineRunMove {
  const riskSource = opts.riskSource ?? analyzeFrontier;
  const risk = riskSource(view);
  const sortedCells = sortedPosteriorCells(risk);
  if (sortedCells.length === 0) {
    throw new Error(
      "chooseRiskAwareMove: no posterior candidate cell — should never happen for an ongoing, reachable state."
    );
  }
  const R = Math.min(view.revealsLeft, sortedCells.length);
  const sortedP = sortedCells.slice(0, R).map((c) => risk.posterior.get(c)!);

  const plans = scanPlanValues(sortedP, view.streakLen, view.streakValue);
  const best = bestPlan(plans);

  if (best.m === 0 && view.streakLen >= 1) {
    return { t: "bank" };
  }
  return { t: "reveal", cell: sortedCells[0]! };
}

/** `SafeMoveFn`-shaped export (packages/harness/src/agents.ts's `SafeMoveFn<M, V> = (view: V) =>
 *  M`) — matched structurally, not imported (see this module's own doc). Wires the default Tier
 *  B risk source. */
export function riskAwareMove(view: MineRunView): MineRunMove {
  return chooseRiskAwareMove(view);
}

/** `MoveSelector`-shaped adapter (packages/bots/src/search-utils.ts's `MoveSelector<S, M> =
 *  (engine, state, player, legal, rng) => M`) — matched structurally, not imported (see this
 *  module's own doc). C1's own rule for a rollout adapter: `state` here may be a
 *  `sampleConsistentState`-sampled hypothetical world, never the true secret (MoveSelector's own
 *  contract) — this derives its view via `engine.playerView(state, player)` and never reads
 *  `state` any other way, so the decision stays honest regardless of which world produced it.
 *  `legal`/`rng` are unused: `chooseRiskAwareMove` derives its own candidates from the view/risk
 *  analysis and is a pure deterministic function, exactly like `chooseSafeMove` before it. */
export function riskAwareRolloutSelector(
  engine: GameEngine<MineRunState, MineRunMove, MineRunView>,
  state: MineRunState,
  player: PlayerId,
  _legal: readonly MineRunMove[],
  _rng: Rng
): MineRunMove {
  const view = engine.playerView(state, player);
  return chooseRiskAwareMove(view);
}

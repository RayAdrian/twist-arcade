// games/mine-run/test/risk-policy.test.ts
//
// TDD anchors (docs/plans/mine-run-risk-aware-policy.md §2/§7, coordinator's S1 ruling,
// platform-corrections.md C39):
//   1. known-answer U(m) positions, checked against an INDEPENDENTLY re-derived uniform-p
//      closed form (S_m=(1-p)^m, delta_m=m*k+m(m+1)/2, U(m)=S_m*(V+delta_m)) — not copy-pasted
//      from the implementation.
//   2. the full-m scan makes NO unimodality assumption — proven with an adversarial (real
//      posteriors are always sorted ascending; this is deliberately NOT) input where a "stop at
//      the first decrease" shortcut would report the wrong argmax, to prove the scan has no
//      such shortcut. scanPlanValues/bestPlan are pure numeric functions with no invariant
//      enforced on their input beyond being finite numbers, so this is a legitimate stress test
//      of the implementation, not a claim about what real posteriors look like.
//   3. chooseRiskAwareMove's decision wrapping (bank vs reveal, m*=0 at streak 0 falling back to
//      a free probe since bank is illegal there) is tested against a stub risk source, mirroring
//      probes.test.ts's chooseSafeMove convention: the ORDERING logic is proven independent of
//      analyzeFrontier's own correctness (csp.test.ts owns that).
//   4. a real end-to-end check against the default Tier B risk source (analyzeFrontier), reusing
//      probes.test.ts's oracle-verified "1-2-1" board.
// View-honesty (resampled worlds agree) is NOT here — it extends view-honesty.test.ts directly,
// reusing that file's own established fixture/helper conventions.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { countAdjacentMines } from "../board";
import { createMineRun } from "../engine";
import type { MineRunCellView, MineRunView } from "../engine";
import {
  bestPlan,
  chooseRiskAwareMove,
  riskAwareMove,
  riskAwareRolloutSelector,
  scanPlanValues,
  type RiskEstimate,
} from "../risk-policy";

function makeView(
  width: number,
  height: number,
  revealed: Map<number, number>,
  minesTotal: number,
  overrides: Partial<MineRunView> = {}
): MineRunView {
  const cells: Record<number, MineRunCellView> = {};
  for (const [cell, n] of revealed) cells[cell] = { n };
  return {
    width,
    height,
    cells,
    minesTotal,
    minesExploded: 0,
    streakLen: 0,
    streakValue: 0,
    nextGain: 1,
    banked: 0,
    revealsLeft: 50,
    lastEffects: [],
    ...overrides,
  };
}

function risk(overrides: Partial<RiskEstimate>): RiskEstimate {
  return {
    provablySafe: new Set(),
    posterior: new Map(),
    ...overrides,
  };
}

// Independent re-derivation of §2's closed form for uniform p across every candidate — NOT
// derived from scanPlanValues's own source, so a match is a genuine cross-check.
function closedFormUniformP(p: number, R: number, streakLen: number, streakValue: number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= R; m++) {
    const survival = Math.pow(1 - p, m);
    const delta = m * streakLen + (m * (m + 1)) / 2;
    out.push(survival * (streakValue + delta));
  }
  return out;
}

describe("scanPlanValues — U(m) scan (§2)", () => {
  it("matches the independently re-derived uniform-p closed form", () => {
    const p = 0.1;
    const R = 5;
    const streakLen = 3;
    const streakValue = 6; // triangular(3)
    const sortedP = Array.from({ length: R }, () => p);
    const plans = scanPlanValues(sortedP, streakLen, streakValue);
    const expected = closedFormUniformP(p, R, streakLen, streakValue);

    expect(plans).toHaveLength(R + 1);
    for (let m = 0; m <= R; m++) {
      expect(plans[m]!.m).toBe(m);
      expect(plans[m]!.value).toBeCloseTo(expected[m]!, 10);
    }
  });

  it("U(0) always equals streakValue (bank-now value), regardless of R", () => {
    const plans = scanPlanValues([0.2, 0.4, 0.9], 4, 10);
    expect(plans[0]!.m).toBe(0);
    expect(plans[0]!.survival).toBe(1);
    expect(plans[0]!.value).toBe(10);
  });

  it("returns exactly R+1 entries for R=0 (no candidates to push into)", () => {
    const plans = scanPlanValues([], 0, 0);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ m: 0, survival: 1, value: 0 });
  });

  it("scans every m unconditionally — no unimodality shortcut (adversarial, deliberately non-ascending input)", () => {
    // p = [0.05, 0.5, 0, 0], streakLen=0, streakValue=5. Hand-computed:
    //   U(0)=5, U(1)=5.7, U(2)=3.8 (DIP below both U(0) and U(1)), U(3)=5.225, U(4)=7.125 (NEW
    //   global max, at the far end, only reached after the dip). A "stop scanning once U starts
    //   decreasing" shortcut would report m=1 (5.7) and never see m=4 (7.125).
    const sortedP = [0.05, 0.5, 0, 0];
    const plans = scanPlanValues(sortedP, 0, 5);
    const values = plans.map((p) => p.value);
    expect(values[0]!).toBeCloseTo(5, 10);
    expect(values[1]!).toBeCloseTo(5.7, 10);
    expect(values[2]!).toBeCloseTo(3.8, 10); // the dip
    expect(values[2]!).toBeLessThan(values[0]!);
    expect(values[2]!).toBeLessThan(values[1]!);
    expect(values[3]!).toBeCloseTo(5.225, 10);
    expect(values[4]!).toBeCloseTo(7.125, 10); // the true max, past the dip

    const best = bestPlan(plans);
    expect(best.m).toBe(4);
    expect(best.value).toBeCloseTo(7.125, 10);
  });
});

describe("bestPlan — argmax with smallest-m tie-break", () => {
  it("returns the single maximum when there is no tie", () => {
    const plans = scanPlanValues([0.1, 0], 0, 10);
    const best = bestPlan(plans);
    expect(best.m).toBe(2);
  });

  it("breaks an EXACT tie toward the smaller m", () => {
    // V=10, k=0, p1 chosen so U(1) === U(0) exactly: 10 = (1-p1)*(10+1) => p1 = 1/11.
    const p1 = 1 / 11;
    const plans = scanPlanValues([p1], 0, 10);
    expect(plans[0]!.value).toBeCloseTo(plans[1]!.value, 10); // confirm the tie is real
    const best = bestPlan(plans);
    expect(best.m).toBe(0); // smaller of the tied m's
  });
});

describe("chooseRiskAwareMove — decision wrapping (pure, given a stub risk source)", () => {
  it("banks when the best plan is m=0 and the streak is >= 1", () => {
    const view = makeView(10, 10, new Map(), 5, { streakLen: 3, streakValue: 6, revealsLeft: 50 });
    // High-risk single candidate makes pushing strictly worse than banking now.
    const a = risk({ posterior: new Map([[42, 0.9]]) });
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "bank" });
  });

  it("reveals the best-probe cell when the best plan is m=0 but the streak is 0 (bank is illegal there)", () => {
    // At streakLen=0, streakValue is always 0, so U(0)=0. For ANY p<1, U(1)=S_1*Delta_1>0 >
    // U(0) — pushing is always at least as good as banking nothing. The only way m*=0 is
    // actually optimal here is a guaranteed-mine candidate (p=1 exactly), which ties U(1)=0
    // against U(0)=0; ties break toward the smaller m, giving m*=0. Since bank is illegal at
    // streak 0, the defensive fallback reveals the best (here, only) candidate anyway.
    const view = makeView(10, 10, new Map(), 5, { streakLen: 0, streakValue: 0, revealsLeft: 50 });
    const a = risk({ posterior: new Map([[42, 1.0]]) });
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "reveal", cell: 42 });
  });

  it("reveals the lowest-posterior cell when the best plan pushes (m* > 0)", () => {
    const view = makeView(10, 10, new Map(), 5, { streakLen: 0, streakValue: 0, revealsLeft: 50 });
    const a = risk({
      posterior: new Map([
        [3, 0.4],
        [7, 0.02],
        [50, 0.5],
      ]),
    });
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "reveal", cell: 7 });
  });

  it("ties in minimum posterior break on the lowest cell index", () => {
    const view = makeView(10, 10, new Map(), 5, { streakLen: 0, streakValue: 0, revealsLeft: 50 });
    const a = risk({
      posterior: new Map([
        [40, 0.02],
        [12, 0.02],
        [77, 0.9],
      ]),
    });
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "reveal", cell: 12 });
  });

  it("a provably-safe (p=0) cell sorts first and is pushed into freely", () => {
    const view = makeView(10, 10, new Map(), 5, { streakLen: 5, streakValue: 15, revealsLeft: 50 });
    const a = risk({
      provablySafe: new Set([9]),
      posterior: new Map([
        [9, 0],
        [42, 0.8],
      ]),
    });
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "reveal", cell: 9 });
  });

  it("caps the plan horizon at revealsLeft, never planning past the real budget", () => {
    // Only 1 reveal left; even though 3 candidates exist, R must be capped at 1.
    const view = makeView(10, 10, new Map(), 5, { streakLen: 0, streakValue: 0, revealsLeft: 1 });
    const a = risk({
      posterior: new Map([
        [1, 0.01],
        [2, 0.01],
        [3, 0.01],
      ]),
    });
    // Should not throw and should return a legal-shaped reveal of the best candidate.
    const move = chooseRiskAwareMove(view, { riskSource: () => a });
    expect(move).toEqual({ t: "reveal", cell: 1 });
  });
});

describe("chooseRiskAwareMove / riskAwareMove — end-to-end with the default Tier B risk source (analyzeFrontier)", () => {
  it("reveals the provably-safe cell on the oracle-verified 1-2-1 board (probes.test.ts's fixture)", () => {
    const width = 3;
    const height = 2;
    const mines = new Set([3, 5]);
    const revealed = new Map<number, number>([
      [0, countAdjacentMines(0, mines, width, height)],
      [1, countAdjacentMines(1, mines, width, height)],
      [2, countAdjacentMines(2, mines, width, height)],
    ]);
    const view = makeView(width, height, revealed, mines.size);
    expect(riskAwareMove(view)).toEqual({ t: "reveal", cell: 4 });
    expect(chooseRiskAwareMove(view)).toEqual({ t: "reveal", cell: 4 });
  });
});

describe("riskAwareRolloutSelector — MoveSelector-shaped adapter (C1: derives its view, never reads state.mines)", () => {
  it("agrees with calling chooseRiskAwareMove on engine.playerView(state, 0) directly", () => {
    const engine = createMineRun({ width: 8, height: 8, mines: 10, budget: 30 });
    const state = engine.setup(1, rngForSetup("risk-policy-adapter"));
    const legal = engine.legalMoves(state, 0);
    const rng = rngFor("risk-policy-adapter", 0);
    const viaAdapter = riskAwareRolloutSelector(engine, state, 0, legal, rng);
    const viaDirect = chooseRiskAwareMove(engine.playerView(state, 0));
    expect(viaAdapter).toEqual(viaDirect);
  });
});

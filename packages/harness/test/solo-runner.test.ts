// packages/harness/test/solo-runner.test.ts — verifies the WIP solo-runner.ts (committed at
// 1003679, never previously exercised by any test) actually does what its own doc comments
// claim: plays a full solo run to a terminal or the move cap, reports the right `terminal`
// tag, and gives every policy in a suite run the IDENTICAL paired seed set.

import { describe, expect, it } from "vitest";
import { randomPolicy } from "@twist-arcade/bots";
import { createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { miniCrackstep } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { createMineRun } from "@twist-arcade/mine-run";
import type { MineRunMove, MineRunState } from "@twist-arcade/mine-run";
import { buildAgent, type SoloAgent } from "../src/agents";
import { pairedSeeds, playSoloRun, runSoloAgentOverSeeds, UnwrappedAgentOnHiddenInformationEngineError } from "../src/solo-runner";

describe("pairedSeeds", () => {
  it("returns the same n seeds, in the same order, every call (the paired-seed-set contract)", () => {
    const a = pairedSeeds("suite", 5);
    const b = pairedSeeds("suite", 5);
    expect(a).toEqual(b);
    expect(a).toEqual(["suite-0", "suite-1", "suite-2", "suite-3", "suite-4"]);
  });

  it("different prefixes never collide", () => {
    const a = pairedSeeds("random", 3);
    const b = pairedSeeds("strong", 3);
    expect(a).not.toEqual(b);
  });
});

describe("playSoloRun — bank-run (a scored, perfect-info, stochastic fixture)", () => {
  const engine = createBankRun({ successProb: 0.6 });
  const agent = buildAgent(engine, randomPolicy(), "random");

  it("reaches a scored terminal within the round cap (6 rounds) — never cap-hits at 2000", () => {
    const result = playSoloRun(engine, agent, "bank-run-seed-1");
    expect(result.terminal).toBe("scored");
    expect(result.capHit).toBe(false);
    expect(result.decisions).toBeLessThanOrEqual(6);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic: the same seed and agent replay to the identical outcome", () => {
    const a = playSoloRun(engine, agent, "bank-run-determinism-seed");
    const b = playSoloRun(engine, agent, "bank-run-determinism-seed");
    expect(a.finalScore).toBe(b.finalScore);
    expect(a.decisions).toBe(b.decisions);
    expect(a.moveLog).toEqual(b.moveLog);
  });

  it("respects an explicit moveCap by forcing a cap-hit terminal on an artificially tiny cap", () => {
    // bank-run's own round cap is 6, so a moveCap of 2 forces the harness's own cap to bind
    // first — proving playSoloRun's moveCap (not just the game's structural cap) is live.
    const result = playSoloRun(engine, agent, "bank-run-tiny-cap-seed", { moveCap: 2 });
    expect(result.decisions).toBe(2);
    expect(result.terminal).toBe("cap-hit");
    expect(result.capHit).toBe(true);
  });
});

describe("playSoloRun — mini-crackstep (a won/lost, deterministic puzzle fixture)", () => {
  const agent = buildAgent(miniCrackstep, randomPolicy(), "random");

  it("terminates won or lost within the 3x3 grid's structural bound (8 moves)", () => {
    for (let i = 0; i < 20; i++) {
      const result = playSoloRun(miniCrackstep, agent, `crackstep-seed-${i}`, { moveCap: 8 });
      expect(["won", "lost"]).toContain(result.terminal);
      expect(result.capHit).toBe(false);
      expect(result.decisions).toBeLessThanOrEqual(8);
    }
  });
});

describe("playSoloRun — C1 runtime guard at the solo-runner seam (SHOULD FIX item 5)", () => {
  // `playSoloRun` hands its `state: S` argument to `agent.chooseMove` verbatim, regardless of
  // `engine.meta.hiddenInformation` — the C1 wall (never let a policy touch a hidden-info
  // engine's canonical state) exists only INSIDE buildAgent/buildViewPolicyAgent/
  // buildSafeMoveAgent, one wrapper away from here. A hand-rolled `SoloAgent` that bypasses
  // those and reads the real state directly runs silently, exactly the hole class already
  // found and fixed at the two-player runMatchup seam (main branch, runner.ts's own
  // `HiddenInformationUnsupportedError` — reproduced here for the solo runner instead, which
  // (unlike the two-player runner) DOES support hidden-info games via the sanctioned
  // wrappers, so the fix here is a `viewHonest` brand check, not a blanket refusal).
  it("throws BEFORE playing a single decision when handed an agent that isn't viewHonest, against a real hidden-information engine (Mine Run)", () => {
    const engine = createMineRun({ width: 4, height: 4, mines: 2, budget: 16 });
    // A genuine C1 violation: reads the canonical state's secret (`state.mines`) directly,
    // never `engine.playerView(state, player)`. Cast through `unknown` — `viewHonest: true`
    // is a required literal on the real interface precisely so this can't be constructed by
    // accident; only buildAgent/buildViewPolicyAgent/buildSafeMoveAgent are meant to set it.
    const cheatAgent = {
      name: "cheater",
      viewHonest: false,
      chooseMove({ state }: { state: MineRunState }) {
        const firstMineCell = state.mines[0]!;
        return {
          move: { t: "reveal", cell: firstMineCell } as unknown as MineRunMove,
          stats: { elapsedMs: 0, rollouts: 0 },
        };
      },
    } as unknown as SoloAgent<MineRunState, MineRunMove>;

    expect(() => playSoloRun(engine, cheatAgent, "solo-runner-c1-cheater-seed")).toThrow(/viewHonest/);
    try {
      playSoloRun(engine, cheatAgent, "solo-runner-c1-cheater-seed");
      expect.unreachable("playSoloRun should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnwrappedAgentOnHiddenInformationEngineError);
    }
  });

  it("does NOT throw for a properly-built (viewHonest) agent against the same hidden-information engine", () => {
    const engine = createMineRun({ width: 4, height: 4, mines: 2, budget: 16 });
    const agent = buildAgent(engine, randomPolicy<MineRunState, MineRunMove>(), "random");
    expect(() => playSoloRun(engine, agent, "solo-runner-c1-honest-seed")).not.toThrow();
  });

  it("does NOT throw for an unmarked agent against a perfect-information engine (the guard is gated on hiddenInformation, never a blanket requirement)", () => {
    const engine = createBankRun({ successProb: 0.6 });
    const notMarkedHonest = {
      name: "whatever",
      chooseMove: () => ({ move: { kind: "push" }, stats: { elapsedMs: 0, rollouts: 0 } }),
    } as unknown as SoloAgent<BankRunState, BankRunMove>;
    expect(() => playSoloRun(engine, notMarkedHonest, "solo-runner-perfect-info-seed")).not.toThrow();
  });
});

describe("runSoloAgentOverSeeds", () => {
  const engine = createBankRun({ successProb: 0.6 });
  const agent = buildAgent(engine, randomPolicy(), "random");

  it("runs one result per seed, preserving order, and aggregates scores/decisions/capHitRate", () => {
    const seeds = pairedSeeds("agg", 10);
    const summary = runSoloAgentOverSeeds(engine, agent, seeds);
    expect(summary.name).toBe("random");
    expect(summary.runs).toHaveLength(10);
    expect(summary.runs.map((r) => r.seed)).toEqual(seeds);
    expect(summary.scores).toHaveLength(10);
    expect(summary.decisionsList).toHaveLength(10);
    expect(summary.capHitRate).toBe(0); // bank-run's round cap always binds first
  });

  it("gives two independently-built agents on the SAME engine the identical seed set (paired seeds)", () => {
    const seeds = pairedSeeds("paired-check", 20);
    const r1 = runSoloAgentOverSeeds(engine, buildAgent(engine, randomPolicy(), "random-a"), seeds);
    const r2 = runSoloAgentOverSeeds(engine, buildAgent(engine, randomPolicy(), "random-b"), seeds);
    expect(r1.runs.map((r) => r.seed)).toEqual(r2.runs.map((r) => r.seed));
  });
});

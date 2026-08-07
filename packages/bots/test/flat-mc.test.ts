import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import {
  bankRun,
  createBankRun,
  type BankRunMove,
  type BankRunState,
} from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { flatMonteCarloPolicy } from "../src/flat-mc";
import { randomPolicy } from "../src/random";
import { greedyMoveSelector, HorizonValueUndeclaredError } from "../src/search-utils";
import { fakeClock } from "./helpers";

/** Plays one full bank-run game with `policy` deciding every move, returns the final score
 *  (== banked, per the fixture's own score()/terminal invariant). */
function playOneGame(policy: { chooseMove: ReturnType<typeof flatMonteCarloPolicy<BankRunState, BankRunMove>>["chooseMove"] }, seed: string): number {
  const engine = bankRun;
  let state = engine.setup(1, rngFromSeed(`${seed}:setup`));
  const decisionRng = rngFromSeed(`${seed}:decision`);
  for (let round = 0; round < 10; round++) {
    const status = engine.status(state);
    if (status.kind !== "ongoing") break;
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: decisionRng,
      budget: { kind: "rollouts", n: 64 },
      clock: fakeClock(),
    });
    state = engine.apply(state, new Map([[0, move]]), rngFromSeed(`${seed}:step-${round}`));
  }
  const finalStatus = engine.status(state);
  if (finalStatus.kind !== "scored") throw new Error(`unexpected terminal: ${JSON.stringify(finalStatus)}`);
  return finalStatus.scores[0]!;
}

describe("flatMonteCarloPolicy", () => {
  it("always returns a legal move on bank-run", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 8 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("flat-mc-legal"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-legal-decision"),
      budget: { kind: "rollouts", n: 32 },
      clock: fakeClock(),
    });
    const legal = engine.legalMoves(state, 0);
    expect(legal.some((m) => m.kind === move.kind)).toBe(true);
  });

  it("beats random by a reproducible fixed-seed margin on bank-run (DoD §13 anchor)", () => {
    const flatMc = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 32 });
    const random = randomPolicy<BankRunState, BankRunMove>();
    const N = 60;
    let flatMcTotal = 0;
    let randomTotal = 0;
    for (let seed = 0; seed < N; seed++) {
      flatMcTotal += playOneGame(flatMc, `flat-mc-strong-${seed}`);
      randomTotal += playOneGame(random, `flat-mc-random-${seed}`);
    }
    const flatMcMean = flatMcTotal / N;
    const randomMean = randomTotal / N;
    expect(flatMcMean).toBeGreaterThan(randomMean);
  });

  it("same seed ⇒ identical move (determinism, rollouts budget)", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 16 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("flat-mc-det"));
    const a = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });

  it("throws a clear error when called on a terminal state", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>();
    const engine = bankRun;
    const terminalState: BankRunState = { banked: 3, streak: 0, round: 6, lastEffects: [] };
    expect(() =>
      policy.chooseMove({
        engine,
        state: terminalState,
        player: 0,
        rng: rngFromSeed("flat-mc-terminal"),
        budget: { kind: "rollouts", n: 8 },
        clock: fakeClock(),
      })
    ).toThrow(/terminal/i);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C30: "a defect that lives BETWEEN two files" — a game's engine
// (score()/heuristic(), each individually correct and individually tested) and the search's
// shared valuation helper (search-utils.ts's valueOfStatus, also individually correct and
// tested) composed into a Strong that was blind to Mine Run's entire live-streak mechanic.
// Every single-file property passed throughout (strong-vs-random, view-honesty, score()'s own
// coherence check) — only the fully-composed policy, exercised at a genuine horizon-capped
// leaf, could show the failure, and even THAT took a multi-hour real-board run to notice
// (C27/C29) before the root cause was found by reading code (C30).
//
// This suite is the fixture-scale, millisecond version of that exact real-board experiment:
// same engine shape as Mine Run (score() == "banked only", heuristic() == "banked + live
// streak"), same rollout selector Mine Run's real Strong uses (greedyMoveSelector — this is
// not a stand-in shape, it is the identical `rolloutMoveSelector` resolveStrongPolicy/
// buildSoloRoster pass to flatMonteCarloPolicy/determinizedFlatMonteCarloPolicy in
// packages/harness/src/agents.ts), and the SAME shared valueOfStatus every real search
// algorithm calls — routed through the real, exported `flatMonteCarloPolicy` entry point
// (never a hand-rolled reimplementation of the search), with rolloutCapPlies forced below the
// fixture's own terminal so a real horizon-capped "ongoing" leaf is unavoidable, exactly as
// C27 measured happens on nearly every real Mine Run game (38-60 decisions against a 60-ply
// cap). If a future game repeats this shape (score() blind to some component heuristic()
// values), THIS suite — not a unit test of either hook alone — is what would catch it, because
// it asserts on the policy's ACTUAL move choice, not on either function's return value in
// isolation.
describe("flatMonteCarloPolicy at a horizon-capped leaf, engine with BOTH score() and heuristic() (platform-corrections.md C30 seam test)", () => {
  // banked=0, streak=2 already built (3 real pushes happened before this decision point, but
  // only the resulting state matters) — the state a press-your-luck decision is actually about:
  // "bank 2 now, or risk it to grow the streak further". plantFarmingLoop removes bust risk so
  // the objectively correct answer is unambiguous and stable across seeds: push.
  const midStreakState: BankRunState = { banked: 0, streak: 2, round: 3, lastEffects: [] };

  function makeEngine(horizonValue?: "score" | "heuristic") {
    const base = createBankRun({ plantFarmingLoop: true });
    return horizonValue === undefined
      ? { ...base, heuristic: (s: BankRunState, _p: 0) => s.banked + s.streak }
      : { ...base, heuristic: (s: BankRunState, _p: 0) => s.banked + s.streak, horizonValue };
  }

  // rolloutCapPlies=1: from EITHER root candidate's resulting state (round=4), one more greedy
  // ply lands at round=5 — still `ongoing` (bank-run's terminal is round>=6) — so every rollout
  // leaf this test measures is a genuine horizon-capped "ongoing" value, never a terminal.
  const ROLLOUT_CAP_PLIES = 1;
  // legal.length===2 (push/bank) and budget.n===2 ⇒ perActionRollouts=1 — deterministic, no
  // averaging noise to obscure which single leaf value drove the decision.
  const budget = { kind: "rollouts" as const, n: 2 };

  it("PLANTED VIOLATION: throws HorizonValueUndeclaredError the moment a rollout actually reaches the ambiguous horizon leaf — the exact seam C30 found silently mis-resolved before this fix", () => {
    const engine = makeEngine(undefined);
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({
      rolloutCapPlies: ROLLOUT_CAP_PLIES,
      rolloutMoveSelector: greedyMoveSelector,
    });
    expect(() =>
      policy.chooseMove({
        engine,
        state: midStreakState,
        player: 0,
        rng: rngFromSeed("c30-seam-undeclared"),
        budget,
        clock: fakeClock(),
      })
    ).toThrow(HorizonValueUndeclaredError);
  });

  it("horizonValue: 'score' reproduces C30's exact historical failure mode — the policy picks 'bank', forfeiting the compounding streak, because the horizon leaf can only see banked", () => {
    const engine = makeEngine("score");
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({
      rolloutCapPlies: ROLLOUT_CAP_PLIES,
      rolloutMoveSelector: greedyMoveSelector,
    });
    const { move } = policy.chooseMove({
      engine,
      state: midStreakState,
      player: 0,
      rng: rngFromSeed("c30-seam-score"),
      budget,
      clock: fakeClock(),
    });
    // Traced: push's horizon leaf is banked=0 (streak never gets banked along this branch);
    // bank's horizon leaf is banked=2 (the 2-streak just realized). score()-only ranks
    // bank(2) > push(0) — the wrong answer under zero bust risk, and precisely C29's real-board
    // symptom (more search, or any search, favoring the immediately-realized value).
    expect(move.kind).toBe("bank");
  });

  it("horizonValue: 'heuristic' — the C30 FIX — the SAME policy, SAME rollout selector, SAME horizon cap now picks 'push': the objectively correct move under zero bust risk", () => {
    const engine = makeEngine("heuristic");
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({
      rolloutCapPlies: ROLLOUT_CAP_PLIES,
      rolloutMoveSelector: greedyMoveSelector,
    });
    const { move } = policy.chooseMove({
      engine,
      state: midStreakState,
      player: 0,
      rng: rngFromSeed("c30-seam-heuristic"),
      budget,
      clock: fakeClock(),
    });
    // Traced: push's horizon leaf heuristic (banked+streak) is 0+4=4; bank's is 2+1=3. Used RAW
    // (this engine has score(), so valueOfStatus keeps the "scored"-terminal commensurate raw
    // scale — see search-utils.ts's valueOfStatus) — 4 > 3, so push correctly wins. Nothing
    // about flatMonteCarloPolicy, greedyMoveSelector, or the rollout mechanics changed between
    // this test and the one above: the ONLY difference is which value the engine declared for
    // the horizon, and that alone flips the shipped policy's actual decision.
    expect(move.kind).toBe("push");
  });
});

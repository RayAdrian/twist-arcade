// packages/bots/test/determinized-flat-mc.test.ts — TDD coverage for the literal hidden-
// information Strong mechanism (mine-run.md §4.4, platform-corrections.md C6). The property
// that actually matters and that `determinize(flatMonteCarloPolicy())` gets wrong for this
// shape: EACH CANDIDATE MOVE is averaged over its OWN fresh world samples, not majority-voted
// via full per-world re-searches — see "true per-candidate averaging" below for the concrete
// case where the two approaches disagree.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { tinyFog, type TinyFogMove, type TinyFogState, type TinyFogView } from "./fixtures/tiny-fog";
import { deriveView } from "../src/policy";
import { MissingSampleConsistentStateError } from "../src/policy";
import {
  DeterminizedFlatMonteCarloTerminalStateError,
  determinizedFlatMonteCarloPolicy,
} from "../src/determinized-flat-mc";
import { greedyMoveSelector } from "../src/search-utils";
import { fakeClock } from "./helpers";

describe("determinizedFlatMonteCarloPolicy: basics", () => {
  it("throws MissingSampleConsistentStateError when the engine has no sampleConsistentState", () => {
    // Can't spread `{ sampleConsistentState: undefined }` — exactOptionalPropertyTypes treats a
    // present-but-undefined property differently from an absent one. Destructure it away
    // instead (same convention search-utils.test.ts uses for `heuristic`).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sampleConsistentState: _unusedSampleConsistentState, ...engine } = tinyFog;
    const policy = determinizedFlatMonteCarloPolicy<TinyFogState, TinyFogMove, TinyFogView>();
    const view = deriveView(engine, tinyFog.setup(1, rngFromSeed("x")), 0);
    expect(() =>
      policy.chooseMove({
        engine,
        view,
        player: 0,
        rng: rngFromSeed("x:decision"),
        budget: { kind: "rollouts", n: 8 },
        clock: fakeClock(),
      })
    ).toThrow(MissingSampleConsistentStateError);
  });

  it("throws a typed terminal-state error when the sampled reference world is already terminal", () => {
    const policy = determinizedFlatMonteCarloPolicy<TinyFogState, TinyFogMove, TinyFogView>();
    const resolvedState: TinyFogState = { secret: 0, resolved: true, won: true, lastEffects: [] };
    expect(() =>
      policy.chooseMove({
        engine: tinyFog,
        view: deriveView(tinyFog, resolvedState, 0),
        player: 0,
        rng: rngFromSeed("terminal-decision"),
        budget: { kind: "rollouts", n: 8 },
        clock: fakeClock(),
      })
    ).toThrow(DeterminizedFlatMonteCarloTerminalStateError);
  });

  it("always returns a legal move", () => {
    const policy = determinizedFlatMonteCarloPolicy<TinyFogState, TinyFogMove, TinyFogView>();
    const state = tinyFog.setup(1, rngFromSeed("legal-seed"));
    const view = deriveView(tinyFog, state, 0);
    const { move } = policy.chooseMove({
      engine: tinyFog,
      view,
      player: 0,
      rng: rngFromSeed("legal-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    expect(tinyFog.legalMoves(state, 0).some((m) => m.guess === move.guess)).toBe(true);
  });

  it("same seed ⇒ identical move (determinism, rollouts budget)", () => {
    const policy = determinizedFlatMonteCarloPolicy<TinyFogState, TinyFogMove, TinyFogView>();
    const state = tinyFog.setup(1, rngFromSeed("det-seed"));
    const view = deriveView(tinyFog, state, 0);
    const a = policy.chooseMove({
      engine: tinyFog,
      view,
      player: 0,
      rng: rngFromSeed("det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine: tinyFog,
      view,
      player: 0,
      rng: rngFromSeed("det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });
});

describe("determinizedFlatMonteCarloPolicy: true per-candidate averaging (the C6 close-out property)", () => {
  // A stub hidden-info, 2-candidate-move engine whose `sampleConsistentState` draws from a
  // shared, deterministically-cycling sequence of 4 "world types" (0..3). Move A's payoff is
  // [10, 10, 10, -100] across those 4 types; move B's is [1, 1, 1, 1] flat. A's TRUE average
  // (-17.5) is far worse than B's (1) — but if each candidate were instead evaluated against
  // only ONE shared world per "vote" and the votes were majority-counted (the shape
  // `determinize(flatMonteCarloPolicy())` has), 3 of the 4 worlds prefer A (10 > 1) and only 1
  // prefers B, so a majority-vote architecture picks the WRONG move (A). This engine exists to
  // prove `determinizedFlatMonteCarloPolicy` picks B — i.e. that it truly averages per
  // candidate over its OWN fresh samples, not per-world votes.
  interface BanditState extends WithEffects {
    readonly resolved: boolean;
    readonly payoff: number;
  }
  interface BanditMove {
    readonly arm: "A" | "B";
    readonly [key: string]: Json;
  }
  const payoffs: Record<"A" | "B", number[]> = { A: [10, 10, 10, -100], B: [1, 1, 1, 1] };

  function makeBanditEngine(): { engine: GameEngine<BanditState, BanditMove, BanditState>; drawCount: () => number } {
    let counter = 0;
    const engine: GameEngine<BanditState, BanditMove, BanditState> = {
      meta: {
        id: "bandit-fixture",
        name: "Bandit (bots test fixture)",
        minPlayers: 1,
        maxPlayers: 1,
        hiddenInformation: true,
        simultaneous: false,
        stochastic: false,
        version: 1,
      },
      setup(_n: number, _rng: Rng): BanditState {
        return { resolved: false, payoff: 0, lastEffects: [] };
      },
      legalMoves(state, player: PlayerId): BanditMove[] {
        if (player !== 0 || state.resolved) return [];
        return [{ arm: "A" }, { arm: "B" }];
      },
      isLegal(state, player, move): boolean {
        if (player !== 0 || state.resolved) return false;
        return move.arm === "A" || move.arm === "B";
      },
      active(_state): ActiveSpec {
        return { mode: "sequential", player: 0 };
      },
      apply(state, moves, _rng): BanditState {
        const move = moves.get(0);
        if (!move) throw new Error("bandit: apply() called without a move");
        const type = counter % 4;
        counter += 1;
        const effects: Effect[] = [{ type: "revealed", arm: move.arm, worldType: type }];
        return { resolved: true, payoff: payoffs[move.arm]![type]!, lastEffects: effects };
      },
      status(state): Status {
        if (!state.resolved) return { kind: "ongoing" };
        return { kind: "scored", scores: [state.payoff] };
      },
      playerView(state, _player): BanditState {
        return state;
      },
      encode(state): string {
        return JSON.stringify({ resolved: state.resolved, payoff: state.payoff });
      },
      decode(encoded): BanditState {
        const parsed = JSON.parse(encoded) as { resolved: boolean; payoff: number };
        return { resolved: parsed.resolved, payoff: parsed.payoff, lastEffects: [] };
      },
      score(state, _player): number {
        return state.payoff;
      },
      sampleConsistentState(_view: BanditState, _rng: Rng): BanditState {
        // Every "world" consistent with the (uninformative) view is just a fresh, unresolved
        // starting state — the cycling `counter` lives in `apply()`, driven by DRAW ORDER
        // (mirroring how a real sampleConsistentState + apply pair would resolve a hidden
        // world's specific outcome only once the candidate is actually applied to it).
        return { resolved: false, payoff: 0, lastEffects: [] };
      },
    };
    return { engine, drawCount: () => counter };
  }

  it("picks the candidate with the higher TRUE per-candidate average, not the per-world majority", () => {
    const { engine } = makeBanditEngine();
    const policy = determinizedFlatMonteCarloPolicy<BanditState, BanditMove, BanditState>({ samplesPerCandidate: 4 });
    const state = engine.setup(1, rngFromSeed("bandit-setup"));
    const view = deriveView(engine, state, 0);
    const { move, stats } = policy.chooseMove({
      engine,
      view,
      player: 0,
      rng: rngFromSeed("bandit-decision"),
      // legal.length is 2 (A, B); a `rollouts` budget of 8 gives samplesPerCandidate = 4.
      budget: { kind: "rollouts", n: 8 },
      clock: fakeClock(),
    });
    expect(move.arm).toBe("B"); // -17.5 (A's true average) < 1 (B's true average)
    expect(stats.rollouts).toBe(8); // 2 candidates * 4 samples each, every sample resolves in 1 apply
  });
});

describe("determinizedFlatMonteCarloPolicy: rolloutMoveSelector is actually used", () => {
  // Same scenario search-utils.test.ts's greedyMoveSelector rollout test uses (bank-run +
  // plantFarmingLoop), spread with hiddenInformation:true and a trivial
  // sampleConsistentState so it can be driven through this ViewPolicy too — proves
  // `rolloutMoveSelector` is genuinely threaded into the rollout, not silently dropped.
  function makeHiddenBankRun(): GameEngine<BankRunState, BankRunMove, BankRunState> {
    const base = createBankRun({ plantFarmingLoop: true });
    return {
      ...base,
      meta: { ...base.meta, hiddenInformation: true },
      sampleConsistentState(_view: BankRunState, _rng: Rng): BankRunState {
        return base.setup(1, _rng);
      },
    };
  }

  it("a greedy rollout drives play toward the streak-preserving behavior a uniform-random rollout would not reliably show", () => {
    const engine = makeHiddenBankRun();
    const policy = determinizedFlatMonteCarloPolicy<BankRunState, BankRunMove, BankRunState>({
      samplesPerCandidate: 6,
      rolloutCapPlies: 6,
      rolloutMoveSelector: greedyMoveSelector,
    });
    const state = engine.setup(1, rngFromSeed("greedy-rollout-setup"));
    const view = deriveView(engine, state, 0);
    const { move } = policy.chooseMove({
      engine,
      view,
      player: 0,
      rng: rngFromSeed("greedy-rollout-decision"),
      budget: { kind: "rollouts", n: 12 },
      clock: fakeClock(),
    });
    // Under plantFarmingLoop (push never busts), a greedy CONTINUATION always keeps pushing
    // (mine-run.md §4.4's own framing: banking forfeits upside at zero risk) — so the averaged
    // rollout value strictly favors "push" at the very first decision over "bank" (which locks
    // in 0 immediately, since streak is 0 at the very first move).
    expect(move.kind).toBe("push");
  });
});

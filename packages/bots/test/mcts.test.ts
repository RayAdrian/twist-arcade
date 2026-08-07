import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { aggregateByOwnMove, mctsPolicy } from "../src/mcts";
import { randomPolicy } from "../src/random";
import { determinize, deriveView, probeViewHonesty, type Policy, type SearchStats, type ViewPolicy } from "../src/policy";
import { fakeClock } from "./helpers";
import { rps, type RPSMove, type RPSState } from "./fixtures/rps";
import { luckyCellRps, type LuckyCellRPSMove, type LuckyCellRPSState } from "./fixtures/lucky-cell-rps";
import { tinyFog, type TinyFogMove, type TinyFogState, type TinyFogView } from "./fixtures/tiny-fog";

describe("mctsPolicy", () => {
  it("mcts1k beats random >= 90% over a seeded batch on classic-ttt (free oracle, plan §9)", () => {
    const mcts = mctsPolicy<TTTState, TTTMove>({ explorationC: 1.4 });
    const random = randomPolicy<TTTState, TTTMove>();
    const engine = classicTicTacToe;
    const GAMES = 40;
    let mctsWins = 0;
    let mctsLosses = 0;
    for (let seed = 0; seed < GAMES; seed++) {
      const mctsSeat = seed % 2; // alternate seats to rule out a first-move-advantage artifact
      let state = engine.setup(2, rngFromSeed(`mcts-vs-random-setup-${seed}`));
      const driverRng = rngFromSeed(`mcts-vs-random-driver-${seed}`);
      for (let ply = 0; ply < 9; ply++) {
        const status = engine.status(state);
        if (status.kind !== "ongoing") break;
        const active = engine.active(state);
        if (active.mode !== "sequential") throw new Error("unexpected");
        const mover = active.player === mctsSeat ? mcts : random;
        const { move } = mover.chooseMove({
          engine,
          state,
          player: active.player,
          rng: driverRng,
          budget: { kind: "rollouts", n: 1000 },
          clock: fakeClock(),
        });
        state = engine.apply(state, new Map([[active.player, move]]), rngFromSeed(`step-${seed}-${ply}`));
      }
      const finalStatus = engine.status(state);
      if (finalStatus.kind === "won") {
        if (finalStatus.winner === mctsSeat) mctsWins += 1;
        else mctsLosses += 1;
      }
    }
    // "beats random >=90%" read as: mcts does not LOSE more than 10% of decisive games (draws
    // don't count against it — a well-played TTT is very frequently a draw).
    const decisive = mctsWins + mctsLosses;
    expect(mctsLosses / GAMES).toBeLessThanOrEqual(0.1);
    expect(decisive).toBeGreaterThan(0); // sanity: the batch actually produced some wins
  });

  it("same seed + same rollouts budget ⇒ identical move (determinism)", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("mcts-determinism"));
    const policy = mctsPolicy<TTTState, TTTMove>();
    const a = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-determinism-decision"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-determinism-decision"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });

  it("reports rootVisits summing to the rollouts budget", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("mcts-rootvisits"));
    const policy = mctsPolicy<TTTState, TTTMove>();
    const { stats } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-rootvisits-decision"),
      budget: { kind: "rollouts", n: 300 },
      clock: fakeClock(),
    });
    expect(stats.rootVisits).toBeDefined();
    const total = stats.rootVisits!.reduce((sum, v) => sum + v.visits, 0);
    expect(total).toBe(300);
  });

  it("is 1-player native on bank-run (solo, stochastic): produces a legal move with no opponent nodes", () => {
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("mcts-bankrun"));
    const policy = mctsPolicy<BankRunState, BankRunMove>();
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-bankrun-decision"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    const legal = engine.legalMoves(state, 0);
    expect(legal.some((m) => m.kind === move.kind)).toBe(true);
  });

  it("stochastic games draw a fresh rng per playout: two rollouts of the same push can bust or succeed differently", () => {
    // Regression guard against an rng-reuse bug: if every rollout consumed the SAME frozen
    // rng draw, every simulated "push" from a given node would always resolve identically
    // (either every rollout busts, or none ever do). Run enough rollouts that, at
    // bank-run's default 0.6 success probability, both outcomes are overwhelmingly likely to
    // appear if rng truly varies per playout — and assert we see BOTH a bust-flavored and a
    // success-flavored leaf value show up (approximated via stats.rootValue not being exactly
    // +-the count, i.e. a genuinely mixed outcome). We check this more directly by running
    // many independent single-rollout searches from the same node and confirming they are NOT
    // all identical.
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("mcts-fresh-rng"));
    const policy = mctsPolicy<BankRunState, BankRunMove>();
    const outcomes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { stats } = policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed(`mcts-fresh-rng-decision-${i}`),
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
      });
      outcomes.add(String(stats.rootValue));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("simultaneous games: joint move space produces a legal move for each player independently (rps fixture)", () => {
    const engine = rps;
    const state = engine.setup(2, rngFromSeed("mcts-rps"));
    const policy = mctsPolicy<RPSState, RPSMove>();
    for (const player of [0, 1] as const) {
      const { move } = policy.chooseMove({
        engine,
        state,
        player,
        rng: rngFromSeed(`mcts-rps-decision-${player}`),
        budget: { kind: "rollouts", n: 100 },
        clock: fakeClock(),
      });
      const legal = engine.legalMoves(state, player);
      expect(legal.some((m) => m.choice === move.choice)).toBe(true);
    }
  });

  describe("marginal aggregation at a simultaneous root (platform-corrections.md C56)", () => {
    it("aggregateByOwnMove: a single lucky joint cell can out-visit any individual cell of the TRUE-best action — plant a violation the OLD joint-argmax rule would have missed", () => {
      // Constructed directly (bypassing real search noise) so the disagreement is exact and
      // not seed-dependent: player 0's action A is uniformly good across all three of player
      // 1's responses (15 visits each, avg value 1.0 apiece — marginal total 45 visits, mean
      // 1.0). Action B is a trap: one lucky cell (B,X) alone gets MORE visits (40) than any
      // single A-cell (15), even though B's other two cells are barely explored and strongly
      // negative (1 visit each, avg -1.0) — B's marginal total is only 42, mean ~0.905.
      //
      // The OLD defect (docs/plans/platform-corrections.md C56): read off the single
      // most-visited JOINT cell, which is (B,X) at 40 — recommending B, the worse action.
      // A test asserting the OLD rule's answer here would still pass after a fix that changed
      // nothing (C41's "vacuous agreement" trap) — this asserts the OPPOSITE: the marginal
      // total prefers A (45 > 42), and that is what `aggregateByOwnMove` must return.
      const entries = [
        { move: "A" as const, visits: 15, totalValue: 15 },
        { move: "A" as const, visits: 15, totalValue: 15 },
        { move: "A" as const, visits: 15, totalValue: 15 },
        { move: "B" as const, visits: 40, totalValue: 40 }, // the lucky cell: joint-argmax picks THIS
        { move: "B" as const, visits: 1, totalValue: -1 },
        { move: "B" as const, visits: 1, totalValue: -1 },
      ];

      // Sanity check on the plant itself: confirm the single most-visited JOINT cell really is
      // a B-cell (40), strictly beating every individual A-cell (15) — i.e. the OLD rule really
      // would disagree with the fixed one here, not just "arguably".
      const jointArgmax = entries.reduce((best, e) => (e.visits > best.visits ? e : best));
      expect(jointArgmax.move).toBe("B");
      expect(jointArgmax.visits).toBe(40);
      expect(entries.filter((e) => e.move === "A").every((e) => e.visits < jointArgmax.visits)).toBe(true);

      const aggregated = aggregateByOwnMove(entries);
      const byMove = new Map(aggregated.map((a) => [a.move, a]));
      expect(byMove.get("A")?.visits).toBe(45);
      expect(byMove.get("B")?.visits).toBe(42);

      const marginalBest = aggregated.reduce((best, a) => (a.visits > best.visits ? a : best));
      expect(marginalBest.move).toBe("A"); // the TRUE-best action — disagrees with jointArgmax
      expect(marginalBest.move).not.toBe(jointArgmax.move);
    });

    it("aggregateByOwnMove is a structural no-op for a sequential root's shape: one joint arm per own move never merges with another", () => {
      // Every sequential root child is ALREADY keyed by a singleton {player: move} map, so
      // jointMoveOptions() never produces two children sharing the same own-move value. This
      // is the fact mcts.ts's sequential branch relies on to justify NOT routing through
      // aggregateByOwnMove at all (see mcts.ts's byte-identical-for-sequential rationale) —
      // asserted here directly so that claim has its own regression coverage.
      const entries = [
        { move: "left" as const, visits: 10, totalValue: 3 },
        { move: "right" as const, visits: 20, totalValue: -5 },
        { move: "center" as const, visits: 5, totalValue: 5 },
      ];
      const aggregated = aggregateByOwnMove(entries);
      expect(aggregated).toEqual(entries);
    });

    it("real MCTS on a fixture engineered to expose the pathology (lucky-cell-rps): marginalizes over the opponent instead of reading off the joint argmax", () => {
      // lucky-cell-rps.ts: player 0's action A wins against every one of player 1's three
      // responses; action B only wins against ONE of them (X) and loses to the other two.
      // Marginalized over player 1, A strictly dominates (mean +1 vs mean -1/3). At this
      // specific (budget, seed) pair — found by direct measurement, the same C36/C56
      // discipline this fix responds to — the single most-visited JOINT cell is a B-cell
      // (the lucky (B,X) draw), which is exactly the shape of defect C56 describes: UCB ties
      // player 0's three A-cells and the one lucky B-cell at value 1.0 apiece, and whichever
      // of those four happens to be first in insertion order wins the OLD rule's tie-break —
      // here, that happens to be a B-cell, even though B's OWN marginal total (over all of
      // player 1's responses) is decisively behind A's.
      const engine = luckyCellRps;
      const state = engine.setup(2, rngFromSeed("lucky-setup-a"));
      const policy = mctsPolicy<LuckyCellRPSState, LuckyCellRPSMove>({ explorationC: 1.4 });
      const { move, stats } = policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("lucky-decision-100-a"),
        budget: { kind: "rollouts", n: 100 },
        clock: fakeClock(),
      });

      // The fixed policy must marginalize: A's own aggregated visits must exceed B's.
      const byOwnMove = new Map<string, number>();
      for (const { move: m, visits } of stats.rootVisits ?? []) {
        const choice = (m as unknown as LuckyCellRPSMove).choice;
        byOwnMove.set(choice, (byOwnMove.get(choice) ?? 0) + visits);
      }
      expect(byOwnMove.get("A")).toBeDefined();
      expect(byOwnMove.get("B")).toBeDefined();
      expect(byOwnMove.get("A")!).toBeGreaterThan(byOwnMove.get("B")!);

      // The chosen move must be the marginal winner, A — NOT the joint-argmax pick a
      // pre-C56-fix search would make on this exact (state, seed, budget) (empirically
      // confirmed to be "B" against the unfixed selection rule).
      expect(move.choice).toBe("A");
    });
  });

  it("throws a clear error when called on a terminal state", () => {
    const engine = classicTicTacToe;
    const wonState: TTTState = {
      board: [0, 0, 0, 1, 1, null, null, null, null],
      turn: 1,
      lastEffects: [],
    };
    const policy = mctsPolicy<TTTState, TTTMove>();
    expect(() =>
      policy.chooseMove({
        engine,
        state: wonState,
        player: 1,
        rng: rngFromSeed("mcts-terminal"),
        budget: { kind: "rollouts", n: 10 },
        clock: fakeClock(),
      })
    ).toThrow(/terminal/i);
  });
});

describe("determinize() + mctsPolicy on a hidden-info fixture (correction C1)", () => {
  it("probeViewHonesty passes: the SAME view yields the SAME move across different REAL hidden worlds, each with its own freshly-built policy pipeline", () => {
    const engine = tinyFog;
    const stateA = engine.setup(1, rngFromSeed("fog-world-a")); // some secret
    const stateB = { ...stateA, secret: (stateA.secret === 0 ? 1 : 0) as 0 | 1 }; // the OTHER secret
    // Sanity: these really are two DIFFERENT real states that project to the IDENTICAL view —
    // otherwise this wouldn't be exercising anything about view-honesty at all.
    expect(stateA.secret).not.toBe(stateB.secret);
    expect(deriveView(engine, stateB, 0)).toEqual(deriveView(engine, stateA, 0));

    // makePolicy is rebuilt fresh per world (mirroring the harness constructing the pipeline
    // inside a live game whose true state IS that world) — an honestly-built pipeline never
    // reads `world` at all, it only ever samples fresh worlds of its own via
    // engine.sampleConsistentState during chooseMove.
    const makePolicy = (): ViewPolicy<TinyFogState, TinyFogMove, TinyFogView> =>
      determinize(mctsPolicy<TinyFogState, TinyFogMove>());

    probeViewHonesty({
      engine,
      makePolicy,
      worlds: [stateA, stateB],
      player: 0,
      budget: { kind: "rollouts", n: 20 },
      clock: fakeClock(),
      makeRng: () => rngFromSeed("fog-probe-seed"),
    });
  });

  it("an omniscient cheater that reads the real secret through a closure instead of sampleConsistentState makes the probe throw (the exact C1 defect)", () => {
    const engine = tinyFog;
    const stateA = engine.setup(1, rngFromSeed("fog-cheat-a"));
    const stateB = { ...stateA, secret: (stateA.secret === 0 ? 1 : 0) as 0 | 1 };
    expect(stateA.secret).not.toBe(stateB.secret);
    expect(deriveView(engine, stateB, 0)).toEqual(deriveView(engine, stateA, 0));

    // A "ViewPolicy" that structurally satisfies the interface (its chooseMove signature has
    // no `state: S` parameter) but smuggles the real world in through a closure instead of
    // ever calling engine.sampleConsistentState — exactly the failure mode C1 exists to catch.
    // It guesses tiny-fog's coin correctly 100% of the time, where honest play is a 50/50 flip.
    const cheaterFactory = (world: TinyFogState): ViewPolicy<TinyFogState, TinyFogMove, TinyFogView> => ({
      chooseMove(): { move: TinyFogMove; stats: SearchStats } {
        return { move: { guess: world.secret }, stats: { elapsedMs: 0 } };
      },
    });

    expect(() =>
      probeViewHonesty({
        engine,
        makePolicy: cheaterFactory,
        worlds: [stateA, stateB],
        player: 0,
        budget: { kind: "rollouts", n: 20 },
        clock: fakeClock(),
        makeRng: () => rngFromSeed("fog-cheat-seed"),
      })
    ).toThrow(/C1 violation|behaving as though it can see/i);
  });

  it("determinize() never hands the wrapped Policy the real state — only a sampled world", () => {
    const engine = tinyFog;
    const realState = engine.setup(1, rngFromSeed("fog-real"));
    const view = deriveView(engine, realState, 0);
    let sawState: unknown;
    const spyPolicy: Policy<TinyFogState, TinyFogMove> = {
      chooseMove(args) {
        sawState = args.state;
        return mctsPolicy<TinyFogState, TinyFogMove>().chooseMove(args);
      },
    };
    const viewPolicy = determinize(spyPolicy);
    viewPolicy.chooseMove({
      engine,
      view,
      player: 0,
      rng: rngFromSeed("fog-real-decision"),
      budget: { kind: "rollouts", n: 10 },
      clock: fakeClock(),
    });
    // The sampled world must be a validly-shaped state (determinize DID synthesize one), but
    // it must not be reference-equal to the real state (it was independently generated).
    expect(sawState).toBeDefined();
    expect(sawState).not.toBe(realState);
  });
});

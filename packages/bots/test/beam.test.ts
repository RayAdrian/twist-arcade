import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { miniCrackstep } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { beamPolicy } from "../src/beam";
import { randomPolicy } from "../src/random";
import { fakeClock } from "./helpers";

// A minimal solo, deterministic fixture built ONLY to exercise beam's won/lost-vs-heuristic
// ranking: from "start", one move ends the game in an immediate win (status "won"); the other
// move ("drift") stays "ongoing" forever with a heuristic (100) that is far larger than a
// naively-finite won value of 1. No shipped solo fixture combines maxPlayers===1, a won/lost
// status, AND heuristic() in one place, so this is test scaffolding only (not a shipped game).
interface WinVsDriftState extends WithEffects {
  readonly phase: "start" | "won" | "drift";
}
interface WinVsDriftMove {
  readonly kind: "win" | "drift";
  readonly [key: string]: Json;
}
const winVsDrift: GameEngine<WinVsDriftState, WinVsDriftMove, WinVsDriftState> = {
  meta: {
    id: "win-vs-drift-fixture",
    name: "Win vs Drift (bots test fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },
  setup(_numPlayers: number, _rng: Rng): WinVsDriftState {
    return { phase: "start", lastEffects: [] };
  },
  legalMoves(state, player: PlayerId): WinVsDriftMove[] {
    if (player !== 0) return [];
    if (state.phase === "start") return [{ kind: "win" }, { kind: "drift" }];
    if (state.phase === "drift") return [{ kind: "drift" }]; // drift forever, budget bounds the search
    return [];
  },
  isLegal(state, player, move): boolean {
    return this.legalMoves(state, player).some((m) => m.kind === move.kind);
  },
  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },
  apply(_state, moves, _rng): WinVsDriftState {
    const move = moves.get(0);
    if (!move) throw new Error("win-vs-drift: apply() called without a move for player 0");
    return { phase: move.kind === "win" ? "won" : "drift", lastEffects: [] };
  },
  status(state): Status {
    return state.phase === "won" ? { kind: "won", winner: 0 } : { kind: "ongoing" };
  },
  playerView(state, _player): WinVsDriftState {
    return state;
  },
  encode(state): string {
    return JSON.stringify({ phase: state.phase });
  },
  decode(encoded): WinVsDriftState {
    const parsed = JSON.parse(encoded) as { phase: "start" | "won" | "drift" };
    return { phase: parsed.phase, lastEffects: [] };
  },
  heuristic(state, _player): number {
    // Deliberately much larger than a naive finite won-value of 1 — the whole point of this
    // fixture is to prove a real win outranks ANY raw heuristic on an ongoing position.
    return state.phase === "drift" ? 100 : 0;
  },
};

function playOneGame(policy: { chooseMove: ReturnType<typeof beamPolicy<BankRunState, BankRunMove>>["chooseMove"] }, seed: string): number {
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
      budget: { kind: "rollouts", n: 500 },
      clock: fakeClock(),
    });
    state = engine.apply(state, new Map([[0, move]]), rngFromSeed(`${seed}:step-${round}`));
  }
  const finalStatus = engine.status(state);
  if (finalStatus.kind !== "scored") throw new Error(`unexpected terminal: ${JSON.stringify(finalStatus)}`);
  return finalStatus.scores[0]!;
}

describe("beamPolicy", () => {
  it("always returns a legal move on bank-run (default width 100, plan §6)", () => {
    const policy = beamPolicy<BankRunState, BankRunMove>();
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("beam-legal"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-legal-decision"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    const legal = engine.legalMoves(state, 0);
    expect(legal.some((m) => m.kind === move.kind)).toBe(true);
  });

  it("beats random by a reproducible fixed-seed margin on bank-run (DoD §13 anchor: THE solo Strong agent)", () => {
    const beam = beamPolicy<BankRunState, BankRunMove>({ width: 50 });
    const random = randomPolicy<BankRunState, BankRunMove>();
    const N = 60;
    let beamTotal = 0;
    let randomTotal = 0;
    for (let seed = 0; seed < N; seed++) {
      beamTotal += playOneGame(beam, `beam-strong-${seed}`);
      randomTotal += playOneGame(random, `beam-random-${seed}`);
    }
    expect(beamTotal / N).toBeGreaterThan(randomTotal / N);
  });

  it("same seed ⇒ identical move (determinism, rollouts budget)", () => {
    const policy = beamPolicy<BankRunState, BankRunMove>({ width: 20 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("beam-det"));
    const a = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-det-decision"),
      budget: { kind: "rollouts", n: 100 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-det-decision"),
      budget: { kind: "rollouts", n: 100 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });

  it("refuses a non-solo game with a typed error", () => {
    const policy = beamPolicy<TTTState, TTTMove>();
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("beam-not-solo"));
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("beam-not-solo-decision"),
        budget: { kind: "rollouts", n: 10 },
        clock: fakeClock(),
      })
    ).toThrow(/solo/i);
  });

  it("takes an immediate win over a merely-higher-heuristic ongoing position (a real win beats any raw heuristic score)", () => {
    const policy = beamPolicy<WinVsDriftState, WinVsDriftMove>();
    const engine = winVsDrift;
    const state = engine.setup(1, rngFromSeed("beam-win-vs-drift"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-win-vs-drift-decision"),
      budget: { kind: "rollouts", n: 5 },
      clock: fakeClock(),
    });
    expect(move.kind).toBe("win");
  });

  it("refuses a solo game with neither score() nor heuristic() (mini-crackstep) with a typed error", () => {
    const policy = beamPolicy();
    const engine = miniCrackstep;
    const state = engine.setup(1, rngFromSeed("beam-no-eval"));
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("beam-no-eval-decision"),
        budget: { kind: "rollouts", n: 10 },
        clock: fakeClock(),
      })
    ).toThrow(/score|heuristic/i);
  });
});

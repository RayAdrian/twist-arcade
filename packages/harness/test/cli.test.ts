// packages/harness/test/cli.test.ts — TDD anchor for the CLI's argument parsing and command
// dispatch (plan §7.1 / §13's "pnpm harness solve classic-ttt-fixture" acceptance line). Tests
// call the exported `parseArgs`/`dispatch` functions directly (no child_process spawn) — the
// same "framework boundary tested by calling the pure function" pattern
// packages/bots/src/worker/host.ts's own tests use for the analogous reason: fast, and it
// exercises the exact same logic `main()` calls.

import { describe, expect, it } from "vitest";
import type { GameManifest, RegistryEntry } from "@twist-arcade/game-spec";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { CliUsageError, dispatch, parseArgs, UnknownFixtureError, UnregisteredGameError, type DispatchResult } from "../src/cli";

// `dispatch()`'s return type widened to `DispatchResult | Promise<DispatchResult>` once "suite"
// started resolving real registered games (real `loadEngine()` is a dynamic import — see
// cli.ts's own doc comment on `dispatch`). `solve`/`run` against a built-in fixture, and
// "suite" against a KNOWN built-in fixture id, are ALL still guaranteed synchronous — this
// helper asserts that at runtime (never silently assumes it) so every pre-existing solve/run
// test below keeps exercising the exact same synchronous behavior it always has.
function dispatchSync(argv: readonly string[]): DispatchResult {
  const result = dispatch(argv);
  if (result instanceof Promise) {
    throw new Error(`dispatchSync: dispatch(${JSON.stringify(argv)}) unexpectedly returned a Promise`);
  }
  return result;
}

describe("parseArgs()", () => {
  it("parses a bare command + gameId with no flags", () => {
    expect(parseArgs(["solve", "classic-ttt-fixture"])).toEqual({
      command: "solve",
      gameId: "classic-ttt-fixture",
      flags: {},
    });
  });

  it("parses --flag value pairs", () => {
    expect(parseArgs(["run", "classic-ttt-fixture", "--matchup", "mcts100:random", "--games", "10"])).toEqual({
      command: "run",
      gameId: "classic-ttt-fixture",
      flags: { matchup: "mcts100:random", games: "10" },
    });
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["frobnicate", "x"])).toThrow(CliUsageError);
  });

  it("rejects a missing gameId", () => {
    expect(() => parseArgs(["solve"])).toThrow(CliUsageError);
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["solve", "classic-ttt-fixture", "--max-states"])).toThrow(CliUsageError);
  });

  it("rejects a bare positional argument after gameId (must be --flag value)", () => {
    expect(() => parseArgs(["solve", "classic-ttt-fixture", "extra"])).toThrow(CliUsageError);
  });
});

describe("dispatch() — solve (plan §13's published-number acceptance line)", () => {
  it("pnpm harness solve classic-ttt-fixture: 5,478 reachable states, value draw", () => {
    const { exitCode, output } = dispatchSync(["solve", "classic-ttt-fixture", "--json", "true"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output) as { reachableStates: number; rootValue: string };
    expect(parsed.reachableStates).toBe(5478);
    expect(parsed.rootValue).toBe("draw");
  });

  it("the human-readable (non --json) form also reports the same two headline numbers", () => {
    const { output } = dispatchSync(["solve", "classic-ttt-fixture"]);
    expect(output).toContain("reachable states: 5478");
    expect(output).toContain("root value: draw");
  });

  it("an unknown gameId is a typed refusal, not a crash or a wrong answer", () => {
    expect(() => dispatch(["solve", "not-a-real-game"])).toThrow(UnknownFixtureError);
  });
});

describe("dispatch() — run", () => {
  it("runs a named matchup and reports a real games count", () => {
    const { exitCode, output } = dispatchSync([
      "run",
      "classic-ttt-fixture",
      "--matchup",
      "mcts100:random",
      "--games",
      "6",
      "--seed",
      "cli-test",
      "--json",
      "true",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output) as { metrics: { games: number } };
    expect(parsed.metrics.games).toBe(6);
  });

  it("requires --matchup", () => {
    expect(() => dispatch(["run", "classic-ttt-fixture", "--games", "6"])).toThrow(CliUsageError);
  });

  it("rejects a malformed --matchup (must be A:B)", () => {
    expect(() =>
      dispatch(["run", "classic-ttt-fixture", "--matchup", "onlyoneside", "--games", "6"])
    ).toThrow(CliUsageError);
  });

  // SHOULD FIX #5: plan §9's anchor is a byte-identical JSON artifact under a fixed seed.
  // Decisions are deterministic (search budgets are always `{kind:"rollouts"}`) and `solve` is
  // clock-free, but `run --json` embedded `throughputGamesPerSec`, the one field the module doc
  // itself admits varies run to run with real wall-clock timing — three identical invocations
  // measured 952.38 / 869.57 / 888.89 games/sec. Exclude it from the JSON artifact.
  it("--json is byte-identical across two independent invocations with the same seed", () => {
    const invoke = () =>
      dispatchSync([
        "run",
        "classic-ttt-fixture",
        "--matchup",
        "mcts100:random",
        "--games",
        "8",
        "--seed",
        "cli-test:determinism",
        "--json",
        "true",
      ]).output;
    const first = invoke();
    const second = invoke();
    expect(first).toBe(second);
  });

  it("--json never embeds throughputGamesPerSec (the one non-deterministic field)", () => {
    const { output } = dispatchSync([
      "run",
      "classic-ttt-fixture",
      "--matchup",
      "mcts100:random",
      "--games",
      "6",
      "--seed",
      "cli-test:no-throughput",
      "--json",
      "true",
    ]);
    expect(output).not.toContain("throughputGamesPerSec");
  });

  it("the human-readable (non --json) table still prints throughput — this is a JSON-only exclusion", () => {
    const { output } = dispatchSync([
      "run",
      "classic-ttt-fixture",
      "--matchup",
      "mcts100:random",
      "--games",
      "6",
      "--seed",
      "cli-test:human-table-throughput",
    ]);
    expect(output).toContain("throughput:");
  });
});

describe("dispatch() — suite (scoped out for built-in testkit fixtures — no manifest exists for them)", () => {
  it("refuses loudly rather than fabricating a manifest", () => {
    expect(() => dispatch(["suite", "classic-ttt-fixture"])).toThrow(CliUsageError);
  });
});

// platform-corrections.md C13: "harness suite hard-refuses anything outside the built-in
// testkit fixtures, so it cannot run against a real registered game at all." These tests prove
// `dispatch()` now resolves a REAL registered game via an injected `resolveRegisteredGame` dep
// (the same "pure logic vs thin main()" DI seam scripts/ci-gates.ts's `runAllGates` already
// uses) rather than needing games/registry.ts or a real npm-linked game package. The real
// `main()` wiring (untested, process-only) resolves against the actual games/registry.ts file.
function twoPlayerManifest(): GameManifest {
  return {
    id: "classic-ttt-registered",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "cli.test.ts sabotaged fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };
}

function chaseManifest(): GameManifest {
  return {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
  };
}

describe("dispatch() — suite resolves a REAL registered game (platform-corrections.md C13)", () => {
  it("runs the two-player CI gate for a registered game via the injected registry resolver", async () => {
    const entry: RegistryEntry = {
      manifest: twoPlayerManifest(),
      loadEngine: async () => classicTicTacToe,
      loadPresentation: async () => {
        throw new Error("not needed by this test");
      },
    };
    const result = dispatch(["suite", "classic-ttt-registered", "--seed", "cli-suite-test", "--games", "6", "--json", "true"], {
      resolveRegisteredGame: async (gameId) => (gameId === "classic-ttt-registered" ? entry : undefined),
      resolveSafeMove: async () => undefined,
    });
    expect(result).toBeInstanceOf(Promise);
    const { exitCode, output } = await result;
    const parsed = JSON.parse(output) as { kind: string; gameId: string };
    expect(parsed.kind).toBe("two-player");
    expect(parsed.gameId).toBe("classic-ttt-registered");
    // sabotaged ruthless tier === randomPolicy, so strong-vs-random fails -> non-zero exit.
    expect(exitCode).toBe(1);
  });

  it("runs the solo-chase CI gate for a registered game, resolving safeMove via the injected dep", async () => {
    const entry: RegistryEntry = {
      manifest: chaseManifest(),
      loadEngine: async () => bankRun,
      loadPresentation: async () => {
        throw new Error("not needed by this test");
      },
    };
    const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });
    const result = dispatch(["suite", "bank-run-fixture", "--seed", "cli-suite-chase", "--json", "true"], {
      resolveRegisteredGame: async (gameId) => (gameId === "bank-run-fixture" ? entry : undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveSafeMove: async () => alwaysBank as any,
    });
    const { output } = await result;
    const parsed = JSON.parse(output) as { kind: string; gameId: string };
    expect(parsed.kind).toBe("solo-chase");
    expect(parsed.gameId).toBe("bank-run-fixture");
  });

  it("throws UnregisteredGameError for a gameId that is neither a built-in fixture nor a registered game", async () => {
    const result = dispatch(["suite", "not-a-real-game-anywhere"], {
      resolveRegisteredGame: async () => undefined,
      resolveSafeMove: async () => undefined,
    });
    await expect(result).rejects.toThrow(UnregisteredGameError);
  });

  it("still refuses a KNOWN built-in fixture id even with the registry resolver injected (no manifest exists for it either way)", () => {
    expect(() =>
      dispatch(["suite", "classic-ttt-fixture"], {
        resolveRegisteredGame: async () => {
          throw new Error("must not be consulted for a built-in fixture id");
        },
        resolveSafeMove: async () => undefined,
      })
    ).toThrow(CliUsageError);
  });
});

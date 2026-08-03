// packages/harness/test/cli.test.ts — TDD anchor for the CLI's argument parsing and command
// dispatch (plan §7.1 / §13's "pnpm harness solve classic-ttt-fixture" acceptance line). Tests
// call the exported `parseArgs`/`dispatch` functions directly (no child_process spawn) — the
// same "framework boundary tested by calling the pure function" pattern
// packages/bots/src/worker/host.ts's own tests use for the analogous reason: fast, and it
// exercises the exact same logic `main()` calls.

import { describe, expect, it } from "vitest";
import { CliUsageError, dispatch, parseArgs, UnknownFixtureError } from "../src/cli";

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
    const { exitCode, output } = dispatch(["solve", "classic-ttt-fixture", "--json", "true"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output) as { reachableStates: number; rootValue: string };
    expect(parsed.reachableStates).toBe(5478);
    expect(parsed.rootValue).toBe("draw");
  });

  it("the human-readable (non --json) form also reports the same two headline numbers", () => {
    const { output } = dispatch(["solve", "classic-ttt-fixture"]);
    expect(output).toContain("reachable states: 5478");
    expect(output).toContain("root value: draw");
  });

  it("an unknown gameId is a typed refusal, not a crash or a wrong answer", () => {
    expect(() => dispatch(["solve", "not-a-real-game"])).toThrow(UnknownFixtureError);
  });
});

describe("dispatch() — run", () => {
  it("runs a named matchup and reports a real games count", () => {
    const { exitCode, output } = dispatch([
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
});

describe("dispatch() — suite (scoped out for built-in testkit fixtures — no manifest exists for them)", () => {
  it("refuses loudly rather than fabricating a manifest", () => {
    expect(() => dispatch(["suite", "classic-ttt-fixture"])).toThrow(CliUsageError);
  });
});

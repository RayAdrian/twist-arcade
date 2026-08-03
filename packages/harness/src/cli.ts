// packages/harness/src/cli.ts — `pnpm harness <command> ...` entry point (plan §7.1).
//
// SCOPE NOTE (read this before extending gameId resolution): `resolveFixture` below only knows
// about a small built-in map of @twist-arcade/engine's OWN testkit fixtures (currently
// classic-ttt-fixture) — enough to smoke-test `solve`/`run` end-to-end against the plan §9/§13
// published-number oracle ("pnpm harness solve classic-ttt-fixture: 5,478 reachable states,
// value draw"). Wiring this CLI to the real `games/registry.ts` (dynamic `loadEngine()` per
// shipped game, manifest-driven roster/tiers, `--json out.json` file writing, `suite`'s
// dependence on a real manifest) is bigger, registry-consuming work — explicitly out of this
// milestone's scope (M4/M5 own the full CI workflow and scaffold this would plug into). Every
// function `dispatch` calls (`solveTwoPlayerGame`, `runMatchup`, `runCiSuite`) is already fully
// engine/manifest-agnostic; a future CLI pass only has to add real gameId resolution here, not
// touch any of those three.
//
// TESTED BY CALLING THE PURE FUNCTIONS DIRECTLY (see cli.test.ts) — the same boundary-testing
// pattern packages/bots/src/worker/host.ts uses for the analogous reason: fast, in-process, and
// it exercises the exact logic `main()` calls without needing a child_process spawn.

import type { GameEngine } from "@twist-arcade/engine";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { solveTwoPlayerGame } from "./solver/solve";
import { runMatchup } from "./runner";
import { resolveNamedAgent } from "./roster";
import { formatMatchupTable, formatSolveResult, toReportJson } from "./report";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KNOWN_FIXTURES: Record<string, GameEngine<any, any, any>> = {
  "classic-ttt-fixture": classicTicTacToe,
};

export class UnknownFixtureError extends Error {
  constructor(gameId: string) {
    super(
      `harness cli: unknown gameId "${gameId}". Known: ${Object.keys(KNOWN_FIXTURES).join(", ")} — ` +
        "real-game resolution via games/registry.ts is out of this milestone's CLI scope (see " +
        "cli.ts's module doc)."
    );
    this.name = "UnknownFixtureError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveFixture(gameId: string): GameEngine<any, any, any> {
  const engine = KNOWN_FIXTURES[gameId];
  if (!engine) throw new UnknownFixtureError(gameId);
  return engine;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ParsedArgs {
  command: "solve" | "run" | "suite";
  gameId: string;
  flags: Record<string, string>;
}

/** Parses `process.argv.slice(2)`-shaped tokens: `<command> <gameId> [--flag value]...`. Pure
 *  (no `process` access) so it is trivially unit-testable. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, gameId, ...rest] = argv;
  if (command !== "solve" && command !== "run" && command !== "suite") {
    throw new CliUsageError(`harness: unknown command "${String(command)}" — expected solve, run, or suite`);
  }
  if (!gameId) {
    throw new CliUsageError(`harness ${command}: missing <gameId>`);
  }
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith("--")) {
      throw new CliUsageError(`harness ${command}: unexpected argument "${token}" (flags must start with --)`);
    }
    const name = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliUsageError(`harness ${command}: flag --${name} requires a value`);
    }
    flags[name] = value;
    i += 1;
  }
  return { command, gameId, flags };
}

export interface DispatchResult {
  exitCode: number;
  output: string;
}

/** Runs one CLI invocation end to end and returns what `main()` would print + exit with —
 *  separated from `main()` itself so tests never need `process.exit`/stdout capture. */
export function dispatch(argv: readonly string[]): DispatchResult {
  const parsed = parseArgs(argv);
  const engine = resolveFixture(parsed.gameId);
  const asJson = parsed.flags.json !== undefined;

  if (parsed.command === "solve") {
    const maxStates = parsed.flags["max-states"] !== undefined ? Number(parsed.flags["max-states"]) : undefined;
    const result = solveTwoPlayerGame(engine, maxStates !== undefined ? { maxStates } : {});
    return { exitCode: 0, output: asJson ? toReportJson(result) : formatSolveResult(result) };
  }

  if (parsed.command === "run") {
    const matchup = parsed.flags.matchup;
    if (!matchup) throw new CliUsageError('harness run: --matchup "A:B" is required');
    const [nameA, nameB] = matchup.split(":");
    if (!nameA || !nameB) {
      throw new CliUsageError(`harness run: --matchup must be "A:B", got "${matchup}"`);
    }
    const games = parsed.flags.games !== undefined ? Number(parsed.flags.games) : 200;
    const seed = parsed.flags.seed ?? "harness-cli";
    const report = runMatchup(engine, resolveNamedAgent(nameA), resolveNamedAgent(nameB), { games, seed });
    return { exitCode: 0, output: asJson ? toReportJson(report) : formatMatchupTable(report) };
  }

  // "suite" needs a GameManifest (runCiSuite's second argument) — built-in testkit fixtures
  // have none (see module doc: they exist to smoke-test the solver/runner, not to be full
  // shippable games with difficulty tiers). Refusing loudly here, rather than fabricating a
  // placeholder manifest, is the same "typed refusal over a silent wrong answer" rule this
  // whole package follows elsewhere (UnsupportedGameError, UnknownFixtureError, ...).
  throw new CliUsageError(
    'harness suite: no manifest is available for a built-in testkit fixture — "suite" needs a ' +
      "real registered game (out of this milestone's CLI scope; runCiSuite() itself is fully " +
      "ready and manifest-agnostic — see suites.ts)."
  );
}

function main(): void {
  try {
    const { exitCode, output } = dispatch(process.argv.slice(2));
    console.log(output);
    process.exitCode = exitCode;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  }
}

// Only run when this file is the actual process entry point (`tsx src/cli.ts ...`), never when
// a test imports it to exercise `parseArgs`/`dispatch` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

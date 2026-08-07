// packages/harness/src/cli.ts — `pnpm harness <command> ...` entry point (plan §7.1).
//
// SCOPE NOTE for `solve`/`run`: `resolveFixture` below only knows about a small built-in map of
// @twist-arcade/engine's OWN testkit fixtures (currently classic-ttt-fixture) — enough to
// smoke-test `solve`/`run` end-to-end against the plan §9/§13 published-number oracle ("pnpm
// harness solve classic-ttt-fixture: 5,478 reachable states, value draw"). Those two commands
// stay scoped to built-in fixtures; real games have no reason to route their solver/matchup
// smoke-tests through this CLI (Fadeout/Crackstep each already have their own solver scripts).
//
// `suite`, however, is exactly the command platform-corrections.md C13 named: "harness suite
// hard-refuses anything outside the built-in testkit fixtures, so it cannot run against a real
// registered game at all" — a game team's own ship/no-ship check had nowhere to go but a
// hand-written throwaway script. Fixed here: a gameId that isn't a built-in fixture is now
// resolved against `games/registry.ts` (dynamic import, mirroring scripts/ci-gates.ts's own
// `loadRegistry()` — the same repo-layout convention that script's module doc says it owns,
// since the harness dispatcher deliberately knows nothing about repo layout), and run through
// `runGameCiGate`/`selectGateKind` — the SAME game-agnostic dispatcher scripts/ci-gates.ts uses
// for the whole registry, just for one game. Nothing about that dispatcher was wrong; only the
// two callers (this CLI and scripts/ci-gates.ts before its own C13 fix) were.
//
// TESTED BY CALLING THE PURE FUNCTIONS DIRECTLY (see cli.test.ts) — the same boundary-testing
// pattern packages/bots/src/worker/host.ts uses for the analogous reason: fast, in-process, and
// it exercises the exact logic `main()` calls without needing a child_process spawn. Real
// registry/safeMove resolution is injected via `CliDeps` (defaulted to the real dynamic-import
// wiring in `defaultCliDeps()`) — the same "pure logic vs thin main()" DI seam
// scripts/ci-gates.ts's `runAllGates`/`RunAllGatesDeps` already established — so a test never
// needs a real games/registry.ts entry or a real npm-linked game package.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameEngine, Json } from "@twist-arcade/engine";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { Registry, RegistryEntry } from "@twist-arcade/game-spec";
import { solveTwoPlayerGame } from "./solver/solve";
import { runMatchup } from "./runner";
import { resolveNamedAgent } from "./roster";
import { formatGameCiGateReport, formatMatchupTable, formatSolveResult, toGameCiGateReportJson, toMatchupReportJson, toReportJson } from "./report";
import { runGameCiGate, selectGateKind, type GameCiGateReport } from "./ci-gates";
import type { SafeMoveFn } from "./agents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KNOWN_FIXTURES: Record<string, GameEngine<any, any, any>> = {
  "classic-ttt-fixture": classicTicTacToe,
};

export class UnknownFixtureError extends Error {
  constructor(gameId: string) {
    super(
      `harness cli: unknown gameId "${gameId}". Known: ${Object.keys(KNOWN_FIXTURES).join(", ")} — ` +
        `for a real registered game, use "suite" (resolves games/registry.ts); "solve"/"run" ` +
        "stay scoped to built-in testkit fixtures (see cli.ts's module doc)."
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

/** Thrown by the `suite` command when a gameId is neither a known built-in testkit fixture nor
 *  present in `games/registry.ts` — a typo (or a game that has not registered yet) must be a
 *  loud refusal, never a silently-empty report. */
export class UnregisteredGameError extends Error {
  constructor(gameId: string) {
    super(
      `harness suite: "${gameId}" is neither a known built-in testkit fixture (${Object.keys(KNOWN_FIXTURES).join(", ")}) ` +
        "nor a registered game in games/registry.ts."
    );
    this.name = "UnregisteredGameError";
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

// Repo root, computed the same way scripts/ci-gates.ts computes it (REPO_ROOT), just from this
// file's own location three directories deeper (packages/harness/src/ -> packages/harness/ ->
// packages/ -> repo root).
const REPO_ROOT_URL = new URL("../../../", import.meta.url);
const REPO_ROOT = fileURLToPath(REPO_ROOT_URL);

/** Injected dependencies for the `suite` command's real-game resolution — mirrors
 *  scripts/ci-gates.ts's `RunAllGatesDeps` DI seam so this stays testable without a real
 *  games/registry.ts entry or a real npm-linked game package. `defaultCliDeps()` is the only
 *  place either of these touches the filesystem/a real dynamic import. */
export interface CliDeps {
  resolveRegisteredGame(gameId: string): Promise<RegistryEntry | undefined>;
  /** Mirrors scripts/ci-gates.ts's `resolveSafeMove`: a solo score-chase game's `safeMove` hook
   *  is exported from the game's OWN package root (`@twist-arcade/<gameId>`), never from
   *  `RegistryEntry` (game-spec's registry has no `loadProbes()` slot for it — see
   *  scripts/ci-gates.ts's own module doc for the full rationale, which applies unchanged here). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveSafeMove(gameId: string): Promise<SafeMoveFn<Json, any> | undefined>;
}

function defaultCliDeps(): CliDeps {
  return {
    async resolveRegisteredGame(gameId) {
      const registryUrl = new URL("games/registry.ts", REPO_ROOT_URL).href;
      const mod = (await import(registryUrl)) as { registry: Registry };
      return mod.registry[gameId];
    },
    async resolveSafeMove(gameId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import(`@twist-arcade/${gameId}`)) as { safeMove?: SafeMoveFn<Json, any> };
      return mod.safeMove;
    },
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10)!;
}

/** The `suite` command's real logic, separated from `dispatch()` only because it is
 *  (necessarily — real registered games load via `loadEngine()`, a dynamic import) async, unlike
 *  `solve`/`run` against a built-in fixture. Never called for a KNOWN built-in fixture id —
 *  `dispatch()` refuses that synchronously before reaching here (see its own comment for why:
 *  a caller must get a synchronous throw for that case, not a rejected Promise). */
async function dispatchSuite(gameId: string, flags: Record<string, string>, asJson: boolean, deps: CliDeps): Promise<DispatchResult> {
  const entry = await deps.resolveRegisteredGame(gameId);
  if (!entry) throw new UnregisteredGameError(gameId);

  const engine = await entry.loadEngine();
  const manifest = entry.manifest;
  const kind = selectGateKind(manifest);
  const suite = flags.suite === "nightly" ? "nightly" : "ci";
  const seed = flags.seed ?? "harness-cli";

  let report: GameCiGateReport;
  if (kind === "two-player") {
    const games = flags.games !== undefined ? Number(flags.games) : undefined;
    report = await runGameCiGate(engine, manifest, {
      kind: "two-player",
      seed,
      suite,
      ...(games !== undefined ? { games } : {}),
    });
  } else if (kind === "solo-chase") {
    const safeMove = await deps.resolveSafeMove(gameId);
    if (!safeMove) {
      throw new CliUsageError(
        `harness suite: solo score-chase game "${gameId}" does not export a "safeMove" hook ` +
          `from its package root (@twist-arcade/${gameId}) — every score chase MUST supply one ` +
          "(platform §6/§7.4)."
      );
    }
    const seedCount = flags["seed-count"] !== undefined ? Number(flags["seed-count"]) : undefined;
    report = await runGameCiGate(engine, manifest, {
      kind: "solo-chase",
      seed,
      suite,
      safeMove,
      ...(seedCount !== undefined ? { seedCount } : {}),
    });
  } else {
    // kind === "solo-puzzle"
    report = await runGameCiGate(engine, manifest, {
      kind: "solo-puzzle",
      baseDir: path.join(REPO_ROOT, "data/certificates"),
      today: todayUtc(),
      dayFor,
    });
  }

  return {
    exitCode: report.ok ? 0 : 1,
    output: asJson ? toGameCiGateReportJson(report) : formatGameCiGateReport(report),
  };
}

/** Runs one CLI invocation end to end and returns what `main()` would print + exit with —
 *  separated from `main()` itself so tests never need `process.exit`/stdout capture. Returns a
 *  `Promise<DispatchResult>` ONLY for `suite` against a real registered game (real `loadEngine()`
 *  is a dynamic import); `solve`/`run` against a built-in fixture, and `suite` against a KNOWN
 *  built-in fixture id (refused synchronously below), both stay fully synchronous — so every
 *  existing caller of those is unaffected. */
export function dispatch(argv: readonly string[], deps: CliDeps = defaultCliDeps()): DispatchResult | Promise<DispatchResult> {
  const parsed = parseArgs(argv);
  const asJson = parsed.flags.json !== undefined;

  if (parsed.command === "suite") {
    if (parsed.gameId in KNOWN_FIXTURES) {
      // "suite" needs a GameManifest (runGameCiGate's second argument) — built-in testkit
      // fixtures have none (they exist to smoke-test the solver/runner, not to be full
      // shippable games with difficulty tiers). Refusing loudly here, rather than fabricating a
      // placeholder manifest, is the same "typed refusal over a silent wrong answer" rule this
      // whole package follows elsewhere (UnsupportedGameError, UnknownFixtureError, ...).
      // SYNCHRONOUS on purpose (see this function's own doc comment) — a built-in-fixture
      // refusal must never look like an async registry lookup that happened to fail.
      throw new CliUsageError(
        'harness suite: no manifest is available for a built-in testkit fixture — "suite" needs ' +
          "a real registered game (games/registry.ts). solve/run stay scoped to built-in fixtures."
      );
    }
    return dispatchSuite(parsed.gameId, parsed.flags, asJson, deps);
  }

  const engine = resolveFixture(parsed.gameId);

  if (parsed.command === "solve") {
    const maxStates = parsed.flags["max-states"] !== undefined ? Number(parsed.flags["max-states"]) : undefined;
    const result = solveTwoPlayerGame(engine, maxStates !== undefined ? { maxStates } : {});
    return { exitCode: 0, output: asJson ? toReportJson(result) : formatSolveResult(result) };
  }

  // parsed.command === "run"
  const matchup = parsed.flags.matchup;
  if (!matchup) throw new CliUsageError('harness run: --matchup "A:B" is required');
  const [nameA, nameB] = matchup.split(":");
  if (!nameA || !nameB) {
    throw new CliUsageError(`harness run: --matchup must be "A:B", got "${matchup}"`);
  }
  const games = parsed.flags.games !== undefined ? Number(parsed.flags.games) : 200;
  const seed = parsed.flags.seed ?? "harness-cli";
  const report = runMatchup(engine, resolveNamedAgent(nameA), resolveNamedAgent(nameB), { games, seed });
  // SHOULD FIX #5: --json uses toMatchupReportJson (drops throughputGamesPerSec, the one
  // non-deterministic field) so the JSON artifact is byte-identical across runs under a fixed
  // seed (plan §9's anchor) — the human table still prints throughput via formatMatchupTable.
  return { exitCode: 0, output: asJson ? toMatchupReportJson(report) : formatMatchupTable(report) };
}

function main(): void {
  const result = dispatch(process.argv.slice(2));
  const finish = ({ exitCode, output }: DispatchResult): void => {
    console.log(output);
    process.exitCode = exitCode;
  };
  const fail = (err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  };
  if (result instanceof Promise) {
    result.then(finish).catch(fail);
    return;
  }
  try {
    finish(result);
  } catch (err) {
    fail(err);
  }
}

// Only run when this file is the actual process entry point (`tsx src/cli.ts ...`), never when
// a test imports it to exercise `parseArgs`/`dispatch` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

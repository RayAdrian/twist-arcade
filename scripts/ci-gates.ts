#!/usr/bin/env node
// scripts/ci-gates.ts — `pnpm harness:ci-gates [-- --suite ci|nightly] [--game <id>]` — the M4
// CI entry point. Iterates every registered game (games/registry.ts) and runs the correct gate
// table, OR (platform-corrections.md C13) exactly one of them when `--game <id>` is supplied —
// checking one game's own ship/no-ship gates must never re-run every other game's gates too,
// a cost that only grows as the registry does. `--game` refuses loudly (UnknownGameIdError) for
// an id absent from the registry, rather than silently falling back to the whole registry.
// for it via @twist-arcade/harness's ci-gates.ts dispatcher (selected by manifest.solo.format,
// never player count — platform-corrections.md C2). Exits non-zero if ANY game's gate report
// is not ok: "wired as a failing assertion" (plan §7.5).
//
// This script owns exactly the repo-layout conventions the harness dispatcher deliberately
// does NOT know about (ci-gates.ts's own module doc: it composes gate logic, not repo layout):
//   - two-player: `games` count from the CI/nightly budget below.
//   - solo score-chase: the mandatory `safeMove` hook is exported from the game's OWN package
//     root (`@twist-arcade/<gameId>`), per games/mine-run/index.ts's own convention
//     (`export { safeMove } from "./probes"`) — game-spec's RegistryEntry has no `loadProbes()`
//     slot for it (plan §5.4's registry is deliberately just manifest/engine/presentation/
//     solver), so this script is the one place that knows where to look.
//   - solo daily-puzzle: `baseDir` is the repo's committed `data/certificates/`, `today` is
//     the REAL current UTC day — the one place in this whole call chain that reads the actual
//     clock, deliberately: "what day is it in production" is not a reproducibility-sensitive
//     harness computation the way match seeds are.
//
// Structured the same way packages/harness/src/cli.ts is (see its own module doc): the real
// logic (`runAllGates`) is a plain async function over injected dependencies, so tests never
// need a real `games/registry.ts` entry, a real npm-linked game package, or the real clock —
// `main()` is the thin, untested, process-only wiring on top.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Json } from "@twist-arcade/engine";
import type { Registry } from "@twist-arcade/game-spec";
import {
  formatGameCiGateReport,
  runGameCiGate,
  selectGateKind,
  type GameCiGateReport,
  type SafeMoveFn,
} from "@twist-arcade/harness";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CERT_BASE_DIR = path.join(REPO_ROOT, "data/certificates");

// PR-budget vs nightly-budget sample counts. Both floors are explicitly >=100 (G-14 — "M3's CI
// gate configs [must] pass an explicit runs (>=100) rather than relying on defaults"); the
// nightly numbers additionally satisfy roadmap §9's "20k+ games" sweep once several games are
// registered (this loop's PER-GAME count times the number of registered games accumulates
// toward that total — a single game's own nightly matchup count is not meant to be 20k on its
// own).
export const CI_GAMES = 100;
export const NIGHTLY_GAMES = 2000;
export const CI_SEED_COUNT = 100;
export const NIGHTLY_SEED_COUNT = 1000;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UTC day arithmetic — supports negative offsets (yesterday) as well as the forward horizon
 *  `runSoloPuzzleCiGate`'s buffer check walks. */
export function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10)!;
}

/** Thrown when a registered score-chase game's package does not export `safeMove` — mirrors
 *  probes-solo.ts's `MissingSafeMoveError` posture at the repo-wiring layer: a missing hook is
 *  a hard error, never a silently skipped gate (plan §6/§7.4: "every solo score chase MUST
 *  export one"). */
export class SafeMoveNotExportedError extends Error {
  constructor(gameId: string) {
    super(
      `ci-gates: solo score-chase game "${gameId}" does not export a "safeMove" hook from its ` +
        `package root (@twist-arcade/${gameId}) — every score chase MUST supply one (platform ` +
        "§6/§7.4). This is a hard error, not a skipped gate."
    );
    this.name = "SafeMoveNotExportedError";
  }
}

export interface RunAllGatesDeps {
  /** Real wiring: `import(`@twist-arcade/${gameId}`)`, reading `.safeMove`. Injected so tests
   *  never need a real npm-linked game package. */
  resolveSafeMove(gameId: string): Promise<SafeMoveFn<Json, unknown> | undefined>;
  certBaseDir: string;
  today: string;
  dayFor: (isoDay: string, offset: number) => string;
}

function defaultDeps(): RunAllGatesDeps {
  return {
    async resolveSafeMove(gameId: string) {
      const mod = (await import(`@twist-arcade/${gameId}`)) as { safeMove?: SafeMoveFn<Json, unknown> };
      return mod.safeMove;
    },
    certBaseDir: CERT_BASE_DIR,
    today: todayUtc(),
    dayFor,
  };
}

export interface RunAllGatesOptions {
  suite: "ci" | "nightly";
  /** C13: restrict this run to exactly one registered game id (`--game <id>`). Omitted (the
   *  default) keeps the historical full-registry behavior — checking one game must never
   *  re-run every other game's gates too, which is exactly why this filter exists (a game
   *  team's own ship/no-ship check was growing linearly with the registry's size). */
  game?: string;
}

/** Thrown when `--game <id>` names something absent from the registry — a typo or a game that
 *  hasn't landed yet must be a loud, immediate refusal, never a silent "ran the whole registry
 *  anyway" or "ran nothing" (the same "a skipped gate and a passed gate must never look the
 *  same" discipline C2 applies to gate STATUS applies here to gate SELECTION). */
export class UnknownGameIdError extends Error {
  constructor(gameId: string, known: readonly string[]) {
    super(
      `ci-gates: --game "${gameId}" is not a registered game. Known: ${known.length > 0 ? known.join(", ") : "(registry is empty)"}.`
    );
    this.name = "UnknownGameIdError";
  }
}

/**
 * Runs the correct gate table for every entry in `registry`, keyed by `manifest.solo.format`
 * (never player count — C2), and returns one report per game. Games run in registry-key order
 * (sorted) so a fixed registry always produces a stably-ordered report list.
 */
export async function runAllGates(
  registry: Registry,
  opts: RunAllGatesOptions,
  deps: RunAllGatesDeps = defaultDeps()
): Promise<GameCiGateReport[]> {
  const reports: GameCiGateReport[] = [];
  const allGameIds = Object.keys(registry).sort();

  let gameIds = allGameIds;
  if (opts.game !== undefined) {
    if (!(opts.game in registry)) {
      throw new UnknownGameIdError(opts.game, allGameIds);
    }
    gameIds = [opts.game];
  }

  for (const gameId of gameIds) {
    const entry = registry[gameId]!;
    const engine = await entry.loadEngine();
    const kind = selectGateKind(entry.manifest);

    if (kind === "two-player") {
      const report = await runGameCiGate(engine, entry.manifest, {
        kind: "two-player",
        seed: `ci:${gameId}:${opts.suite}`,
        games: opts.suite === "nightly" ? NIGHTLY_GAMES : CI_GAMES,
        suite: opts.suite,
      });
      reports.push(report);
      continue;
    }

    if (kind === "solo-chase") {
      const safeMove = await deps.resolveSafeMove(gameId);
      if (!safeMove) throw new SafeMoveNotExportedError(gameId);
      const report = await runGameCiGate(engine, entry.manifest, {
        kind: "solo-chase",
        seed: `ci:${gameId}:${opts.suite}`,
        seedCount: opts.suite === "nightly" ? NIGHTLY_SEED_COUNT : CI_SEED_COUNT,
        safeMove,
        // C19: threads suite through so manifest.ciGateBudget.soloChaseCiRollouts (and the
        // hidden-info floor guard it's checked against) actually applies at the "ci" budget —
        // previously missing here entirely, so no registered solo-chase game's rollout budget
        // was ever suite-aware regardless of what its manifest declared.
        suite: opts.suite,
      });
      reports.push(report);
      continue;
    }

    // kind === "solo-puzzle"
    const report = await runGameCiGate(engine, entry.manifest, {
      kind: "solo-puzzle",
      baseDir: deps.certBaseDir,
      today: deps.today,
      dayFor: deps.dayFor,
    });
    reports.push(report);
  }

  return reports;
}

async function loadRegistry(): Promise<Registry> {
  const registryUrl = pathToFileURL(path.join(REPO_ROOT, "games/registry.ts")).href;
  const mod = (await import(registryUrl)) as { registry: Registry };
  return mod.registry;
}

function parseSuiteFlag(argv: readonly string[]): "ci" | "nightly" {
  const idx = argv.indexOf("--suite");
  const value = idx !== -1 ? argv[idx + 1] : "ci";
  if (value !== "ci" && value !== "nightly") {
    throw new Error(`ci-gates: --suite must be "ci" or "nightly", got ${JSON.stringify(value)}`);
  }
  return value;
}

/** C13: `--game <id>` restricts this run to one registered game. `undefined` (the flag
 *  omitted) keeps the historical full-registry run. */
function parseGameFlag(argv: readonly string[]): string | undefined {
  const idx = argv.indexOf("--game");
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("ci-gates: --game requires a value (a registered game id)");
  }
  return value;
}

async function main(): Promise<void> {
  const suite = parseSuiteFlag(process.argv.slice(2));
  const game = parseGameFlag(process.argv.slice(2));

  const registry = await loadRegistry();
  const gameIds = Object.keys(registry);
  if (gameIds.length === 0 && game === undefined) {
    console.log(
      "ci-gates: games/registry.ts has no registered games yet — nothing to gate. This is " +
        "expected before the first game team registers (plan §9); the moment a game lands in " +
        "the registry, this same run starts gating it for real."
    );
    return;
  }

  const reports = await runAllGates(registry, { suite, ...(game !== undefined ? { game } : {}) });
  for (const report of reports) {
    console.log(formatGameCiGateReport(report));
    console.log("");
  }

  const failing = reports.filter((r) => !r.ok);
  if (failing.length > 0) {
    console.error(`ci-gates: ${failing.length}/${reports.length} game(s) failed their gate table (${suite}).`);
    process.exitCode = 1;
    return;
  }
  console.log(`ci-gates: all ${reports.length} registered game(s) passed (${suite} suite).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  });
}

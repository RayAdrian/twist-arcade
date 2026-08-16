#!/usr/bin/env node
// scripts/harness-cli.ts — `pnpm harness <command> ...` — the REAL process entry point for the
// harness CLI (plan §7.1; C84, docs/plans/platform-corrections.md).
//
// packages/harness/src/cli.ts owns the PURE dispatch logic (`dispatch()`, `parseArgs()`) and
// takes an injected `CliDeps` — see that file's own module doc for the full C84 rationale. This
// file is the thin, untested, process-only "real wiring" half, structured exactly like
// scripts/ci-gates.ts's own `defaultDeps()` / `loadRegistry()` split:
//
//   - `defaultCliDeps()` below is the ONLY place in this whole call chain that does a real
//     `import(\`@twist-arcade/${gameId}\`)` (a game's package-root `safeMove` export) or a real
//     `games/registry.ts` dynamic import — repo-layout knowledge packages/harness deliberately
//     does not have (that package's own module doc), matching scripts/ci-gates.ts's
//     `resolveSafeMove`/`loadRegistry()` precisely.
//   - scripts/ is checked against the ROOT package.json (scripts/check-declared-deps.mjs's own
//     scope rule), which already declares every registered game (crackstep, fadeout,
//     mine-run, nine-grids, tilt) as a devDependency — so this file's templated dynamic import
//     resolves against a REAL declared dependency, no allowlist required. That is the actual
//     C84 fix: not exempting the finding, but moving the resolution to the layer that can
//     honestly declare it.
//
// Why this could not stay a self-executing packages/harness/src/cli.ts (the pre-C84 shape):
// crackstep and fadeout both already depend on @twist-arcade/harness, so packages/harness
// declaring the reverse edge back would be a real cycle (harness -> crackstep -> harness). A
// platform package cannot own the resolution that would require declaring that cycle; the app
// layer (scripts/) can, because scripts/ never appears on the other side of that edge.

import type { Json } from "@twist-arcade/engine";
import type { Registry } from "@twist-arcade/game-spec";
import { dispatch, type CliDeps, type DispatchResult } from "@twist-arcade/harness/cli";
import type { SafeMoveFn } from "@twist-arcade/harness";

const REPO_ROOT_URL = new URL("..", import.meta.url);

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

function main(): void {
  const result = dispatch(process.argv.slice(2), defaultCliDeps());
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

// Only run when this file is the actual process entry point (`tsx scripts/harness-cli.ts ...`),
// never when a test imports it — same guard scripts/ci-gates.ts and its siblings all use.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

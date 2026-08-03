#!/usr/bin/env node
// scripts/new-game.ts — `pnpm new-game <id> [--solo puzzle|chase]` (plan §8).
//
// Stamps `games/<id>/` from `templates/game/` (two-player) or `templates/game-solo/` (solo —
// puzzle or chase flavor), substitutes `__GAME_ID__`/`__PASCAL_ID__`/`__CAMEL_ID__`/`__TITLE__`
// placeholders, and inserts the registry entry at `games/registry.ts`'s `<new-game:insert>`
// marker. Hand-rolled (~250 lines incl. comments) rather than a templating dependency — the
// plan's own instruction ("no plop unless it stays smaller") holds: string substitution and a
// recursive file copy is all this needs.
//
// Two template flavors, not three: `templates/game-solo/` holds BOTH solo flavors' shared
// files plus flavor-specific variants suffixed `.chase` / `.puzzle` (e.g. `engine.ts.chase`,
// `solver.ts.puzzle`) — `copyTemplateTree` picks the right one and strips the suffix on copy,
// skipping the other flavor's variant entirely (plan §8: "same minus probes-mirror, plus
// solver.ts stub (puzzle) or safeMove probe stub (chase)").
//
// Same "pure logic vs thin main()" split as ci-gates.ts/cli.ts: every function below except
// `main()` takes its paths as arguments (no hardcoded `process.cwd()`), so tests can point
// `gamesDir`/`registryPath` at a scratch directory while still reading the REAL, checked-in
// `templates/` tree (read-only — perfectly safe to exercise for real in a test).

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export type SoloFlavor = "puzzle" | "chase";

export class InvalidGameIdError extends Error {
  constructor(id: string) {
    super(
      `new-game: "${id}" is not a valid game id — must be kebab-case, starting with a letter ` +
        '(e.g. "mine-run", "demo-solo").'
    );
    this.name = "InvalidGameIdError";
  }
}

export class GameAlreadyExistsError extends Error {
  constructor(id: string, where: string) {
    super(`new-game: "${id}" already exists (${where}) — pick a different id.`);
    this.name = "GameAlreadyExistsError";
  }
}

const GAME_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function validateGameId(id: string): void {
  if (!GAME_ID_PATTERN.test(id)) throw new InvalidGameIdError(id);
}

/** "mine-run" -> "MineRun" */
export function toPascalCase(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** "mine-run" -> "mineRun" — used for the exported engine const name (hyphens are not legal
 *  in a JS identifier, so the kebab id itself can never be used as one). */
export function toCamelCase(id: string): string {
  const pascal = toPascalCase(id);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** "mine-run" -> "Mine Run" — an editable placeholder for manifest.title, never assumed final
 *  (every template marks title as a TODO regardless). */
export function titleGuess(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface TemplateVars {
  gameId: string;
  pascalId: string;
  camelId: string;
  title: string;
}

export function templateVarsFor(id: string): TemplateVars {
  return { gameId: id, pascalId: toPascalCase(id), camelId: toCamelCase(id), title: titleGuess(id) };
}

export function substitutePlaceholders(content: string, vars: TemplateVars): string {
  return content
    .replaceAll("__GAME_ID__", vars.gameId)
    .replaceAll("__PASCAL_ID__", vars.pascalId)
    .replaceAll("__CAMEL_ID__", vars.camelId)
    .replaceAll("__TITLE__", vars.title);
}

/** Strips a trailing `.chase` / `.puzzle` flavor suffix from a template filename, or returns
 *  `undefined` if the file is the OTHER flavor's variant (meaning: skip it entirely). A file
 *  with neither suffix is shared and always copied verbatim. */
function resolveFlavorFilename(filename: string, flavor: SoloFlavor | undefined): string | undefined {
  if (filename.endsWith(".chase")) {
    return flavor === "chase" ? filename.slice(0, -".chase".length) : undefined;
  }
  if (filename.endsWith(".puzzle")) {
    return flavor === "puzzle" ? filename.slice(0, -".puzzle".length) : undefined;
  }
  return filename;
}

/** Recursively copies `templateDir` into `destDir`, substituting placeholders in every file's
 *  text content, resolving `.chase`/`.puzzle` flavor variants per `resolveFlavorFilename`
 *  (a no-op — every file is shared — when `flavor` is undefined, the two-player template). */
async function copyTemplateTree(
  templateDir: string,
  destDir: string,
  vars: TemplateVars,
  flavor: SoloFlavor | undefined
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(templateDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplateTree(srcPath, path.join(destDir, entry.name), vars, flavor);
      continue;
    }
    const destName = resolveFlavorFilename(entry.name, flavor);
    if (destName === undefined) continue; // the other flavor's variant — skip
    const raw = await readFile(srcPath, "utf8");
    await writeFile(path.join(destDir, destName), substitutePlaceholders(raw, vars));
  }
}

export interface RegistryInsertion {
  importLine: string;
  entryBlock: string;
}

export function buildRegistryInsertion(vars: TemplateVars, flavor: SoloFlavor | undefined): RegistryInsertion {
  const importLine = `import { manifest as ${vars.camelId}Manifest } from "./${vars.gameId}/manifest";`;
  const loadSolverLine =
    flavor === "puzzle"
      ? `\n    loadSolver: () => import("@twist-arcade/${vars.gameId}").then((m) => m.solver),`
      : "";
  const entryBlock =
    `  "${vars.gameId}": {\n` +
    `    manifest: ${vars.camelId}Manifest,\n` +
    `    loadEngine: () => import("@twist-arcade/${vars.gameId}").then((m) => m.${vars.camelId}),\n` +
    `    loadPresentation: () => import("@twist-arcade/${vars.gameId}").then((m) => m.presentation),${loadSolverLine}\n` +
    `  },\n`;
  return { importLine, entryBlock };
}

const MARKER = "// <new-game:insert>";

export class RegistryMarkerNotFoundError extends Error {
  constructor(registryPath: string) {
    super(`new-game: could not find "${MARKER}" in ${registryPath} — has the marker been removed?`);
    this.name = "RegistryMarkerNotFoundError";
  }
}

/**
 * Inserts the new game's manifest import (right after the last existing `import` line) and
 * its registry entry (right before the `<new-game:insert>` marker) into `registrySource`.
 * Pure string transform — easy to test against a hand-built registry.ts string, and the same
 * function `main()` uses against the real file.
 */
export function insertRegistryEntry(registrySource: string, insertion: RegistryInsertion): string {
  if (!registrySource.includes(MARKER)) throw new RegistryMarkerNotFoundError("games/registry.ts");

  const lines = registrySource.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("import ")) lastImportIdx = i;
  }
  if (lastImportIdx === -1) {
    throw new Error("new-game: games/registry.ts has no import lines to insert after — has it been restructured?");
  }
  lines.splice(lastImportIdx + 1, 0, insertion.importLine);

  // Splice the entry block's OWN lines in immediately before the marker line, leaving the
  // marker line itself (and its existing indentation) completely untouched — a naive
  // string .replace(MARKER, entryBlock + MARKER) would instead concatenate the entry block's
  // own leading indentation onto whatever whitespace already precedes the marker in the
  // source, double-indenting the very first line of every inserted entry.
  const markerIdx = lines.findIndex((l) => l.includes(MARKER));
  if (markerIdx === -1) {
    throw new RegistryMarkerNotFoundError("games/registry.ts");
  }
  const entryLines = insertion.entryBlock.replace(/\n$/, "").split("\n");
  lines.splice(markerIdx, 0, ...entryLines);

  return lines.join("\n");
}

export interface GenerateGameOptions {
  id: string;
  solo?: SoloFlavor;
  templatesRoot: string; // e.g. path.join(repoRoot, "templates")
  gamesDir: string; // e.g. path.join(repoRoot, "games") — the PARENT dir; games/<id> is created inside it
  registryPath: string; // e.g. path.join(repoRoot, "games/registry.ts")
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates, stamps the template tree, and updates the registry. Throws
 * `GameAlreadyExistsError` if `games/<id>` already exists OR the registry already mentions the
 * id (a defensive belt-and-braces check — the directory check alone would miss a hand-edited
 * registry entry pointing at a not-yet-created directory).
 */
export async function generateGame(opts: GenerateGameOptions): Promise<string> {
  validateGameId(opts.id);

  const destDir = path.join(opts.gamesDir, opts.id);
  if (await pathExists(destDir)) {
    throw new GameAlreadyExistsError(opts.id, destDir);
  }
  const registrySource = await readFile(opts.registryPath, "utf8");
  if (registrySource.includes(`"${opts.id}"`)) {
    throw new GameAlreadyExistsError(opts.id, opts.registryPath);
  }

  const vars = templateVarsFor(opts.id);
  const templateDir = path.join(opts.templatesRoot, opts.solo ? "game-solo" : "game");
  await copyTemplateTree(templateDir, destDir, vars, opts.solo);

  const insertion = buildRegistryInsertion(vars, opts.solo);
  const updatedRegistry = insertRegistryEntry(registrySource, insertion);
  await writeFile(opts.registryPath, updatedRegistry);

  return destDir;
}

// ---------------------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------------------

function parseCliArgs(argv: readonly string[]): { id: string; solo?: SoloFlavor } {
  const [id, ...rest] = argv;
  if (!id) {
    throw new Error('new-game: missing <id> — usage: pnpm new-game <id> [--solo puzzle|chase]');
  }
  const soloFlagIdx = rest.indexOf("--solo");
  if (soloFlagIdx === -1) return { id };
  const value = rest[soloFlagIdx + 1];
  if (value !== "puzzle" && value !== "chase") {
    throw new Error(`new-game: --solo must be "puzzle" or "chase", got ${JSON.stringify(value)}`);
  }
  return { id, solo: value };
}

async function main(): Promise<void> {
  const { id, solo } = parseCliArgs(process.argv.slice(2));
  const destDir = await generateGame({
    id,
    ...(solo ? { solo } : {}),
    templatesRoot: path.join(REPO_ROOT, "templates"),
    gamesDir: path.join(REPO_ROOT, "games"),
    registryPath: path.join(REPO_ROOT, "games/registry.ts"),
  });

  console.log(`new-game: stamped ${path.relative(REPO_ROOT, destDir)}/ (${solo ? `solo ${solo}` : "two-player"})`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Read ${path.relative(REPO_ROOT, destDir)}/CHECKLIST.md`);
  console.log(`  2. pnpm --filter @twist-arcade/${id} test    # watch engineContract fail red (termination)`);
  console.log(`  3. Implement engine.ts's status() TODO, then watch it turn green`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  });
}

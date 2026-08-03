// scripts/test/new-game.test.ts — TDD anchor for the M5 scaffold generator
// (scripts/new-game.ts). Unit tests for the pure string-transform helpers, plus an
// integration test that stamps BOTH flavors for real (against the REAL, checked-in
// templates/ tree, read-only) into a scratch directory and asserts the generated tree
// compiles and its contract suite fails ONLY on the TODO engine.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRegistryInsertion,
  generateGame,
  GameAlreadyExistsError,
  insertRegistryEntry,
  InvalidGameIdError,
  RegistryMarkerNotFoundError,
  substitutePlaceholders,
  templateVarsFor,
  titleGuess,
  toCamelCase,
  toPascalCase,
  validateGameId,
} from "../new-game";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(__dirname, "..", "..");

describe("id transforms", () => {
  it("toPascalCase", () => {
    expect(toPascalCase("mine-run")).toBe("MineRun");
    expect(toPascalCase("demo")).toBe("Demo");
    expect(toPascalCase("demo-solo")).toBe("DemoSolo");
  });

  it("toCamelCase", () => {
    expect(toCamelCase("mine-run")).toBe("mineRun");
    expect(toCamelCase("demo")).toBe("demo");
  });

  it("titleGuess", () => {
    expect(titleGuess("mine-run")).toBe("Mine Run");
  });
});

describe("validateGameId", () => {
  it("accepts kebab-case ids", () => {
    expect(() => validateGameId("demo")).not.toThrow();
    expect(() => validateGameId("demo-solo")).not.toThrow();
    expect(() => validateGameId("a1-b2")).not.toThrow();
  });

  it("rejects non-kebab-case ids", () => {
    for (const bad of ["Demo", "demo_solo", "1demo", "-demo", "demo-", "de mo", ""]) {
      expect(() => validateGameId(bad), bad).toThrow(InvalidGameIdError);
    }
  });
});

describe("substitutePlaceholders", () => {
  it("replaces every marker, including repeats", () => {
    const vars = templateVarsFor("demo-solo");
    const out = substitutePlaceholders(
      "id=__GAME_ID__ pascal=__PASCAL_ID__ camel=__CAMEL_ID__ title=__TITLE__ again=__GAME_ID__",
      vars
    );
    expect(out).toBe("id=demo-solo pascal=DemoSolo camel=demoSolo title=Demo Solo again=demo-solo");
  });
});

describe("buildRegistryInsertion", () => {
  it("two-player: no loadSolver line", () => {
    const insertion = buildRegistryInsertion(templateVarsFor("demo"), undefined);
    expect(insertion.importLine).toBe('import { manifest as demoManifest } from "./demo/manifest";');
    expect(insertion.entryBlock).not.toContain("loadSolver");
    expect(insertion.entryBlock).toContain('loadEngine: () => import("@twist-arcade/demo").then((m) => m.demo),');
  });

  it("solo chase: no loadSolver line either (chases have no solver)", () => {
    const insertion = buildRegistryInsertion(templateVarsFor("demo-chase"), "chase");
    expect(insertion.entryBlock).not.toContain("loadSolver");
  });

  it("solo puzzle: includes loadSolver", () => {
    const insertion = buildRegistryInsertion(templateVarsFor("demo-puzzle"), "puzzle");
    expect(insertion.entryBlock).toContain('loadSolver: () => import("@twist-arcade/demo-puzzle").then((m) => m.solver),');
  });
});

describe("insertRegistryEntry", () => {
  const EMPTY_REGISTRY = [
    'import type { Registry } from "@twist-arcade/game-spec";',
    "",
    "export const registry: Registry = {",
    "  // <new-game:insert>",
    "};",
    "",
  ].join("\n");

  it("inserts the import after the last import line and the entry before the marker", () => {
    const insertion = buildRegistryInsertion(templateVarsFor("demo"), undefined);
    const result = insertRegistryEntry(EMPTY_REGISTRY, insertion);
    expect(result).toContain('import { manifest as demoManifest } from "./demo/manifest";');
    expect(result.indexOf('import { manifest as demoManifest }')).toBeGreaterThan(
      result.indexOf('import type { Registry }')
    );
    expect(result).toContain('"demo": {');
    // Entry appears BEFORE the marker, not after.
    expect(result.indexOf('"demo": {')).toBeLessThan(result.indexOf("<new-game:insert>"));
  });

  it("throws RegistryMarkerNotFoundError when the marker is missing", () => {
    const insertion = buildRegistryInsertion(templateVarsFor("demo"), undefined);
    expect(() => insertRegistryEntry("no marker here", insertion)).toThrow(RegistryMarkerNotFoundError);
  });

  it("is idempotent-safe against a SECOND game inserted after the first (both entries present, valid syntax shape)", () => {
    const first = insertRegistryEntry(EMPTY_REGISTRY, buildRegistryInsertion(templateVarsFor("demo"), undefined));
    const second = insertRegistryEntry(first, buildRegistryInsertion(templateVarsFor("demo-two"), undefined));
    expect(second).toContain('"demo": {');
    expect(second).toContain('"demo-two": {');
  });
});

describe("generateGame — end-to-end stamping against the REAL templates/ tree", () => {
  let scratchRoot: string;
  let gamesDir: string;
  let registryPath: string;

  beforeEach(async () => {
    scratchRoot = await mkdtemp(path.join(tmpdir(), "new-game-scratch-"));
    gamesDir = path.join(scratchRoot, "games");
    await mkdir(gamesDir, { recursive: true });
    registryPath = path.join(gamesDir, "registry.ts");
    await writeFile(
      registryPath,
      [
        'import type { Registry } from "@twist-arcade/game-spec";',
        "",
        "export const registry: Registry = {",
        "  // <new-game:insert>",
        "};",
        "",
      ].join("\n")
    );
  });

  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it("stamps a two-player game tree with every expected file", async () => {
    const destDir = await generateGame({
      id: "demo",
      templatesRoot: path.join(REPO_ROOT, "templates"),
      gamesDir,
      registryPath,
    });
    for (const f of [
      "package.json",
      "tsconfig.json",
      "vitest.config.ts",
      "manifest.ts",
      "manifest.test.ts",
      "engine.ts",
      "engine.test.ts",
      "heuristic.ts",
      "probes.ts",
      "index.ts",
      "CHECKLIST.md",
      "ui/Board.tsx",
    ]) {
      const raw = await readFile(path.join(destDir, f), "utf8");
      expect(raw.length, f).toBeGreaterThan(0);
      expect(raw, `${f} should have no leftover placeholders`).not.toMatch(/__[A-Z_]+__/);
    }
    const registryOut = await readFile(registryPath, "utf8");
    expect(registryOut).toContain('"demo": {');
    expect(registryOut).not.toContain("loadSolver"); // two-player: no solver slot at all
  });

  it("stamps a solo CHASE tree: probes.ts present (safeMove), solver.ts absent", async () => {
    const destDir = await generateGame({
      id: "demo-chase",
      solo: "chase",
      templatesRoot: path.join(REPO_ROOT, "templates"),
      gamesDir,
      registryPath,
    });
    const probes = await readFile(path.join(destDir, "probes.ts"), "utf8");
    expect(probes).toContain("export function safeMove");
    await expect(readFile(path.join(destDir, "solver.ts"), "utf8")).rejects.toThrow();

    const manifest = await readFile(path.join(destDir, "manifest.ts"), "utf8");
    expect(manifest).toContain('format: "score-chase"');
  });

  it("stamps a solo PUZZLE tree: solver.ts present, probes.ts absent", async () => {
    const destDir = await generateGame({
      id: "demo-puzzle",
      solo: "puzzle",
      templatesRoot: path.join(REPO_ROOT, "templates"),
      gamesDir,
      registryPath,
    });
    const solver = await readFile(path.join(destDir, "solver.ts"), "utf8");
    expect(solver).toContain("export const solver");
    await expect(readFile(path.join(destDir, "probes.ts"), "utf8")).rejects.toThrow();

    const manifest = await readFile(path.join(destDir, "manifest.ts"), "utf8");
    expect(manifest).toContain('format: "daily-puzzle"');
  });

  it("refuses to stamp over an existing game directory", async () => {
    await generateGame({ id: "demo", templatesRoot: path.join(REPO_ROOT, "templates"), gamesDir, registryPath });
    await expect(
      generateGame({ id: "demo", templatesRoot: path.join(REPO_ROOT, "templates"), gamesDir, registryPath })
    ).rejects.toThrow(GameAlreadyExistsError);
  });

  it("refuses an invalid id before touching the filesystem", async () => {
    await expect(
      generateGame({ id: "Bad_Id", templatesRoot: path.join(REPO_ROOT, "templates"), gamesDir, registryPath })
    ).rejects.toThrow(InvalidGameIdError);
  });
});

// ---------------------------------------------------------------------------------------
// The plan §8 observable-acceptance test, run for REAL: `pnpm new-game demo` (equivalent, via
// generateGame + a real `tsc`/`vitest` invocation against the stamped tree) compiles and its
// contract suite fails ONLY on the TODO engine. This is the slow, expensive, end-to-end proof
// — everything above already covers the generator's own logic quickly; this proves what the
// generator PRODUCES is real. Skipped by default in the normal `pnpm test` run (it shells out
// to tsc/vitest against a scratch workspace copy, on the order of tens of seconds) — run
// explicitly via `RUN_SCAFFOLD_E2E=1 pnpm test scripts/test/new-game.test.ts`.
// ---------------------------------------------------------------------------------------

const RUN_E2E = process.env.RUN_SCAFFOLD_E2E === "1";

describe.runIf(RUN_E2E)("generateGame — compiles for real and fails only on the TODO engine", () => {
  it(
    "two-player: pnpm install && pnpm typecheck (scoped) && pnpm test (scoped) — red only on termination",
    async () => {
      const destDir = await generateGame({
        id: "e2e-demo",
        templatesRoot: path.join(REPO_ROOT, "templates"),
        gamesDir: path.join(REPO_ROOT, "games"),
        registryPath: path.join(REPO_ROOT, "games/registry.ts"),
      });
      try {
        await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: REPO_ROOT });
        await execFileAsync("pnpm", ["--filter", "@twist-arcade/e2e-demo", "typecheck"], { cwd: REPO_ROOT });
        await expect(
          execFileAsync("pnpm", ["--filter", "@twist-arcade/e2e-demo", "test"], { cwd: REPO_ROOT })
        ).rejects.toMatchObject({ stdout: expect.stringContaining("termination") });
      } finally {
        await rm(destDir, { recursive: true, force: true });
        const registrySource = await readFile(path.join(REPO_ROOT, "games/registry.ts"), "utf8");
        await writeFile(
          path.join(REPO_ROOT, "games/registry.ts"),
          registrySource
            .split("\n")
            .filter((l) => !l.includes("e2e-demo"))
            .join("\n")
        );
      }
    },
    120_000
  );
});

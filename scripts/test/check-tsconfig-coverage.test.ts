// scripts/test/check-tsconfig-coverage.test.ts
//
// C69 (docs/plans/platform-corrections.md): games/bid-tac-toe's tsconfig `include` glob
// never covered its solver, so the exact-solve oracle had never been typechecked, despite
// `pnpm typecheck` passing the whole time. C72: the audit C69 owed found a second instance,
// shipped on `main` — games/tilt's tsconfig was missing `ui/**/*.ts`, so
// games/tilt/ui/board-view.test.ts ran 16 tests every run with its types never checked.
// Both were found by a human reading globs and guessing what they covered — the failure
// mode this script exists to remove. scripts/check-tsconfig-coverage.mjs asks the compiler
// directly (`tsc -p <pkg>/tsconfig.json --noEmit --listFiles`) and diffs that against every
// real *.ts/*.tsx/*.mts/*.cts file on disk under the package, per C72's "ask the tool what
// it actually processed" rule.
//
// These tests plant real files/tsconfigs into the real tree and run the real script as a
// subprocess (mirroring packages/engine/test/check-engine-purity.test.ts) — a mocked
// filesystem or a mocked tsc would test a prediction of coverage, which is exactly the
// failure mode C72 diagnosed. Every planted fixture is removed in a `finally`.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = join(repoRoot, "scripts/check-tsconfig-coverage.mjs");

function runScript(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("scripts/check-tsconfig-coverage.mjs", () => {
  it("passes cleanly on the current (healthy) tree — both C69 and C72's defects are already fixed here", () => {
    const result = runScript();
    expect(result.status).toBe(0);
  }, 30_000);

  it("discovers a brand-new package from pnpm-workspace.yaml's glob rather than a hardcoded list, and catches its coverage gap unprompted", () => {
    const pkgDir = join(repoRoot, "games/__qa_coverage_probe__");
    mkdirSync(pkgDir, { recursive: true });
    try {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@twist-arcade/__qa_coverage_probe__", private: true, version: "0.0.0" }, null, 2)
      );
      // include only "covered.ts" — "missed.ts" exists on disk but is never named.
      writeFileSync(
        join(pkgDir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: { strict: true, module: "ESNext", moduleResolution: "bundler", noEmit: true },
            include: ["covered.ts"],
          },
          null,
          2
        )
      );
      writeFileSync(join(pkgDir, "covered.ts"), "export const covered = 1;\n");
      writeFileSync(join(pkgDir, "missed.ts"), "export const missed = 2;\n");

      const result = runScript();
      expect(result.status).toBe(1);
      const out = result.stdout + result.stderr;
      expect(out).toMatch(/games\/__qa_coverage_probe__\/missed\.ts/);
      expect(out).not.toMatch(/games\/__qa_coverage_probe__\/covered\.ts/);
    } finally {
      rmSync(pkgDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails the exact historical C72 defect: dropping ui/**/*.ts from games/tilt's tsconfig re-excludes ui/board-view.test.ts", () => {
    const tiltTsconfigPath = join(repoRoot, "games/tilt/tsconfig.json");
    const original = readFileSync(tiltTsconfigPath, "utf8");
    try {
      // The exact pre-fix (59e2c08) shape from C72: ["*.ts", "ui/**/*.tsx", "test/**/*.ts"].
      const broken = original.replace(
        /"include":\s*\[[^\]]*\]/s,
        '"include": ["*.ts", "ui/**/*.tsx", "test/**/*.ts"]'
      );
      expect(broken).not.toBe(original); // sanity: the replace actually matched something
      writeFileSync(tiltTsconfigPath, broken);

      const result = runScript();
      expect(result.status).toBe(1);
      const out = result.stdout + result.stderr;
      // Only the leaf test file is actually flagged: games/tilt/ui/board-view.ts (the
      // non-test module) is still pulled into the compiler's program transitively — it's
      // imported by another file that IS in scope — so removing the glob doesn't drop it
      // from `--listFiles`. board-view.test.ts is a leaf nothing imports, so it's reachable
      // ONLY via the `include` glob; that's the one C72 itself names, and the only one this
      // guard can (or should) catch by definition — matching that exactly is the proof this
      // reproduces the real historical defect, not a broader claim about the whole file.
      expect(out).toMatch(/games\/tilt\/ui\/board-view\.test\.ts/);
      expect(out).toMatch(/games\/tilt/);
    } finally {
      writeFileSync(tiltTsconfigPath, original);
    }
  }, 30_000);

  it("states the vitest.config.ts allowlist explicitly by exact path (C72 Finding 2) rather than staying silent about it", () => {
    const result = runScript();
    expect(result.status).toBe(0);
    // Explicit, not silent: the clean run's own output names what it chose not to flag.
    expect(result.stdout).toMatch(/packages\/engine\/vitest\.config\.ts/);
    expect(result.stdout).toMatch(/allowlist/i);
  }, 30_000);

  it("does not let the vitest.config.ts allowlist swallow a differently-named uncovered file at the same package root", () => {
    // packages/harness's include is ["src/**/*.ts", "test/**/*.ts"] — a file sitting at the
    // package root matches neither glob, same as its legitimately-allowlisted
    // vitest.config.ts sibling. This one must still fail: the allowlist is an exact-path
    // list, not a "config-ish root file" pattern.
    const plantPath = join(repoRoot, "packages/harness/vitest.setup.ts");
    writeFileSync(plantPath, "export const setup = true;\n");
    try {
      const result = runScript();
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/packages\/harness\/vitest\.setup\.ts/);
    } finally {
      rmSync(plantPath, { force: true });
    }
  }, 30_000);
});

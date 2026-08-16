// scripts/test/check-declared-deps.test.ts
//
// C83 (docs/plans/platform-corrections.md): four branches merged tonight, each typechecked,
// linted, tested, byte-identity-verified and stage-6 reviewed. Running the real gate table on
// `main` then failed instantly: "Cannot find package '@twist-arcade/fadeout' imported from
// scripts/ci-gates.ts". The root package.json declared crackstep, mine-run, nine-grids and
// tilt -- never fadeout. It had only ever resolved because a stale node_modules symlink was
// present, and that night's worktree teardowns pruned it. Every branch passed because each
// worktree resolved independently -- the defect existed only in the integration.
//
// scripts/check-declared-deps.mjs compares every workspace package's real imports (static AND
// templated-dynamic) against its own declared dependencies, in the same posture as
// scripts/check-engine-purity.mjs and scripts/check-tsconfig-coverage.mjs: plant real files
// into the real tree, run the real script as a subprocess, assert on its actual stdout/stderr,
// clean up in `finally`. A mocked filesystem or a mocked import graph would test a prediction
// of what resolves, which is the exact failure mode C83 diagnosed.
//
// C84: the guard's first real run found four undeclared resolutions, all at
// packages/harness/src/cli.ts:151 -- and the obvious fix (declare them) would have created a
// real cycle for two of the four (crackstep, fadeout both already depend on
// @twist-arcade/harness). The ruling was to allowlist the four specific (file, line, package)
// findings, printed and explicit, WITHOUT blanket-skipping templated-import detection, while
// the real fix (inverting the CLI's game resolution to injection) was registered as its own
// work. That real fix is DONE: packages/harness/src/cli.ts no longer resolves a game package
// by name at all -- the real wiring moved to scripts/harness-cli.ts, which resolves cleanly
// against the ALREADY-declared root package.json (scripts/ is checked against it), so the
// allowlist that used to carry the four cli.ts:151 entries is now empty. Tested below alongside
// the original C83 acceptance test.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = join(repoRoot, "scripts/check-declared-deps.mjs");
const rootPkgPath = join(repoRoot, "package.json");

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

describe("scripts/check-declared-deps.mjs", () => {
  it(
    "fails the exact historical C83 defect: removing @twist-arcade/fadeout from the root " +
      "package.json is caught via scripts/ci-gates.ts's templated dynamic import",
    () => {
      const original = readFileSync(rootPkgPath, "utf8");
      try {
        const pkg = JSON.parse(original);
        expect(pkg.dependencies["@twist-arcade/fadeout"]).toBeDefined(); // sanity: it's there today
        delete pkg.dependencies["@twist-arcade/fadeout"];
        writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + "\n");

        const result = runScript();
        expect(result.status).toBe(1);
        const out = result.stdout + result.stderr;
        expect(out).toMatch(/scripts\/ci-gates\.ts/);
        expect(out).toMatch(/@twist-arcade\/fadeout/);
        // Named as a templated-dynamic expansion, not a plain bare specifier -- the whole
        // point is that no static string literal ever names "@twist-arcade/fadeout" here.
        expect(out).toMatch(/@twist-arcade\/\$\{gameId\}/);
      } finally {
        writeFileSync(rootPkgPath, original);
      }
    },
    30_000
  );

  it(
    "passes cleanly on the tree as it stands (C84, fixed): packages/harness no longer resolves a " +
      "game package by name at all, so the ALLOWLIST that used to carry the four " +
      "packages/harness/src/cli.ts:151 findings is empty -- a clean pass, not an exemption",
    () => {
      const result = runScript();
      expect(result.status).toBe(0);
      const out = result.stdout + result.stderr;
      // No cli.ts:151 templated resolution exists anymore -- packages/harness's dispatch()
      // takes an injected CliDeps and performs no dynamic import of a game package itself.
      expect(out).not.toMatch(/packages\/harness\/src\/cli\.ts:151/);
      expect(out).toMatch(/0 exact \(file, line, resolved package\) finding\(s\)/);
      expect(out).toMatch(/✓ packages\/harness -- every import resolved against a declared dependency/);
      // The real wiring now lives in scripts/, resolving against the ALREADY-declared root
      // package.json (no allowlist needed there either).
      expect(out).toMatch(/✓ scripts\/ .* -- every import resolved against a declared dependency/);
    },
    30_000
  );

  it(
    "does NOT declare packages/harness's dependencies to force this green -- packages/harness/package.json " +
      "still omits crackstep, fadeout, nine-grids, and tilt (the fix was inversion to injection, not the manifest)",
    () => {
      const pkg = JSON.parse(readFileSync(join(repoRoot, "packages/harness/package.json"), "utf8"));
      const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]);
      for (const missing of ["@twist-arcade/crackstep", "@twist-arcade/fadeout", "@twist-arcade/nine-grids", "@twist-arcade/tilt"]) {
        expect(declared.has(missing)).toBe(false);
      }
    }
  );

  it(
    "the (now-empty) allowlist mechanism does NOT blanket-skip templated-import detection: a NEW " +
      "resolution planted directly in packages/harness still fails (C84 ruling 3's posture, still enforced)",
    () => {
      const plantPath = join(repoRoot, "packages/harness/src/__qa_layering_probe__.ts");
      writeFileSync(
        plantPath,
        "export async function probe(gameId: string) {\n  return import(`@twist-arcade/${gameId}`);\n}\n"
      );
      try {
        const result = runScript();
        expect(result.status).toBe(1);
        const out = result.stdout + result.stderr;
        expect(out).toMatch(/__qa_layering_probe__\.ts/);
        // Same package names as the allowlisted cli.ts:151 findings, but a DIFFERENT file/line
        // -- the allowlist's exact-tuple keying must not swallow this.
        expect(out).toMatch(/@twist-arcade\/crackstep/);
      } finally {
        rmSync(plantPath, { force: true });
      }
    },
    30_000
  );

  it("discovers a brand-new workspace package via pnpm-workspace.yaml's glob and catches an undeclared bare import in it, unprompted", () => {
    const pkgDir = join(repoRoot, "packages/__qa_deps_probe__");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    try {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@twist-arcade/__qa_deps_probe__", private: true, version: "0.0.0", dependencies: {} }, null, 2)
      );
      writeFileSync(join(pkgDir, "src", "index.ts"), 'import fc from "fast-check";\nexport const probe = fc;\n');

      const result = runScript();
      expect(result.status).toBe(1);
      const out = result.stdout + result.stderr;
      expect(out).toMatch(/packages\/__qa_deps_probe__\/src\/index\.ts/);
      expect(out).toMatch(/fast-check/);
    } finally {
      rmSync(pkgDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails loudly on a templated scoped dynamic import with no registered expansion-set resolver, rather than silently skipping it", () => {
    const plantPath = join(repoRoot, "scripts", "__qa_unknown_scope_probe__.ts");
    writeFileSync(plantPath, "export async function probe(id: string) {\n  return import(`@some-other-scope/${id}`);\n}\n");
    try {
      const result = runScript();
      expect(result.status).toBe(1);
      const out = result.stdout + result.stderr;
      expect(out).toMatch(/__qa_unknown_scope_probe__\.ts/);
      expect(out).toMatch(/@some-other-scope\//);
      expect(out).toMatch(/no.*expansion-set resolver/i);
    } finally {
      rmSync(plantPath, { force: true });
    }
  }, 30_000);

  it("prints its own scope boundary at runtime (C79 ruling 1), naming what it does and does not check and why", () => {
    const result = runScript();
    const out = result.stdout + result.stderr;
    expect(out).toMatch(/OUT OF SCOPE/);
    expect(out).toMatch(/app\//);
    expect(out).toMatch(/supabase\//);
    // scripts/ is the opposite of check-tsconfig-coverage.mjs's posture -- it must be IN
    // scope here, since scripts/ci-gates.ts is literally where the C83 defect lived. The
    // guard's own output should say so, not just this test's comment.
    expect(out).toMatch(/scripts\//);
    expect(out).toMatch(/C83/);
    expect(out).toMatch(/ALLOWLIST/);
    expect(out).toMatch(/C84/);
  }, 30_000);

  it("reports its own measured runtime", () => {
    const result = runScript();
    const out = result.stdout + result.stderr;
    expect(out).toMatch(/\d+(\.\d+)?\s*ms/);
  }, 30_000);
});

// packages/engine/test/check-engine-purity.test.ts
//
// M1 review finding 9 + DoD line "packages/engine has zero runtime dependencies (CI
// dependency check)" (WS-006/WS-007 in the QA test plan — the script existed with zero test
// coverage). scripts/check-engine-purity.mjs checked (1) package.json#dependencies is empty
// and (2) no react/react-dom/next imports — but never scanned for a bare (non-relative,
// non-node-builtin) import of an undeclared package. `import fc from "fast-check"` inside
// src/ would pass both existing checks (fast-check isn't react, and the package.json check
// only looks at the manifest, not actual imports) AND pass `pnpm test`/`pnpm typecheck`
// (fast-check is a real, installed devDependency) — then break every real consumer at
// runtime, since devDependencies are not installed for consumers of the published package.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptPath = join(repoRoot, "scripts/check-engine-purity.mjs");

function runScript(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("scripts/check-engine-purity.mjs", () => {
  it("passes cleanly on the current (healthy) tree", () => {
    const result = runScript();
    expect(result.status).toBe(0);
  });

  it("fails a bare devDependency import (e.g. fast-check) planted in packages/engine/src (M1 review finding 9)", () => {
    const plantPath = join(repoRoot, "packages/engine/src/__qa_purity_probe__.ts");
    writeFileSync(
      plantPath,
      'import fc from "fast-check";\nexport function probe() { return fc; }\n'
    );
    try {
      const result = runScript();
      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/fast-check/);
    } finally {
      rmSync(plantPath, { force: true });
    }
  });

  it("still fails a react import planted in src/ (regression guard on the pre-existing check)", () => {
    const plantPath = join(repoRoot, "packages/engine/src/__qa_purity_probe_react__.ts");
    writeFileSync(plantPath, 'import type { FC } from "react";\nexport type Probe = FC;\n');
    try {
      const result = runScript();
      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/react/);
    } finally {
      rmSync(plantPath, { force: true });
    }
  });

  it("does not flag relative imports or Node builtins", () => {
    const plantPath = join(repoRoot, "packages/engine/src/__qa_purity_probe_ok__.ts");
    writeFileSync(
      plantPath,
      'import type { Json } from "./types";\nimport { readFileSync } from "node:fs";\nexport type { Json };\nexport { readFileSync };\n'
    );
    try {
      const result = runScript();
      expect(result.status).toBe(0);
    } finally {
      rmSync(plantPath, { force: true });
    }
  });
});

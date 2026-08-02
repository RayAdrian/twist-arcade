// packages/engine/test/testkit-import-boundary.test.ts
//
// M1 review finding 2: the testkit's vitest-dependent adapter (testkit/contract.ts) and its
// vitest-FREE checks (testkit/checks.ts, incl. verifyCertificate) must be genuinely separable
// — the destined consumers of the latter (the M3d `harness certify` loop, the nightly
// certificate re-verifier) are plain Node CI jobs, not vitest workers. This test proves the
// split actually holds by spawning real, separate processes via `tsx` (the project's
// confirmed tooling for running .ts files directly, per plan §2) — the same execution path a
// real plain-Node consumer would use. It intentionally does NOT import either module inside
// vitest's own process, because that would prove nothing: vitest's process already has
// vitest's internal state initialized, which is exactly the condition a real consumer lacks.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tsxBin = join(repoRoot, "node_modules/.bin/tsx");

function runViaTsx(scriptContents: string): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "testkit-import-boundary-"));
  const scriptPath = join(dir, "probe.mjs");
  writeFileSync(scriptPath, scriptContents);
  try {
    const stdout = execFileSync(tsxBin, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("testkit import boundary (M1 review finding 2)", () => {
  it("testkit/checks.ts (verifyCertificate + the check functions) imports cleanly in a plain Node/tsx process, outside vitest", () => {
    const result = runViaTsx(`
      import { verifyCertificate, checkPurity, checkTermination } from ${JSON.stringify(
        join(repoRoot, "packages/engine/testkit/checks.ts")
      )};
      if (typeof verifyCertificate !== "function") throw new Error("verifyCertificate missing");
      if (typeof checkPurity !== "function") throw new Error("checkPurity missing");
      if (typeof checkTermination !== "function") throw new Error("checkTermination missing");
      console.log("OK");
    `);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("OK");
    expect(result.status).toBe(0);
  });

  it("testkit/contract.ts (the vitest adapter) throws when imported outside a real vitest worker — pinning WHY the split is necessary", () => {
    const result = runViaTsx(`
      import { engineContract } from ${JSON.stringify(
        join(repoRoot, "packages/engine/testkit/contract.ts")
      )};
      console.log(typeof engineContract);
    `);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/vitest/i);
  });
});

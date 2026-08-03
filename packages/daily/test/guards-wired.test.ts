import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// packages/daily/test/guards-wired.test.ts — closes the class of bug must-fix 2 (stage-6
// review, 2026-08-03) found: `.github/workflows/ci.yml` invokes NONE of `guard:immutability`,
// `guard:era-changelog`, `guard:manifests`, so a committed retune of a shipped manifest merges
// green today. DY1's whole deliverable is enforcement, and enforcement that isn't invoked in CI
// doesn't exist. See ../CI.md for the exact steps to add (ci.yml is owned by another agent
// mid-edit for M4 right now, so this repo routes the fix through that file instead of editing
// the workflow directly).
//
// This test closes the CLASS, not just the instance: it fails if ANY `guard:*` script exists in
// package.json but no workflow step anywhere under .github/workflows/ invokes it BY NAME — a
// guard nobody calls is exactly this bug, and a future guard added the same way (defined, never
// wired) would recur silently without this check. It deliberately does NOT assert anything about
// the guards' own logic (immutability.test.ts / era-guard.test.ts already cover that with planted
// violations) — only that CI actually reaches for each one.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

function guardScriptNames(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "daily", "package.json"), "utf8")) as PackageJsonShape;
  return Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith("guard:"));
}

function allWorkflowText(): string {
  let entries: string[];
  try {
    entries = readdirSync(WORKFLOWS_DIR);
  } catch {
    return ""; // no workflows directory at all — every guard is trivially "not invoked".
  }
  return entries
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => readFileSync(path.join(WORKFLOWS_DIR, f), "utf8"))
    .join("\n---\n");
}

describe("guards-wired — every packages/daily guard:* script must be invoked somewhere in CI", () => {
  it("finds at least one guard:* script to check (a sanity check on this test itself)", () => {
    expect(guardScriptNames().length).toBeGreaterThan(0);
  });

  it("every guard:* script in package.json is referenced by name in some .github/workflows/*.yml", () => {
    const scripts = guardScriptNames();
    const workflowText = allWorkflowText();

    // A script is "invoked" if its name appears as a substring anywhere in the workflow YAML —
    // whether via `pnpm run guard:foo`, `pnpm --filter @twist-arcade/daily run guard:foo`, or a
    // future equivalent. This deliberately does NOT require a specific invocation FORM (that's
    // CI.md's job to specify precisely) — only that the name is referenced at all, so this test
    // stays stable across reasonable changes to how the step is written.
    const uninvoked = scripts.filter((name) => !workflowText.includes(name));

    expect(
      uninvoked,
      uninvoked.length > 0
        ? `${uninvoked.length} guard(s) defined in packages/daily/package.json but never invoked in .github/workflows/*.yml: ${uninvoked.join(", ")}. See packages/daily/CI.md for the steps to add.`
        : undefined
    ).toEqual([]);
  });
});

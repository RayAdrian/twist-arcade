// packages/shell/test/eslint-config.test.ts — stage-6 review C1: the flat config's two
// import-boundary rule blocks (board-path animation ban + registry-splitting) both key on
// `no-restricted-imports`. Flat config REPLACES (never merges) a same-key rule when a later
// block also matches a given file — so for every file both boundaries were meant to cover
// (the six shell board-path files, which also live under `packages/shell/src/**`), whichever
// block is declared LAST silently wins and the other's bans go dark. This test lints real
// SOURCE TEXT against the REAL repo `eslint.config.mjs` (via ESLint's flat-config programmatic
// API, `lintText` with a virtual `filePath` — no fixture files are written to disk; the path is
// only used to resolve which config blocks apply) so a future same-key block collision fails
// here before it ever ships silently, exactly like this one did.

import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// NOT `fileURLToPath(new URL("../../..", import.meta.url))` — under this package's jsdom test
// environment, jsdom's global `URL` resolves a relative-to-`import.meta.url` construction
// against jsdom's own `http://localhost:3000` document location instead of the given file://
// base (a known vitest+jsdom interaction), producing an http: URL that `fileURLToPath` then
// rejects. Plain path math on the already-resolved current-file path sidesteps it entirely.
const here = dirname(fileURLToPath(import.meta.url)); // .../packages/shell/test
const repoRoot = join(here, "..", "..", ".."); // -> repo root

async function lint(relPath: string, source: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(source, { filePath: join(repoRoot, relPath) });
  return result!;
}

function ruleIds(result: { messages: { ruleId: string | null }[] }): (string | null)[] {
  return result.messages.map((m) => m.ruleId);
}

describe("eslint.config.mjs — board-path import boundaries (C1)", () => {
  it("bans framer-motion on a board-path file (Cell.tsx)", async () => {
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'import { motion } from "framer-motion";\nexport function probe() { return motion; }\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("bans motion/react (the other ~30kB Motion One engine entry) on a board-path file (Cell.tsx)", async () => {
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'import { motion } from "motion/react";\nexport function probe() { return motion; }\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("does NOT ban bare 'motion' or motion/mini on a board-path file — motion/mini is the sanctioned API", async () => {
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'import { animate } from "motion/mini";\nexport function probe() { return animate; }\n'
    );
    expect(ruleIds(result)).not.toContain("no-restricted-imports");
  });

  it("still bans a game's engine via a THREE-level-up relative specifier from deep under app/play/** (C1b)", async () => {
    const result = await lint(
      "app/play/[gameId]/__lint_probe__.ts",
      'import "../../games/mine-run/engine";\nexport {};\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("also bans the same game engine import at ONE level up (bare-adjacent) from app/play/**", async () => {
    const result = await lint(
      "app/play/[gameId]/__lint_probe__.ts",
      'import "../games/mine-run/engine";\nexport {};\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("still enforces the registry-splitting ban (games/*/ui) on the same board-path file that also bans animation libs", async () => {
    // Regression guard for the exact bug this pass fixed: a board-path file (packages/shell/
    // src/**) must get BOTH boundaries, not whichever one's config block happens to load last.
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'import "../../../games/mine-run/ui";\nexport {};\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("allows framer-motion in chrome (ResultModal.tsx) — the ban is board-path only", async () => {
    const result = await lint(
      "packages/shell/src/components/ResultModal.tsx",
      'import { motion } from "framer-motion";\nexport function probe() { return motion; }\n'
    );
    expect(ruleIds(result)).not.toContain("no-restricted-imports");
  });
});

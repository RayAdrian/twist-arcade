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

// Hardcoded independently of the config's own exported BOARD_PATH_FILES (stage-6 re-review C1,
// blind spot B) — deliberately NOT `BOARD_PATH_FILES.map(...)` for the probe loop below. If the
// loop iterated the import directly, narrowing the config's real list (e.g. dropping
// BoardShell.tsx, exactly the planted mutation that slipped through before) would ALSO shrink
// this list at the same time, since both come from the same source file — the loop would then
// simply stop probing the dropped file and still show green, the very blind spot this rewrite
// exists to close. Keeping this list literal means the probe for each of these six paths runs
// against whatever the real config currently says, independent of what the config's own list
// claims; the equality assertion right below is what catches the two lists drifting apart.
const EXPECTED_BOARD_PATH_FILES = [
  "packages/shell/src/components/BoardShell.tsx",
  "packages/shell/src/components/Cell.tsx",
  "packages/shell/src/components/board-context.tsx",
  "packages/shell/src/components/CalloutLayer.tsx",
  "packages/shell/src/components/CountdownBadge.tsx",
  "packages/shell/src/effects-map.ts",
];

// Typed via the sibling `eslint.config.d.mts` declaration file at the repo root (TS's standard
// companion-declaration convention for a plain `.mjs` module: resolving "eslint.config.mjs" also
// looks for "eslint.config.d.mts" next to it) — see that file for why a `declare module` inside
// THIS file alone doesn't work here (TS2665: it treats the target as an existing-but-untyped JS
// module, not something a relative-specifier ambient declaration is allowed to augment).
import { BOARD_PATH_FILES } from "../../../eslint.config.mjs";

describe("eslint.config.mjs — board-path import boundaries (C1)", () => {
  it("BOARD_PATH_FILES in eslint.config.mjs matches the known six-file board-path scope", () => {
    // Fails loudly (a clear array diff) the moment the config's list and this test's own
    // expectation diverge in either direction — whether a file is dropped from the config
    // (blind spot B) or a new board-path file is added to the config but never added here.
    expect(BOARD_PATH_FILES).toEqual(EXPECTED_BOARD_PATH_FILES);
  });

  it.each(EXPECTED_BOARD_PATH_FILES)("bans framer-motion on board-path file %s", async (file) => {
    const result = await lint(file, 'import { motion } from "framer-motion";\nexport function probe() { return motion; }\n');
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("bans gsap on a board-path file (Cell.tsx)", async () => {
    // gsap's own pattern group in boardPathAnimationBoundary had never been exercised by any
    // fixture — only framer-motion and motion/react were probed.
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'import gsap from "gsap";\nexport function probe() { return gsap; }\n'
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

  it("bans framer-motion under a game's own ui/** path (games/**/ui/**), independent of the board-path list", async () => {
    // Blind spot D: no fixture linted a games/**/ui/** path at all, so deleting the entire
    // `files: ["games/**/ui/**/*.tsx", ...]` block that carries boardPathAnimationBoundary for
    // games' own UI code (eslint.config.mjs:169) went undetected — every existing probe targeted
    // either a BOARD_PATH_FILES entry or ResultModal.tsx, neither of which exercises this block.
    const result = await lint(
      "games/fadeout/ui/__lint_probe__.tsx",
      'import { motion } from "framer-motion";\nexport function probe() { return motion; }\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("bans framer-motion via a STATIC import in a game file OUTSIDE ui/** (C5 gap 2, stage-6 F3 review) — this used to lint clean", async () => {
    // Before this fix, `boardPathAnimationBoundary`'s files glob was `games/**/ui/**` only, so a
    // game's presentation.ts (one directory up from ui/**, but shipping in the same route
    // bundle) could `import "framer-motion"` and lint completely clean.
    const result = await lint(
      "games/fadeout/__lint_probe__.ts",
      'import { motion } from "framer-motion";\nexport function probe() { return motion; }\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("bans a DYNAMIC import() of gsap on a game's ui/** file (C5 gap 1, stage-6 F3 review) — no-restricted-imports never caught import() at all", async () => {
    // `no-restricted-imports`'s patterns only ever match a static ImportDeclaration; a dynamic
    // `import()` expression is a different AST node entirely and evaded the ban regardless of
    // how the patterns were written. `no-restricted-syntax` (an AST selector on
    // `ImportExpression`) is what actually closes this gap.
    const result = await lint("games/fadeout/ui/__lint_probe__.tsx", 'export const load = () => import("gsap");\n');
    expect(ruleIds(result)).toContain("no-restricted-syntax");
  });

  it("bans a DYNAMIC import() of framer-motion on a BOARD_PATH_FILES entry (Cell.tsx)", async () => {
    const result = await lint(
      "packages/shell/src/components/Cell.tsx",
      'export const load = () => import("framer-motion");\n'
    );
    expect(ruleIds(result)).toContain("no-restricted-syntax");
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

  it("bans a game's package-root index import from app/play/** (registry-splitting's games/*/index pattern group)", async () => {
    // Blind spot C: the `**/games/*/index` pattern group (eslint.config.mjs:115) — the ban on a
    // game's package root, which typically re-exports engine + presentation together — had no
    // fixture at all; only the neighboring games/*/engine and games/*/ui groups were probed.
    const result = await lint(
      "app/play/[gameId]/__lint_probe__.ts",
      'import "../../games/mine-run/index";\nexport {};\n'
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

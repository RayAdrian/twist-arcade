// scripts/test/chunk-budget.test.ts — unit coverage for the two pure steps of
// scripts/chunk-budget.ts (platform-corrections.md C38, rewritten for C50):
//
//   1. extractGameImportSpecifiers — parses AUTHORED (never-minified) games/registry.ts source,
//      shaped like the real file (verified against the real 4-game build in the C50 fix-up
//      report — see that script's header for the real crackstep/fadeout/nine-grids/tilt
//      numbers), so this suite runs without a `pnpm build` on disk and stays fast in `pnpm
//      test`.
//   2. attributeOwnFiles — attributes a game's specifiers to built files via a synthetic
//      react-loadable-manifest.json-shaped object, again with no real build needed.
//
// The filesystem-integration half (resolving files under .next/ and gzipping them) is
// deliberately NOT unit-tested here — it only means something against real Next.js output, and
// is covered by the real `pnpm build && pnpm chunk-budget` integration path instead.

import { describe, expect, it } from "vitest";
import { extractGameImportSpecifiers, attributeOwnFiles, ChunkBudgetProbeError, type LoadableManifest } from "../chunk-budget";

// Mirrors the real authored shape of games/registry.ts at the time this test was written
// (confirmed against the real file in the C50 fix-up): a `const registry = {...}` object keyed
// by game id, entries built from `defineGame(...)` calls but with `loadEngine`/
// `loadPresentation`/`loadSolver` as plain arrow functions calling `import(...)` — some games
// split engine/presentation into separate specifiers (fadeout), some share one specifier for
// both (crackstep, nine-grids, tilt).
const SYNTHETIC_REGISTRY_SOURCE = `
import type { Registry } from "@twist-arcade/game-spec";
import { fadeoutManifest } from "./fadeout/manifest";

export const registry: Registry = {
  "crackstep": {
    manifest: crackstepManifest,
    loadEngine: () => import("@twist-arcade/crackstep").then((m) => m.crackstep),
    loadPresentation: () => import("@twist-arcade/crackstep").then((m) => m.presentation),
    loadSolver: () => import("@twist-arcade/crackstep/solver").then((m) => m.solver),
  },
  "nine-grids": {
    manifest: nineGridsManifest,
    loadEngine: () => import("@twist-arcade/nine-grids").then((m) => m.nineGrids),
    loadPresentation: () => import("@twist-arcade/nine-grids").then((m) => m.presentation),
  },
  fadeout: {
    manifest: fadeoutManifest,
    loadEngine: () => import("./fadeout/engine").then((m) => m.createFadeoutEngine(FADEOUT_RULESET_CONFIG)),
    loadPresentation: () => import("./fadeout/presentation").then((m) => m.fadeoutPresentation),
  },
};
`;

const GAME_IDS = ["crackstep", "fadeout", "nine-grids"];

describe("extractGameImportSpecifiers", () => {
  it("reads each game's dynamic-import specifiers from authored (unminified) source", () => {
    const result = extractGameImportSpecifiers(SYNTHETIC_REGISTRY_SOURCE, GAME_IDS);
    expect(result.get("crackstep")).toEqual(["@twist-arcade/crackstep", "@twist-arcade/crackstep/solver"]);
    expect(result.get("nine-grids")).toEqual(["@twist-arcade/nine-grids"]);
    expect(result.get("fadeout")).toEqual(["./fadeout/engine", "./fadeout/presentation"]);
  });

  it("throws when a registered game id has no matching entry in the source (drift, not a silent 0-specifier report)", () => {
    expect(() => extractGameImportSpecifiers(SYNTHETIC_REGISTRY_SOURCE, [...GAME_IDS, "closing-walls"])).toThrow(ChunkBudgetProbeError);
    expect(() => extractGameImportSpecifiers(SYNTHETIC_REGISTRY_SOURCE, [...GAME_IDS, "closing-walls"])).toThrow(/closing-walls/);
  });

  it("throws when the source's registry keys don't exactly match the expected id set (fewer ids passed than the source declares)", () => {
    expect(() => extractGameImportSpecifiers(SYNTHETIC_REGISTRY_SOURCE, ["crackstep", "fadeout"])).toThrow(ChunkBudgetProbeError);
  });

  it("throws when no 'const registry = {...}' declaration exists at all", () => {
    expect(() => extractGameImportSpecifiers("export const somethingElse = {};", GAME_IDS)).toThrow(ChunkBudgetProbeError);
  });

  it("throws when a game entry is missing the required loadEngine or loadPresentation property", () => {
    const source = `
export const registry: Registry = {
  crackstep: {
    loadEngine: () => import("@twist-arcade/crackstep").then((m) => m.crackstep),
  },
};
`;
    expect(() => extractGameImportSpecifiers(source, ["crackstep"])).toThrow(/loadPresentation/);
  });

  it("returns an empty specifier list for a game whose load functions contain no import() calls (legitimate zero, not an error)", () => {
    const source = `
export const registry: Registry = {
  crackstep: {
    loadEngine: () => eagerEngine,
    loadPresentation: () => eagerPresentation,
  },
};
`;
    const result = extractGameImportSpecifiers(source, ["crackstep"]);
    expect(result.get("crackstep")).toEqual([]);
  });
});

describe("attributeOwnFiles", () => {
  const specifiersByGame = new Map<string, string[]>([
    ["crackstep", ["@twist-arcade/crackstep", "@twist-arcade/crackstep/solver"]],
    ["nine-grids", ["@twist-arcade/nine-grids"]],
    ["fadeout", ["./fadeout/engine", "./fadeout/presentation"]],
  ]);

  function manifestEntry(id: number, files: string[]) {
    return { id, files };
  }

  it("excludes files referenced by every registered game (shell-equivalent) and attributes the rest per game", () => {
    const manifest: LoadableManifest = {
      "games/registry.ts -> @twist-arcade/crackstep": manifestEntry(1, ["shared-a.js", "shared-b.js", "crackstep-own.js"]),
      "games/registry.ts -> @twist-arcade/crackstep/solver": manifestEntry(2, ["solver-own.js"]),
      "games/registry.ts -> @twist-arcade/nine-grids": manifestEntry(3, ["shared-a.js", "shared-b.js", "ninegrids-own.js"]),
      "games/registry.ts -> ./fadeout/engine": manifestEntry(4, ["fadeout-engine-own.js"]),
      "games/registry.ts -> ./fadeout/presentation": manifestEntry(5, ["shared-a.js", "shared-b.js", "fadeout-pres-own.js"]),
    };
    const result = attributeOwnFiles(specifiersByGame, manifest);
    expect(result.get("crackstep")).toEqual(["crackstep-own.js", "solver-own.js"]);
    expect(result.get("nine-grids")).toEqual(["ninegrids-own.js"]);
    expect(result.get("fadeout")).toEqual(["fadeout-engine-own.js", "fadeout-pres-own.js"]);
  });

  it("charges a file shared by SOME but not ALL games in full to every game that references it (no partial-shared discount)", () => {
    const manifest: LoadableManifest = {
      "games/registry.ts -> @twist-arcade/crackstep": manifestEntry(1, ["crackstep-own.js"]),
      "games/registry.ts -> @twist-arcade/crackstep/solver": manifestEntry(2, []),
      "games/registry.ts -> @twist-arcade/nine-grids": manifestEntry(3, ["partial-shared.js", "ninegrids-own.js"]),
      "games/registry.ts -> ./fadeout/engine": manifestEntry(4, ["partial-shared.js", "fadeout-own.js"]),
      "games/registry.ts -> ./fadeout/presentation": manifestEntry(5, []),
    };
    const result = attributeOwnFiles(specifiersByGame, manifest);
    // partial-shared.js is referenced by nine-grids and fadeout but not crackstep, so it is
    // NOT universal and must be charged in full to both games that use it.
    expect(result.get("nine-grids")).toEqual(["ninegrids-own.js", "partial-shared.js"]);
    expect(result.get("fadeout")).toEqual(["fadeout-own.js", "partial-shared.js"]);
  });

  it("throws naming the game and specifier when a specifier the source declares has no matching manifest entry", () => {
    const manifest: LoadableManifest = {
      "games/registry.ts -> @twist-arcade/crackstep": manifestEntry(1, ["crackstep-own.js"]),
      "games/registry.ts -> @twist-arcade/nine-grids": manifestEntry(3, ["ninegrids-own.js"]),
      "games/registry.ts -> ./fadeout/engine": manifestEntry(4, ["fadeout-own.js"]),
      "games/registry.ts -> ./fadeout/presentation": manifestEntry(5, []),
      // "@twist-arcade/crackstep/solver" is deliberately missing — simulates a stale build.
    };
    expect(() => attributeOwnFiles(specifiersByGame, manifest)).toThrow(ChunkBudgetProbeError);
    expect(() => attributeOwnFiles(specifiersByGame, manifest)).toThrow(/crackstep\/solver/);
    expect(() => attributeOwnFiles(specifiersByGame, manifest)).toThrow(/crackstep/);
  });

  it("matches manifest keys by suffix on the file part, not strict equality (tolerates an absolute-path prefix)", () => {
    const manifest: LoadableManifest = {
      "/abs/repo/root/games/registry.ts -> @twist-arcade/crackstep": manifestEntry(1, ["crackstep-own.js"]),
      "/abs/repo/root/games/registry.ts -> @twist-arcade/crackstep/solver": manifestEntry(2, []),
      "/abs/repo/root/games/registry.ts -> @twist-arcade/nine-grids": manifestEntry(3, ["ninegrids-own.js"]),
      "/abs/repo/root/games/registry.ts -> ./fadeout/engine": manifestEntry(4, ["fadeout-own.js"]),
      "/abs/repo/root/games/registry.ts -> ./fadeout/presentation": manifestEntry(5, []),
    };
    const result = attributeOwnFiles(specifiersByGame, manifest);
    expect(result.get("crackstep")).toEqual(["crackstep-own.js"]);
  });
});

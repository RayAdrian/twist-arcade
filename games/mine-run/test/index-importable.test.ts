// games/mine-run/test/index-importable.test.ts
//
// Fable review (should-fix 5): package.json's main/types/exports pointed at a nonexistent
// `index.ts`, so `import("@twist-arcade/mine-run")` threw ERR_MODULE_NOT_FOUND. Nothing
// consumes the package yet, but registry wiring will hit this immediately -- and this is the
// same shape as M1's G-13, silently dropped from a deferral list once already. Import by
// PACKAGE NAME here (not a relative path) specifically so this test actually exercises
// package.json's resolution, not just that index.ts happens to exist on disk.

import { describe, expect, it } from "vitest";

describe("@twist-arcade/mine-run is importable by package name", () => {
  it("resolves and exposes the expected public surface", async () => {
    const pkg = await import("@twist-arcade/mine-run");
    expect(typeof pkg.createMineRun).toBe("function");
    expect(typeof pkg.mineRun).toBe("object");
    expect(typeof pkg.MineRunDecodeError).toBe("function");
    expect(typeof pkg.analyzeFrontier).toBe("function");
    expect(typeof pkg.sampleConsistentState).toBe("function");
    expect(typeof pkg.safeMove).toBe("function");
    expect(typeof pkg.makeMineRunSecretExtractor).toBe("function");

    // Sanity: the exported engine is actually usable end-to-end through this entry point.
    const engine = pkg.createMineRun({ width: 4, height: 4, mines: 2, budget: 10 });
    expect(engine.meta.id).toBe("mine-run");
  });
});

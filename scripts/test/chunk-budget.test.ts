// scripts/test/chunk-budget.test.ts — unit coverage for the pure parse-and-attribute core of
// scripts/chunk-budget.ts (platform-corrections.md C38). Exercises `attributeOwnChunkIds`
// against small synthetic source strings SHAPED like webpack's real compiled output (verified
// against the actual build in the fix-up report — see that script's header for the real
// crackstep/nine-grids/fadeout numbers), so this suite runs without a `pnpm build` on disk and
// stays fast in `pnpm test`. The filesystem half (chunk-id -> built file -> gzip size) is
// deliberately NOT unit-tested here — it only means something against real webpack output, and
// is covered by the real `pnpm build && pnpm chunk-budget` integration path instead.

import { describe, expect, it } from "vitest";
import { attributeOwnChunkIds, ChunkBudgetProbeError } from "../chunk-budget";

// Mirrors the real compiled shape (confirmed against `.next/static/chunks/app/play/[gameId]/
// page-*.js` at the time this guard was built): an object keyed by game id, each entry's
// loadEngine/loadPresentation/loadSolver calling `n.e(<chunkId>)` — sometimes standalone,
// sometimes inside `Promise.all([...])` — before `.then(n.bind(n, <moduleId>))`.
const SYNTHETIC_SOURCE = `
var d = {
  crackstep: {
    manifest: l.e,
    loadEngine: () => Promise.all([n.e(678), n.e(994), n.e(737)]).then(n.bind(n, 9737)).then(e => e.crackstep),
    loadPresentation: () => Promise.all([n.e(678), n.e(994), n.e(737)]).then(n.bind(n, 9737)).then(e => e.presentation),
    loadSolver: () => n.e(152).then(n.bind(n, 5152)).then(e => e.solver),
  },
  "nine-grids": {
    manifest: a.e,
    loadEngine: () => Promise.all([n.e(678), n.e(994), n.e(855), n.e(59)]).then(n.bind(n, 5059)).then(e => e.nineGrids),
    loadPresentation: () => Promise.all([n.e(678), n.e(994), n.e(855), n.e(59)]).then(n.bind(n, 5059)).then(e => e.presentation),
  },
  fadeout: {
    manifest: r._m,
    loadEngine: () => n.e(507).then(n.bind(n, 1507)).then(e => e.createFadeoutEngine(r.dl)),
    loadPresentation: () => Promise.all([n.e(678), n.e(994), n.e(131), n.e(502)]).then(n.bind(n, 1502)).then(e => e.fadeoutPresentation),
  },
};
`;

const GAME_IDS = ["crackstep", "fadeout", "nine-grids"];

describe("attributeOwnChunkIds", () => {
  it("excludes chunk ids referenced by every registered game (678, 994 — shell-equivalent) and attributes the rest per game", () => {
    const result = attributeOwnChunkIds(SYNTHETIC_SOURCE, GAME_IDS);
    expect(result.get("crackstep")).toEqual([152, 737]);
    expect(result.get("nine-grids")).toEqual([59, 855]);
    expect(result.get("fadeout")).toEqual([131, 502, 507]);
  });

  it("charges a chunk id shared by SOME but not ALL games in full to every game that references it (no partial-shared discount)", () => {
    // 2001 is shared by nine-grids and fadeout only — crackstep never references it — so it
    // must NOT be excluded as universal, and must count in full toward both games that use it.
    const source = `
var d = {
  crackstep: { manifest: l.e, loadEngine: () => Promise.all([n.e(678), n.e(737)]).then(n.bind(n, 1)) },
  "nine-grids": { manifest: a.e, loadEngine: () => Promise.all([n.e(678), n.e(2001), n.e(59)]).then(n.bind(n, 2)) },
  fadeout: { manifest: r.e, loadEngine: () => Promise.all([n.e(678), n.e(2001), n.e(507)]).then(n.bind(n, 3)) },
};
`;
    const result = attributeOwnChunkIds(source, GAME_IDS);
    expect(result.get("crackstep")).toEqual([737]); // 678 is universal (all 3 reference it), excluded
    expect(result.get("nine-grids")).toEqual([59, 2001]); // 2001 charged in full, not shared-discounted
    expect(result.get("fadeout")).toEqual([507, 2001]); // same 2001 charged again to fadeout too
  });

  it("throws when a registered game id has no matching entry in the compiled chunk (drift, not a silent 0-byte report)", () => {
    expect(() => attributeOwnChunkIds(SYNTHETIC_SOURCE, [...GAME_IDS, "closing-walls"])).toThrow(ChunkBudgetProbeError);
    expect(() => attributeOwnChunkIds(SYNTHETIC_SOURCE, [...GAME_IDS, "closing-walls"])).toThrow(/closing-walls/);
  });

  it("throws when no object literal in the source matches the expected id set exactly (build shape changed, or wrong ids passed)", () => {
    expect(() => attributeOwnChunkIds(SYNTHETIC_SOURCE, ["crackstep", "fadeout"])).toThrow(ChunkBudgetProbeError);
  });

  it("throws when MORE THAN ONE object literal in the source matches the expected id set exactly (ambiguous — refuses to guess)", () => {
    const duplicated = SYNTHETIC_SOURCE + "\nvar d2 = " + SYNTHETIC_SOURCE.replace(/^var d = /, "") ;
    expect(() => attributeOwnChunkIds(duplicated, GAME_IDS)).toThrow(ChunkBudgetProbeError);
  });

  it("returns an empty own-chunk list for a game whose load functions reference nothing but universally-shared chunks", () => {
    const source = `
var d = {
  crackstep: { manifest: l.e, loadEngine: () => n.e(678).then(n.bind(n, 1)) },
  fadeout: { manifest: r.e, loadEngine: () => n.e(678).then(n.bind(n, 2)) },
};
`;
    const result = attributeOwnChunkIds(source, ["crackstep", "fadeout"]);
    expect(result.get("crackstep")).toEqual([]);
    expect(result.get("fadeout")).toEqual([]);
  });
});

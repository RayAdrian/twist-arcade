// packages/harness/test/certify.test.ts — TDD anchors for the certificate pipeline (M3d):
// generate -> exact-solve -> reject -> store. The one invariant every test here defends:
// budget exhaustion is a REJECTION, never an uncertified ship (platform §7.7). Uses a real,
// seed-generated puzzle fixture (hole-walk.ts) for the reject/accept LOOP and a real, known
// solution (mini-crackstep) for the pure feature-computation helpers.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameEngine } from "@twist-arcade/engine";
import { rngForSetup } from "@twist-arcade/engine";
import { miniCrackstep, MINI_CRACKSTEP_KNOWN_SOLUTION } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import type { DailyCertificate } from "@twist-arcade/game-spec";
import {
  bufferDaysRemaining,
  certificatePath,
  certifyDay,
  computePathFeatures,
  randomPlayoutStats,
  readAllCertificates,
  readCertificate,
  rejectionRate,
  StochasticEngineCertifyUnsupportedError,
  writeCertificate,
} from "../src/certify";
import { dfsSolver } from "../src/solver/generic-solo";
import { holeWalk } from "./fixtures/hole-walk";
import type { HoleWalkMove, HoleWalkState } from "./fixtures/hole-walk";

// Empirically located (see the harness handoff report): "hunt:2" produces a hole layout that
// disconnects start from goal (unsolvable); "hunt:0" produces the open board (no holes),
// solved at length 5, forcedMoveFraction 0.2, random-playout solve rate ~0.66.
const UNSOLVABLE_SEED = "hunt:2";
const SOLVABLE_SEED = "hunt:0";

describe("computePathFeatures — pinned against mini-crackstep's own known solution", () => {
  it("computes forcedMoveFraction=0.25 and branchingMean=1.75 for the fixture's documented 4-move solution", () => {
    // Hand-traced (see handoff report): legal-move counts at each of the 4 decision points
    // along 0->1->2->5->8 are [2, 2, 1, 2] — cell 2's only unvisited neighbor is 5, a forced
    // move; every other step has 2 legal continuations.
    const initial = miniCrackstep.setup(1, rngForSetup("irrelevant"));
    const features = computePathFeatures(miniCrackstep, initial, [...MINI_CRACKSTEP_KNOWN_SOLUTION]);
    expect(features.forcedMoveFraction).toBeCloseTo(0.25, 10);
    expect(features.branchingMean).toBeCloseTo(1.75, 10);
  });

  it("returns 0/0 for an empty move log rather than dividing by zero", () => {
    const initial = miniCrackstep.setup(1, rngForSetup("irrelevant"));
    const features = computePathFeatures(miniCrackstep, initial, []);
    expect(features.forcedMoveFraction).toBe(0);
    expect(features.branchingMean).toBe(0);
  });
});

describe("randomPlayoutStats — mini-crackstep (every playout resolves won or lost, never a third state)", () => {
  it("solveRate and deadEndDensity sum to 1 across 500 trials", () => {
    const initial = miniCrackstep.setup(1, rngForSetup("irrelevant"));
    const stats = randomPlayoutStats(miniCrackstep, initial, 500, 20);
    expect(stats.solveRate + stats.deadEndDensity).toBeCloseTo(1, 10);
    expect(stats.solveRate).toBeGreaterThan(0);
    expect(stats.solveRate).toBeLessThan(1);
  });
});

describe("certifyDay — the reject-and-redraw loop, against a real generated puzzle", () => {
  const baseOptions = {
    gameId: "hole-walk-fixture",
    gameVersion: 1,
    engineVersion: "test",
    engine: holeWalk,
    solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
    day: "2026-09-14",
    solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
    randomPlayoutTrials: 200,
  };

  it("rejects an unsolvable nonce-0 candidate, then certifies at nonce 1", () => {
    const seedFor = (_day: string, nonce: number) => (nonce === 0 ? UNSOLVABLE_SEED : SOLVABLE_SEED);
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 5,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(result.outcome).toBe("certified");
    expect(result.certificate?.nonce).toBe(1);
    expect(result.certificate?.seed).toBe(SOLVABLE_SEED);
    expect(result.certificate?.par).toBe(5);
    expect(result.certificate?.parKind).toBe("optimal");
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toMatch(/unsolvable/);
  });

  it("returns rejected-all-attempts (never a certificate) when the attempt budget stops before the solvable nonce", () => {
    const seedFor = (_day: string, nonce: number) => (nonce === 0 ? UNSOLVABLE_SEED : SOLVABLE_SEED);
    const result = certifyDay({ ...baseOptions, seedFor, maxNonceAttempts: 1 });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.certificate).toBeUndefined();
    expect(result.rejections).toHaveLength(1);
  });

  it("rejects a below-minPar solve as trivial", () => {
    const seedFor = () => SOLVABLE_SEED;
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 1,
      minPar: 6, // the known solve length is 5
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.rejections[0]?.reason).toMatch(/trivial.*L\*=5/);
  });

  it("rejects when forcedMoveFraction exceeds the configured ceiling", () => {
    const seedFor = () => SOLVABLE_SEED;
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.1, // the known board's forcedMoveFraction is 0.2
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.rejections[0]?.reason).toMatch(/forcedMoveFraction/);
  });

  it("rejects when the random-playout solve rate exceeds the configured ceiling (trivial)", () => {
    const seedFor = () => SOLVABLE_SEED;
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.3, // the known board's random-playout solve rate is ~0.66
    });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.rejections[0]?.reason).toMatch(/randomPlayoutSolveRate/);
  });

  it("(SHOULD FIX item 6) refuses a stochastic engine BEFORE calling seedFor or the solver at all", () => {
    // certify.ts's own replay convention (rngFor(seed, k) reconstructing every apply() call)
    // is sound only when apply() draws no randomness beyond setup() — a requirement asserted
    // in this file's comments but never checked. A stochastic holeWalk's certified moveLog
    // could draw different outcomes on CI re-verification than it did here. Both seedFor and
    // the solver are throwing stubs, proving the guard fires eagerly, before either is ever
    // invoked (same posture as MissingSafeMoveError in probes-solo.ts).
    const stochasticHoleWalk: typeof holeWalk = {
      ...holeWalk,
      meta: { ...holeWalk.meta, stochastic: true },
    };
    const neverCalledSeedFor = () => {
      throw new Error("seedFor should never be called");
    };
    const neverCalledSolver = {
      solve: () => {
        throw new Error("solver.solve should never be called");
      },
    };
    expect(() =>
      certifyDay({
        ...baseOptions,
        engine: stochasticHoleWalk,
        solver: neverCalledSolver,
        seedFor: neverCalledSeedFor,
      })
    ).toThrow(/stochastic/);
    try {
      certifyDay({
        ...baseOptions,
        engine: stochasticHoleWalk,
        solver: neverCalledSolver,
        seedFor: neverCalledSeedFor,
      });
      expect.unreachable("certifyDay should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StochasticEngineCertifyUnsupportedError);
    }
  });

  it("treats a budget-exhausted solve exactly like unsolvable — never an uncertified ship", () => {
    const alwaysExhausted = { solve: () => ({ outcome: "budget-exhausted" as const, nodesExpanded: 999 }) };
    const result = certifyDay({
      ...baseOptions,
      solver: alwaysExhausted,
      seedFor: () => SOLVABLE_SEED,
      maxNonceAttempts: 3,
    });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.certificate).toBeUndefined();
    expect(result.rejections).toHaveLength(3);
    for (const r of result.rejections) expect(r.reason).toMatch(/budget exhausted/);
  });

  it("respects an injected withinDifficultyBand predicate — rejects even a solvable, non-trivial candidate outside the band", () => {
    const seedFor = () => SOLVABLE_SEED;
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      withinDifficultyBand: () => false,
    });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.rejections[0]?.reason).toMatch(/difficulty band/);
  });

  it("(C11) rejects a fog (hidden-information) candidate whose solve required a guess, then certifies once one is deduction-only", () => {
    // C11: `certifyDay` used to RECORD `guessFree` for a hidden-information engine but never
    // REJECT on it — a fog daily requiring a guess certified and shipped anyway. Wraps
    // holeWalk as a fog engine (hiddenInformation: true) and a solver whose first call
    // reports guessFree:false (a guess was required) and second+ call reports guessFree:true
    // (deduction-only) — same solvable board both times (SOLVABLE_SEED), so guessFree is the
    // ONLY thing distinguishing the two attempts.
    const fogEngine: GameEngine<HoleWalkState, HoleWalkMove, HoleWalkState> = {
      ...holeWalk,
      meta: { ...holeWalk.meta, hiddenInformation: true },
    };
    const realSolver = dfsSolver<HoleWalkState, HoleWalkMove>();
    let calls = 0;
    const guessFreeOnSecondCallSolver = {
      solve(engine: GameEngine<HoleWalkState, HoleWalkMove, HoleWalkState>, initial: HoleWalkState, budget: Parameters<typeof realSolver.solve>[2]) {
        const result = realSolver.solve(engine, initial, budget);
        if (result.outcome !== "solved") return result;
        const guessFree = calls > 0;
        calls += 1;
        return { ...result, guessFree };
      },
    };
    const result = certifyDay({
      ...baseOptions,
      engine: fogEngine,
      solver: guessFreeOnSecondCallSolver,
      seedFor: () => SOLVABLE_SEED,
      maxNonceAttempts: 2,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(result.outcome).toBe("certified");
    expect(result.certificate?.nonce).toBe(1);
    expect(result.certificate?.guessFree).toBe(true);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toMatch(/guess/i);
  });

  it("(C11) does NOT reject a perfect-information (non-fog) puzzle even though its solver never reports guessFree at all", () => {
    // Regression guard: the rejection clause is gated on `engine.meta.hiddenInformation`, so
    // holeWalk itself (hiddenInformation: false, and dfsSolver never sets guessFree at all —
    // it stays `undefined`) must keep certifying exactly as it did before C11.
    const seedFor = () => SOLVABLE_SEED;
    const result = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(result.outcome).toBe("certified");
    expect(result.certificate?.guessFree).toBeUndefined(); // non-fog: the field isn't even set
  });

  it("computes rejectionRate as rejections / total attempts, for both outcomes", () => {
    const seedFor = (_day: string, nonce: number) => (nonce === 0 ? UNSOLVABLE_SEED : SOLVABLE_SEED);
    const certified = certifyDay({
      ...baseOptions,
      seedFor,
      maxNonceAttempts: 5,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
    });
    expect(rejectionRate(certified)).toBeCloseTo(1 / 2, 10); // 1 rejection, 1 acceptance

    const allRejected = certifyDay({ ...baseOptions, seedFor: () => UNSOLVABLE_SEED, maxNonceAttempts: 4 });
    expect(rejectionRate(allRejected)).toBe(1);
  });
});

describe("certificate storage — committed JSON under data/certificates/<gameId>/<day>.json", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "harness-certify-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sampleCertificate: DailyCertificate = {
    gameId: "hole-walk-fixture",
    gameVersion: 1,
    engineVersion: "test",
    day: "2026-09-14",
    seed: SOLVABLE_SEED,
    nonce: 0,
    moveLog: [{ to: 1 }, { to: 5 }, { to: 9 }, { to: 10 }, { to: 11 }],
    par: 5,
    parKind: "optimal",
    solverNodes: 42,
    features: { forcedMoveFraction: 0.2, branchingMean: 1.8, deadEndDensity: 0.34, greedyGap: null, zScore: 0 },
  };

  it("round-trips a certificate through write -> read unchanged", async () => {
    await writeCertificate(dir, sampleCertificate);
    const readBack = await readCertificate(dir, sampleCertificate.gameId, sampleCertificate.day);
    expect(readBack).toEqual(sampleCertificate);
  });

  it("readCertificate returns undefined (never throws) for a day that was never certified", async () => {
    const readBack = await readCertificate(dir, "hole-walk-fixture", "2099-01-01");
    expect(readBack).toBeUndefined();
  });

  it("writes to the documented path shape: <baseDir>/<gameId>/<day>.json", async () => {
    await writeCertificate(dir, sampleCertificate);
    const expected = certificatePath(dir, sampleCertificate.gameId, sampleCertificate.day);
    expect(expected).toBe(path.join(dir, "hole-walk-fixture", "2026-09-14.json"));
    const readBack = await readCertificate(dir, sampleCertificate.gameId, sampleCertificate.day);
    expect(readBack).toBeDefined();
  });

  it("readAllCertificates returns every stored day, sorted ascending, and [] for an uncertified game", async () => {
    await writeCertificate(dir, { ...sampleCertificate, day: "2026-09-16" });
    await writeCertificate(dir, { ...sampleCertificate, day: "2026-09-14" });
    await writeCertificate(dir, { ...sampleCertificate, day: "2026-09-15" });
    const all = await readAllCertificates(dir, sampleCertificate.gameId);
    expect(all.map((c) => c.day)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);

    const none = await readAllCertificates(dir, "never-certified-game");
    expect(none).toEqual([]);
  });
});

describe("bufferDaysRemaining — the certified-buffer alert/fail signal", () => {
  const dayFor = (isoDay: string, offset: number): string => {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  it("counts a contiguous run of certified days forward from today", () => {
    const certified = new Set(["2026-09-14", "2026-09-15", "2026-09-16"]);
    expect(bufferDaysRemaining(certified, "2026-09-14", dayFor, 90)).toBe(3);
  });

  it("stops counting at the first gap — a buffer is a contiguous run, not a total count", () => {
    const certified = new Set(["2026-09-14", "2026-09-16"]); // 2026-09-15 is missing
    expect(bufferDaysRemaining(certified, "2026-09-14", dayFor, 90)).toBe(1);
  });

  it("is 0 when today itself has no certificate", () => {
    const certified = new Set(["2026-09-15"]);
    expect(bufferDaysRemaining(certified, "2026-09-14", dayFor, 90)).toBe(0);
  });
});

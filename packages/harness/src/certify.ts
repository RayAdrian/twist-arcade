// packages/harness/src/certify.ts — the certificate pipeline (M3d, phase-0-platform-spine.md
// §7.7 / solo-games-lens §3.3): generate -> exact-solve -> reject -> store, run OFFLINE in
// batch, never at request time. The one invariant every line of this file protects: **budget
// exhaustion means rejection, never an uncertified ship.** A daily is the one surface with
// site-wide blast radius (crackstep.md §3.4) — it cannot be quietly patched once players have
// started submitting results against it, so a bad daily is caught here, before it ever ships,
// or not at all.
//
// This module does NOT own `dailyFormula(gameId, engineVersion, day)` (the daily team's public
// seed formula — a separate lane, ../claude-project-daily) or any per-game solver/heuristic —
// both are injected by the caller, keeping this module a small, additive piece of shared
// plumbing rather than a place that reaches into another team's scope.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import type { DailyCertificate, SoloSolveBudget, SoloSolver } from "@twist-arcade/game-spec";

const DEFAULT_SOLVE_BUDGET: SoloSolveBudget = { maxNodes: 1e7, maxMs: 10_000 };
const DEFAULT_MAX_NONCE_ATTEMPTS = 200;
const DEFAULT_RANDOM_PLAYOUT_TRIALS = 1000;
const DEFAULT_MAX_RANDOM_PLAYOUT_SOLVE_RATE = 0.3;
const DEFAULT_MAX_FORCED_MOVE_FRACTION = 0.85;
const DEFAULT_MIN_PAR = 8;

export interface CertifyRejection {
  readonly nonce: number;
  readonly seed: string;
  readonly reason: string;
}

export interface CertifyDayOptions<S extends WithEffects, M extends Json, V extends WithEffects> {
  gameId: string;
  gameVersion: number;
  engineVersion: string;
  engine: GameEngine<S, M, V>;
  solver: SoloSolver<S, M>;
  day: string; // "2026-09-14" (UTC)
  /** The daily team's public seed formula, injected — this module never constructs one. */
  seedFor: (day: string, nonce: number) => string;
  solveBudget?: SoloSolveBudget;
  maxNonceAttempts?: number;
  minPar?: number; // default 8 (CI floor; platform §7.5)
  maxRandomPlayoutSolveRate?: number; // default 0.30
  maxForcedMoveFraction?: number; // default 0.85
  randomPlayoutTrials?: number; // default 1000
  /** Optional band/drift check against a prior calibration run (calibrate.ts). Omitted =>
   *  the band clause is not enforced by this call (the caller is expected to gate on it
   *  separately via solo-gates.ts once calibration data exists) — never silently assumed
   *  "in band" and reported as such; `certifyDay`'s own report simply does not claim to have
   *  checked what it was not given the means to check. */
  withinDifficultyBand?: (features: CertifyFeatures, length: number) => boolean;
  /** Optional: a greedy/heuristic solver's move log for the SAME seed, for the greedyGap
   *  feature (greedy length - L*, or null if greedy fails to solve). Omitted => `null`. */
  greedySolve?: (engine: GameEngine<S, M, V>, initial: S) => M[] | null;
  /** Optional z-score against a prior calibration distribution (calibrate.ts computes this
   *  externally); defaults to 0 (no calibration data available yet). */
  zScoreFor?: (length: number) => number;
}

export interface CertifyDayResult {
  outcome: "certified" | "rejected-all-attempts";
  certificate?: DailyCertificate;
  rejections: CertifyRejection[];
}

interface CertifyFeatures {
  forcedMoveFraction: number;
  branchingMean: number;
  deadEndDensity: number;
  randomPlayoutSolveRate: number;
}

/** Exported for direct unit testing (certify.test.ts) — the per-seed feature computation is
 *  pure and worth pinning against a known solution path independent of any particular
 *  generator or solver. */
export function computePathFeatures<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  initial: S,
  moveLog: readonly M[]
): { forcedMoveFraction: number; branchingMean: number } {
  let state = initial;
  let forcedCount = 0;
  let branchingSum = 0;
  for (let i = 0; i < moveLog.length; i++) {
    const legal = engine.legalMoves(state, 0);
    branchingSum += legal.length;
    if (legal.length === 1) forcedCount += 1;
    const move = moveLog[i]!;
    state = engine.apply(state, new Map([[0, move]]), rngFor(`certify-path-features:${i}`, i));
  }
  const n = moveLog.length;
  return {
    forcedMoveFraction: n === 0 ? 0 : forcedCount / n,
    branchingMean: n === 0 ? 0 : branchingSum / n,
  };
}

/** Random-playout solve rate / dead-end density (solo-games-lens §3.4): from `trials`
 *  independent random legal playouts starting at `initial`, the fraction that reach `won`
 *  (solve rate) and the fraction that reach anything else — `lost`, or the puzzle's own
 *  structural cap — (dead-end density). These are complements of each other for a puzzle
 *  whose only terminals are `won`/`lost` (the common case); computed independently anyway so
 *  a puzzle with a third terminal kind is never silently mis-summed. */
/** Exported for direct unit testing — see computePathFeatures's doc comment. */
export function randomPlayoutStats<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  initial: S,
  trials: number,
  maxPlies: number
): { solveRate: number; deadEndDensity: number } {
  let solved = 0;
  let deadEnded = 0;
  for (let t = 0; t < trials; t++) {
    let state = initial;
    let status = engine.status(state);
    let plies = 0;
    const rng = rngFor(`certify-random-playout:${t}`, t);
    while (status.kind === "ongoing" && plies < maxPlies) {
      const legal = engine.legalMoves(state, 0);
      if (legal.length === 0) break;
      const move = legal[rng.int(legal.length)]!;
      state = engine.apply(state, new Map([[0, move]]), rngFor(`certify-random-playout:${t}`, plies + 1));
      status = engine.status(state);
      plies += 1;
    }
    if (status.kind === "won") solved += 1;
    else deadEnded += 1; // lost, or the structural cap was hit without winning
  }
  return { solveRate: trials === 0 ? 0 : solved / trials, deadEndDensity: trials === 0 ? 0 : deadEnded / trials };
}

/**
 * Certifies ONE day: draws candidate seeds (nonce 0, 1, 2, ...) until one is accepted or
 * `maxNonceAttempts` is exhausted. Every rejection reason is recorded — "rejected-all-attempts"
 * with a full rejection log is the honest outcome when nothing in the attempt budget qualifies;
 * this function NEVER returns a certificate that did not pass every check, and a solver
 * `budget-exhausted` result is rejected exactly like `unsolvable` (platform §7.7: "treated as
 * unsolvable — a daily is NEVER shipped uncertified").
 */
export function certifyDay<S extends WithEffects, M extends Json, V extends WithEffects>(
  opts: CertifyDayOptions<S, M, V>
): CertifyDayResult {
  const solveBudget = opts.solveBudget ?? DEFAULT_SOLVE_BUDGET;
  const maxNonceAttempts = opts.maxNonceAttempts ?? DEFAULT_MAX_NONCE_ATTEMPTS;
  const minPar = opts.minPar ?? DEFAULT_MIN_PAR;
  const maxRandomPlayoutSolveRate = opts.maxRandomPlayoutSolveRate ?? DEFAULT_MAX_RANDOM_PLAYOUT_SOLVE_RATE;
  const maxForcedMoveFraction = opts.maxForcedMoveFraction ?? DEFAULT_MAX_FORCED_MOVE_FRACTION;
  const randomPlayoutTrials = opts.randomPlayoutTrials ?? DEFAULT_RANDOM_PLAYOUT_TRIALS;

  const rejections: CertifyRejection[] = [];

  for (let nonce = 0; nonce < maxNonceAttempts; nonce++) {
    const seed = opts.seedFor(opts.day, nonce);
    const initial = opts.engine.setup(1, rngForSetup(seed));

    const solveResult = opts.solver.solve(opts.engine, initial, solveBudget);
    if (solveResult.outcome === "unsolvable") {
      rejections.push({ nonce, seed, reason: "unsolvable" });
      continue;
    }
    if (solveResult.outcome === "budget-exhausted") {
      // Platform §7.7: budget exhaustion is REJECTION, never an uncertified ship.
      rejections.push({ nonce, seed, reason: "solver budget exhausted (treated as unsolvable)" });
      continue;
    }

    const length = solveResult.length!;
    const moveLog = solveResult.moveLog!;

    // Correction C11: spine §7.7 and solo-lens §3.3 both list "fog games — if not
    // deduction-only" as an explicit rejection clause, and this used to be recorded
    // (`guessFree`, below) but never REJECTED on — a fog daily requiring a guess certified
    // and shipped. Non-fog (`hiddenInformation: false`) engines are entirely unaffected:
    // `solveResult.guessFree` is meaningless for them (it stays `undefined`, same as before).
    if (opts.engine.meta.hiddenInformation && !solveResult.guessFree) {
      rejections.push({
        nonce,
        seed,
        reason: "fog game requires a guess to solve (guessFree=false) — fog dailies must be deduction-only",
      });
      continue;
    }

    if (length < minPar) {
      rejections.push({ nonce, seed, reason: `trivial: L*=${length} < minPar ${minPar}` });
      continue;
    }

    const pathFeatures = computePathFeatures(opts.engine, initial, moveLog as unknown as M[]);
    if (pathFeatures.forcedMoveFraction > maxForcedMoveFraction) {
      rejections.push({
        nonce,
        seed,
        reason: `plays itself: forcedMoveFraction=${pathFeatures.forcedMoveFraction.toFixed(3)} > ${maxForcedMoveFraction}`,
      });
      continue;
    }

    const playoutStats = randomPlayoutStats(opts.engine, initial, randomPlayoutTrials, length * 4 + 50);
    if (playoutStats.solveRate > maxRandomPlayoutSolveRate) {
      rejections.push({
        nonce,
        seed,
        reason: `trivial: randomPlayoutSolveRate=${playoutStats.solveRate.toFixed(3)} > ${maxRandomPlayoutSolveRate}`,
      });
      continue;
    }

    const features: CertifyFeatures = {
      forcedMoveFraction: pathFeatures.forcedMoveFraction,
      branchingMean: pathFeatures.branchingMean,
      deadEndDensity: playoutStats.deadEndDensity,
      randomPlayoutSolveRate: playoutStats.solveRate,
    };

    if (opts.withinDifficultyBand && !opts.withinDifficultyBand(features, length)) {
      rejections.push({ nonce, seed, reason: "outside the difficulty band (calibration drift)" });
      continue;
    }

    const greedyMoveLog = opts.greedySolve ? opts.greedySolve(opts.engine, initial) : null;
    const greedyGap = greedyMoveLog ? greedyMoveLog.length - length : null;
    const zScore = opts.zScoreFor ? opts.zScoreFor(length) : 0;

    const certificate: DailyCertificate = {
      gameId: opts.gameId,
      gameVersion: opts.gameVersion,
      engineVersion: opts.engineVersion,
      day: opts.day,
      seed,
      nonce,
      moveLog,
      par: length,
      parKind: solveResult.optimal ? "optimal" : "best-in-budget",
      solverNodes: solveResult.nodesExpanded,
      ...(opts.engine.meta.hiddenInformation ? { guessFree: solveResult.guessFree ?? false } : {}),
      features: {
        forcedMoveFraction: features.forcedMoveFraction,
        branchingMean: features.branchingMean,
        deadEndDensity: features.deadEndDensity,
        greedyGap,
        zScore,
      },
    };

    return { outcome: "certified", certificate, rejections };
  }

  return { outcome: "rejected-all-attempts", rejections };
}

/** Rejection rate over one `certifyDay` call's own attempt log — solo-games-lens §3.3 / §3.4's
 *  generator-rejection-rate signal (warn > 50%, hard-fail > 90%, evaluated by solo-gates.ts). */
export function rejectionRate(result: CertifyDayResult): number {
  const attempts = result.rejections.length + (result.outcome === "certified" ? 1 : 0);
  if (attempts === 0) return 0;
  return result.rejections.length / attempts;
}

// ---------------------------------------------------------------------------------------
// Storage — committed JSON under data/certificates/<gameId>/<day>.json (platform §7.7).
// Phase 0 storage; the schema is designed to survive the Phase 2 move to Postgres unchanged
// (crackstep.md §3.3), so this module's ONLY job is get-it-to/from-disk, nothing schema-
// specific. `baseDir` is caller-supplied (never a baked-in absolute path) so tests can point
// it at a scratch directory instead of the real `data/certificates`.
// ---------------------------------------------------------------------------------------

export function certificatePath(baseDir: string, gameId: string, day: string): string {
  return path.join(baseDir, gameId, `${day}.json`);
}

export async function writeCertificate(baseDir: string, certificate: DailyCertificate): Promise<void> {
  const file = certificatePath(baseDir, certificate.gameId, certificate.day);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(certificate, null, 2)}\n`, "utf8");
}

export async function readCertificate(baseDir: string, gameId: string, day: string): Promise<DailyCertificate | undefined> {
  try {
    const raw = await readFile(certificatePath(baseDir, gameId, day), "utf8");
    return JSON.parse(raw) as DailyCertificate;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** All certified days on disk for a game, sorted ascending by day string (which is a UTC
 *  "YYYY-MM-DD" — lexicographic order is chronological order). Used to compute the buffer
 *  (days from "today" forward that are already certified) and to drive nightly
 *  re-verification (harness handoff report: wired via verifyCertificate, one call per file). */
export async function readAllCertificates(baseDir: string, gameId: string): Promise<DailyCertificate[]> {
  let entries: string[];
  try {
    entries = await readdir(path.join(baseDir, gameId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const days = entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  days.sort();
  const certs: DailyCertificate[] = [];
  for (const day of days) {
    const cert = await readCertificate(baseDir, gameId, day);
    if (cert) certs.push(cert);
  }
  return certs;
}

/** Certified-buffer-days (platform §7.7 / solo-games-lens §3.3: "90 certified days per game...
 *  alert below 30, hard fail below 7"): how many of the days in `[today, today+horizonDays)`
 *  already have a stored certificate. `today` and `dayFor` are injected (never `Date.now()`
 *  read directly here) so this stays a pure, testable function of its inputs. */
export function bufferDaysRemaining(
  certifiedDays: ReadonlySet<string>,
  today: string,
  dayFor: (isoDay: string, offset: number) => string,
  horizonDays = 90
): number {
  let buffered = 0;
  for (let i = 0; i < horizonDays; i++) {
    const day = dayFor(today, i);
    if (certifiedDays.has(day)) buffered += 1;
    else break; // the buffer is a contiguous run forward from today — the first gap ends it
  }
  return buffered;
}

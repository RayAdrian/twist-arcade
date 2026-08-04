// games/crackstep/solver/certify-day.ts — composes the platform's certificate pipeline
// (`certifyDay`, @twist-arcade/harness) with Crackstep's own engine/solver and the daily team's
// public seed formula (`dailySeed`, @twist-arcade/daily) into one call: `certifyOneDay(day)`.
//
// This is the pure, directly-testable core behind `run-certify.mts`'s thin CLI wrapper — same
// split as the repo root's own scripts/ci-gates.ts / scripts/verify-certificates.ts: real logic
// here (unit-tested against the real generator/solver in certify-day.test.ts), untested
// process-only wiring (argv parsing, writing files, exit codes) in the .mts script.
//
// Deliberately lives under solver/ (not the package root or engine.ts) — it imports
// @twist-arcade/harness AND ./solver, so importing it must never happen from a route that only
// plays the game (index.ts's own header comment on why loadSolver is a separate registry entry
// point; this module is squarely on that "heavier, build-time-only" side of the split).

import { dailySeed } from "@twist-arcade/daily";
import { certifyDay, type CertifyDayOptions, type CertifyDayResult } from "@twist-arcade/harness";
import { crackstep, type CrackstepMove, type CrackstepState } from "../engine";
import { solver } from "../solver";

/**
 * `@twist-arcade/engine`'s OWN package version (packages/engine/package.json's "version" field)
 * — NOT this game's package version, and not `crackstep.meta.version` (the manifest/gameVersion
 * field, a distinct number game-spec's DailyCertificate keeps separate on purpose). Mirrors the
 * "0.1.0" literal already used the same way in packages/daily/test/manifest.test.ts and
 * packages/engine/test/replay.test.ts — there is no single importable source of truth for it at
 * this milestone (a package.json is not a module under this repo's moduleResolution), so this
 * constant must be bumped BY HAND alongside any real packages/engine version bump, exactly like
 * every other "0.1.0" literal in this codebase already is.
 */
export const ENGINE_VERSION = "0.1.0";

/**
 * The public, offline-computable seed FORMULA for one day (no nonce yet) — `certifyOneDay`
 * appends `:<nonce>` per attempt below, exactly matching `packages/daily/src/seed.ts`'s own
 * documented convention ("solo dailies use the CERTIFIED seed instead... that composition
 * happens at certify time"). Exported so a caller (or a test) can independently recompute the
 * formula a certificate's `seed` field should be a `isCertifiedSeedOf` derivative of.
 */
export function seedFormulaFor(day: string): Promise<string> {
  return dailySeed(crackstep.meta.id, ENGINE_VERSION, day);
}

/** Every `CertifyDayOptions` field this module does NOT itself decide — a caller (nightly
 *  calibration/CI, or a test planting a violation) may still override any of these; the fields
 *  this module always supplies (`gameId`/`gameVersion`/`engineVersion`/`engine`/`solver`/`day`/
 *  `seedFor`) are fixed and cannot be overridden by construction (TypeScript's `Omit` below, not
 *  just a convention). */
export type CertifyOneDayOverrides = Partial<
  Omit<
    CertifyDayOptions<CrackstepState, CrackstepMove, CrackstepState>,
    "gameId" | "gameVersion" | "engineVersion" | "engine" | "solver" | "day" | "seedFor"
  >
>;

/**
 * Certifies exactly one day: resolves the day's public formula once, then hands `certifyDay`
 * the platform's full generate -> exact-solve -> reject -> (self-verify ->) store loop. Returns
 * `certifyDay`'s own result UNCHANGED — this function adds no rejection/acceptance logic of its
 * own, so "budget exhaustion means rejection, never an uncertified ship" (platform §7.7,
 * crackstep.md §3.4) is enforced entirely by the composed `certifyDay` call, not reimplemented
 * here. See certify-day.test.ts's planted-violation tests for the standing proof that a starved
 * budget or an unreachable band NEVER produces `outcome === "certified"`.
 */
export async function certifyOneDay(day: string, overrides: CertifyOneDayOverrides = {}): Promise<CertifyDayResult> {
  const formula = await seedFormulaFor(day);
  return certifyDay<CrackstepState, CrackstepMove, CrackstepState>({
    gameId: crackstep.meta.id,
    gameVersion: crackstep.meta.version,
    engineVersion: ENGINE_VERSION,
    engine: crackstep,
    solver,
    day,
    seedFor: (_day, nonce) => `${formula}:${nonce}`,
    ...overrides,
  });
}

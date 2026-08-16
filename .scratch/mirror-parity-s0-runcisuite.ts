// .scratch/mirror-parity-s0-runcisuite.ts — C81/C86 mirror-parity task: S0 byte-identity guard
// for runCiSuite's own six-plus-mirror-declaration rows (fadeout/nine-grids/tilt). runCiSuite
// never calls mirrorMove at all (mirrorMove only feeds runProbeSuite, a SEPARATE function) — this
// script proves that stays true across the mirror-probe metric-binding change. Prints JSON to
// stdout; run once before any edit, once after, diff the two files (must be empty).
//
// Throwaway script, not a package deliverable.

import { runCiSuite } from "@twist-arcade/harness";
import { fadeoutEngine, fadeoutManifest } from "../games/fadeout/index";
import { nineGrids, manifest as nineGridsManifest } from "../games/nine-grids/index";
import { tilt, manifest as tiltManifest } from "../games/tilt/index";

const SEED = "mirror-parity-c81-c86-s0-runcisuite";
const GAMES = 40;

function stripThroughput(report: unknown): unknown {
  return JSON.parse(JSON.stringify(report, (key, value) => (key === "throughputGamesPerSec" ? undefined : value)));
}

function main(): void {
  const out: Record<string, unknown> = {};
  out["fadeout"] = stripThroughput(runCiSuite(fadeoutEngine, fadeoutManifest, { seed: SEED, games: GAMES, suite: "ci" }));
  out["nine-grids"] = stripThroughput(runCiSuite(nineGrids, nineGridsManifest, { seed: SEED, games: GAMES, suite: "ci" }));
  out["tilt"] = stripThroughput(runCiSuite(tilt, tiltManifest, { seed: SEED, games: GAMES, suite: "ci" }));
  console.log(JSON.stringify(out, null, 2));
}

main();

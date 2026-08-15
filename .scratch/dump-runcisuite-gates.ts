// .scratch/dump-runcisuite-gates.ts — S0-style byte-identity guard (docs/plans/degeneracy-
// probes.md §5 S0: "Fixed-seed dump of runCiSuite gates for fadeout/nine-grids/tilt on main and
// on the branch; diff must be empty before and after every step") for platform-corrections.md
// C81 tasks #26/#27: runCiSuite's own six-row gate table must NOT change from either task —
// task #26 only touches games/nine-grids/probes.ts's mirrorMove (which runCiSuite never calls at
// all — mirrorMove only feeds runProbeSuite, a SEPARATE function from a SEPARATE module), and
// task #27 only touches runTwoPlayerCiGate's OWN rush-relief composition, never runCiSuite
// itself. Prints JSON to stdout; run once before any edit, once after, diff the two files.
//
// Throwaway script, not a package deliverable.

import { runCiSuite } from "@twist-arcade/harness";
import { fadeoutEngine, fadeoutManifest } from "../games/fadeout/index";
import { nineGrids, manifest as nineGridsManifest } from "../games/nine-grids/index";
import { tilt, manifest as tiltManifest } from "../games/tilt/index";

const SEED = "c81-s0-byte-identity-guard";
const GAMES = 12;

function main(): void {
  const out: Record<string, unknown> = {};

  out["fadeout"] = runCiSuite(fadeoutEngine, fadeoutManifest, { seed: SEED, games: GAMES }).gates;
  out["nine-grids"] = runCiSuite(nineGrids, nineGridsManifest, { seed: SEED, games: GAMES }).gates;
  out["tilt"] = runCiSuite(tilt, tiltManifest, { seed: SEED, games: GAMES }).gates;

  console.log(JSON.stringify(out, null, 2));
}

main();

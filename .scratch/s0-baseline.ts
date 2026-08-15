// .scratch/s0-baseline.ts — C64/S0: fixed-seed runCiSuite gate dump for fadeout, nine-grids,
// tilt, captured BEFORE any wiring change and re-run after every subsequent step (C63
// discipline). Prints deterministic JSON (toReportJson drops the one non-deterministic field,
// throughputGamesPerSec, at the matchup-report layer — but CiSuiteReport embeds full
// MatchupReport objects including that field, so we strip it here explicitly, matching
// toMatchupReportJson's own convention, to get a byte-identical diff across runs).

import { runCiSuite } from "@twist-arcade/harness";
import { fadeoutEngine, fadeoutManifest } from "../games/fadeout/index";
import { nineGrids, manifest as nineGridsManifest } from "../games/nine-grids/index";
import { tilt, manifest as tiltManifest } from "../games/tilt/index";

function stripThroughput(report: unknown): unknown {
  return JSON.parse(
    JSON.stringify(report, (key, value) => (key === "throughputGamesPerSec" ? undefined : value))
  );
}

function main(): void {
  const games = 40; // small, deterministic, fast — S0 only needs to prove byte-identical output, not measure anything
  const out: Record<string, unknown> = {};

  out["fadeout"] = stripThroughput(
    runCiSuite(fadeoutEngine, fadeoutManifest, { seed: "s0-baseline:fadeout", games, suite: "ci" })
  );
  out["nine-grids"] = stripThroughput(
    runCiSuite(nineGrids, nineGridsManifest, { seed: "s0-baseline:nine-grids", games, suite: "ci" })
  );
  out["tilt"] = stripThroughput(
    runCiSuite(tilt, tiltManifest, { seed: "s0-baseline:tilt", games, suite: "ci" })
  );

  console.log(JSON.stringify(out, null, 2));
}

main();

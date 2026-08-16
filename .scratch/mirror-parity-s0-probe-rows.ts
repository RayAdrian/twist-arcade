// .scratch/mirror-parity-s0-probe-rows.ts — C81/C86 mirror-parity task: separate byte-identity
// evidence for the probe rows themselves (mirror-probe/stall-probe/rush-probe), for fadeout,
// nine-grids and tilt, via runTwoPlayerCiGate (real mirrorMove threaded in, same as
// scripts/ci-gates.ts does). C86 measured all three games' mirror matchups at 0.0% win, 0.0%
// draw, 0.0% parity — i.e. the metric change is a no-op on every shipped game today, so this
// script's job is to prove the GATE STATUS for every probe row is unchanged (still "pass") before
// and after the metric-binding change. The DETAIL STRING is deliberately NOT expected to be
// byte-identical (the whole point of the change is new wording/fields in that string) — only the
// numeric win/draw/parity readings and the gate status are compared.
//
// Throwaway script, not a package deliverable.

import { runTwoPlayerCiGate } from "@twist-arcade/harness";
import { fadeoutEngine, fadeoutManifest, mirrorMove as fadeoutMirrorMove } from "../games/fadeout/index";
import { nineGrids, manifest as nineGridsManifest, mirrorMove as nineGridsMirrorMove } from "../games/nine-grids/index";
import { tilt, manifest as tiltManifest, mirrorMove as tiltMirrorMove } from "../games/tilt/index";

const SEED = "mirror-parity-c81-c86-s0-probe-rows";
const GAMES = 40;

function summarize(report: ReturnType<typeof runTwoPlayerCiGate>): unknown {
  return report.gates
    .filter((g) => g.gate === "mirror-probe" || g.gate === "stall-probe" || g.gate === "rush-probe")
    .map((g) => ({ gate: g.gate, status: g.status, detail: g.detail }));
}

function main(): void {
  const out: Record<string, unknown> = {};

  out["fadeout"] = summarize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTwoPlayerCiGate(fadeoutEngine as any, fadeoutManifest, { seed: SEED, games: GAMES, suite: "ci", mirrorMove: fadeoutMirrorMove })
  );
  out["nine-grids"] = summarize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTwoPlayerCiGate(nineGrids as any, nineGridsManifest, { seed: SEED, games: GAMES, suite: "ci", mirrorMove: nineGridsMirrorMove })
  );
  out["tilt"] = summarize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTwoPlayerCiGate(tilt as any, tiltManifest, { seed: SEED, games: GAMES, suite: "ci", mirrorMove: tiltMirrorMove })
  );

  console.log(JSON.stringify(out, null, 2));
}

main();

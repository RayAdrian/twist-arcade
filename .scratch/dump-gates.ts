// .scratch/dump-gates.ts — throwaway verification script for the C48/C62 mirror-probe branch
// (feature/mirror-na). Dumps each NON-declaring TWO-PLAYER game's runCiSuite gate output (or
// the exact thrown error, if the manifest's own ciGateBudget/tier setup makes runCiSuite
// refuse) to a stable JSON file, under a FIXED seed/games count, so the SAME script run against
// `main` can be diffed byte-for-byte. This is the observed comparison Part B asks for — not an
// argument from the code's shape.
//
// Scope note: crackstep and mine-run are SOLO games (players: {min:1,max:1}) — they never call
// runCiSuite at all (that function, and the mirror-probe mechanism appended to it, is scoped to
// the two-player self-play lane; solo games go through packages/harness/src/solo-gates.ts via
// scripts/ci-gates.ts's own dispatcher). They are deliberately excluded from this dump, not
// forgotten — see the accompanying report for how that was confirmed independently (git diff
// shows solo-gates.ts untouched by this branch).
//
// Run with: pnpm exec tsx .scratch/dump-gates.ts <output-dir>

import fs from "node:fs";
import path from "node:path";
import { runCiSuite } from "@twist-arcade/harness";
import type { GameManifest, GameEngine } from "@twist-arcade/game-spec";
import type { WithEffects } from "@twist-arcade/engine";
import { fadeoutEngine, fadeoutManifest } from "@twist-arcade/fadeout";
import { nineGrids, manifest as nineGridsManifest } from "@twist-arcade/nine-grids";
import { orderVsChaos, manifest as orderVsChaosManifest } from "@twist-arcade/order-vs-chaos";
import { tilt, manifest as tiltManifest } from "@twist-arcade/tilt";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: tsx .scratch/dump-gates.ts <output-dir>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const games: { id: string; engine: GameEngine<any, any, any & WithEffects>; manifest: GameManifest }[] = [
  { id: "fadeout", engine: fadeoutEngine, manifest: fadeoutManifest },
  { id: "nine-grids", engine: nineGrids, manifest: nineGridsManifest },
  { id: "order-vs-chaos", engine: orderVsChaos, manifest: orderVsChaosManifest },
  { id: "tilt", engine: tilt, manifest: tiltManifest },
];

for (const g of games) {
  const file = path.join(outDir, `${g.id}.json`);
  try {
    const report = runCiSuite(g.engine, g.manifest, { seed: `mirrorna-partB:${g.id}`, games: 20 });
    fs.writeFileSync(file, JSON.stringify({ kind: "report", gates: report.gates, ok: report.ok }, null, 2) + "\n");
    console.log(`${g.id}: wrote report (${report.gates.length} gates, ok=${report.ok})`);
  } catch (e) {
    fs.writeFileSync(
      file,
      JSON.stringify({ kind: "error", name: (e as Error).name, message: (e as Error).message }, null, 2) + "\n"
    );
    console.log(`${g.id}: threw ${(e as Error).name}`);
  }
}

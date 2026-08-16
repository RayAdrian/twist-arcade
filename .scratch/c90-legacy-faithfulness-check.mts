// .scratch/c90-legacy-faithfulness-check.mts — C76's mandatory pre-check, re-run in this
// worktree (feature/duct-leaf-eval) before the C90 head-to-head.
//
// WHY A NEW SCRIPT RATHER THAN EDITING THE TRACKED `.scratch/c57-byte-identity-dump.mts`:
// that script is this branch's own C57/C58-remedy artifact (no `legacy` mode) and is left
// untouched per the task's "do not touch mcts.ts/heuristic.ts/the legacy policy" spirit —
// extended, not mutated. This is a throwaway diagnostic (C36 discipline), mirroring the
// `legacy`-mode dump used on `feature/sim-search-residue` for the original C76 head-to-head
// (packages/bots/test/support/mcts-legacy.ts's own module doc), reproduced here because
// `mctsPolicyLegacy` was only just brought into this worktree and must be re-verified here,
// not assumed faithful because it was faithful somewhere else.
//
// CHECK: dump `mctsPolicyLegacy` (packages/bots/test/support/mcts-legacy.ts) at the
// mcts1k roster budget (1,000 rollouts) vs `random`, on fadeout/nine-grids/tilt, 20 seeds x
// mirrorSeats. Output MUST diff byte-for-byte against docs/research/games/
// c57-byte-identity-pre-fix-{fadeout,nine-grids,tilt}.json (captured from the real dabc6a2
// checkout before mcts.ts was ever edited for C57/C58). If it doesn't, STOP — nothing
// measured against mctsPolicyLegacy in this worktree is trustworthy.
//
// Run: pnpm tsx .scratch/c90-legacy-faithfulness-check.mts .scratch/c90-legacy-check

import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMatchupReportJson, runMatchup, resolveNamedAgent } from "@twist-arcade/harness";
import { FADEOUT_RULESET_CONFIG } from "../games/fadeout/manifest";
import { createFadeoutEngine } from "../games/fadeout/engine";
import { nineGrids } from "@twist-arcade/nine-grids";
import { tilt } from "@twist-arcade/tilt";
import { mctsPolicyLegacy } from "../packages/bots/test/support/mcts-legacy";
import fs from "node:fs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GAMES: { id: string; engine: any }[] = [
  { id: "fadeout", engine: createFadeoutEngine(FADEOUT_RULESET_CONFIG) },
  { id: "nine-grids", engine: nineGrids },
  { id: "tilt", engine: tilt },
];

function main(): void {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: c90-legacy-faithfulness-check.mts <output-dir>");
  const resolvedOutDir = path.isAbsolute(outDir) ? outDir : path.join(REPO_ROOT, outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  for (const { id, engine } of GAMES) {
    const agentA = { kind: "policy" as const, name: "mcts1k", policy: mctsPolicyLegacy(), budget: { kind: "rollouts" as const, n: 1_000 } };
    const agentB = resolveNamedAgent("random");
    const report = runMatchup(engine, agentA, agentB, {
      games: 20,
      seed: `c57-byte-identity-${id}`, // fixed literal, matches the original pre-fix dump's seed
      mirrorSeats: true,
    });
    const json = toMatchupReportJson(report);
    const outFile = path.join(resolvedOutDir, `${id}.json`);
    fs.writeFileSync(outFile, json + "\n", "utf8");
    console.log(`wrote ${outFile} (${report.outcomes.length} games, agentA=${agentA.name})`);
  }
}

main();

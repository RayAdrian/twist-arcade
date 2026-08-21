// .scratch/c57-byte-identity-dump.mts — C57/C58 remedy plan §6 step 1's byte-identity guard.
//
// WHY THIS SHAPE INSTEAD OF A FULL `ci-gates` RUN: `pnpm harness:ci-gates -- --game fadeout`
// alone exceeded 2 minutes per game (CI_GAMES=100 at each game's shipped Ruthless budget) —
// the user's brief explicitly authorizes "a fast fixed-seed harness dump rather than a full
// ci-gates run" as long as it is (a) deterministic and (b) actually exercises MCTS on all
// three games. This does both, reusing the harness's OWN established byte-identity mechanism
// (report.ts's `toMatchupReportJson`, which already drops `throughputGamesPerSec` — the one
// non-deterministic field — specifically so a fixed-seed JSON artifact is byte-identical across
// runs, per its own doc comment) rather than inventing a parallel one.
//
// DETERMINISM: `runMatchup`'s only non-reproducible input is wall-clock throughput (dropped by
// toMatchupReportJson); every DECISION is deterministic because every roster agent gets a
// `{kind:"rollouts"}` budget (roster.ts's own doc) and the match seed is a fixed literal string
// with no timestamp anywhere in it. mcts1k is used explicitly (not "random" or "greedy") so
// mcts.ts's SELECT+EXPAND+BACKPROP loop is actually exercised on real tree shapes for all three
// games, not just its terminal-state fast path.
//
// GAME COUNT: 20 match-seeds x mirrorSeats -> 40 real games per matchup, well under the full
// CI_GAMES=100 lane, but plenty to walk deep trees on all three engines (fadeout/nine-grids/tilt
// boards are small — mcts1k reaches real internal nodes well before 40 games). Determinism is
// what makes this valid at low N (plan's own framing): any single-bit divergence between the
// pre-fix and post-fix dump is caught regardless of game count.
//
// USAGE: pnpm tsx .scratch/c57-byte-identity-dump.mts <output-dir>

import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMatchupReportJson, runMatchup, resolveNamedAgent } from "@twist-arcade/harness";
import { FADEOUT_RULESET_CONFIG } from "../games/fadeout/manifest";
import { createFadeoutEngine } from "../games/fadeout/engine";
import { nineGrids } from "@twist-arcade/nine-grids";
import { tilt } from "@twist-arcade/tilt";
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
  if (!outDir) throw new Error("usage: c57-byte-identity-dump.mts <output-dir>");
  const resolvedOutDir = path.isAbsolute(outDir) ? outDir : path.join(REPO_ROOT, outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  for (const { id, engine } of GAMES) {
    // All three are confirmed unconditionally sequential (plan §2, verified against
    // engine.ts source) — mcts1k exercises mcts.ts's real SELECT+EXPAND+BACKPROP loop.
    const agentA = resolveNamedAgent("mcts1k");
    const agentB = resolveNamedAgent("random");
    const report = runMatchup(engine, agentA, agentB, {
      games: 20,
      seed: `c57-byte-identity-${id}`, // fixed literal, no timestamp — C22/C24 rule
      mirrorSeats: true,
    });
    const json = toMatchupReportJson(report);
    const outFile = path.join(resolvedOutDir, `${id}.json`);
    fs.writeFileSync(outFile, json + "\n", "utf8");
    console.log(`wrote ${outFile} (${report.outcomes.length} games, agentA=${agentA.name})`);
  }
}

main();

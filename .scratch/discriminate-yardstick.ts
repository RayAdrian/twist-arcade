// C6-vs-Wrap-class discriminating experiment (coordinator's explicit ask): is Strong at
// ciGateBudget=750 (K~=8.6) too weak on the REAL 100-cell board (yardstick collapse, C6), or
// does Always-Safe genuinely outscore a much stronger Strong too (a game-design finding, not a
// harness one)? Raises Strong's rollout budget 750 -> 3000 (4x the search) via an IN-MEMORY
// budget object only -- the shipped games/mine-run/manifest.ts ciGateBudget stays untouched at
// 750. Fixed seeds (C24), reusing ci:mine-run:ci-0/ci-1 (already measured at 750) plus three
// more so the comparison is paired against real prior numbers, not restated from scratch.
import { createMineRun, safeMove } from "@twist-arcade/mine-run";
import { buildSoloRoster, playSoloRun, runAlwaysSafeProbe } from "@twist-arcade/harness";

const engine = createMineRun({ width: 10, height: 10, mines: 20, budget: 60 });
const roster = buildSoloRoster(engine);
const moveCap = 400; // real manifest value, untrimmed

const seeds = [
  "ci:mine-run:ci-0",
  "ci:mine-run:ci-1",
  "ci:mine-run:ci-2",
  "ci:mine-run:ci-3",
  "ci:mine-run:ci-4",
];

// Already measured (previous run, this same engine/seeds/budget) -- NOT recomputed, reused so
// the comparison is paired against real prior numbers rather than re-rolling them.
const already750: Record<string, { strong: number; safe: number }> = {
  "ci:mine-run:ci-0": { strong: 630, safe: 849 },
  "ci:mine-run:ci-1": { strong: 91, safe: 686 },
};

console.log(`start: ${new Date().toISOString()}`);
console.log("seed,alwaysSafe,strong@750,strong@3000,ratio@750,ratio@3000,strong3000ElapsedMs");

for (const seed of seeds) {
  const t0 = Date.now();
  const alwaysSafeSummary = runAlwaysSafeProbe(engine, safeMove, [seed], { moveCap });
  const safeScore = alwaysSafeSummary.scores[0]!;
  const safeElapsed = Date.now() - t0;

  let strong750: number;
  if (seed in already750) {
    strong750 = already750[seed]!.strong;
    console.log(`seed=${seed} strong@750: REUSED from prior run -> score=${strong750}`);
  } else {
    const t1 = Date.now();
    const r = playSoloRun(engine, roster.strong, seed, { moveCap, budget: { kind: "rollouts", n: 750 } });
    strong750 = r.finalScore;
    console.log(`seed=${seed} strong@750: elapsed=${Date.now() - t1}ms score=${strong750} decisions=${r.decisions} capHit=${r.capHit}`);
  }

  const t2 = Date.now();
  const r3000 = playSoloRun(engine, roster.strong, seed, { moveCap, budget: { kind: "rollouts", n: 3000 } });
  const strong3000Elapsed = Date.now() - t2;
  console.log(`seed=${seed} strong@3000: elapsed=${strong3000Elapsed}ms score=${r3000.finalScore} decisions=${r3000.decisions} capHit=${r3000.capHit}`);

  const ratio750 = strong750 === 0 ? Infinity : safeScore / strong750;
  const ratio3000 = r3000.finalScore === 0 ? Infinity : safeScore / r3000.finalScore;
  console.log(
    `ROW seed=${seed} alwaysSafe=${safeScore} (elapsed=${safeElapsed}ms) strong@750=${strong750} ` +
      `strong@3000=${r3000.finalScore} ratio@750=${ratio750.toFixed(3)} ratio@3000=${ratio3000.toFixed(3)}`
  );
}

console.log(`end: ${new Date().toISOString()}`);
console.log("DISCRIMINATE_COMPLETE");

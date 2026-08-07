// Throwaway C56 regression-proof script: full self-play traces for the three registered
// sequential games that route through mcts.ts (fadeout, nine-grids, tilt), at real shipped
// tier budgets. Run once against the pre-fix mcts.ts, once against the post-fix mcts.ts, diff
// the two output files byte-for-byte. Not a package deliverable.
import { rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { tierPolicy } from "@twist-arcade/bots";
import type { DifficultyTier } from "@twist-arcade/game-spec";
import { createFadeoutEngine } from "../games/fadeout/engine";
import { FADEOUT_RULESET_CONFIG, fadeoutManifest } from "../games/fadeout/manifest";
import { nineGrids } from "../games/nine-grids/engine";
import { manifest as nineGridsManifest } from "../games/nine-grids/manifest";
import { tilt } from "../games/tilt/engine";
import { manifest as tiltManifest } from "../games/tilt/manifest";

const NULL_CLOCK = { now: (() => { let t = 0; return () => (t += 1); })() };

function traceGame<S extends WithEffects, M extends Json>(
  label: string,
  engine: GameEngine<S, M, S>,
  tier: DifficultyTier,
  seed: string
): string {
  const lines: string[] = [];
  let state = engine.setup(2, rngFromSeed(`${seed}-setup`));
  const budget = tier.budget as { kind: "rollouts"; n: number };
  const policy = tierPolicy<S, M>(tier);
  let ply = 0;
  while (engine.status(state).kind === "ongoing" && ply < 500) {
    const active = engine.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const moves = new Map();
    for (const p of actors) {
      const { move, stats } = policy.chooseMove({
        engine,
        state,
        player: p,
        rng: rngFromSeed(`${seed}-decision-${ply}-${p}`),
        budget,
        clock: NULL_CLOCK,
      });
      moves.set(p, move);
      lines.push(`${label}|${seed}|ply=${ply}|p=${p}|move=${JSON.stringify(move)}|rootValue=${stats.rootValue ?? "n/a"}|rollouts=${stats.rollouts ?? "n/a"}`);
    }
    state = engine.apply(state, moves as never, rngFromSeed(`${seed}-apply-${ply}`)) as S;
    ply += 1;
  }
  const finalStatus = engine.status(state);
  lines.push(`${label}|${seed}|FINAL|${JSON.stringify(finalStatus)}|plies=${ply}`);
  return lines.join("\n");
}

const out: string[] = [];

// fadeout: standard (1000) x2 seeds, ruthless (10000) x1 seed, casual (100) x1 seed
const fadeoutEngine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);
for (const tier of fadeoutManifest.difficultyTiers) {
  const seeds = tier.id === "ruthless" ? ["fo-r1"] : tier.id === "standard" ? ["fo-s1", "fo-s2"] : ["fo-c1"];
  for (const seed of seeds) {
    out.push(traceGame("fadeout", fadeoutEngine, tier, seed));
  }
}

// nine-grids: same pattern
for (const tier of nineGridsManifest.difficultyTiers) {
  const seeds = tier.id === "ruthless" ? ["ng-r1"] : tier.id === "standard" ? ["ng-s1", "ng-s2"] : ["ng-c1"];
  for (const seed of seeds) {
    out.push(traceGame("nine-grids", nineGrids, tier, seed));
  }
}

// tilt: same pattern
for (const tier of tiltManifest.difficultyTiers) {
  const seeds = tier.id === "ruthless" ? ["tl-r1"] : tier.id === "standard" ? ["tl-s1", "tl-s2"] : ["tl-c1"];
  for (const seed of seeds) {
    out.push(traceGame("tilt", tilt, tier, seed));
  }
}

console.log(out.join("\n"));

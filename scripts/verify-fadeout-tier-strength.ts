#!/usr/bin/env node
// scripts/verify-fadeout-tier-strength.ts — one-off empirical verification for shell milestone
// S2: "with a real bot, difficulty tiers should visibly change play" (docs/plans/phase-0-app-
// shell.md §10's S2 scope). Before S2, the ONLY bot in play was `stubBotDriver` — uniform
// random, deliberately ignoring `tierId` entirely (its own "NOT SHIPPABLE" doc says so) — so
// Fadeout's three manifest tiers (casual: 100 rollouts + epsilon 0.3; standard: 1000 rollouts +
// epsilon 0.08; ruthless: 10000 rollouts, no blunder) had ZERO effect on play.
//
// Two measurements, both against the REAL shipping Fadeout engine and its REAL registered
// manifest tiers (games/fadeout/manifest.ts) — not a fixture — so this verifies the actual data
// that flows through `games/registry.ts` -> the worker host -> tierPolicy, not just the
// mechanism (which packages/bots/test/tiers.test.ts already covers against classic-ttt):
//
//   1. tier vs. a fixed uniform-random opponent (the same free-oracle shape tiers.test.ts uses)
//      — a sanity floor, but Fadeout is small enough that even `casual` likely saturates this
//      (100% non-loss) against pure random, so it's not expected to show separation on its own.
//   2. tier vs. tier head-to-head (casual v standard, standard v ruthless, casual v ruthless) —
//      the discriminating measurement: the exact solve proved this game a 100% draw under
//      optimal play for BOTH sides, so a stronger tier facing a weaker (blunder-prone) one
//      should win noticeably more than it loses, while two tiers of similar strength should
//      trend toward the proven draw.
//
// Loads `games/fadeout/index.ts` via a RUNTIME file URL (not a static import) — the same
// convention `scripts/ci-gates.ts` uses for `games/registry.ts` — because `games/fadeout` is its
// own tsc project (its own tsconfig.json/package.json), not one of `scripts/tsconfig.json`'s
// project references; a static import here would fail `tsc -b` with a rootDir violation the
// instant `engine.ts`'s own transitive imports (engine-internal.ts, heuristic.ts) came into the
// program. `tsx` (this script's runner) resolves the resulting file:// URL to a real .ts module
// at runtime regardless.
//
// Not wired into `pnpm test` (a full ruthless-tier run at 10000 MCTS rollouts x many games is
// slow — this is an on-demand verification, not a CI gate) — run directly:
//   pnpm tsx scripts/verify-fadeout-tier-strength.ts [gamesPerMatchup]
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rngFromSeed } from "@twist-arcade/engine";
import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { tierPolicy } from "@twist-arcade/bots";
import type { DifficultyTier, GameManifest } from "@twist-arcade/game-spec";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

interface FadeoutModule {
  fadeoutEngine: GameEngine<WithEffects, Json, WithEffects>;
  fadeoutManifest: GameManifest;
}

async function loadFadeout(): Promise<FadeoutModule> {
  const url = pathToFileURL(path.join(REPO_ROOT, "games/fadeout/index.ts")).href;
  return (await import(url)) as FadeoutModule;
}

// A fixed, deterministic Clock (this script is offline tooling, not shipped engine/bot code —
// scripts/** is the eslint config's own carve-out for exactly this kind of Date.now() use).
const fakeClock = () => ({ now: () => 0 });

const RANDOM_OPPONENT: DifficultyTier = {
  id: "casual",
  policy: { kind: "random" },
  budget: { kind: "rollouts", n: 1 },
  minReplyMs: 0,
};

const MAX_PLIES = 200; // safety bound only — threefold repetition guarantees termination well before this.

interface Score {
  wins: number;
  losses: number;
  draws: number;
  unresolved: number;
}

/** Plays `a` (seat alternates 0/1 by seed parity) against `b`, `games` times, from `a`'s
 *  perspective. */
function playMatch(
  engine: GameEngine<WithEffects, Json, WithEffects>,
  a: DifficultyTier,
  b: DifficultyTier,
  games: number,
  saltPrefix: string
): Score {
  const botA = tierPolicy<WithEffects, Json>(a);
  const botB = tierPolicy<WithEffects, Json>(b);
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let unresolved = 0;

  for (let seed = 0; seed < games; seed++) {
    const aSeat = seed % 2;
    let state = engine.setup(2, rngFromSeed(`${saltPrefix}-setup-${seed}`));
    const driverRng = rngFromSeed(`${saltPrefix}-driver-${seed}`);
    let ply = 0;
    for (; ply < MAX_PLIES; ply++) {
      const status = engine.status(state);
      if (status.kind !== "ongoing") break;
      const active = engine.active(state);
      if (active.mode !== "sequential") throw new Error("fadeout is sequential-only");
      const mover = active.player === aSeat ? botA : botB;
      const { move } = mover.chooseMove({
        engine,
        state,
        player: active.player,
        rng: driverRng,
        budget: { kind: "rollouts", n: 1 }, // ignored — tierPolicy always uses its own tier's budget
        clock: fakeClock(),
      });
      state = engine.apply(state, new Map([[active.player, move]]), rngFromSeed(`${saltPrefix}-step-${seed}-${ply}`));
    }
    const finalStatus = engine.status(state);
    if (finalStatus.kind === "won") {
      if (finalStatus.winner === aSeat) wins += 1;
      else losses += 1;
    } else if (finalStatus.kind === "draw") {
      draws += 1;
    } else {
      unresolved += 1; // hit MAX_PLIES without a terminal — should never happen (log, don't crash)
    }
  }
  return { wins, losses, draws, unresolved };
}

function fmt(r: Score, games: number): string {
  const nonLoss = ((r.wins + r.draws) / games).toFixed(3);
  return `wins ${r.wins}, draws ${r.draws}, losses ${r.losses} (non-loss ${nonLoss})${r.unresolved ? ` — ${r.unresolved} UNRESOLVED` : ""}`;
}

async function main(): Promise<void> {
  const GAMES = Number(process.argv[2] ?? 20);
  const { fadeoutEngine, fadeoutManifest } = await loadFadeout();
  const tiers = fadeoutManifest.difficultyTiers;

  console.log(`Fadeout tier-strength verification — ${GAMES} games per matchup.\n`);

  console.log("=== 1. Each tier vs. a fixed uniform-random opponent ===");
  for (const tier of tiers) {
    const r = playMatch(fadeoutEngine, tier, RANDOM_OPPONENT, GAMES, `fadeout-vs-random-${tier.id}`);
    const rollouts = tier.budget.kind === "rollouts" ? tier.budget.n : `deadline:${tier.budget.ms}ms`;
    console.log(`  ${tier.id.padEnd(9)} (${rollouts} rollouts, eps ${tier.blunder?.epsilon ?? "—"}): ${fmt(r, GAMES)}`);
  }

  console.log("\n=== 2. Head-to-head — the discriminating measurement ===");
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i]!;
      const b = tiers[j]!;
      const r = playMatch(fadeoutEngine, a, b, GAMES, `fadeout-h2h-${a.id}-vs-${b.id}`);
      console.log(`  ${a.id} vs ${b.id}: ${fmt(r, GAMES)} — from ${a.id}'s perspective`);
    }
  }

  console.log(
    "\nExpected shape: vs-random non-loss rates roughly non-decreasing casual -> standard -> ruthless " +
      "(may saturate at 1.000 — the game is small); head-to-head, the stronger tier in each pairing " +
      "should not have a losing record against the weaker one."
  );
}

main();

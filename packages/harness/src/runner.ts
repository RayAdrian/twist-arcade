// packages/harness/src/runner.ts — the 2-player self-play matchup executor (plan §7.1's
// minimal `run`, extended to §7.2's full metric derivation via metrics.ts). This is what
// `pnpm harness run <gameId> --matchup A:B --games N --seed S` runs, and what suites.ts calls
// once per required matchup to evaluate the roadmap §6 CI gate table.
//
// RNG CONVENTIONS (deliberately matching @twist-arcade/engine's own wire format, not inventing
// a parallel one): `rngForSetup(matchSeed)` seeds `engine.setup()`, `rngFor(matchSeed, ply)`
// seeds that ply's `engine.apply()` — EXACTLY replay.ts's own step-rng rule, so any game this
// runner plays could in principle be re-validated through `replay()` later using
// `{ seed: matchSeed, steps: [...] }`. The policy/bot's OWN randomness is a separate,
// domain-separated stream, `rngFor(\`${matchSeed}:bot\`, ply)` — the identical convention
// packages/bots/src/worker/host.ts already uses for the exact same reason (a public, replayable
// game-state draw must never share a stream with a bot's internal search randomness).
//
// SEAT MIRRORING (plan §7.1: "2P uses seat-mirrored pairs"): consecutive games sharing one
// `matchSeed` but swapping which agent sits in which seat are the standard self-play variance-
// reduction technique — both games see IDENTICAL environment randomness (setup + any stochastic
// apply() draws), isolating "which agent is stronger" from "who got the luckier deal", the same
// way replay's determinism makes bug repro possible. `mirrorSeats` defaults to true.
//
// DETERMINISM: the CLOCK is the only source of non-reproducibility in this file (search
// budgets used by the roster are always `{kind:"rollouts"}` — see roster.ts's own doc — so
// nothing here depends on wall-clock speed for its DECISIONS). A caller that needs a
// byte-identical JSON report across runs (the plan §9 anchor) injects a deterministic `Clock`;
// the default is a real one, appropriate for actual CLI/CI use where only the elapsed-time
// FIELD (throughputGamesPerSec), not any decision, is expected to vary run to run.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import type { Clock } from "@twist-arcade/bots";
import type { AgentSpec } from "./roster";
import { computeMatchupMetrics, type GameOutcome, type MatchupMetrics } from "./metrics";

export interface RunMatchupOptions {
  /** Total games to play. Must be >= 1. */
  readonly games: number;
  /** Base match seed; game `i` of a non-mirrored run (or pair `i` of a mirrored one) uses
   *  `${seed}:${i}`. */
  readonly seed: string;
  /** Ply cap per game (plan §3's 2P default: 200). A game still `ongoing` at the cap is
   *  adjudicated a draw and logged as a cap hit (plan §7.2) — never silently dropped. */
  readonly maxPlies?: number;
  /** Play each matchSeed pair with both seat assignments (default true — see module doc). */
  readonly mirrorSeats?: boolean;
  /** Injected wall-clock reader, exactly like @twist-arcade/bots's own `Clock` — default a real
   *  one. Tests inject a fake, always-advancing one for reproducible `throughputGamesPerSec`. */
  readonly clock?: Clock;
}

export interface MatchupReport {
  readonly agentA: string;
  readonly agentB: string;
  readonly metrics: MatchupMetrics;
  readonly throughputGamesPerSec: number;
  readonly outcomes: readonly GameOutcome[];
}

const realClock: Clock = { now: () => Date.now() };

function playOneGame<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  matchSeed: string,
  seatAgents: readonly [AgentSpec<S, M>, AgentSpec<S, M>],
  maxPlies: number,
  clock: Clock
): GameOutcome {
  const setupRng = rngForSetup(matchSeed);
  let state = engine.setup(2, setupRng);
  let status = engine.status(state);
  let plies = 0;
  const branchingSamples: number[] = [];
  // Tracks the most recent move made BY each seat — the "lastOppMove" a mirror agent (roster.ts)
  // needs, from the perspective of whichever seat is asking. null until that seat has moved.
  const lastMoveBySeat: [M | null, M | null] = [null, null];

  while (status.kind === "ongoing" && plies < maxPlies) {
    const active = engine.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const policyRng = rngFor(`${matchSeed}:bot`, plies);
    const applyRng = rngFor(matchSeed, plies);
    const jointMoves = new Map<PlayerId, M>();

    for (const seat of actors) {
      const legal = engine.legalMoves(state, seat);
      if (legal.length === 0) {
        throw new Error(
          `runMatchup: player ${seat} has no legal moves while status is ongoing ` +
            `(matchSeed=${matchSeed}, ply=${plies}) — this violates the engine contract's ` +
            "no-hidden-pass rule."
        );
      }
      branchingSamples.push(legal.length);

      const agent = seatAgents[seat]!;
      const opponentSeat: PlayerId = seat === 0 ? 1 : 0;
      const move: M =
        agent.kind === "mirror"
          ? agent.mirrorMove(state, lastMoveBySeat[opponentSeat] ?? null, legal)
          : agent.policy.chooseMove({ engine, state, player: seat, rng: policyRng, budget: agent.budget, clock })
              .move;

      jointMoves.set(seat, move);
      lastMoveBySeat[seat] = move;
    }

    state = engine.apply(state, jointMoves, applyRng);
    status = engine.status(state);
    plies += 1;
  }

  // Still ongoing after the loop exits only because the ply cap was hit — adjudicated draw,
  // logged via `capHit` (plan §7.2), never conflated with a genuine rules-drawn terminal for
  // anyone who cares which one happened, even though both count as a draw for winnerSeat.
  const capHit = status.kind === "ongoing";
  const winnerSeat: PlayerId | null = !capHit && status.kind === "won" ? status.winner : null;

  return {
    matchSeed,
    seatAgent: [seatAgents[0].name, seatAgents[1].name],
    winnerSeat,
    plies,
    capHit,
    branchingSamples,
  };
}

export function runMatchup<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  agentA: AgentSpec<S, M>,
  agentB: AgentSpec<S, M>,
  opts: RunMatchupOptions
): MatchupReport {
  if (!Number.isInteger(opts.games) || opts.games < 1) {
    throw new RangeError(`runMatchup: games must be a positive integer, got ${opts.games}`);
  }
  const maxPlies = opts.maxPlies ?? 200;
  const mirrorSeats = opts.mirrorSeats ?? true;
  const clock = opts.clock ?? realClock;

  const start = clock.now();
  const outcomes: GameOutcome[] = [];
  let pairIndex = 0;
  while (outcomes.length < opts.games) {
    const matchSeed = `${opts.seed}:${pairIndex}`;
    outcomes.push(playOneGame(engine, matchSeed, [agentA, agentB], maxPlies, clock));
    if (mirrorSeats && outcomes.length < opts.games) {
      outcomes.push(playOneGame(engine, matchSeed, [agentB, agentA], maxPlies, clock));
    }
    pairIndex += 1;
  }
  // Clamped to at least 1ms so a fake/coarse clock (or a batch fast enough to elapse 0ms on a
  // real one) can never divide-by-zero into Infinity — which JSON.stringify silently maps to
  // `null`, indistinguishable from a real absent value (the same NaN/Infinity trap
  // @twist-arcade/engine's stableStringify guards against explicitly).
  const elapsedMs = Math.max(1, clock.now() - start);

  return {
    agentA: agentA.name,
    agentB: agentB.name,
    metrics: computeMatchupMetrics(outcomes),
    throughputGamesPerSec: (outcomes.length / elapsedMs) * 1000,
    outcomes,
  };
}

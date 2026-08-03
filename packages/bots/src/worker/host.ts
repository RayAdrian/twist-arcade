// packages/bots/src/worker/host.ts — the Web Worker host (plan §6).
//
// `handleBotRequest` is the whole protocol in one pure, testable function: resolve gameId ->
// registry entry -> dynamic-imported engine (code-split: a worker only ever pulls in the
// engine chunk for the game it is actually asked to play); resolve tierId -> the game's own
// manifest.difficultyTiers entry; decode the caller's encodedState through the GAME's OWN
// engine.decode() (never trusts a live object across the postMessage boundary — and this is
// the one seam in the whole platform where C4's "decode throws on malformed input, never
// returns a partial state" rule is load-bearing against a genuinely external input); build a
// tierPolicy for the resolved tier and run it; return a BotResponse.
//
// FRAMEWORK-AGNOSTIC ON PURPOSE: there is no `self.onmessage` in this file. `handleBotRequest`
// takes its Registry as a plain argument rather than importing `games/registry.ts` directly,
// for two compounding reasons: (1) packages/bots declares ONLY @twist-arcade/engine and
// @twist-arcade/game-spec as dependencies (package.json) — reaching across the package
// boundary into the app-owned `games/` directory would be an undeclared, un-typechecked
// dependency (tsc -b's per-package `rootDir` would reject a source file living outside this
// package importing one living outside it too); (2) the plan's own ownership line — "Host is
// UI-framework-free; the shell team wraps it in their useGame hook" — reads most naturally as
// the shell owning the concrete `new Worker(...)` bootstrap file that imports both this
// function and its OWN bundled `games/registry`, and calls the one exported entry point below.
// That thin bootstrap file is intentionally NOT built here (shell-team scope, plan §1's
// non-goals) — this module is everything short of it, unit-testable without a DOM/Worker
// environment at all (see test/worker/host.test.ts, which calls handleBotRequest directly
// against a fixture Registry).
//
// DETERMINISM (plan §13's headline acceptance item, and correction context from §5.2 /
// orchestrator decision 7): the SAME BotRequest, handled twice, must return an IDENTICAL move
// when the resolved tier's budget is `{kind:"rollouts"}` — the policy rng is rebuilt fresh
// from `rngFor(seed + ":bot", step)` on every call, so replaying the identical
// (gameId, encodedState, player, tierId, seed, step) tuple replays the identical rng stream
// and therefore the identical decision, with no hidden state carried between calls. A
// `deadlineMs` tier is explicitly NOT reproducible this way (a slower machine completes fewer
// rollouts before the same wall-clock deadline) — `assertDeterministic: true` makes
// `handleBotRequest` REFUSE such a tier with a typed `NonDeterministicBudgetError` (surfaced
// as `{ ok: false, error }`, never a silent accept) rather than let a caller who needs
// reproducibility (a pinned daily bot, a determinism test) unknowingly get a wall-clock bot
// instead. Interactive (non-daily) callers simply omit the flag and keep deadlineMs's
// weak-device responsiveness.

import type { GameEngine, PlayerId } from "@twist-arcade/engine";
import { rngFor } from "@twist-arcade/engine";
import type { Registry } from "@twist-arcade/game-spec";
import { requireDeterministicBudget, type Clock } from "../policy";
import { tierPolicy } from "../tiers";
import type { BotRequest, BotResponse } from "./protocol";

export class UnknownGameError extends Error {
  constructor(gameId: string) {
    super(`worker host: no registry entry for gameId "${gameId}"`);
    this.name = "UnknownGameError";
  }
}

export class UnknownTierError extends Error {
  constructor(gameId: string, tierId: string) {
    super(`worker host: game "${gameId}" has no difficultyTiers entry with id "${tierId}"`);
    this.name = "UnknownTierError";
  }
}

export interface HandleBotRequestOptions {
  /** When true, refuse (typed error, never a silent accept) any resolved tier whose budget is
   *  `deadlineMs` — the caller is asserting this response must be reproducible (a pinned daily
   *  bot, or a determinism test) and a wall-clock budget cannot honor that. Default false:
   *  ordinary interactive play legitimately uses deadlineMs tiers and must not be blocked. Not
   *  part of BotRequest's own wire shape (plan §6 pins that shape exactly) — this is the
   *  CALLING CONTEXT's own knowledge of whether determinism is required, not something that
   *  needs to travel over postMessage. */
  assertDeterministic?: boolean;
}

/**
 * Resolves one BotRequest to a BotResponse. Never throws — every failure (unknown game,
 * unknown tier, a decode() rejection, a refused non-deterministic budget) is caught and
 * returned as a `{ ok: false, error }` response, since a thrown Error does not survive
 * structured clone across a real postMessage boundary with its identity intact.
 */
export async function handleBotRequest(
  registry: Registry,
  request: BotRequest,
  clock: Clock,
  opts: HandleBotRequestOptions = {}
): Promise<BotResponse> {
  try {
    const entry = registry[request.gameId];
    if (!entry) throw new UnknownGameError(request.gameId);

    const tier = entry.manifest.difficultyTiers.find((t) => t.id === request.tierId);
    if (!tier) throw new UnknownTierError(request.gameId, request.tierId);

    if (opts.assertDeterministic) {
      requireDeterministicBudget(
        tier.budget,
        `worker host (gameId=${request.gameId}, tierId=${request.tierId})`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (await entry.loadEngine()) as GameEngine<any, any, any>;
    // C4: decode() throws a typed error on malformed input rather than returning a partial
    // state — that throw propagates out of this try and becomes a typed ok:false below,
    // never a silently-accepted forged state.
    const state = engine.decode(request.encodedState);

    const policyRng = rngFor(`${request.seed}:bot`, request.step);
    const policy = tierPolicy(tier);
    const { move, stats } = policy.chooseMove({
      engine,
      state,
      player: request.player as PlayerId,
      rng: policyRng,
      budget: tier.budget,
      clock,
    });

    return { requestId: request.requestId, ok: true, move, stats };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { requestId: request.requestId, ok: false, error: { name: error.name, message: error.message } };
  }
}

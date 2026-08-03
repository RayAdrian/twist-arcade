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

/**
 * Thrown when a request targets a `hiddenInformation: true` game. This is correction C1 made
 * concrete at the exact seam its own text warns about: "the harness cannot use a single
 * policy-invocation signature across perfect- and hidden-information games without care —
 * that seam is where the bug would come back." `tierPolicy` (tiers.ts) only ever builds a
 * state-space `Policy<S,M>` (its PolicySpec union has no "determinized"/ViewPolicy variant
 * yet), and this host decodes and hands over the REAL canonical state — safe for a
 * perfect-info game (where playerView is the identity), a silent C1 violation for a
 * hidden-info one (a "Strong" tier would read unrevealed secrets and post a passing gate on a
 * game no human could play blind). Refusing loudly here is deliberate scoping, not an
 * oversight: wiring a determinized (view-honest) tier through this path is real future work
 * (plan's own note: "Determinized Strong lives in packages/bots... reused by every hidden-info
 * game and becomes the shipped hint feature") that has no consumer yet in M2 — no shipped game
 * needs it today, and this refusal is what stands in for that work until it exists, so the gap
 * fails loud instead of shipping broken.
 */
export class HiddenInformationUnsupportedError extends Error {
  constructor(gameId: string) {
    super(
      `worker host: game "${gameId}" has hiddenInformation===true — tierPolicy has no ` +
        "view-honest (determinized) search variant yet, and handing this seam the canonical " +
        "state would violate correction C1 (a policy that can read unrevealed secrets posts a " +
        "passing gate on a game that is unplayable blind). Refusing rather than silently " +
        "leaking secrets."
    );
    this.name = "HiddenInformationUnsupportedError";
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

  /** Resolves the game-specific "is this move twist-exploiting" predicate `tierPolicy` needs
   *  to act on `BotRequest.soften` (tiers.ts's SOFTEN doc). A function cannot cross a real
   *  postMessage boundary, so it is never part of `BotRequest` itself — this callback runs
   *  INSIDE the worker process (same JS realm as `handleBotRequest`), given the resolved
   *  `gameId` and the already-loaded `engine`, and returns the predicate directly (or
   *  `undefined` if the resolved game has none — `soften` is then correctly a no-op, per
   *  tierPolicy's own contract). Left unset entirely (the default), `soften` is ALWAYS a no-op
   *  — there is no predicate to raise epsilon against. The concrete bootstrap file that owns
   *  `new Worker(...)` (shell-team scope, per this module's own doc) is the natural place to
   *  supply this, since it already imports the bundled per-game registry this needs to consult. */
  resolveIsTwistExploitingMove?: (
    gameId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: GameEngine<any, any, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => ((state: any, move: any) => boolean) | undefined;
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

    // Correction C1's seam, guarded BEFORE decode/search ever touches the canonical state —
    // see HiddenInformationUnsupportedError's doc for why this is a refusal, not a routing
    // decision made silently.
    if (engine.meta.hiddenInformation) {
      throw new HiddenInformationUnsupportedError(request.gameId);
    }

    // C4: decode() throws a typed error on malformed input rather than returning a partial
    // state — that throw propagates out of this try and becomes a typed ok:false below,
    // never a silently-accepted forged state.
    const state = engine.decode(request.encodedState);

    const policyRng = rngFor(`${request.seed}:bot`, request.step);
    const isTwistExploitingMove = opts.resolveIsTwistExploitingMove?.(request.gameId, engine);
    // Built conditionally (never `key: undefined`) — exactOptionalPropertyTypes treats a
    // present-but-undefined property differently from an absent one, and TierPolicyOptions's
    // own fields are typed as plain optionals (soften?: boolean), not `boolean | undefined`.
    const policy = tierPolicy(tier, {
      ...(request.soften !== undefined ? { soften: request.soften } : {}),
      ...(isTwistExploitingMove !== undefined ? { isTwistExploitingMove } : {}),
    });
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

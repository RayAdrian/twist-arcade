// packages/shell/src/bot-driver.ts — the BotDriver seam + the M2 stub (plan §5.4).
//
// `BotMoveRequest` mirrors platform M2's `BotRequest` wire shape by field-name convention
// (gameId, encodedState, player, tierId, seed, step) plus `soften?: boolean` (§5.2.10), so the
// post-M2 `workerBotDriver` is a thin postMessage adapter over `packages/bots`'s worker host
// with zero changes to `useGame`. `packages/bots` does not exist in this worktree yet (M2 is a
// later milestone) — this file is the shell-owned seam type, not a copy of a real upstream
// type; when M2 lands, `BotMoveRequest`'s shape should be reconciled against the real
// `BotRequest` (a 1-line import fix if they already match, per the shim-drift pattern S0 used
// for engine/game-spec).
//
// `requestId` (not in the plan's illustrative interface sketch) is added here because
// `cancel(requestId)` is meaningless without a way to correlate it to a specific in-flight
// `chooseMove` call — `useGame` generates one per bot turn and uses it for both.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import { rngFor } from "@twist-arcade/engine";

export type TierId = "casual" | "standard" | "ruthless";

/** Provisional — platform M2 owns the real shape once the worker host exists. */
export interface SearchStats {
  nodesVisited?: number;
}

export interface BotMoveRequest {
  requestId: string;
  gameId: string;
  encodedState: string;
  player: PlayerId;
  tierId: TierId;
  seed: string;
  step: number;
  /** Never sent in daily mode (§5.2.10) — that assertion is `useGame`'s job, not the driver's. */
  soften?: boolean;
}

export interface BotMoveResponse {
  move: Json;
  stats?: SearchStats;
}

export interface BotDriver {
  chooseMove(req: BotMoveRequest): Promise<BotMoveResponse>;
  /** Rejects the matching in-flight `chooseMove` call (if any) with BotCancelledError. Never
   *  throws for an unknown/already-settled requestId — cancellation races are expected. */
  cancel(requestId: string): void;
  /** Rejects every still-pending request (BotCancelledError) — called on unmount. */
  dispose(): void;
}

export class BotCancelledError extends Error {
  constructor(requestId: string) {
    super(`bot request ${requestId} was cancelled`);
    this.name = "BotCancelledError";
  }
}

export class ScriptExhaustedError extends Error {
  constructor() {
    super(
      "scriptedBotDriver: chooseMove() was called more times than the script provided moves for — " +
        "extend the script or the test is asking for more bot turns than it accounted for."
    );
    this.name = "ScriptExhaustedError";
  }
}

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>;
  reject(err: Error): void;
}

/** Shared cancel/dispose bookkeeping for both drivers below: a Map of requestId -> the pending
 *  timer + reject callback, so `cancel`/`dispose` can settle a promise from the outside. */
function makePendingRegistry() {
  const pending = new Map<string, PendingEntry>();

  function register(requestId: string, timer: ReturnType<typeof setTimeout>, reject: (err: Error) => void): void {
    pending.set(requestId, { timer, reject });
  }

  function settle(requestId: string): void {
    pending.delete(requestId);
  }

  function cancel(requestId: string): void {
    const entry = pending.get(requestId);
    if (!entry) return; // already settled, or never existed — cancellation races are fine.
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.reject(new BotCancelledError(requestId));
  }

  function dispose(): void {
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new BotCancelledError(requestId));
    }
    pending.clear();
  }

  return { register, settle, cancel, dispose };
}

/**
 * stubBotDriver — // NOT SHIPPABLE. Picks uniformly among `engine.legalMoves(state, player)`
 * using `rngFor(seed + ":bot", step)` (deterministic and replayable — the same seed/step always
 * produces the same "bot" move, so undo/replay stays exact through a stubbed bot turn), with an
 * artificial 250ms delay so pacing UI (the `botThinking` state, the tier's `minReplyMs` floor)
 * is exercised against something real. Exists purely so shell + game UI work proceeds through
 * M2's 3-4 day window (plan §5.4) — the Phase 0 exit criterion "Fadeout playable" is met ONLY
 * once the real worker driver replaces this.
 */
export function stubBotDriver<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): BotDriver {
  const registry = makePendingRegistry();

  return {
    chooseMove(req: BotMoveRequest): Promise<BotMoveResponse> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          registry.settle(req.requestId);
          const state = engine.decode(req.encodedState);
          const legal = engine.legalMoves(state, req.player);
          const rng = rngFor(`${req.seed}:bot`, req.step);
          const move = legal[rng.int(legal.length)];
          if (move === undefined) {
            reject(new Error(`stubBotDriver: no legal moves for player ${req.player} at step ${req.step}`));
            return;
          }
          resolve({ move });
        }, 250);
        registry.register(req.requestId, timer, reject);
      });
    },
    cancel(requestId: string): void {
      registry.cancel(requestId);
    },
    dispose(): void {
      registry.dispose();
    },
  };
}

/**
 * scriptedBotDriver — ships alongside the stub for deterministic Playwright/unit tests (plan
 * §5.4). Returns `moves` in order, one per `chooseMove` call, regardless of the request's
 * legality (the test author is asserting a specific trajectory, not fuzzing one). Throws
 * `ScriptExhaustedError` — loudly, not `undefined` — once exhausted, so an under-scripted test
 * fails clearly instead of hanging or silently returning garbage.
 */
export function scriptedBotDriver(moves: readonly Json[], delayMs = 0): BotDriver {
  const registry = makePendingRegistry();
  const queue = [...moves];

  return {
    chooseMove(req: BotMoveRequest): Promise<BotMoveResponse> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          registry.settle(req.requestId);
          const move = queue.shift();
          if (move === undefined) {
            reject(new ScriptExhaustedError());
            return;
          }
          resolve({ move });
        }, delayMs);
        registry.register(req.requestId, timer, reject);
      });
    },
    cancel(requestId: string): void {
      registry.cancel(requestId);
    },
    dispose(): void {
      registry.dispose();
    },
  };
}

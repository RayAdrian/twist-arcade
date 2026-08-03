// packages/shell/src/bot-driver.ts — the BotDriver seam + the M2 stub + the real S2 worker
// driver (plan §5.4).
//
// RECONCILED (S2 — M2 has landed in this worktree): `BotMoveRequest`/`TierId`/`SearchStats`
// were originally a hand-copied shim (this file's own prior header said so verbatim: "when M2
// lands, BotMoveRequest's shape should be reconciled against the real BotRequest — a 1-line
// import fix if they already match"). They did match field-for-field, so these are now type
// ALIASES of `@twist-arcade/bots`'s real wire types, not a second hand-maintained copy — exactly
// the C8 lesson (platform-corrections.md: two implementations of the same concept silently
// drift) applied before any drift had a chance to happen.
//
// `requestId` (not in the plan's illustrative interface sketch) is added here because
// `cancel(requestId)` is meaningless without a way to correlate it to a specific in-flight
// `chooseMove` call — `useGame` generates one per bot turn and uses it for both.

import type { Json, WithEffects, GameEngine } from "@twist-arcade/engine";
import { rngFor } from "@twist-arcade/engine";
import type { SearchStats } from "@twist-arcade/bots";
import type { BotRequest, BotResponse } from "@twist-arcade/bots/worker/protocol";

export type { SearchStats };
export type TierId = BotRequest["tierId"];
export type BotMoveRequest = BotRequest;

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

/**
 * workerBotDriver — the S2 real bot, a thin postMessage adapter over
 * `packages/bots/src/worker/host.ts`'s `handleBotRequest` (plan §5.4/§10). This is a pure
 * ADAPTER: it knows nothing about `new Worker(...)` construction, `games/registry.ts`, or which
 * concrete game is loaded — it just speaks the wire protocol (`BotRequest`/`BotResponse`,
 * `@twist-arcade/bots/worker/protocol`) over whatever `WorkerLike` it is handed.
 *
 * WHY THE CONCRETE `new Worker(...)` IS NOT HERE (host.ts's own doc anticipates a "shell owns
 * the bootstrap file" reading — this is the precise reconciliation): the actual worker MODULE
 * that runs `self.onmessage = ...` must statically import `games/registry.ts` so it can resolve
 * `loadEngine()` for whichever game a request names. `games/registry.ts` lives outside every
 * package's `rootDir`/tsconfig project-reference graph (it's part of `tsconfig.app.json`'s own
 * project, not `packages/shell`'s) — precisely the same reason `GameShell`/`PlayClient` already
 * take a `RegistryEntry`/`Registry` as a prop/parameter instead of importing the registry
 * directly (see `GameShell.tsx`'s and `PlayClient.tsx`'s own header comments). So the concrete
 * worker entry script lives at `app/bot-worker.ts` (app-owned, where the registry import is
 * legal) and constructs `new Worker(new URL("../bot-worker.ts", import.meta.url))`; this
 * function is what turns that `Worker` instance into a `BotDriver` `useGame` can drive
 * identically to `stubBotDriver`/`scriptedBotDriver`.
 *
 * DETERMINISM ACROSS THE REAL BOUNDARY: `chooseMove` posts `req` verbatim (already JSON-plain
 * per `BotRequest`'s own contract) and resolves/rejects from whatever `BotResponse` the worker
 * posts back for that `requestId` — no client-side state influences the result, so a
 * `rollouts`-budget tier's determinism (proven in `packages/bots/test/worker/host.test.ts`
 * against `handleBotRequest` directly) survives unchanged through a REAL `postMessage`/
 * structured-clone round trip. Proven here (not just asserted) in
 * `test/worker-bot-driver.test.ts` via a fake worker that runs the real `handleBotRequest` and
 * round-trips every message through `JSON.parse(JSON.stringify(...))`.
 *
 * CANCEL SEMANTICS: `handleBotRequest` has no cancellation hook — once posted, the worker runs
 * the request to completion regardless. `cancel(requestId)` therefore does NOT postMessage
 * anything back to the worker; it simply forgets the pending entry and rejects the caller's
 * promise immediately. The worker's eventual response for that `requestId` still arrives later
 * and is silently dropped (no matching pending entry) — wasted CPU in the worker thread, never
 * a correctness problem, exactly like a network request whose response is ignored after the
 * caller gave up on it.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Carries a `BotResponse`'s `{ ok: false, error: { name, message } }` payload back into a
 *  rejected promise, `name` set to the ORIGINAL typed error's name (e.g.
 *  "HiddenInformationUnsupportedError", "NonDeterministicBudgetError") — never a generic
 *  "Error", since `err.name` is precisely how `useGame`/a caller would branch on which typed
 *  refusal occurred (protocol.ts's own module doc: "ok: false carries a plain, JSON-plain
 *  `{ name, message }` — enough for the caller to branch on `error.name` without relying on
 *  cross-realm `instanceof`"). This class does not (and cannot) restore the original
 *  prototype/instanceof chain — only `.name`/`.message` survive a real postMessage boundary. */
export class WorkerBotError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

interface WorkerPendingEntry {
  resolve(res: BotMoveResponse): void;
  reject(err: Error): void;
}

export function workerBotDriver(worker: WorkerLike): BotDriver {
  const pending = new Map<string, WorkerPendingEntry>();

  function handleMessage(event: MessageEvent): void {
    // Trusts the worker's own reply shape — this is OUR bootstrap script on the other end
    // (app/bot-worker.ts), not arbitrary external input; the untrusted-input boundary
    // (`encodedState`) is handled inside `handleBotRequest` itself via `engine.decode()` (C4).
    const data = event.data as BotResponse;
    const entry = pending.get(data.requestId);
    if (!entry) return; // already cancelled/disposed, or not a request this driver instance sent.
    pending.delete(data.requestId);
    if (data.ok) {
      entry.resolve({ move: data.move, stats: data.stats });
    } else {
      entry.reject(new WorkerBotError(data.error.name, data.error.message));
    }
  }

  worker.addEventListener("message", handleMessage);

  return {
    chooseMove(req: BotMoveRequest): Promise<BotMoveResponse> {
      return new Promise((resolve, reject) => {
        pending.set(req.requestId, { resolve, reject });
        worker.postMessage(req);
      });
    },
    cancel(requestId: string): void {
      const entry = pending.get(requestId);
      if (!entry) return; // already settled, or never existed — cancellation races are fine.
      pending.delete(requestId);
      entry.reject(new BotCancelledError(requestId));
    },
    dispose(): void {
      for (const [requestId, entry] of pending) {
        entry.reject(new BotCancelledError(requestId));
      }
      pending.clear();
      worker.removeEventListener("message", handleMessage);
    },
  };
}

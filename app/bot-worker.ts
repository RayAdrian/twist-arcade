// app/bot-worker.ts — the concrete `new Worker(...)` entry point (plan §5.4/§10's S2 milestone:
// "the real worker driver replaces [stubBotDriver]"). This file IS the worker: it runs in a
// dedicated Web Worker global scope, not the main thread.
//
// Lives here (app-owned), not under packages/shell, because it must statically import
// `games/registry.ts` to resolve `loadEngine()` for whichever game a request names — and
// `games/registry.ts` is part of `tsconfig.app.json`'s own project (not any packages/shell
// project reference), for the exact same reason `GameShell`/`PlayClient` already take a
// `RegistryEntry`/`Registry` as a prop/parameter instead of importing the registry directly (see
// those files' own header comments, and `packages/shell/src/bot-driver.ts`'s `workerBotDriver`
// doc for the full reconciliation). `packages/shell/src/bot-driver.ts` owns the reusable,
// testable postMessage ADAPTER (`workerBotDriver`); this file owns the one concrete Worker
// bootstrap that adapter talks to.
//
// FRAMEWORK-AGNOSTIC HOST, THIN GLUE HERE: all protocol logic (decode, tier resolution, C1's
// hidden-information refusal, C4's decode-throws contract, determinism) lives in
// `@twist-arcade/bots`'s `handleBotRequest` — this file only wires `self.onmessage` to it with
// this app's concrete `registry` and `Date.now()`-based `Clock` (the one sanctioned wall-clock
// read on this side of the boundary; see bots' own eslint carve-out for `packages/bots/src/
// worker/**` for the platform-side mirror of this same allowance).
import { handleBotRequest } from "@twist-arcade/bots/worker/host";
import type { BotRequest, BotResponse } from "@twist-arcade/bots/worker/protocol";
import { registry } from "../games/registry";
import { TWIST_EXPLOITING_MOVE_PREDICATES } from "./bot-worker-twist-predicates";

// This file is compiled inside tsconfig.app.json's single project (`lib: ["ES2022","DOM",
// "DOM.Iterable"]`) alongside every other app/** file — it cannot ALSO load the separate
// "webworker" lib (its ambient `self: DedicatedWorkerGlobalScope` declaration collides with
// DOM's own `self: Window & typeof globalThis`). Casting through `Worker` — the MAIN-thread
// handle's type, which declares the same `postMessage`/`onmessage` shape this worker's global
// `self` actually has at runtime — gets real typing here without a second, conflicting lib.
const ctx = self as unknown as Worker;

const clock = { now: () => Date.now() };

ctx.onmessage = (event: MessageEvent<BotRequest>) => {
  handleBotRequest(registry, event.data, clock, {
    resolveIsTwistExploitingMove: (gameId, engine) => TWIST_EXPLOITING_MOVE_PREDICATES[gameId]?.(engine),
  }).then((response: BotResponse) => {
    ctx.postMessage(response);
  });
};

// Marks this file as a module for isolatedModules (no other export needed — `self.onmessage`
// wiring above is the entire contract a Web Worker script needs to satisfy).
export {};

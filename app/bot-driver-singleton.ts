// app/bot-driver-singleton.ts — the one place `new Worker(...)` is actually called (plan
// §5.4/§10). Module-scope singleton rather than per-render/per-effect state, for a real reason,
// not just convenience:
//
// `useGame`'s `driverRef` captures `opts.botDriver` via a LAZY ref init on the hook's OWN first
// render and never re-points it afterward (`packages/shell/src/bot-driver.ts`'s own comment:
// "Callers must treat botDriver as effectively stable... exactly like a real worker connection
// would be"). If this file instead constructed the worker inside a `useEffect` (state populated
// only on a LATER render), `PlayClient`'s first render would pass `botDriver: undefined` down —
// and if that first render happened to be the one `useGame` captures its ref from, the bot would
// never dispatch, full stop. Today that race doesn't fire in practice (`GameShellReady`/`useGame`
// only ever mount after `GameShell`'s own `loadEngine()/loadPresentation()` dynamic import
// resolves, which is reliably slower than a same-tick effect+state round trip) — but relying on
// that gap being wide enough is exactly the kind of implicit-timing assumption this project's own
// standing warning exists to catch. A module-scope singleton has no such gap: `getBotDriver()`
// returns the real thing SYNCHRONOUSLY, before any component that calls it has rendered once.
//
// Reused across `/play/[gameId]` navigations for the same reason a real socket connection would
// be — one Worker per tab, not one per game mount.
//
// SSR SAFETY: this module's top-level code also executes in Node during the server render of the
// "use client" component that calls it (Next still renders Client Components server-side for the
// initial HTML) — `typeof Worker === "undefined"` there, so `getBotDriver()` returns `undefined`
// and `GameShell`'s own `stubBotDriver` fallback covers that one SSR-only, never-interactive
// pass. The browser's module instance (a separate realm entirely) constructs the real thing.
import { workerBotDriver, type BotDriver } from "@twist-arcade/shell";

declare global {
  interface Window {
    /** Set once the real worker driver is constructed — read by Playwright only (Risks table:
     *  "Stub driver ships by accident... a Phase-0-exit Playwright assertion that the worker
     *  driver is active"). No product code branches on this. */
    __TWIST_ARCADE_BOT_DRIVER_KIND__?: "worker";
  }
}

let cachedDriver: BotDriver | undefined;

export function getBotDriver(): BotDriver | undefined {
  if (typeof Worker === "undefined") return undefined; // SSR, or a browser with no Worker support.
  if (!cachedDriver) {
    const worker = new Worker(new URL("./bot-worker.ts", import.meta.url), { type: "module" });
    cachedDriver = workerBotDriver(worker);
    if (typeof window !== "undefined") window.__TWIST_ARCADE_BOT_DRIVER_KIND__ = "worker";
  }
  return cachedDriver;
}

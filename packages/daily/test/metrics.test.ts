import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureMetricsProvider,
  noopProvider,
  shareOutcomeToPath,
  track,
  trackOnceForDaily,
  umamiProvider,
  type MetricsProvider,
} from "../src/metrics";

// Plan §10/§12 Q1: `track(event, props)` is the ONE door every call site uses — no component
// imports an analytics SDK directly, so a provider swap is a one-file change (this one). Umami
// Cloud is the chosen vendor; the facade/provider split is the actual binding requirement, not
// the vendor. No PII in props (enforced at the type level by the TrackEventPropsMap union —
// see the @ts-expect-error test below); denominators fire on completion, not start; share_done
// distinguishes "artifact copied/shared" from "sheet opened then dismissed."

describe("metrics.ts — track() facade", () => {
  afterEach(() => {
    configureMetricsProvider(noopProvider); // restore default between tests
  });

  it("delegates to the configured provider with the exact event name and props", () => {
    const spy = vi.fn();
    const provider: MetricsProvider = { track: spy };
    configureMetricsProvider(provider);

    track("daily_complete", { gameId: "fadeout", kind: "vs-bot", n: 37, result: "won", moves: 9, restarts: 0 });

    expect(spy).toHaveBeenCalledWith("daily_complete", {
      gameId: "fadeout",
      kind: "vs-bot",
      n: 37,
      result: "won",
      moves: 9,
      restarts: 0,
    });
  });

  it("defaults to a no-op provider — calling track() before configuration never throws", () => {
    expect(() => track("share_open", { gameId: "fadeout", mode: "daily" })).not.toThrow();
  });

  it("the props type only admits the declared safe fields — no PII shape compiles", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    // @ts-expect-error — `email`/`name` are not part of any TrackEventPropsMap entry; the type
    // union is the enforcement mechanism for "no PII in event props" (plan §12 Q1).
    track("daily_complete", { email: "player@example.com", name: "Pat" });
    // The call above is a type error and would fail `pnpm typecheck`; at runtime (vitest is
    // transpile-only) it still reaches the provider, which is exactly why typecheck must run in
    // the loop and not be trusted to vitest alone.
    expect(spy).toHaveBeenCalled();
  });
});

describe("metrics.ts — umamiProvider (the Q1-chosen vendor, behind the facade)", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restoring the original value is never a type error (same declared type going back in) —
    // only the deliberately-reshaped test doubles below need @ts-expect-error.
    globalThis.window = originalWindow;
  });

  it("never throws when window.umami hasn't loaded yet (script still in flight, or SSR)", () => {
    // @ts-expect-error — deliberately simulate umami being absent.
    globalThis.window = { ...originalWindow, umami: undefined };
    expect(() => umamiProvider.track("share_open", { gameId: "fadeout", mode: "daily" })).not.toThrow();
  });

  it("forwards to window.umami.track() when present", () => {
    const umamiTrack = vi.fn();
    // @ts-expect-error — test-only global shape.
    globalThis.window = { ...originalWindow, umami: { track: umamiTrack } };
    umamiProvider.track("share_open", { gameId: "fadeout", mode: "daily" });
    expect(umamiTrack).toHaveBeenCalledWith("share_open", { gameId: "fadeout", mode: "daily" });
  });
});

describe("metrics.ts — trackOnceForDaily() (plan §10.1's 'Once per: device x daily N' dedup)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    configureMetricsProvider(noopProvider);
  });

  it("fires the first time for a given daily number", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    const fired = trackOnceForDaily("daily_complete", 37, { gameId: "fadeout", kind: "vs-bot", n: 37, result: "won", moves: 9, restarts: 0 });
    expect(fired).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire a second time for the SAME daily number — one enthusiast sharing to three chats must not inflate the growth metric", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    trackOnceForDaily("share_done", 37, { gameId: "fadeout", mode: "daily", path: "native" });
    const firedAgain = trackOnceForDaily("share_done", 37, { gameId: "fadeout", mode: "daily", path: "clipboard" });
    expect(firedAgain).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fires again for a DIFFERENT daily number", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    trackOnceForDaily("daily_start", 37, { gameId: "fadeout", kind: "vs-bot", n: 37 });
    const firedNextDay = trackOnceForDaily("daily_start", 38, { gameId: "fadeout", kind: "vs-bot", n: 38 });
    expect(firedNextDay).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does NOT latch the dedup key while the noop provider is active — a later configureMetricsProvider() call must still be able to fire this event (should-fix 6)", () => {
    // Deliberately no configureMetricsProvider() call before this — activeProvider is whatever
    // the afterEach hooks above reset it to: noopProvider, the documented state before the app
    // root has configured anything (SSR, or the earliest hydration tick). Before the fix, the
    // dedup key latched on this very call even though the event went nowhere, permanently
    // losing it for this device x daily N — the metric would UNDER-count forever, not just once.
    const fired = trackOnceForDaily("daily_start", 99, { gameId: "fadeout", kind: "vs-bot", n: 99 });
    expect(fired).toBe(true); // the call went through (not blocked by an existing dedup latch)...
    expect(window.localStorage.getItem("ta:metric:daily_start:99")).toBeNull(); // ...but nothing was persisted

    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    const firedAgain = trackOnceForDaily("daily_start", 99, { gameId: "fadeout", kind: "vs-bot", n: 99 });
    expect(firedAgain).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("DOES latch once a real (non-noop) provider is active, same as before — the fix only relaxes the noop-provider case", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    trackOnceForDaily("daily_start", 55, { gameId: "fadeout", kind: "vs-bot", n: 55 });
    expect(window.localStorage.getItem("ta:metric:daily_start:55")).not.toBeNull();
    const firedAgain = trackOnceForDaily("daily_start", 55, { gameId: "fadeout", kind: "vs-bot", n: 55 });
    expect(firedAgain).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("degrades to 'fire anyway' if localStorage itself throws, rather than silently dropping the metric forever", () => {
    const spy = vi.fn();
    configureMetricsProvider({ track: spy });
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      const fired = trackOnceForDaily("daily_start", 1, { gameId: "fadeout", kind: "vs-bot", n: 1 });
      expect(fired).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.localStorage.getItem = original;
    }
  });
});

describe("metrics.ts — shareOutcomeToPath() (the copied-vs-dismissed distinction, orchestrator addendum §12 Q1)", () => {
  it("maps a resolved native share to 'native'", () => {
    expect(shareOutcomeToPath("shared")).toBe("native");
  });
  it("maps a successful clipboard write to 'clipboard'", () => {
    expect(shareOutcomeToPath("copied")).toBe("clipboard");
  });
  it("maps a genuine clipboard/share failure to null — the caller must NOT call share_done for this", () => {
    expect(shareOutcomeToPath("failed")).toBeNull();
  });
  it("maps a user-dismissed share sheet to null — distinct from 'failed', both mean 'do not fire share_done' (stage-6 must-fix 1)", () => {
    expect(shareOutcomeToPath("dismissed")).toBeNull();
  });
});

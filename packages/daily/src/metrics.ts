// packages/daily/src/metrics.ts — the provider-agnostic `track(event, props)` facade (plan §10,
// sharpened by the orchestrator addendum §12 Q1). Share rate is the product's #1 metric
// (roadmap: >=8% target, <2-3% after a real spike is the pivot trigger) and this is the ONE
// door every call site must go through — no component anywhere may import an analytics SDK
// directly, so swapping providers (Q1: Umami Cloud today, self-hosted-on-Supabase in Phase 2) is
// a one-file change: only `umamiProvider` below talks to any actual vendor.
//
// No PII: enforced at the TYPE level. `TrackEventPropsMap` is a closed union of exactly the
// fields the plan names as safe (game ids, daily numbers, result kinds, counts) — a caller
// cannot pass a name/email/token through `track()` because the props type for each event name is
// fixed and exhaustive, not `Record<string, unknown>`. See metrics.test.ts's @ts-expect-error
// case for the planted-violation proof.
//
// Denominators fire on completion, not start (plan §12 Q1, restated as a rule): daily_complete
// and share_done are the two events any rate calculation divides by; daily_start exists for
// funnel diagnostics only, never as a denominator.

export type DailyKind = "vs-bot" | "solo-puzzle" | "solo-chase";
export type ShareMode = "casual" | "daily";
export type SharePath = "native" | "clipboard";

export interface TrackEventPropsMap {
  daily_start: { gameId: string; kind: DailyKind; n: number };
  daily_complete: { gameId: string; kind: DailyKind; n: number; result: string; moves: number; restarts: number };
  share_open: { gameId: string; mode: ShareMode };
  /** Fires ONLY on a resolved `navigator.share` or a successful clipboard write — never on a
   *  rejected/dismissed share sheet or a failed clipboard write. See `shareOutcomeToPath` below,
   *  which is what makes that distinction mechanical rather than a discipline the caller must
   *  remember (plan §12 Q1: "otherwise the number flatters itself"). */
  share_done: { gameId: string; mode: ShareMode; path: SharePath };
  daily_fallback: { day: string; reason: string };
}

export type TrackEventName = keyof TrackEventPropsMap;

export interface MetricsProvider {
  track<E extends TrackEventName>(name: E, props: TrackEventPropsMap[E]): void;
}

/** The default provider until `configureMetricsProvider` is called — e.g. during SSR, before the
 *  collector script has loaded, or in any test that doesn't care about metrics. Never throws,
 *  never sends anything anywhere. */
export const noopProvider: MetricsProvider = {
  track: () => {
    // Intentionally empty.
  },
};

let activeProvider: MetricsProvider = noopProvider;

/** Swaps the active provider. The app's root wires this once (e.g. to `umamiProvider`, or a
 *  future Plausible/GoatCounter/self-hosted-Umami adapter) — every other call site only ever
 *  calls `track()` below and never touches this. */
export function configureMetricsProvider(provider: MetricsProvider): void {
  activeProvider = provider;
}

/** THE call site. Every component/hook that wants to record an event calls this — never a
 *  vendor SDK directly (plan §12 Q1; lint-enforceable via a no-restricted-imports rule naming
 *  this module as the only allowed door to any analytics vendor). */
export function track<E extends TrackEventName>(name: E, props: TrackEventPropsMap[E]): void {
  activeProvider.track(name, props);
}

declare global {
  interface Window {
    /** Umami Cloud's tracking script installs this global once loaded (plan §12 Q1's chosen
     *  vendor). Optional because the script may not have loaded yet (a event fired before
     *  hydration completes) or may never load (ad blocker, offline) — both must degrade to a
     *  silently-dropped event, never a thrown error on the play path. */
    umami?: { track(name: string, data?: Record<string, unknown>): void };
  }
}

/** The Umami Cloud adapter (orchestrator addendum §12 Q1). Deliberately ~10 lines: the entire
 *  vendor-specific surface this codebase touches, so a future self-hosted-Umami or
 *  Plausible/GoatCounter swap only ever edits this one function (plus whatever config wires it
 *  into `configureMetricsProvider` at app startup — never a second call site). */
export const umamiProvider: MetricsProvider = {
  track(name, props) {
    if (typeof window === "undefined" || !window.umami) return; // SSR, or script not loaded yet.
    window.umami.track(name, props as Record<string, unknown>);
  },
};

function dedupKey(name: TrackEventName, n: number): string {
  return `ta:metric:${name}:${n}`;
}

/**
 * Fires `track(name, props)` at most once per (this device, daily number `n`) — plan §10.1's
 * "Once per: device x daily N" column, covering `daily_start`, `daily_complete`, and `share_done`
 * in daily mode. Returns whether this call actually fired (`false` means an earlier call already
 * recorded this `n` — without this guard, one enthusiast sharing the same daily to three chats
 * would inflate the growth metric threefold). A localStorage failure (private mode, quota) is
 * treated as "fire anyway" — silently under-counting share rate forever is worse than
 * over-counting once in a degraded environment.
 */
export function trackOnceForDaily<E extends "daily_start" | "daily_complete" | "share_done">(
  name: E,
  n: number,
  props: TrackEventPropsMap[E]
): boolean {
  const key = dedupKey(name, n);
  try {
    if (window.localStorage.getItem(key) !== null) return false;
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable — fall through and fire anyway.
  }
  track(name, props);
  return true;
}

/**
 * Maps a share attempt's outcome (shell's `ShareOutcome`: "shared" | "copied" | "dismissed" |
 * "failed" — duplicated here as a literal union rather than importing the type, to keep this
 * module's only dependency the browser globals it already declares above) to the `share_done`
 * path it should fire under, or `null` when no `share_done` should fire at all. This is the
 * mechanical form of plan §12 Q1's binding rule: "a rejected share promise (user dismissed the
 * sheet) is never share_done."
 *
 * Stage-6 must-fix 1 correction: "dismissed" (the user backing out of the native share sheet,
 * shell's `invokeShare` AbortError case) and "failed" (a genuine clipboard write failure) are
 * DIFFERENT producer signals, kept distinct so a future analytics need (e.g. "how often do
 * people back out vs. hit a real error") isn't destroyed by collapsing them upstream — but both
 * map to the same `null` here: either way the artifact never reached anyone, so neither should
 * count toward share_done, the product's #1 metric.
 *
 * The switch has no `default` — an exhaustiveness check via `assertNever` in its place, so
 * adding a new `ShareOutcome` member without updating this function is a COMPILE ERROR here,
 * not a silent runtime fallthrough (which is exactly how the previous "failed covers both"
 * comment above went stale: a member was added upstream and nothing forced this file to notice).
 */
function assertNever(x: never): never {
  throw new Error(`metrics.ts: shareOutcomeToPath — unhandled ShareOutcome: ${JSON.stringify(x)}`);
}

export function shareOutcomeToPath(outcome: "shared" | "copied" | "dismissed" | "failed"): SharePath | null {
  switch (outcome) {
    case "shared":
      return "native";
    case "copied":
      return "clipboard";
    case "dismissed":
    case "failed":
      return null;
    default:
      return assertNever(outcome);
  }
}

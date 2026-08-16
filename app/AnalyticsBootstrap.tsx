// app/AnalyticsBootstrap.tsx — the ONE call site that wires a real analytics provider into
// packages/daily/src/metrics.ts's track() facade (plan §12 Q1: "no component anywhere may
// import an analytics SDK directly"). Renders nothing; its only job is deciding, once mounted
// in the browser, whether to swap the default noopProvider for umamiProvider.
//
// Gated on getUmamiConfig() (app/analytics-config.ts) — the SAME function app/layout.tsx's
// server-rendered <Script> tag is gated on, so the two can never disagree about whether Umami
// is configured. Unconfigured (both NEXT_PUBLIC_UMAMI_* vars unset) is the normal local-dev
// state: the effect body never runs, activeProvider stays metrics.ts's noopProvider, and
// nothing is sent anywhere — no network request, no console noise.
//
// A useEffect (not a module-scope call) so this only ever runs client-side, once, after mount
// — never during SSR, and never re-fires on re-render (the empty dependency array).
"use client";

import { useEffect } from "react";
import { configureMetricsProvider, umamiProvider } from "@twist-arcade/daily";
import { getUmamiConfig } from "./analytics-config";

export function AnalyticsBootstrap(): null {
  useEffect(() => {
    if (getUmamiConfig()) {
      configureMetricsProvider(umamiProvider);
    }
  }, []);
  return null;
}

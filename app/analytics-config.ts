// app/analytics-config.ts — C91: NEXT_PUBLIC_UMAMI_WEBSITE_ID / NEXT_PUBLIC_UMAMI_SCRIPT_URL
// were declared in .env.example with zero readers anywhere in the app. getUmamiConfig() is the
// ONE place this is decided — app/layout.tsx's server-rendered <Script> gate and
// app/AnalyticsBootstrap.tsx's client provider-wiring effect both call it, so the two can never
// silently disagree about whether Umami is configured (the exact drift shape C91 named: two
// independent checks of the same fact going stale relative to each other).
//
// Pure and side-effect-free: reads only the two NEXT_PUBLIC_ vars (inlined at build time, so
// this works identically server- and client-side) and returns null unless BOTH are non-empty.
// null is the normal state for local development and every worktree that hasn't set up an
// Umami Cloud account yet — it must never throw and never partially configure (e.g. a website
// id with no script url would produce a broken <script src="">).
export interface UmamiConfig {
  websiteId: string;
  scriptUrl: string;
}

export function getUmamiConfig(): UmamiConfig | null {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  if (!websiteId || !scriptUrl) return null;
  return { websiteId, scriptUrl };
}

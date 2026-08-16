// packages/shell/src/site-url.ts — resolves the app's absolute origin, consumed by
// GameShell.tsx's default `shareUrl` (plan §4.4's literal artifacts show a domain-qualified
// path — "twistarcade.game/d/fadeout" — never a bare "/play/{id}"; C91: NEXT_PUBLIC_SITE_URL
// existed in .env.example with zero readers). This is the ONE reader inside this package;
// app/layout.tsx's `metadataBase` reads the same env var directly (SSR-only, no `window`
// fallback needed there — see that file's comment for why it isn't routed through this
// function too).
//
// Primary source: NEXT_PUBLIC_SITE_URL, inlined at build time by Next for both server and
// client bundles — correct behind any proxy/CDN and stable across SSR vs. hydration. Falls
// back to `window.location.origin` only when running in the browser AND the env var is
// unset/blank (a defensive path — .env.example ships this var pre-filled with
// "http://localhost:3000", so an empty value should be rare, not the expected local-dev
// state). Falls back to a literal as the last resort so a non-browser, non-configured caller
// (e.g. a Node-run unit test) never throws.
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:3000";
}

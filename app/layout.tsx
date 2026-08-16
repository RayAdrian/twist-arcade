import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Fraunces, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import { getSiteUrl } from "@twist-arcade/shell";
import { AnalyticsBootstrap } from "./AnalyticsBootstrap";
import { getUmamiConfig } from "./analytics-config";
import "./globals.css";

// UI direction §1.1 Move 1 — the three self-hosted OFL faces, latin subset, `display: swap`.
// `next/font` downloads + self-hosts at build time and injects size-adjusted fallback metrics
// automatically, so swapping in the real face never costs a layout shift (the plan's own "fonts
// are asset weight, not JS budget... zero CLS" claim). Each is exposed ONLY as a CSS variable
// (`variable: "--font-*"`) — tailwind.config.ts maps the semantic `font-display`/`font-sans`/
// `font-mono` utilities onto these variables; nothing here hardcodes a literal font name outside
// this file, matching the same "tokens.css owns literals" convention the color tokens follow.
//
// Fraunces roman: variable wght 600-900 (opsz axis included for the letterpress "wonk"
// character at different sizes) — NO italic in this instance (Instrument Sans similarly loads
// no italic — the plan is explicit: "Instrument Sans italic is not loaded, so never style it
// italic"). Fraunces italic is a SEPARATE static-weight (500) instance below, its own CSS
// variable, because a single @font-face's italic glyphs only render when `font-style: italic`
// is actually applied — mixing both styles under one variable would let a plain `italic`
// utility silently fall back to synthetic (browser-faked) oblique on the roman face instead of
// the real italic instance. "No synthetic bold/italic anywhere" (§1.1) requires keeping them
// distinct on purpose.
const frauncesDisplay = Fraunces({
  subsets: ["latin"],
  style: ["normal"],
  weight: "variable",
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

const frauncesTexture = Fraunces({
  subsets: ["latin"],
  style: ["italic"],
  weight: "500",
  variable: "--font-display-italic",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  style: ["normal"],
  weight: "variable",
  variable: "--font-sans",
  display: "swap",
});

// Countdown numerals, kickers, stats, streaks, the move-timeline — "arcade tempo" (§1.1): every
// number in the product renders in this face, tabular. Only the two loaded weights the plan
// specifies (500/600 static) — no variable instance, so no accidental in-between weight ever
// ships.
const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  style: ["normal"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// metadataBase resolves every relative URL used elsewhere in this app's `Metadata` objects
// (app/play/[gameId]/page.tsx's generateMetadata openGraph block, and any future canonical/
// og:image entry) into an absolute one — without it, Next falls back to a build-time-inferred
// localhost URL and warns on every build (C91: NEXT_PUBLIC_SITE_URL had no reader anywhere).
// getSiteUrl() (packages/shell) reads NEXT_PUBLIC_SITE_URL directly; on the server (this file
// never runs in the browser) its `window` fallback is inert, so this is effectively "env var,
// else the literal http://localhost:3000" — matching .env.example's own pre-filled default.
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Twist Arcade",
  description: "Classic games, one rule changed.",
};

// Theme bootstrap (tokens.css's own comment: "the `.dark` class is applied by the theme
// bootstrap inline script in app/layout.tsx"). `strategy="beforeInteractive"` (below) runs it
// before hydration/paint, never as a `useEffect`, so there is never a flash of the wrong theme.
// Default: system `prefers-color-scheme`;
// an explicit `ta:settings.theme` in localStorage (set by the settings menu — not yet built,
// S1 gap noted in the final report) always wins over the OS setting. Never throws on corrupt/
// disabled storage (same "degrade silently" rule persistence.ts's own reads follow).
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var raw = window.localStorage.getItem("ta:settings");
    var theme = null;
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && (parsed.theme === "light" || parsed.theme === "dark")) {
        theme = parsed.theme;
      }
    }
    var dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    // Private mode / corrupt storage — fall back to no override, system default stands.
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // Server-evaluated: getUmamiConfig() reads process.env directly, so an unconfigured
  // deployment (the normal local-dev state, C91) never even STREAMS a <script> tag to the
  // client — not "hidden via CSS/JS", genuinely absent from the rendered HTML. Verified by
  // fetching the page both ways and inspecting the response body, not by reading this code.
  const umami = getUmamiConfig();

  return (
    <html
      lang="en"
      className={`${frauncesDisplay.variable} ${frauncesTexture.variable} ${instrumentSans.variable} ${splineSansMono.variable}`}
    >
      <body>
        {/* beforeInteractive: must run before hydration/paint so there is never a flash of
         *  the wrong theme — Next requires beforeInteractive scripts to be declared in the
         *  root layout (this file). */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
        {/* Umami Cloud (plan §12 Q1), loaded iff BOTH NEXT_PUBLIC_UMAMI_WEBSITE_ID and
         *  NEXT_PUBLIC_UMAMI_SCRIPT_URL are set — an intentional, silent no-op otherwise
         *  (C91). `afterInteractive` (Next's own recommended strategy for analytics/tag-
         *  manager scripts): it loads after the page becomes interactive rather than
         *  blocking hydration like `beforeInteractive` would, but still fires early enough
         *  to capture the initial pageview — unlike `lazyOnload`, which defers until the
         *  browser is idle and would lose fast-bouncing visitors, exactly the traffic a
         *  growth metric like share rate most needs to see. Umami is cookieless by default;
         *  nothing here adds a cookie or any cross-session identifier — see AnalyticsBootstrap
         *  for the (also gated) wiring of the metrics.ts provider this script's global
         *  (`window.umami`) is consumed through. */}
        {umami && (
          <Script id="umami-analytics" src={umami.scriptUrl} data-website-id={umami.websiteId} strategy="afterInteractive" />
        )}
        <AnalyticsBootstrap />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-paper focus:px-3 focus:py-2 focus:text-ink focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}

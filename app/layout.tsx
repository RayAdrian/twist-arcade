import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Fraunces, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
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

export const metadata: Metadata = {
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

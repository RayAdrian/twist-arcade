import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";

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
    <html lang="en">
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

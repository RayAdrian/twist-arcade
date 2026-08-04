import type { Config } from "tailwindcss";

// Design tokens (plan §9.1, "ink on paper, arcade tempo"): the literal color/opacity/timing
// VALUES live in packages/shell/src/tokens.css (CSS custom properties, theme-switched via the
// `.dark` class on <html> — see app/layout.tsx's theme bootstrap script) and are mirrored,
// byte-for-byte, in packages/shell/src/design-tokens.ts (the TS source of truth used by
// contrast tests). This file only maps SEMANTIC Tailwind names onto those CSS variables —
// it must never hardcode a color value itself.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./games/**/*.{ts,tsx}",
    "./packages/shell/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "accent-p1": "var(--accent-p1)",
        "accent-p2": "var(--accent-p2)",
        "focus-ring": "var(--focus-ring)",
        // UI direction §1.3 (Move 5) — chrome-only paper tiers + the one marker tint. Never
        // used for board state; decorative backgrounds only (text on them stays `text-ink`).
        "paper-lift": "var(--paper-lift)",
        "paper-shade": "var(--paper-shade)",
        marker: "var(--marker)",
      },
      opacity: {
        "age-1": "var(--age-1)",
        "age-2": "var(--age-2)",
      },
      // Print-shop stroke scale (Move 4) — replaces ad hoc `border`/`border-2` with named
      // weights that carry the visual hierarchy of every screen. `border-hairline` /
      // `border-ui` / `border-brush`.
      borderWidth: {
        hairline: "var(--stroke-hairline)",
        ui: "var(--stroke-ui)",
        brush: "var(--stroke-brush)",
      },
      // Hard offset "print" shadows (Move 2) — NEVER blurred. Named by offset distance so a
      // caller picks the depth, not a blur radius: `shadow-print-1` (press state) through
      // `shadow-print-5` (card hover lift). Color always comes from `--shadow-print` (which is
      // itself theme-switched in tokens.css — a translucent pale rgba() in dark, so it reads as
      // misregistration rather than glow).
      boxShadow: {
        "print-1": "1px 1px 0 var(--shadow-print)",
        "print-2": "2px 2px 0 var(--shadow-print)",
        "print-3": "3px 3px 0 var(--shadow-print)",
        "print-4": "4px 4px 0 var(--shadow-print)",
        "print-5": "5px 5px 0 var(--shadow-print)",
      },
      transitionDuration: {
        place: "var(--dur-place)",
        age: "var(--dur-age)",
        moved: "var(--dur-moved)",
        win: "var(--dur-win)",
        vanish: "var(--dur-vanish)",
        "final-pulse": "var(--dur-final-pulse)",
        // Chrome-tier (§1.3 extension): result-slip/bottom-sheet enter duration.
        sheet: "var(--dur-sheet)",
      },
      transitionTimingFunction: {
        arcade: "var(--ease)",
        // Overshoot-settle easing for chrome "pop" moments (result stamp, sheet enter).
        pop: "var(--ease-pop)",
      },
      // Move 1 — next/font wires each face's CSS variable via className in app/layout.tsx;
      // this only maps the SEMANTIC Tailwind name onto that variable (never a literal font
      // name), matching the same "tokens.css owns literals, this file owns names" rule the
      // color/timing tokens above already follow. System-font fallback stacks keep the app
      // usable even if next/font ever fails to inject its variable.
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

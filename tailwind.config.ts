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
      },
      opacity: {
        "age-1": "var(--age-1)",
        "age-2": "var(--age-2)",
      },
      transitionDuration: {
        place: "var(--dur-place)",
        age: "var(--dur-age)",
        moved: "var(--dur-moved)",
        win: "var(--dur-win)",
        vanish: "var(--dur-vanish)",
        "final-pulse": "var(--dur-final-pulse)",
      },
      transitionTimingFunction: {
        arcade: "var(--ease)",
      },
    },
  },
  plugins: [],
};

export default config;

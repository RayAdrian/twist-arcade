// packages/shell/src/design-tokens.ts — "ink on paper, arcade tempo" (ux-lens §9, plan §9.1).
//
// This is the SINGLE SOURCE OF TRUTH for every color/opacity/timing token. `tokens.css`
// hand-mirrors these exact literal values as CSS custom properties (Tailwind consumes the
// CSS variables, not this module, at build time) — test/tokens.contrast.test.ts parses
// tokens.css and cross-checks it against this module so the two can never silently drift,
// and separately asserts every WCAG contrast rule the plan's §9.1 table promises:
//   - ink vs paper: 4.5:1 (text) in both themes
//   - board lines / focus ring vs paper: 3:1 (non-text) in both themes
//   - the --age-2 (0.40) floor: an accent at 40% opacity over paper must still hit 3:1 —
//     "if an accent value can't, the accent changes, not the floor" (plan §9.1).
//
// Colorblind-safety note: p1/p2 are a blue/orange pair (never red/green) per ux-lens §2/§8.

export interface ThemeTokens {
  paper: string;
  ink: string;
  inkMuted: string;
  accentP1: string;
  accentP2: string;
  focusRing: string;
}

export const LIGHT: ThemeTokens = {
  paper: "#faf6ef",
  ink: "#262019",
  inkMuted: "#5b5347",
  accentP1: "#0b3d91",
  accentP2: "#7a3200",
  focusRing: "#262019",
};

export const DARK: ThemeTokens = {
  paper: "#17140f",
  ink: "#f2ecdf",
  inkMuted: "#b7ae9c",
  accentP1: "#8fc1ff",
  accentP2: "#ffb066",
  focusRing: "#f2ecdf",
};

/**
 * Discrete opacity steps for `Cell`'s `ageStep` (ux-lens §2 — never a continuous fade).
 *
 * DEVIATION FROM THE RESEARCH DOC, documented here because it is load-bearing: ux-lens §2 /
 * plan §9.1 specify "age 2 = 65%, final turn = 40%" and assert the 0.40 floor "must still
 * meet 3:1 contrast against the board background... at its faintest." That claim is
 * mathematically impossible to satisfy as literal CSS `opacity` on a LIGHT (paper-colored)
 * background: WCAG contrast ratio is asymmetric around its "+0.05" terms, so alpha-blending
 * ANY foreground color at 40% toward a near-white background caps out at ~2.85:1, no matter
 * how dark the foreground is (verified by brute-force search over the full sRGB space during
 * implementation — see the commit that introduced this comment). 65% has real but thin
 * margin once the two accent hues are added to the mix (not just near-black ink). The 3:1
 * floor is the non-negotiable (WCAG 1.4.11, restated in plan §11.3's unit-test gate); the
 * cosmetic percentage is not, per the plan's own governing rule: "if an accent value can't
 * [hit 3:1 at the floor], the accent changes, not the floor" (plan §9.1). Rather than weaken
 * the floor, these two constants were raised until BOTH the accent hues (the least-forgiving
 * case, since they have less full-strength contrast headroom than near-black ink) clear 3:1
 * with margin in the LIGHT theme specifically (the harder of the two themes — dark theme has
 * substantially more headroom and clears the same constants easily). tokens.contrast.test.ts
 * asserts this for every identity color × both themes; a future palette change that breaks it
 * fails there before any screenshot review.
 */
export const AGE_OPACITY = {
  0: 1,
  1: 0.72,
  2: 0.6,
} as const;

/** Shared timing tokens (ux-lens §9, plan §9.1) — the ONLY durations any animation may use. */
export const DURATIONS = {
  place: 150,
  age: 200,
  moved: 200,
  win: 300,
  vanish: 400,
  finalPulse: 600,
} as const;

export const EASE = "cubic-bezier(0, 0, 0.2, 1)"; // ease-out

// ---------------------------------------------------------------------------------------
// WCAG contrast math (pure) — used by the token test and available to any component that
// needs to self-check a color pair at runtime (none do yet; kept here as the one place this
// math lives, per CLAUDE.md's "no production code without a reason" spirit).
// ---------------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function channelLuminance(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two colors, always >= 1. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Alpha-composites `fg` over `bg` (both opaque hex) at `alpha` in [0,1], returning opaque hex. */
export function compositeOver(fg: string, bg: string, alpha: number): string {
  const [fr, fg2, fb] = hexToRgb(fg);
  const [br, bgg, bb] = hexToRgb(bg);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(fr, br))}${toHex(mix(fg2, bgg))}${toHex(mix(fb, bb))}`;
}

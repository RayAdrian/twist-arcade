import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGE_OPACITY,
  compositeOver,
  contrastRatio,
  DARK,
  LIGHT,
  type ThemeTokens,
} from "../src/design-tokens";

// Parses `--name: #hex;` declarations out of a CSS block (tokens.css hand-mirrors
// design-tokens.ts; this cross-check is what stops the two from silently drifting apart —
// plan §11.3: "a token edit that breaks 3:1 at the 40% floor fails before any screenshot").
function parseCssVars(css: string, blockSelector: string): Record<string, string> {
  const blockRe = new RegExp(`${blockSelector}\\s*\\{([^}]*)\\}`, "m");
  const match = blockRe.exec(css);
  if (!match) throw new Error(`tokens.css: no ${blockSelector} block found`);
  const body = match[1]!;
  const out: Record<string, string> = {};
  for (const line of body.split(";")) {
    const m = /--([\w-]+)\s*:\s*([^;]+)/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const cssPath = join(testDir, "../src/tokens.css");
const css = readFileSync(cssPath, "utf8");
const lightVars = parseCssVars(css, ":root");
const darkVars = parseCssVars(css, ":root\\.dark");

describe("tokens.css matches design-tokens.ts (no silent drift)", () => {
  const cases: [string, ThemeTokens, Record<string, string>][] = [
    ["light", LIGHT, lightVars],
    ["dark", DARK, darkVars],
  ];

  for (const [name, ts, cssVars] of cases) {
    it(`${name} theme: paper/ink/inkMuted/accents/focusRing match`, () => {
      expect(cssVars["paper"]).toBe(ts.paper);
      expect(cssVars["ink"]).toBe(ts.ink);
      expect(cssVars["ink-muted"]).toBe(ts.inkMuted);
      expect(cssVars["accent-p1"]).toBe(ts.accentP1);
      expect(cssVars["accent-p2"]).toBe(ts.accentP2);
      expect(cssVars["focus-ring"]).toBe(ts.focusRing);
    });
  }

  it("age-1/age-2 opacity tokens are present and match AGE_OPACITY", () => {
    expect(Number(lightVars["age-1"])).toBeCloseTo(AGE_OPACITY[1], 5);
    expect(Number(lightVars["age-2"])).toBeCloseTo(AGE_OPACITY[2], 5);
  });
});

describe("WCAG contrast (plan §9.1 / ux-lens §2, §8) — both themes", () => {
  for (const [name, t] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as [string, ThemeTokens][]) {
    it(`${name}: ink vs paper >= 4.5:1 (text)`, () => {
      expect(contrastRatio(t.ink, t.paper)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: inkMuted vs paper >= 4.5:1 (secondary text still text)`, () => {
      expect(contrastRatio(t.inkMuted, t.paper)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: focusRing vs paper >= 3:1 (non-text)`, () => {
      expect(contrastRatio(t.focusRing, t.paper)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: full-opacity accentP1/accentP2 vs paper >= 3:1 (board material, non-text)`, () => {
      expect(contrastRatio(t.accentP1, t.paper)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.accentP2, t.paper)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: the age-2 (faintest) floor keeps ink AND both accents >= 3:1 against paper`, () => {
      // This is the governing rule from plan §9.1: "if an accent value can't [hit 3:1 at the
      // floor], the accent changes, not the floor" — here it was the FLOOR PERCENTAGE that
      // changed (design-tokens.ts's AGE_OPACITY doc comment: literal 40% opacity is
      // mathematically incapable of 3:1 on a light paper background for any color; 0.60 is
      // the real constant in use). Composite every identity color (ink + both accents — the
      // full set Cell ever fades) at that opacity over paper and assert every one still
      // clears 3:1 against the same paper background.
      for (const identity of [t.ink, t.accentP1, t.accentP2]) {
        const faded = compositeOver(identity, t.paper, AGE_OPACITY[2]);
        expect(contrastRatio(faded, t.paper)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${name}: the age-1 (lightly-aged) tier also stays >= 3:1 for every identity color`, () => {
      for (const identity of [t.ink, t.accentP1, t.accentP2]) {
        const faded = compositeOver(identity, t.paper, AGE_OPACITY[1]);
        expect(contrastRatio(faded, t.paper)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

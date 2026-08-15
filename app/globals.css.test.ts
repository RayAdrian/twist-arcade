import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARK, LIGHT } from "@twist-arcade/shell/design-tokens";

// C77 (smaller item, taken): app/globals.css's `.divider-squiggle` hand-copies `--ink-muted`'s
// hex value into two SVG data-URIs (light/dark) with no test pinning them — matching
// packages/shell/test/tokens.contrast.test.ts's own established pattern (parse the real CSS
// text, cross-check against design-tokens.ts) so a future ink retune can't silently desync the
// divider's stroke color from the rest of the app the way nothing here previously caught.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "globals.css"), "utf8");

/** Extracts the `stroke='%23RRGGBB'` hex (URL-decoded) from a `.divider-squiggle` rule block. */
function strokeHexFrom(block: string): string {
  const match = /stroke='%23([0-9a-fA-F]{6})'/.exec(block);
  if (!match) throw new Error("could not find a stroke='%23......' value in the given CSS block");
  return `#${match[1]!.toLowerCase()}`;
}

describe("app/globals.css — .divider-squiggle stroke color matches --ink-muted (no silent drift)", () => {
  it("light theme: the un-prefixed .divider-squiggle rule's stroke matches design-tokens.ts's LIGHT.inkMuted", () => {
    // The light rule is the one NOT preceded by `:root.dark ` on the same selector line.
    const lightBlock = /(?<!:root\.dark )\.divider-squiggle\s*\{[^}]*\}/.exec(css);
    expect(lightBlock, "could not find the light .divider-squiggle rule").not.toBeNull();
    expect(strokeHexFrom(lightBlock![0])).toBe(LIGHT.inkMuted);
  });

  it("dark theme: the :root.dark .divider-squiggle override's stroke matches design-tokens.ts's DARK.inkMuted", () => {
    const darkBlock = /:root\.dark \.divider-squiggle\s*\{[^}]*\}/.exec(css);
    expect(darkBlock, "could not find the :root.dark .divider-squiggle rule").not.toBeNull();
    expect(strokeHexFrom(darkBlock![0])).toBe(DARK.inkMuted);
  });
});

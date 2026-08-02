import { afterEach, describe, expect, it, vi } from "vitest";
import { vibrate } from "../src/haptics";

// ux-lens §7: light on own placement, medium on vanish, distinct success pattern on win —
// via navigator.vibrate where available, silently absent elsewhere, mute toggle in settings.

describe("haptics.ts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate with a short pattern for 'light'", () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { vibrate: spy });
    vibrate("light", false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("uses a LONGER/heavier pattern for 'medium' than 'light'", () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { vibrate: spy });
    vibrate("light", false);
    const lightArg = spy.mock.calls[0]![0];
    spy.mockClear();
    vibrate("medium", false);
    const mediumArg = spy.mock.calls[0]![0];
    const total = (x: number | number[]) => (Array.isArray(x) ? x.reduce((a, b) => a + b, 0) : x);
    expect(total(mediumArg)).toBeGreaterThan(total(lightArg));
  });

  it("'success' is a distinct multi-pulse pattern (array, not a single number)", () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { vibrate: spy });
    vibrate("success", false);
    expect(Array.isArray(spy.mock.calls[0]![0])).toBe(true);
  });

  it("does NOT call vibrate when muted", () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { vibrate: spy });
    vibrate("light", true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("silently no-ops when navigator.vibrate is unavailable (no throw)", () => {
    vi.stubGlobal("navigator", {});
    expect(() => vibrate("light", false)).not.toThrow();
  });

  it("silently no-ops if navigator.vibrate itself throws", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("not allowed");
      },
    });
    expect(() => vibrate("light", false)).not.toThrow();
  });
});

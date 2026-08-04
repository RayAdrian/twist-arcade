// packages/shell/test/motion.test.ts — UI direction §5.3, R1 & R2. `animateSafe()` is the ONE
// gate every Motion One call site (board path or chrome) must go through: Motion One's own
// `animate()` does not respect `prefers-reduced-motion` by itself, so an entrance animation
// whose "from" state is only ever set inside an unguarded `animate()` call would leave content
// permanently invisible for a reduced-motion user (or on a JS failure, since R2 forbids
// authoring that initial state in markup at all). Under reduce, animateSafe must apply the
// FINAL keyframe SYNCHRONOUSLY — no WAAPI, no rAF hop — so there is never even a one-frame
// flash of a hidden/initial state.
//
// jsdom does not implement Element.prototype.animate (Motion One's real DOM path ultimately
// rides WAAPI), so the "not reduced" branch is verified by spying on motion/mini's own
// `animate` export via vi.mock — this test cares that animateSafe DELEGATES correctly, not
// that Motion One's internals work (that's motion's own test suite's job).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { animateSafe, prefersReducedMotion } from "../src/motion";

// vi.mock's factory is hoisted above all imports/top-level consts, so the spy it returns must
// be created via vi.hoisted (not a plain top-level const) — referencing one directly here
// would throw "Cannot access before initialization".
const { animateSpy } = vi.hoisted(() => ({
  animateSpy: vi.fn(() => ({
    finished: Promise.resolve(),
    stop: vi.fn(),
  })),
}));

vi.mock("motion/mini", () => ({
  animate: animateSpy,
}));

beforeEach(() => {
  animateSpy.mockClear();
});

describe("animateSafe", () => {
  it("under reduced motion, applies the FINAL value of every keyframe synchronously (no WAAPI call)", () => {
    const el = document.createElement("div");
    animateSafe(el, { opacity: [0, 1], y: [24, 0] }, undefined, true);

    // Synchronous — no await, no timer advance — and motion/mini's real animate must NOT have
    // been invoked at all (this is what makes the reduced path immune to WAAPI/rAF entirely).
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toContain("translateY(0px)");
    expect(animateSpy).not.toHaveBeenCalled();
  });

  it("under reduced motion, a scalar (non-array) keyframe value is applied directly", () => {
    const el = document.createElement("div");
    animateSafe(el, { opacity: 0.6 }, undefined, true);
    expect(el.style.opacity).toBe("0.6");
  });

  it("under reduced motion, returns an already-resolved handle", async () => {
    const el = document.createElement("div");
    const handle = animateSafe(el, { opacity: [0, 1] }, undefined, true);
    await expect(handle.finished).resolves.toBeUndefined();
    expect(() => handle.stop()).not.toThrow();
  });

  it("when NOT reduced, delegates to Motion One's real animate() instead of applying the final frame itself", () => {
    const el = document.createElement("div");
    const opts = { duration: 0.3 };
    animateSafe(el, { opacity: [0, 1] }, opts, false);
    expect(animateSpy).toHaveBeenCalledTimes(1);
    expect(animateSpy).toHaveBeenCalledWith(el, { opacity: [0, 1] }, opts);
    // The real (mocked) path must NOT have pre-set the final style itself — that's animate's
    // job when it actually runs, not animateSafe's.
    expect(el.style.opacity).toBe("");
  });

  it("defaults reducedMotion from prefersReducedMotion() when the 4th argument is omitted", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const el = document.createElement("div");
    animateSafe(el, { opacity: [0, 1] });
    expect(el.style.opacity).toBe("1");
    expect(animateSpy).not.toHaveBeenCalled();

    window.matchMedia = original;
  });
});

describe("prefersReducedMotion", () => {
  it("reads window.matchMedia('(prefers-reduced-motion: reduce)')", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    expect(prefersReducedMotion()).toBe(true);
    window.matchMedia = original;
  });

  it("returns false when matchMedia reports no match", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});

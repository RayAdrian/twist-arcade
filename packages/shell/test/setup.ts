import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

// vitest.config.ts does not enable `test.globals`, so @testing-library/react's own
// auto-cleanup detection (which looks for a global `afterEach`) never fires — without this,
// every RTL render() from a previous test stays mounted, and later tests' `getByText` queries
// start throwing "multiple elements found" once more than one test in a file renders the same
// text. Explicit and unambiguous beats relying on global-detection magic.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia; several components (theme bootstrap, reduced-motion
// prefs) read it. A permissive default (no reduced-motion, no dark) — individual tests
// override via `window.matchMedia = vi.fn(...)` when they need a specific answer.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom does not implement Element.prototype.hasPointerCapture / setPointerCapture, which
// BoardShell's pointerup-commit machinery calls. Stub them so pointer event tests don't
// throw "not a function" — a jsdom limitation, not a real-browser gap.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom has no PointerEvent constructor at all (as of the jsdom version this project pins) —
// BoardShell/Cell's pointerup-commit machinery is built on real PointerEvents, so tests that
// dispatch one need a minimal constructable stand-in. MouseEvent carries clientX/clientY,
// which is all Cell's inside/outside-the-cell geometry check reads.
if (typeof window !== "undefined" && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  // @ts-expect-error — intentional test-environment polyfill, not a full spec implementation.
  window.PointerEvent = PointerEventPolyfill;
}

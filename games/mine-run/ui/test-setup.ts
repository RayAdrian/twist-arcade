// games/mine-run/ui/test-setup.ts — jsdom polyfills for Board.test.tsx's pointer-gesture
// assertions (mirrors packages/shell/test/setup.ts's own documented reasoning). This file is
// registered as a global vitest setupFile, so every guard below is defensive: the default test
// environment for this package stays "node" (engine/csp/probes tests never touch a DOM at all),
// and only ui/**'s jsdom-opted-in files ever have `window`/`Element` to polyfill.

import { afterEach } from "vitest";

// jest-dom's matchers and RTL's cleanup() both assume a DOM exists — this setup file runs for
// EVERY test in the package (engine/csp/probes tests included, which stay in the "node"
// environment and have no `document` at all), so both are loaded/invoked only when a real DOM
// is actually present.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}

// jsdom does not implement Element.prototype.hasPointerCapture / setPointerCapture, which
// BoardShell/Cell's pointerup-commit machinery calls unconditionally — a jsdom limitation, not
// a real-browser gap (see packages/shell/test/setup.ts's identical stub).
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}

// jsdom has no PointerEvent constructor at all (as of the jsdom version this project pins).
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

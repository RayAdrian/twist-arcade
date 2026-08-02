// Module augmentation for vitest's `Assertion` interface, adding the `toHaveNoViolations()`
// matcher registered at runtime via `expect.extend(toHaveNoViolations)` in test/setup.ts.
// Needs `import "vitest"` so this file is MODULE mode — augmenting an EXISTING module's types
// (as opposed to declaring a brand-new one, like jest-axe.d.ts) only merges correctly when
// the containing file is itself a module.

import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
}

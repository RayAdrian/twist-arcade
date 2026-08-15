import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Mirrors packages/shell/test/setup.ts's own reasoning: vitest.config.ts does not enable
// `test.globals`, so @testing-library/react's auto-cleanup never fires on its own.
afterEach(() => {
  cleanup();
});

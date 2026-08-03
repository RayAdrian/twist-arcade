import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Mirrors packages/shell/test/setup.ts's reasoning: test.globals is not enabled, so RTL's
// own afterEach-detection never fires. Explicit cleanup, every file.
afterEach(() => {
  cleanup();
});

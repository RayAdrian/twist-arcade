import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // pglite boots a real (WASM) Postgres per test file; give it more headroom than the
    // default unit-test timeout.
    testTimeout: 30_000,
  },
});

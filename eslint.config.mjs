// Flat ESLint config (ESLint 9+). Purity rules (no Math.random / Date.now) are scoped to
// packages/engine and games/* per CLAUDE.md and the phase-0 plan §2 — engines must be
// pure and deterministic; all randomness flows through the injected Rng.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const purityRules = {
  "no-restricted-globals": [
    "error",
    {
      name: "Date",
      message: "Engines/games must not read wall-clock time directly. Use the injected Rng/Clock.",
    },
  ],
  "no-restricted-properties": [
    "error",
    {
      object: "Math",
      property: "random",
      message: "Engines/games must never call Math.random(). All randomness flows through the injected Rng.",
    },
    {
      object: "Date",
      property: "now",
      message: "Engines/games must never call Date.now(). Determinism requires no wall-clock reads.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.config.*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Purity boundary: the engine package and every game package.
    files: ["packages/engine/**/*.ts", "games/**/*.ts", "games/**/*.tsx"],
    rules: purityRules,
  },
  {
    // Test files may construct deliberately-broken mutants that reference Math.random to
    // prove the lint rule (and the testkit) catch it — but the mutant fixtures themselves
    // still live under packages/engine/testkit and ARE linted; only true unit test files
    // that assert-about the rule (none yet) would be exempted here.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);

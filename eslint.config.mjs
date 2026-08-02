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
    // Purity boundary, bots edition: search algorithms (mcts/minimax/beam/flat-mc/tiers/
    // probes) must be as deterministic as the engines they search — all randomness through
    // the injected Rng, all timing through the injected Clock (plan §6: "bots may not touch
    // Date.now()"). Scoped to src/ only (not test/), and excludes src/worker/** — the worker
    // HOST is the one place that constructs a REAL Clock to hand to policies at runtime, and
    // that construction legitimately reads the wall clock (see the override below).
    files: ["packages/bots/src/**/*.ts"],
    rules: purityRules,
  },
  {
    // The worker host's real Clock implementation (`{ now: () => Date.now() }`) and its
    // deadline-based time-boxing loop are the one sanctioned wall-clock read in this
    // package — everything downstream of it (the policies) still only ever sees the
    // injected Clock, never Date.now() directly.
    files: ["packages/bots/src/worker/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
  {
    // Test files get a relaxed no-explicit-any (vitest/fast-check plumbing sometimes needs it).
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Node-executed one-off scripts (not shipped to the browser/engine/games) need the
    // Node global environment — flat config doesn't infer this the way old .eslintrc
    // `env: { node: true }` did.
    files: ["scripts/**/*.mjs", "scripts/**/*.ts"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  {
    // packages/engine/test/mutants/**: deliberately-broken engines used ONLY by the
    // testkit's own self-tests (test/testkit-self-test.test.ts) to prove engineContract()
    // actually catches planted bugs at RUNTIME — including one mutant whose whole point is
    // to leak Math.random() so the determinism property can catch it. That is a different
    // defense than static lint and must not be blocked by it. These files are never a real
    // game and never ship; the purity lint rule stays enforced everywhere else under
    // packages/engine/** and games/**.
    files: ["packages/engine/test/mutants/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  }
);

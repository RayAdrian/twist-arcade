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

// Board-path heavy-animation boundary (orchestrator directive 2026-08-03, architecture-lens
// §5): "Motion One or plain CSS over Framer Motion for the hot path... avoid inside per-cell
// rendering." ReactBits-sourced polish is welcome in CHROME (ResultModal, GameCard, the library
// home, page/route transitions, empty states) precisely because motion there carries no game
// state — it is NOT welcome on the board, where ux-lens §9's rule ("every animation must
// restate a state change a static encoding already shows") is what makes `prefers-reduced-
// motion` safe. A ReactBits effect that becomes the only carrier of a state change is a bug,
// however good it looks — so this is enforced structurally, not left as a comment: any board-
// path file (BoardShell/Cell/board-context/CalloutLayer/CountdownBadge, effects-map.ts, and
// every game's `games/*/ui/**`) is statically forbidden from importing framer-motion or gsap,
// full stop. Motion One (~4kB) and plain CSS remain the only motion options in those files.
const boardPathAnimationBoundary = {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "framer-motion",
          message:
            "Framer Motion (~30kB) is banned on the board path (architecture-lens §5). It is welcome in chrome " +
            "(ResultModal, GameCard, the library home, transitions) — move this import there, or use Motion One / plain CSS here.",
        },
        {
          name: "gsap",
          message:
            "GSAP is banned on the board path (architecture-lens §5) — many ReactBits components pull it in. It is " +
            "welcome in chrome; move this effect there, or use Motion One / plain CSS on the board.",
        },
      ],
      patterns: [
        {
          group: ["gsap/*"],
          message: "GSAP is banned on the board path (architecture-lens §5). See the framer-motion/gsap restriction above.",
        },
      ],
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
    files: [
      "packages/shell/src/components/BoardShell.tsx",
      "packages/shell/src/components/Cell.tsx",
      "packages/shell/src/components/board-context.tsx",
      "packages/shell/src/components/CalloutLayer.tsx",
      "packages/shell/src/components/CountdownBadge.tsx",
      "packages/shell/src/effects-map.ts",
      "games/**/ui/**/*.tsx",
      "games/**/ui/**/*.ts",
    ],
    rules: boardPathAnimationBoundary,
  },
  {
    // Purity boundary: the engine package and every game package.
    files: ["packages/engine/**/*.ts", "games/**/*.ts", "games/**/*.tsx"],
    rules: purityRules,
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

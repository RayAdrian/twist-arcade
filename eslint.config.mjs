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

// Registry-driven code splitting (plan §3.2.3): "App code may statically import only
// games/registry.ts re-exported manifests... Engines and presentations load exclusively
// through registry[id].loadEngine()/loadPresentation()." Manifests are eager (the catalog
// payload games/registry.ts re-exports); a game's engine, UI, or its package-root `index`
// (which typically re-exports both) must load ONLY through the registry entry's own dynamic
// `import()` — a static import of any of those from `app/**` or `packages/shell/**` would pull
// that game's whole engine+presentation bundle into every route that imports it, defeating the
// "game 40 adds zero bytes to game 1's route" budget entirely.
const registrySplittingBoundary = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["games/*/engine", "games/*/engine/*", "*/games/*/engine", "*/games/*/engine/*"],
          message:
            "A game's engine must load only via registry[id].loadEngine() (plan §3.2) — a static import here defeats per-game code splitting.",
        },
        {
          group: ["games/*/ui", "games/*/ui/*", "*/games/*/ui", "*/games/*/ui/*"],
          message:
            "A game's presentation/UI must load only via registry[id].loadPresentation() (plan §3.2) — a static import here defeats per-game code splitting.",
        },
        {
          // Deliberately NOT a bare "games/*" — that would also match "games/registry" itself,
          // the ONE games/* import app code is required to make (the eager manifest catalog).
          // Only a game's own package-root index (an additional path segment past the game
          // folder) is banned here.
          group: ["games/*/index", "*/games/*/index"],
          message:
            "A game's package root (typically re-exporting engine + presentation together) must never be statically imported outside games/registry.ts — go through the registry's loadEngine()/loadPresentation() instead (plan §3.2).",
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
      // Next-generated, gitignored (.gitignore's own entry) — its triple-slash reference to
      // .next/types/routes.d.ts is Next's own required convention, not something to lint.
      "next-env.d.ts",
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
    files: ["app/**/*.ts", "app/**/*.tsx", "packages/shell/src/**/*.ts", "packages/shell/src/**/*.tsx"],
    rules: registrySplittingBoundary,
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

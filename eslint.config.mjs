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
// every game's `games/*/ui/**`) is statically forbidden from importing framer-motion, gsap, or
// Motion One's React entry (`motion/react` — the "motion" package's react bundle wraps the same
// ~30kB animation engine as framer-motion; only bare `motion`/`motion/mini`, Motion One's
// lightweight vanilla-JS API, is sanctioned here), full stop.
//
// Everything lives under a single `patterns` array (stage-6 review C1, part 3): `paths` only
// matches an EXACT specifier, so it can never express "framer-motion and any of its subpaths"
// — `framer-motion/dom` slipped the old `paths`-based ban entirely. `patterns` (gitignore-style,
// via the `ignore` package) handles both the exact and the wildcard cases uniformly, with a
// per-group custom message preserved for each library.
const boardPathAnimationBoundary = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["framer-motion", "framer-motion/*"],
          message:
            "Framer Motion (~30kB) is banned on the board path (architecture-lens §5). It is welcome in chrome " +
            "(ResultModal, GameCard, the library home, transitions) — move this import there, or use Motion One / plain CSS here.",
        },
        {
          group: ["gsap", "gsap/*"],
          message:
            "GSAP is banned on the board path (architecture-lens §5) — many ReactBits components pull it in. It is " +
            "welcome in chrome; move this effect there, or use Motion One / plain CSS on the board.",
        },
        {
          group: ["motion/react", "motion/react-*"],
          message:
            "motion/react (Motion One's React entry) ships the same ~30kB animation engine as Framer Motion and is " +
            "banned on the board path for the same reason (architecture-lens §5). Bare `motion`/`motion/mini` — " +
            "Motion One's sanctioned lightweight vanilla-JS API — is NOT banned; use that or plain CSS here instead.",
        },
      ],
    },
  ],
};

// Dynamic import() closes two gaps `boardPathAnimationBoundary` above left open (stage-6 F3
// review, C5 scope gaps, probed live):
//   1. `no-restricted-imports`'s `paths`/`patterns` options only ever match a STATIC import
//      specifier (`import ... from "..."` / bare `import "..."`) — a dynamic `import("gsap")`
//      expression is a different AST node entirely (`ImportExpression`, not `ImportDeclaration`)
//      and is invisible to that rule no matter how the patterns are written. `() =>
//      import("gsap")` inside a board-path file lints completely clean today.
//   2. `boardPathAnimationBoundary`'s own `files` glob was `games/**/ui/**` only — a banned
//      library imported from a game file OUTSIDE `ui/**` (e.g. `presentation.ts`, one directory
//      up) also lints clean, even though that code still ships in the same route bundle.
// This `no-restricted-syntax` rule closes gap 1 via an AST selector on `ImportExpression`, keyed
// off the same three banned specifier roots; the `files` glob it's applied to (below, alongside
// a WIDENED `boardPathAnimationBoundary` file list) closes gap 2 by covering every game file,
// not just `ui/**`.
const dynamicImportBoardPathBan = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "ImportExpression[source.value=/^(framer-motion|gsap|motion\\/react)(\\/.*)?$/]",
      message:
        "A dynamic import() of a board-path-banned animation library (framer-motion, gsap, or motion/react) evades " +
        "no-restricted-imports — banned here for the same reason as a static import (architecture-lens §5). Use " +
        "Motion One (bare `motion`/`motion/mini`) or plain CSS instead.",
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
//
// Single-`*` prefixes matched at most ONE leading path segment (stage-6 review C1, part 2) —
// `*/games/*/engine` matched `../games/x/engine` (one level up) but NOT `../../games/x/engine`
// (two levels up), and every real file under `app/play/[gameId]/` imports at three. `**` (via
// the `ignore` package's gitignore-style matching, which — unlike minimatch's default — does
// NOT special-case a leading `.` segment) matches zero OR MORE leading segments, so it covers a
// bare specifier and a relative one at any depth uniformly, while `games/registry` (the one
// games/* import app code IS required to make — the eager manifest catalog) stays unmatched
// since "registry" is never "engine"/"ui"/"index".
const registrySplittingBoundary = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["**/games/*/engine", "**/games/*/engine/**"],
          message:
            "A game's engine must load only via registry[id].loadEngine() (plan §3.2) — a static import here defeats per-game code splitting.",
        },
        {
          group: ["**/games/*/ui", "**/games/*/ui/**"],
          message:
            "A game's presentation/UI must load only via registry[id].loadPresentation() (plan §3.2) — a static import here defeats per-game code splitting.",
        },
        {
          // Deliberately NOT a bare "games/*" — that would also match "games/registry" itself,
          // the ONE games/* import app code is required to make (the eager manifest catalog).
          // Only a game's own package-root index (an additional path segment past the game
          // folder) is banned here.
          group: ["**/games/*/index"],
          message:
            "A game's package root (typically re-exporting engine + presentation together) must never be statically imported outside games/registry.ts — go through the registry's loadEngine()/loadPresentation() instead (plan §3.2).",
        },
      ],
    },
  ],
};

// The six shell board-path files (see boardPathAnimationBoundary's own comment for why these
// specific files) ALSO live under `packages/shell/src/**` and so are matched by
// registrySplittingBoundary below. Flat config's rule-merging is per-key, not additive: when
// two blocks both set the same rule key (`no-restricted-imports`, here) for a file, the LATER
// block's value REPLACES the earlier one entirely — it does not union their option objects
// (stage-6 review C1, part 1: this is exactly how the registry-splitting block silently killed
// the animation ban for every one of these six files, since it was declared after it). The fix
// is to never let two blocks both claim the same rule key for the same file: this list drives a
// third, explicitly-merged block declared after BOTH boardPathAnimationBoundary and
// registrySplittingBoundary below, so it is the one block whose `no-restricted-imports` value
// actually governs these six files, and that value is a union of both option sets.
// Exported (not just module-local) so packages/shell/test/eslint-config.test.ts can assert
// this list against its own independently-hardcoded expectation (stage-6 re-review C1: a self
// -test that only iterates whatever this array currently contains would silently shrink its
// own coverage the moment an entry is dropped from it — the export lets the test catch that
// drift explicitly instead of just testing fewer files).
export const BOARD_PATH_FILES = [
  "packages/shell/src/components/BoardShell.tsx",
  "packages/shell/src/components/Cell.tsx",
  "packages/shell/src/components/board-context.tsx",
  "packages/shell/src/components/CalloutLayer.tsx",
  "packages/shell/src/components/CountdownBadge.tsx",
  "packages/shell/src/effects-map.ts",
];

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
    // WIDENED (stage-6 F3 review, C5 gap 2): every game file, not just `ui/**` — a game's
    // presentation.ts, engine.ts, etc. all ship in the same route bundle as its ui/** files, and
    // `import "framer-motion"` from `presentation.ts` previously lint-passed cleanly because this
    // glob didn't reach it. The six shell board-path files get BOTH boundaries via the
    // explicitly-merged block below (declared after registrySplittingBoundary), not this one,
    // per the BOARD_PATH_FILES comment above (stage-6 review C1, part 1).
    files: ["games/**/*.ts", "games/**/*.tsx"],
    rules: { ...boardPathAnimationBoundary, ...dynamicImportBoardPathBan },
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
    // The merged block (stage-6 review C1, part 1): declared after registrySplittingBoundary
    // above so it is the LAST block matching these six files, making its `no-restricted-imports`
    // value — the union of both boundaries' patterns — the one that actually applies to them.
    files: BOARD_PATH_FILES,
    rules: {
      ...dynamicImportBoardPathBan,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...boardPathAnimationBoundary["no-restricted-imports"][1].patterns,
            ...registrySplittingBoundary["no-restricted-imports"][1].patterns,
          ],
        },
      ],
    },
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

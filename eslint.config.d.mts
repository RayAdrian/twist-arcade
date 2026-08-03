// Companion declaration for eslint.config.mjs (TS's standard convention: resolving a plain
// `.mjs` module also looks for a sibling `.d.mts` of the same base name). eslint.config.mjs
// itself is plain JS deliberately — it's the repo's real flat ESLint config, not something we
// want to route through a build step — but packages/shell/test/eslint-config.test.ts imports its
// exported `BOARD_PATH_FILES` directly (stage-6 re-review C1) to cross-check the self-test's own
// hardcoded expectation against the config's real source of truth, and that import needs a real
// type rather than an implicit `any` under this repo's strict/noImplicitAny config.
export declare const BOARD_PATH_FILES: string[];

// games/mine-run/index.ts — public package surface for @twist-arcade/mine-run.
//
// package.json's main/types/exports all point at this file (matching the same convention
// @twist-arcade/engine and @twist-arcade/game-spec use: `"main": "./src/index.ts"` there,
// `"./index.ts"` here since this package has no src/ subdirectory). Before this file existed,
// `import("@twist-arcade/mine-run")` threw ERR_MODULE_NOT_FOUND (Fable review should-fix 5) —
// nothing consumes the package yet, but registry wiring (`games/registry.ts`) will hit this
// immediately, and the M1 review already flagged the identically-shaped gap (G-13) once.
//
// Re-exports the GameEngine surface (engine.ts), the CSP module (csp.ts), the mandatory
// Always-Safe hook (probes.ts, platform §6/§7.4 — the harness hard-errors without one for a
// solo score chase), and the redaction secretExtractor (secret.ts) so a future registry entry
// or harness script can import everything it needs from this one path.

export {
  createMineRun,
  mineRun,
  MineRunDecodeError,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_MINES,
  DEFAULT_BUDGET,
  neighbors,
  countAdjacentMines,
  floodFrom,
} from "./engine";
export type {
  MineRunState,
  MineRunMove,
  MineRunView,
  MineRunCellView,
  CreateMineRunOptions,
} from "./engine";

export { analyzeFrontier, sampleConsistentState, frontierFallbackUsed, frontierComponentCount } from "./csp";
export type { FrontierAnalysis } from "./csp";

export { createMineRunHeuristic } from "./heuristic";

export { safeMove, chooseSafeMove, assertRevealBudgetScarcity, RevealBudgetNotScarceError } from "./probes";

export { makeMineRunSecretExtractor, mineSecretToken, MINES_FIELD_TOKEN } from "./secret";

import { defineWorkspace } from "vitest/config";

// One runner across all packages + games (plan §2). Each package/game is discovered by its
// own vitest config (or falls back to this root's defaults) via glob. Trailing slashes
// restrict the glob to directories only — games/registry.ts is a bare file (not yet a
// per-game package, since no games exist before M2+) and must not be picked up as if it
// were itself a vitest config.
export default defineWorkspace([
  "packages/*/",
  "games/*/",
  "scripts/",
]);

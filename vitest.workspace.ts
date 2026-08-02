import { defineWorkspace } from "vitest/config";

// One runner across all packages + games (plan §2). Each package/game is discovered by its
// own vitest config (or falls back to this root's defaults) via glob.
export default defineWorkspace([
  "packages/*",
  "games/*",
]);

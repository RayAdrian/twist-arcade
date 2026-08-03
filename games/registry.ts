// games/registry.ts — id -> RegistryEntry map (plan §2, §5.4). Empty until the first game
// (M2+/game teams) lands; `pnpm new-game <id>` inserts new entries at the marker below.
//
// Manifests are eager (the catalog payload); engine/presentation/solver load via dynamic
// import() so a game's code only ships to routes that actually play it — enforced on the
// app side by lint: eslint.config.mjs's registrySplittingBoundary rule statically bans
// games/*/engine, games/*/ui, and a game's own package-root index from app/** and
// packages/shell/** (shell team, S1).

import type { Registry } from "@twist-arcade/game-spec";

export const registry: Registry = {
  // <new-game:insert>
};

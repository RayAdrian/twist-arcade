// games/registry.ts — id -> RegistryEntry map (plan §2, §5.4). `pnpm new-game <id>` inserts
// new entries at the marker below.
//
// Manifests are eager (the catalog payload); engine/presentation/solver load via dynamic
// import() so a game's code only ships to routes that actually play it — enforced on the
// app side by lint: eslint.config.mjs's registrySplittingBoundary rule statically bans
// games/*/engine, games/*/ui, and a game's own package-root index from app/** and
// packages/shell/** (shell team, S1). This file itself is exempt from that rule (it isn't
// under app/** or packages/shell/src/**) but still uses dynamic import() below on purpose —
// that's the actual mechanism the boundary exists to protect, not just a lint dodge.

import type { Registry } from "@twist-arcade/game-spec";
import { FADEOUT_RULESET_CONFIG, fadeoutManifest } from "./fadeout/manifest";
import { manifest as crackstepManifest } from "./crackstep/manifest";

export const registry: Registry = {
  "crackstep": {
    manifest: crackstepManifest,
    loadEngine: () => import("@twist-arcade/crackstep").then((m) => m.crackstep),
    loadPresentation: () => import("@twist-arcade/crackstep").then((m) => m.presentation),
    // A SEPARATE subpath import (`@twist-arcade/crackstep/solver`, package.json's own "./solver"
    // export -> solver.ts directly) — not `@twist-arcade/crackstep` above. The package root
    // (index.ts) does NOT re-export the solver specifically so `loadEngine`/`loadPresentation`
    // above never drag @twist-arcade/harness into a route that only plays the game; importing
    // the solver via the SAME module as loadEngine/loadPresentation would defeat that (ES
    // modules evaluate a module's whole dependency graph regardless of which export is used).
    loadSolver: () => import("@twist-arcade/crackstep/solver").then((m) => m.solver),
  },
  // <new-game:insert>
  fadeout: {
    manifest: fadeoutManifest,
    loadEngine: () => import("./fadeout/engine").then((m) => m.createFadeoutEngine(FADEOUT_RULESET_CONFIG)),
    loadPresentation: () => import("./fadeout/presentation").then((m) => m.fadeoutPresentation),
  },
};

// packages/game-spec/src/registry.ts — RegistryEntry / Registry (plan §5.4). Manifests are
// eager (the catalog payload); engine/presentation/solver load via dynamic import() so a
// game's code only ships to routes that actually play it.

import type { GameEngine } from "@twist-arcade/engine";
import type { GameManifest } from "./manifest";
import type { GamePresentation } from "./presentation";
import type { SoloSolver } from "./solver";

// The registry is the one deliberate type-erasure boundary in the whole spec (plan §5.4):
// each game closes over its own concrete S/M/V, and the registry exists precisely so
// callers don't need to know them statically. Hence `any` on all three load* methods below.
export interface RegistryEntry {
  manifest: GameManifest; // EAGER — catalog payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadEngine(): Promise<GameEngine<any, any, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadPresentation(): Promise<GamePresentation<any, any, any>>;
  // puzzle games — harness certify only, NEVER imported by app routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadSolver?(): Promise<SoloSolver<any, any>>;
}

export type Registry = Record<string, RegistryEntry>;

/**
 * Thin identity helper so a game's index.ts can build its RegistryEntry with inference
 * intact (`defineGame({ manifest, loadEngine, loadPresentation })`) rather than annotating
 * the object literal by hand against the `any`-erased RegistryEntry shape.
 */
export function defineGame(entry: RegistryEntry): RegistryEntry {
  return entry;
}

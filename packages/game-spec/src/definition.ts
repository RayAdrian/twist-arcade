// packages/game-spec/src/definition.ts — GameDefinition (plan §5.1): the manifest + engine
// + presentation seam. Platform owns the type; each game implements it.

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { GameManifest } from "./manifest";
import type { GamePresentation } from "./presentation";

export interface GameDefinition<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects = S,
> {
  manifest: GameManifest;
  engine: GameEngine<S, M, V>;
  presentation: GamePresentation<S, M, V>;
}

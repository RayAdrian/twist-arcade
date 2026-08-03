// packages/shell/src/cell-id.ts — the cellId <-> move convention (see test/cell-id.test.ts for
// the full rationale). `BoardShell.onCellAction(cellId: string)` is the only signal a Cell
// commit produces; there is no generic way to recover a game's move type `M` from a bare
// string, and `GamePresentation` deliberately declares no per-game translation hook for it.
// This fixes ONE convention instead: a Board's Cell `id` prop IS `moveToCellId(move)` for the
// move that activating it makes. `GameShell` parses it back via `JSON.parse` to call
// `submitMove`. Uses the engine's own `stableStringify` (not bare `JSON.stringify`) so two
// deep-equal moves built with different key insertion order still produce the identical cellId
// — the same canonical-encoding reasoning `encode()` already relies on (plan §3.2).

import type { Json } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export function moveToCellId(move: Json): string {
  return stableStringify(move);
}

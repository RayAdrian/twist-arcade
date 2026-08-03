import { describe, expect, it } from "vitest";
import { moveToCellId } from "../src/cell-id";

// The cellId <-> move convention this plan leaves open for "Sonnet finalizes exact types
// against game-spec at implementation time" (§4's preamble): `BoardShell.onCellAction` only
// ever receives the STRING cellId a `Cell` was registered under (plan §4.4) — it has no
// generic way to recover a game's move type `M`. Rather than inventing a per-game translation
// hook (which game-spec's `GamePresentation` does not declare), the shell fixes ONE convention
// every game's Board must follow: a Cell's `id` IS `moveToCellId(move)` for the move that
// activating it makes. `GameShell` parses it straight back via `JSON.parse` to call
// `submitMove`. This is fully generic over any `Json`-shaped move — no per-game special-casing
// needed in the shell.

describe("moveToCellId", () => {
  it("is the move's stable JSON encoding", () => {
    expect(moveToCellId({ cell: 4 })).toBe(JSON.stringify({ cell: 4 }));
  });

  it("produces the same cellId for deep-equal moves regardless of key order", () => {
    expect(moveToCellId({ a: 1, b: 2 })).toBe(moveToCellId({ b: 2, a: 1 }));
  });

  it("round-trips through JSON.parse back to an equivalent move", () => {
    const move = { to: 5, extra: "x" };
    expect(JSON.parse(moveToCellId(move))).toEqual(move);
  });
});

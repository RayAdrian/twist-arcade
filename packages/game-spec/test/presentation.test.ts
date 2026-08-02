// packages/game-spec/test/presentation.test.ts
//
// M1 review finding 5: GameEvent's four-variant union (moved | imminent | boardSummary |
// status) is a blessed mid-build deviation (orchestrator-ordered, not undeclared) and stands
// as-is. While the shape is still pre-freeze, this fold in the pending correction from
// platform-corrections.md: firstOccurrence becomes an ARRAY of entries, each with its own
// once-per-device flag key — games have more than one teachable "first" (e.g. the first
// crumble AND the first near-miss decay warning are both worth a one-time callout), and a
// single firstOccurrence slot could only ever key one of them. This is primarily a
// compile-time contract; the assertions below exist so a regression (reverting to a single
// object) fails `pnpm typecheck`, not just this test file.

import { describe, expect, it } from "vitest";
import type { Json, WithEffects } from "@twist-arcade/engine";
import type { GamePresentation } from "../src/presentation";

interface DummyState extends WithEffects {
  readonly x: number;
}
interface DummyMove {
  readonly m: number;
  readonly [key: string]: Json;
}

describe("GamePresentation.firstOccurrence (M1 review finding 5 — corrections.md)", () => {
  it("accepts an array of independently-keyed entries, each with its own flagKey", () => {
    const firstOccurrence: NonNullable<
      GamePresentation<DummyState, DummyMove, DummyState>["firstOccurrence"]
    > = [
      {
        flagKey: "first-crumble",
        trigger: (ev) => ev.kind === "moved",
        text: "The floor crumbles behind you!",
        anchor: (ev) => (ev.kind === "moved" ? ev.player : null),
      },
      {
        flagKey: "first-decay-warning",
        trigger: (ev) => ev.kind === "imminent",
        text: "This tile is about to decay — move now.",
        anchor: () => null,
      },
    ];

    expect(firstOccurrence).toHaveLength(2);
    expect(new Set(firstOccurrence.map((f) => f.flagKey)).size).toBe(2);
  });

  it("a single (non-array) firstOccurrence object is REJECTED at compile time", () => {
    const singleEntry = {
      flagKey: "only-one",
      trigger: () => true,
      text: "nope",
      anchor: () => null,
    };
    // @ts-expect-error — firstOccurrence must be an array of entries now, not a bare single
    // entry object (the pre-correction shape).
    const bad: GamePresentation<DummyState, DummyMove, DummyState>["firstOccurrence"] = singleEntry;
    expect(bad).toBeTruthy();
  });
});

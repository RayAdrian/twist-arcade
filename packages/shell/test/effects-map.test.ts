import { describe, expect, it } from "vitest";
import type { Effect } from "@twist-arcade/engine";
import { finalPulseAnimation, mapEffects } from "../src/effects-map";
import { DURATIONS } from "../src/design-tokens";

// Every vocabulary row of plan §9.3's table -> expected animation record. The governing
// rule (enforced by the table's last column, restated here as the reduced-motion behavior):
// every animation restates a state change a static encoding already shows, so reduced-motion
// must lose zero information — it only removes the TRANSITION, never the resulting state.

const on = { reducedMotion: false };
const off = { reducedMotion: true };

describe("mapEffects — the engine-vocabulary rows", () => {
  it("placed -> place, 150ms, ease-out; instant appear under reduced motion", () => {
    const effects: Effect[] = [{ type: "placed", cell: 4, player: 0 }];
    const [anim] = mapEffects(effects, on);
    expect(anim).toMatchObject({ kind: "place", durationMs: DURATIONS.place, instant: false });
    const [reduced] = mapEffects(effects, off);
    expect(reduced).toMatchObject({ kind: "place", instant: true, durationMs: 0 });
  });

  it("removed and captured both -> vanish, 400ms", () => {
    for (const type of ["removed", "captured"]) {
      const [anim] = mapEffects([{ type, cell: 1 }], on);
      expect(anim).toMatchObject({ kind: "vanish", durationMs: DURATIONS.vanish, instant: false });
    }
  });

  it("decayed and crumbled both -> vanish-ghost, 400ms (ghost outline persists statically)", () => {
    for (const type of ["decayed", "crumbled"]) {
      const [anim] = mapEffects([{ type, cell: 2 }], on);
      expect(anim).toMatchObject({ kind: "vanish-ghost", durationMs: DURATIONS.vanish, instant: false });
    }
  });

  it("moved -> moved (FLIP), 200ms", () => {
    const [anim] = mapEffects([{ type: "moved", from: 0, to: 3 }], on);
    expect(anim).toMatchObject({ kind: "moved", durationMs: DURATIONS.moved, instant: false });
  });

  it("revealed -> revealed, 200ms", () => {
    const [anim] = mapEffects([{ type: "revealed", cell: 5 }], on);
    expect(anim).toMatchObject({ kind: "revealed", instant: false });
  });

  it("rotated -> rotated, 400ms (board rotation + re-fall)", () => {
    const [anim] = mapEffects([{ type: "rotated", degrees: 90 }], on);
    expect(anim).toMatchObject({ kind: "rotated", durationMs: DURATIONS.vanish, instant: false });
  });

  it("banked -> banked (HUD count-up + pulse), 200ms", () => {
    const [anim] = mapEffects([{ type: "banked", amount: 5 }], on);
    expect(anim).toMatchObject({ kind: "banked", instant: false });
  });

  it("an unknown effect type is ignored gracefully — kind 'none', zero duration, instant", () => {
    const [anim] = mapEffects([{ type: "some-future-game-specific-thing", foo: 1 }], on);
    expect(anim).toMatchObject({ kind: "none", durationMs: 0, instant: true });
  });

  it("maps a mixed batch of effects in order, preserving the source effect on each record", () => {
    const effects: Effect[] = [
      { type: "placed", cell: 0 },
      { type: "decayed", cell: 1 },
    ];
    const result = mapEffects(effects, on);
    expect(result).toHaveLength(2);
    expect(result[0]!.effect).toEqual(effects[0]);
    expect(result[1]!.effect).toEqual(effects[1]);
    expect(result[0]!.kind).toBe("place");
    expect(result[1]!.kind).toBe("vanish-ghost");
  });

  it("an empty effects array maps to an empty animation list", () => {
    expect(mapEffects([], on)).toEqual([]);
  });

  it("EVERY kind becomes instant under reduced motion, with zero duration (no information lost, only the transition)", () => {
    const allTypes = ["placed", "removed", "captured", "decayed", "crumbled", "moved", "revealed", "rotated", "banked"];
    const effects: Effect[] = allTypes.map((type) => ({ type }));
    for (const anim of mapEffects(effects, off)) {
      expect(anim.instant).toBe(true);
      expect(anim.durationMs).toBe(0);
    }
  });
});

describe("finalPulseAnimation — the one-time final-turn pulse (dropped under reduced motion)", () => {
  it("returns a 600ms single pulse when motion is allowed", () => {
    expect(finalPulseAnimation(on)).toEqual({ show: true, durationMs: DURATIONS.finalPulse });
  });

  it("is DROPPED entirely under reduced motion (not instant — simply absent)", () => {
    expect(finalPulseAnimation(off)).toEqual({ show: false, durationMs: 0 });
  });
});

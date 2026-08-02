// packages/engine/test/wire-006-fog-setup-rng.test.ts
//
// Companion to wire-006-golden-trajectory.test.ts. That test pins bank-run's trajectory, but
// bank-run's setup() does not consume its rng argument at all — so it cannot, by itself,
// catch a regression to replay.ts's setup-rng wiring (finding 1's exact failure class).
// Proven empirically while writing this test: temporarily reverting replay.ts's
// `rngForSetup(record.seed)` back to the pre-fix `rngFromSeed(record.seed)` left
// wire-006-golden-trajectory.test.ts (and every rng.test.ts/replay.test.ts case) GREEN,
// because none of those exercise a fixture whose setup() actually draws randomness. The fog
// toy engine (test/mutants/mutants.ts) does — its setup() derives `secret` from
// `rng.int(1000) + 1` — so replaying it end-to-end through replay() pins the value setup()
// ACTUALLY received, which is exactly the composite (replay.ts-wiring + rng.ts-formula)
// property finding 1 is about. This is what would have caught the regression the other two
// suites missed.

import { describe, expect, it } from "vitest";
import { fogFixtureCorrect } from "./mutants/mutants";
import { replay, type ReplayRecord } from "../src/replay";
import { rngForSetup, rngFromSeed } from "../src/rng";

const SEED = "wire-golden-fog-setup-1";

function buildRecord(): ReplayRecord {
  return {
    gameId: fogFixtureCorrect.meta.id,
    gameVersion: fogFixtureCorrect.meta.version,
    engineVersion: "wire-golden-test",
    numPlayers: 1,
    seed: SEED,
    steps: [],
  };
}

describe("WIRE-006 companion: replay() actually wires setup() through rngForSetup, end-to-end", () => {
  it("pins the exact secret replay() produces for a fixed seed (captured against the fixed wiring)", () => {
    const result = replay(fogFixtureCorrect, buildRecord());
    expect(result.states[0]!.secret).toBe(926);
  });

  it("that pinned value matches rngForSetup(seed) directly, NOT the raw rngFromSeed(seed) collision value", () => {
    const result = replay(fogFixtureCorrect, buildRecord());
    const viaRngForSetup = rngForSetup(SEED).int(1000) + 1;
    const viaBareRngFromSeed = rngFromSeed(SEED).int(1000) + 1;

    // The two candidate streams give genuinely different values for this seed — this is
    // exactly what makes the assertion below load-bearing rather than coincidentally true.
    expect(viaRngForSetup).not.toBe(viaBareRngFromSeed);

    expect(result.states[0]!.secret).toBe(viaRngForSetup);
    expect(result.states[0]!.secret).not.toBe(viaBareRngFromSeed);
  });
});

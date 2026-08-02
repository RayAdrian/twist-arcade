import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rngFor, rngForSetup, rngFromSeed } from "../src/rng";

// These vectors are a WIRE FORMAT (plan §3.4): mulberry32 stream + splitmix32 seed mixer +
// xmur3 string fold. rngFor(matchSeed, k) = mulberry32(splitmix32(xmur3(matchSeed) + k)).
// Changing any constant orphans every stored replay/certificate — changing them requires an
// ADR. These numbers were generated from the reference implementation and are pinned here.
describe("rng golden vectors", () => {
  it("rngFromSeed(42) — numeric seed", () => {
    const rng = rngFromSeed(42);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.4777817411813885, 0.6772579706739634, 0.5981040478218347, 0.31909019127488136,
      0.5291802159044892, 0.038418033393099904, 0.07244535814970732, 0.4070106332655996,
    ]);
  });

  it("rngFromSeed(0) — numeric seed", () => {
    const rng = rngFromSeed(0);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.6789431222714484, 0.12178174802102149, 0.2769031315110624, 0.7198278896976262,
      0.7572606818284839, 0.5427712108939886, 0.9004051419906318, 0.4359387890435755,
    ]);
  });

  it('rngFromSeed("hello") — string seed folded via xmur3', () => {
    const rng = rngFromSeed("hello");
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.3859497597441077, 0.1418893588706851, 0.880783976521343, 0.9827543036080897,
      0.6576914025936276, 0.18470118381083012, 0.3740465072914958, 0.07091489084996283,
    ]);
  });

  it('rngFor("match-1", 0)', () => {
    const rng = rngFor("match-1", 0);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.18584083556197584, 0.06231559859588742, 0.08475450798869133, 0.42965984903275967,
      0.993779995245859, 0.02326334430836141, 0.8893694914877415, 0.8483380060642958,
    ]);
  });

  it('rngFor("match-1", 1)', () => {
    const rng = rngFor("match-1", 1);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.4079648640472442, 0.21278723399154842, 0.8363592606037855, 0.236421684268862,
      0.419615525752306, 0.8311970073264092, 0.33366613229736686, 0.5308634436223656,
    ]);
  });

  it('rngFor("match-1", 5)', () => {
    const rng = rngFor("match-1", 5);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual([
      0.7739135164301842, 0.13389218668453395, 0.9458856794517487, 0.7384108011610806,
      0.5736612903419882, 0.1778276590630412, 0.9922002370003611, 0.4263912462629378,
    ]);
  });
});

describe("rngFor per-step independence", () => {
  it("replaying steps 0..k consumes an identical stream regardless of draws in earlier steps", () => {
    // Step k's stream must not depend on how many numbers step k-1 drew — that's the whole
    // point of per-step forking. Draw a variable number of values from step 0, then confirm
    // step 1's first value is unaffected.
    for (let drawsAtStep0 = 0; drawsAtStep0 < 5; drawsAtStep0++) {
      const step0 = rngFor("independence-seed", 0);
      for (let i = 0; i < drawsAtStep0; i++) step0.next();

      const step1 = rngFor("independence-seed", 1);
      const first = step1.next();

      // Re-derive step 1 fresh, independent of step 0 entirely.
      const step1Fresh = rngFor("independence-seed", 1);
      expect(first).toBe(step1Fresh.next());
    }
  });

  it("different steps of the same match seed produce different streams", () => {
    const a = rngFor("seed-x", 0).next();
    const b = rngFor("seed-x", 1).next();
    expect(a).not.toBe(b);
  });

  it("different match seeds at the same step produce different streams", () => {
    const a = rngFor("seed-x", 3).next();
    const b = rngFor("seed-y", 3).next();
    expect(a).not.toBe(b);
  });
});

describe("Rng.int and Rng.shuffle", () => {
  it("int(maxExclusive) is always in [0, maxExclusive)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 2, max: 50 }), (seed, max) => {
        const rng = rngFromSeed(seed);
        for (let i = 0; i < 50; i++) {
          const v = rng.int(max);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(max);
        }
      })
    );
  });

  it("shuffle returns a permutation (same multiset, possibly reordered) and does not mutate input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.array(fc.integer(), { minLength: 0, maxLength: 20 }), (seed, xs) => {
        const rng = rngFromSeed(seed);
        const frozenInput = Object.freeze([...xs]);
        const shuffled = rng.shuffle(frozenInput);
        expect(shuffled).not.toBe(frozenInput);
        expect([...shuffled].sort()).toEqual([...frozenInput].sort());
        // Input must be untouched.
        expect(frozenInput).toEqual(xs);
      })
    );
  });

  it("next() is always within [0, 1)", () => {
    const rng = rngFromSeed("bounds-check");
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// M1 review finding 1 (MUST FIX): rngFromSeed(seed) and rngFor(seed, 0) are algebraically
// IDENTICAL by the pinned formula (rngFor(s,0) = mulberry32(splitmix32(xmur3(s)+0)), which is
// exactly what rngFromSeed(s) computes for a string seed). Before this fix, replay.ts and the
// testkit fed setup() directly from rngFromSeed(record.seed) — byte-identical to step 0's
// stream. Any game that draws randomness in both setup() and its first apply() (e.g. a fog
// game deriving a secret in setup, then drawing a PUBLIC chance event in step 0) would leak
// the setup-time secret through a public, replay-visible draw. rngForSetup domain-separates
// setup's stream (via a ":setup" seed suffix) WITHOUT touching the pinned rngFor wire format.
describe("rngForSetup domain separation (M1 review finding 1)", () => {
  it("the rng setup() receives must differ from step 0's apply() stream", () => {
    for (const seed of ["plumbing-seed", "hello", "match-1", "wire-golden-1"]) {
      const setupFirst = rngForSetup(seed).next();
      const step0First = rngFor(seed, 0).next();
      expect(setupFirst).not.toBe(step0First);
    }
  });

  it("rngForSetup(seed) also differs from the raw rngFromSeed(seed) stream", () => {
    // rngForSetup must not merely be an alias for rngFromSeed — it must derive a distinct
    // stream (via the ":setup" suffix), not just relabel the colliding one.
    expect(rngForSetup("hello").next()).not.toBe(rngFromSeed("hello").next());
  });

  it("is itself deterministic: same seed ⇒ identical rngForSetup stream", () => {
    const streamA = rngForSetup("determinism-check");
    const outA = Array.from({ length: 8 }, () => streamA.next());
    const streamB = rngForSetup("determinism-check");
    const outB = Array.from({ length: 8 }, () => streamB.next());
    expect(outA).toEqual(outB);
  });
});

describe("historical collision this fix removes (documented, not enforced going forward)", () => {
  it("the bare rngFromSeed(seed) helper is still algebraically identical to rngFor(seed, 0) — " +
    "callers must use rngForSetup(seed), never rngFromSeed(seed) directly, to feed setup()", () => {
    expect(rngFromSeed("hello").next()).toBe(rngFor("hello", 0).next());
  });
});

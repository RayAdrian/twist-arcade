// packages/engine/src/rng.ts
//
// THIS IS A WIRE FORMAT (plan §3.4). mulberry32 is the stream generator; splitmix32 is the
// seed mixer; strings are folded to a 32-bit seed via xmur3. The derivation algorithm is
// part of the replay format: changing any constant here orphans every stored replay, daily
// seed, and certificate. Golden-vector tests in test/rng.test.ts lock these constants down.
// Changing them is a breaking engineVersion change requiring an ADR (plan §10) — the one
// thing that needs an ADR even pre-freeze.
//
// rngFor(matchSeed, k) = mulberry32(splitmix32(xmur3(matchSeed) + k))
//
// Per-step forking means replaying steps 0..k consumes identical random streams regardless
// of how many draws earlier steps made.

import type { Rng } from "./types";

/** xmur3 — folds an arbitrary string into a 32-bit hash generator. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function (): number {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** splitmix32 — mixes a 32-bit seed into a better-distributed 32-bit seed. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return function (): number {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/** mulberry32 — the stream generator. Returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wraps a raw [0,1) float generator into the public Rng surface. */
function makeRng(nextRaw: () => number): Rng {
  return {
    next(): number {
      return nextRaw();
    },
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`Rng.int(maxExclusive) requires a positive integer, got ${maxExclusive}`);
      }
      return Math.floor(nextRaw() * maxExclusive);
    },
    shuffle<T>(xs: readonly T[]): T[] {
      const out = xs.slice();
      // Fisher-Yates, using this.int-equivalent draws directly off nextRaw for determinism.
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(nextRaw() * (i + 1));
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
      }
      return out;
    },
  };
}

/** Build the mixed 32-bit seed a stream starts from, given a raw numeric seed. */
function mixSeed(rawSeed: number): number {
  return splitmix32(rawSeed >>> 0)();
}

/**
 * rngFromSeed — general-purpose entry point. Numeric seeds are coerced to a uint32 and
 * mixed directly; string seeds are first folded via xmur3, then mixed the same way.
 */
export function rngFromSeed(seed: string | number): Rng {
  const rawSeed = typeof seed === "string" ? xmur3(seed)() : seed >>> 0;
  const mixed = mixSeed(rawSeed);
  return makeRng(mulberry32(mixed));
}

/**
 * rngFor — the fork-per-step rule. Same matchSeed + step ⇒ identical stream, independent of
 * any other step. This is what makes replays robust to engine-internal refactors that
 * change draw counts within a step, and what makes generated content (spawns, mines,
 * tiles) replay-verifiable for free.
 */
export function rngFor(matchSeed: string, step: number): Rng {
  const base = xmur3(matchSeed)();
  const mixed = mixSeed((base + step) >>> 0);
  return makeRng(mulberry32(mixed));
}

// packages/bots/test/helpers.ts — shared test scaffolding (not itself a test file).
import type { Clock } from "../src/policy";

/** A deterministic fake clock: each `.now()` call advances by `stepMs` (default 1). Bots must
 *  never touch Date.now() directly (lint-enforced) — every test drives time through this. */
export function fakeClock(stepMs = 1): Clock {
  let t = 0;
  return {
    now(): number {
      const current = t;
      t += stepMs;
      return current;
    },
  };
}

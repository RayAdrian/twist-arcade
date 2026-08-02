// packages/engine/src/encode.ts
//
// Canonical-encode contract (plan §3, §3.2). `stableStringify` is the recommended backbone
// of every game's `encode(state)`: same logical value ⇒ byte-identical string regardless of
// object key insertion order. Solvers hash on `encode(S)`, so canonical form matters more
// than performance here.
//
// STANDING WARNING (orchestrator decision 6, plan §3.2): a game's `encode` MUST exclude
// `lastEffects`. If effects entered the canonical encoding, two positions identical in every
// way that matters to the rules would hash differently, and superko/repetition detection in
// decay games would silently break. `stableStringify` itself has no opinion on which fields
// a game includes — the exclusion is the game author's responsibility when they build the
// object they pass in. The engineContract testkit's canonical-form property exists to catch
// exactly this mistake; never weaken it.

import type { Json } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deterministic JSON stringify: object keys are sorted before serialization at every level,
 * so two objects that are deep-equal but built with different key insertion orders produce
 * byte-identical output. Arrays keep their order (order is meaningful data).
 */
export function stableStringify(value: Json): string {
  return stringifyValue(value);
}

function stringifyValue(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyValue).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stringifyValue(value[k] as Json)}`);
    return `{${entries.join(",")}}`;
  }
  // Exhaustiveness guard — Json type should make this unreachable.
  throw new TypeError(`stableStringify: unsupported value ${String(value)}`);
}

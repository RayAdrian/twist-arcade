// packages/daily/src/seed.ts — dailySeed(), the public, offline-computable daily seed
// formula (plan §2.1):
//
//   dailySeed(gameId, engineVersion, dayUTC) =
//     sha256("daily:" + gameId + ":" + engineVersion + ":" + yyyy-mm-dd(dayUTC))   // hex
//
// THIS IS A WIRE FORMAT, same discipline as packages/engine/src/rng.ts's rngFor formula:
// changing the joiner string, the hash algorithm, the field order, or the case/encoding of
// the output orphans every committed manifest and certificate ever shipped. Frozen from day
// one; a change requires an ADR (plan §2.1) and a new engineVersion era (the formula takes
// engineVersion as an input specifically so an engine bump is automatically a new seed era
// rather than a silent behavioral shift under an old seed — see the plan's own note).
//
// Implemented over Web Crypto (`crypto.subtle.digest`) rather than a hash library: it is a
// global in every environment this formula needs to run in — browser, worker, and Node >= 20
// (this repo's minimum, per package.json engines) — so anyone can reproduce today's seed with
// a ten-line script and no dependency at all (plan §2.1's "provably not rigged" property).

/** hex-encodes a digest ArrayBuffer, lowercase, zero-padded per byte. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The public daily seed for a two-player ("vs-bot") daily. Solo dailies use the CERTIFIED
 * seed instead (`dailySeed(...) + ":" + nonce`, plan §3.1) — that composition happens at
 * certify time (packages/harness, M3d) and is carried verbatim in the manifest; this
 * function is never called a second time client-side to "check" a solo seed against the
 * formula minus its nonce.
 */
export async function dailySeed(gameId: string, engineVersion: string, dayUTC: string): Promise<string> {
  const input = `daily:${gameId}:${engineVersion}:${dayUTC}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

/** True iff `seed` is exactly the certified derivative of `formula` — `formula` followed by
 *  ":" and a non-negative integer nonce (plan §3.1). Used to validate a solo manifest's
 *  `seed` field without re-running the certify pipeline's rejection loop client-side. */
export function isCertifiedSeedOf(seed: string, formula: string): boolean {
  if (!seed.startsWith(`${formula}:`)) return false;
  const nonce = seed.slice(formula.length + 1);
  return /^\d+$/.test(nonce);
}

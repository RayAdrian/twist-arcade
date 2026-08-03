import { describe, expect, it } from "vitest";
import { dailySeed } from "../src/seed";

// Plan §2.1: dailySeed(gameId, engineVersion, dayUTC) = sha256("daily:" + gameId + ":" +
// engineVersion + ":" + yyyy-mm-dd(dayUTC)), hex. A WIRE FORMAT — golden vectors pin exact
// outputs so a future refactor can never silently change what today's seed is.

describe("seed.ts — dailySeed()", () => {
  it("golden vector: fadeout, engine 0.1.0, Daily #1's day — literal, independently computed offline", async () => {
    // `python3 -c "import hashlib; print(hashlib.sha256(b'daily:fadeout:0.1.0:2026-09-01').hexdigest())"`
    // (or `node -e` with node:crypto) reproduces this exact literal — pinned, not re-derived
    // from this file's own helper, so a shared bug in both can't hide a regression.
    await expect(dailySeed("fadeout", "0.1.0", "2026-09-01")).resolves.toBe(
      "8d1f55f86deedd969fa46f0396459033d2635cbca4d21df35c4767f06eaf47d8"
    );
  });

  it("golden vector: mine-run, engine 0.1.0, a later day — second fixed literal", async () => {
    await expect(dailySeed("mine-run", "0.1.0", "2026-10-14")).resolves.toBe(
      "b17bd25db7d2b73f552318d1fcbbaccaa26613e826528d7c9b26c3f29d8bd818"
    );
  });

  it("matches an independent (non-shared-code) sha256 reference implementation generally", async () => {
    const gameId = "crackstep";
    const engineVersion = "0.3.2";
    const day = "2026-11-01";
    const manual = await sha256Hex(`daily:${gameId}:${engineVersion}:${day}`);
    await expect(dailySeed(gameId, engineVersion, day)).resolves.toBe(manual);
  });

  it("returns a 64-char lowercase hex string (sha256 digest)", async () => {
    const seed = await dailySeed("fadeout", "0.1.0", "2026-09-05");
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — calling it twice with identical inputs yields identical output", async () => {
    const a = await dailySeed("fadeout", "0.1.0", "2026-09-05");
    const b = await dailySeed("fadeout", "0.1.0", "2026-09-05");
    expect(a).toBe(b);
  });

  it("changes with gameId, engineVersion, or day independently (no accidental collisions)", async () => {
    const base = await dailySeed("fadeout", "0.1.0", "2026-09-05");
    expect(await dailySeed("mine-run", "0.1.0", "2026-09-05")).not.toBe(base);
    expect(await dailySeed("fadeout", "0.2.0", "2026-09-05")).not.toBe(base);
    expect(await dailySeed("fadeout", "0.1.0", "2026-09-06")).not.toBe(base);
  });

  it("an engine version bump changes the seed (a new engine era is automatically a new seed era)", async () => {
    const v1 = await dailySeed("fadeout", "0.1.0", "2026-09-10");
    const v2 = await dailySeed("fadeout", "0.1.1", "2026-09-10");
    expect(v1).not.toBe(v2);
  });
});

/** Independent reference implementation used only to derive the golden vectors above — kept
 *  deliberately separate from src/seed.ts's own implementation (importing dailySeed to test
 *  dailySeed would prove nothing). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

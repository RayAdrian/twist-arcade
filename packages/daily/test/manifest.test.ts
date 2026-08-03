import { describe, expect, it } from "vitest";
import { assertValidManifest, type DailyManifest } from "../src/manifest";
import { dailySeed } from "../src/seed";
import type { DailyBotRecord } from "../src/era";

const BOT: DailyBotRecord = {
  era: 1,
  tier: "standard",
  policy: { kind: "mcts" },
  budget: { kind: "rollouts", n: 1000 },
  blunder: null,
  botsVersion: "0.1.0",
  humanSeat: 0,
};

async function vsBotManifest(overrides: Partial<DailyManifest> = {}): Promise<DailyManifest> {
  const day = "2026-09-01";
  const seed = await dailySeed("fadeout", "0.1.0", day);
  return {
    day,
    n: 1,
    gameId: "fadeout",
    kind: "vs-bot",
    seed,
    engineVersion: "0.1.0",
    gameVersion: 1,
    bot: BOT,
    ...overrides,
  };
}

describe("manifest.ts — DailyManifest validation (CI guard: plan §2.3.3, §11.5)", () => {
  it("accepts a well-formed vs-bot manifest whose seed matches the public formula", async () => {
    const manifest = await vsBotManifest();
    await expect(assertValidManifest(manifest)).resolves.not.toThrow();
  });

  it("rejects a manifest whose seed does NOT match dailySeed(gameId, engineVersion, day) — the formula re-derivation check", async () => {
    const manifest = await vsBotManifest({ seed: "0".repeat(64) });
    await expect(assertValidManifest(manifest)).rejects.toThrow(/seed/i);
  });

  it("rejects n !== dailyNumber(day)", async () => {
    const manifest = await vsBotManifest({ n: 999 });
    await expect(assertValidManifest(manifest)).rejects.toThrow(/n\b|dailyNumber/i);
  });

  it("rejects day/n that predate DAILY_EPOCH", async () => {
    const day = "2026-08-31";
    const seed = await dailySeed("fadeout", "0.1.0", day);
    const manifest = await vsBotManifest({ day, n: 0, seed });
    await expect(assertValidManifest(manifest)).rejects.toThrow();
  });

  it("rejects a vs-bot manifest with no bot record at all", async () => {
    const manifest = await vsBotManifest();
    // `bot` is optional in the type (solo manifests have none), so deleting it is not itself
    // a type violation — the missing-bot case is a runtime "vs-bot requires bot" rule, not a
    // type-level one. No @ts-expect-error needed here (unlike the forbidden-shape cases below).
    delete manifest.bot;
    await expect(assertValidManifest(manifest)).rejects.toThrow(/bot/i);
  });

  it("rejects a vs-bot manifest whose bot has a deadlineMs budget (never allowed in daily mode)", async () => {
    const manifest = await vsBotManifest({
      // @ts-expect-error — deliberately constructing the forbidden shape.
      bot: { ...BOT, budget: { kind: "deadlineMs", ms: 500 } },
    });
    await expect(assertValidManifest(manifest)).rejects.toThrow(/rollouts/);
  });

  it("rejects a vs-bot manifest whose bot has humanSeat !== 0", async () => {
    const manifest = await vsBotManifest({
      // @ts-expect-error — deliberately constructing the forbidden shape.
      bot: { ...BOT, humanSeat: 1 },
    });
    await expect(assertValidManifest(manifest)).rejects.toThrow(/humanSeat/);
  });

  it("accepts a well-formed solo-puzzle manifest whose seed is a certified derivative of the formula", async () => {
    const day = "2026-09-02";
    const formula = await dailySeed("crackstep", "0.3.0", day);
    const manifest: DailyManifest = {
      day,
      n: 2,
      gameId: "crackstep",
      kind: "solo-puzzle",
      seed: `${formula}:3`,
      engineVersion: "0.3.0",
      gameVersion: 1,
      puzzle: { par: 19, parKind: "optimal", difficulty: "standard" },
    };
    await expect(assertValidManifest(manifest)).resolves.not.toThrow();
  });

  it("rejects a solo-puzzle manifest whose seed is NOT a certified derivative of the formula (wrong day baked in)", async () => {
    const day = "2026-09-02";
    const wrongFormula = await dailySeed("crackstep", "0.3.0", "2026-09-03");
    const manifest: DailyManifest = {
      day,
      n: 2,
      gameId: "crackstep",
      kind: "solo-puzzle",
      seed: `${wrongFormula}:0`,
      engineVersion: "0.3.0",
      gameVersion: 1,
      puzzle: { par: 19, parKind: "optimal", difficulty: "standard" },
    };
    await expect(assertValidManifest(manifest)).rejects.toThrow(/seed/i);
  });

  it("rejects a solo-puzzle manifest with no puzzle block (missing certificate public subset — never ship uncertified, plan §3.3)", async () => {
    const day = "2026-09-02";
    const formula = await dailySeed("crackstep", "0.3.0", day);
    const manifest: DailyManifest = {
      day,
      n: 2,
      gameId: "crackstep",
      kind: "solo-puzzle",
      seed: `${formula}:0`,
      engineVersion: "0.3.0",
      gameVersion: 1,
    };
    await expect(assertValidManifest(manifest)).rejects.toThrow(/puzzle/i);
  });

  it("accepts a well-formed solo-chase manifest whose seed is a CERTIFIED derivative of the formula (should-fix 4: Mine Run chase days require a certificate exactly like solo-puzzle days — rotation.ts's hasCertificate() already enforces this to SCHEDULE one)", async () => {
    const day = "2026-09-03";
    const formula = await dailySeed("mine-run", "0.1.0", day);
    const manifest: DailyManifest = {
      day,
      n: 3,
      gameId: "mine-run",
      kind: "solo-chase",
      seed: `${formula}:7`,
      engineVersion: "0.1.0",
      gameVersion: 1,
      chase: { moveBudget: 250 },
    };
    await expect(assertValidManifest(manifest)).resolves.not.toThrow();
  });

  it("rejects a solo-chase manifest whose seed is the RAW (uncertified) formula — a chase day is never shipped uncertified, same rule as solo-puzzle", async () => {
    const day = "2026-09-03";
    const rawFormula = await dailySeed("mine-run", "0.1.0", day);
    const manifest: DailyManifest = {
      day,
      n: 3,
      gameId: "mine-run",
      kind: "solo-chase",
      seed: rawFormula, // NOT "formula:nonce" — exactly what a pre-should-fix-4 manifest shipped
      engineVersion: "0.1.0",
      gameVersion: 1,
      chase: { moveBudget: 250 },
    };
    await expect(assertValidManifest(manifest)).rejects.toThrow(/certified/i);
  });

  it("rejects a solo-chase manifest whose seed is NOT a certified derivative of the formula (wrong day baked in)", async () => {
    const day = "2026-09-03";
    const wrongFormula = await dailySeed("mine-run", "0.1.0", "2026-09-04");
    const manifest: DailyManifest = {
      day,
      n: 3,
      gameId: "mine-run",
      kind: "solo-chase",
      seed: `${wrongFormula}:0`,
      engineVersion: "0.1.0",
      gameVersion: 1,
      chase: { moveBudget: 250 },
    };
    await expect(assertValidManifest(manifest)).rejects.toThrow(/certified/i);
  });

  it("rejects a solo-chase manifest with no chase block", async () => {
    const day = "2026-09-03";
    const formula = await dailySeed("mine-run", "0.1.0", day);
    const manifest: DailyManifest = {
      day,
      n: 3,
      gameId: "mine-run",
      kind: "solo-chase",
      seed: `${formula}:0`,
      engineVersion: "0.1.0",
      gameVersion: 1,
    };
    await expect(assertValidManifest(manifest)).rejects.toThrow(/chase/i);
  });

  it("rejects a manifest whose `day` does not match the filename it would be committed under", async () => {
    // filenameDay is a second, explicit argument — CI's own guard (plan §1.5: "must match the
    // filename") passes the filename it read the JSON from; this function must catch a
    // mismatch even though nothing about the JSON payload itself looks wrong in isolation.
    const manifest = await vsBotManifest();
    await expect(assertValidManifest(manifest, { filenameDay: "2026-09-02" })).rejects.toThrow(/filename/i);
  });
});

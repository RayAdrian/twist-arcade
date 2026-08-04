// games/crackstep/solver/certify-day.test.ts — TDD for certify-day.ts: the composition of the
// platform's `certifyDay` (@twist-arcade/harness) with Crackstep's own engine/solver and the
// daily team's public seed formula (@twist-arcade/daily's `dailySeed`). The standing warning
// this whole session carries — "budget exhaustion means rejection, never an uncertified ship"
// — gets its own planted-violation tests here, not just an appeal to certify.ts's own tests
// (which never touch a real generated Crackstep board or the real seed formula end to end).

import { describe, expect, it } from "vitest";
import { isCertifiedSeedOf } from "@twist-arcade/daily";
import { verifyCertificate } from "@twist-arcade/engine/testkit/checks";
import { crackstep } from "../engine";
import { ENGINE_VERSION, certifyOneDay, seedFormulaFor } from "./certify-day";

const DAY = "2026-09-01";

describe("seedFormulaFor", () => {
  it("is deterministic and game/day-scoped (changes with the day, not with repeated calls)", async () => {
    const a = await seedFormulaFor(DAY);
    const b = await seedFormulaFor(DAY);
    const c = await seedFormulaFor("2026-09-02");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, per @twist-arcade/daily's dailySeed
  });
});

describe("certifyOneDay — the happy path", () => {
  it("certifies a real day end to end: seed matches the formula, replays clean, par is optimal", async () => {
    const result = await certifyOneDay(DAY);
    expect(result.outcome).toBe("certified");
    const cert = result.certificate!;
    expect(cert.gameId).toBe("crackstep");
    expect(cert.gameVersion).toBe(crackstep.meta.version);
    expect(cert.engineVersion).toBe(ENGINE_VERSION);
    expect(cert.day).toBe(DAY);
    expect(cert.par).toBeGreaterThan(0);
    expect(cert.parKind).toBe("optimal");

    const formula = await seedFormulaFor(DAY);
    expect(isCertifiedSeedOf(cert.seed, formula)).toBe(true);

    // The certificate must survive the SAME re-verification nightly CI runs (never trust
    // certify-time self-verification alone — prove it independently here too).
    expect(() =>
      verifyCertificate(crackstep, {
        gameId: cert.gameId,
        gameVersion: cert.gameVersion,
        engineVersion: cert.engineVersion,
        seed: cert.seed,
        moveLog: cert.moveLog,
        par: cert.par,
        parKind: cert.parKind,
      })
    ).not.toThrow();
  }, 30_000);

  it("is deterministic: the same day certified twice produces byte-identical certificates", async () => {
    const first = await certifyOneDay(DAY);
    const second = await certifyOneDay(DAY);
    expect(first.outcome).toBe("certified");
    expect(second.outcome).toBe("certified");
    expect(JSON.stringify(second.certificate)).toBe(JSON.stringify(first.certificate));
  }, 30_000);
});

describe("certifyOneDay — budget exhaustion is REJECTION, never an uncertified ship (planted violation)", () => {
  it("a starved solve budget never returns 'certified' — every attempt is rejected instead", async () => {
    const result = await certifyOneDay("2026-09-03", { solveBudget: { maxNodes: 1, maxMs: 1 } });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.certificate).toBeUndefined();
    expect(result.rejections.length).toBeGreaterThan(0);
    expect(result.rejections.every((r) => /budget exhausted/.test(r.reason))).toBe(true);
  }, 30_000);
});

describe("certifyOneDay — an unreachable difficulty band is REJECTION, never a mis-banded ship", () => {
  it("a minPar above every real board's L* rejects every attempt as trivial, not certified", async () => {
    const result = await certifyOneDay("2026-09-04", { minPar: 10_000 });
    expect(result.outcome).toBe("rejected-all-attempts");
    expect(result.certificate).toBeUndefined();
    // Every rejection is EITHER the trivial-band clause this test is targeting OR an ordinary
    // unsolvable/budget draw the generator's own cheap pre-rejections occasionally miss — never
    // a certified outcome slipping through despite the unreachable minPar.
    expect(result.rejections.some((r) => /trivial/.test(r.reason))).toBe(true);
    expect(result.rejections.every((r) => /trivial|unsolvable|budget exhausted/.test(r.reason))).toBe(true);
  }, 30_000);
});

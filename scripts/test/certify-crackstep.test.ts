// scripts/test/certify-crackstep.test.ts — TDD for certify-crackstep.ts's pure, testable core
// (parseCliOptions / runCertifyRange / formatOutcome). Proves, against a real scratch
// certificate directory: certified days land on disk, an already-certified day is skipped
// (never re-solved) unless --force, and — the standing warning this whole session carries —
// a day `certifyOneDay` could not certify is NEVER written to disk, planted directly via an
// injected fake so this test does not depend on a real board happening to be unsolvable.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllCertificates } from "@twist-arcade/harness";
import { certifyOneDay } from "../../games/crackstep/solver/certify-day";
import { formatOutcome, parseCliOptions, runCertifyRange } from "../certify-crackstep";

describe("parseCliOptions", () => {
  const DEFAULT_START = "2026-09-01";

  it("defaults to 90 days from the supplied default start, force off", () => {
    expect(parseCliOptions([], DEFAULT_START)).toEqual({ days: 90, start: DEFAULT_START, force: false });
  });

  it("parses --days, --start, and the boolean --force flag", () => {
    expect(parseCliOptions(["--days", "5", "--start", "2026-10-01", "--force"], DEFAULT_START)).toEqual({
      days: 5,
      start: "2026-10-01",
      force: true,
    });
  });

  it("rejects a non-positive-integer --days rather than silently coercing it", () => {
    expect(() => parseCliOptions(["--days", "0"], DEFAULT_START)).toThrow(/positive integer/);
    expect(() => parseCliOptions(["--days", "abc"], DEFAULT_START)).toThrow(/positive integer/);
  });
});

function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10)!;
}

describe("runCertifyRange", () => {
  let certBaseDir: string;

  beforeEach(async () => {
    certBaseDir = await mkdtemp(path.join(tmpdir(), "crackstep-certify-"));
  });

  afterEach(async () => {
    await rm(certBaseDir, { recursive: true, force: true });
  });

  it("certifies each day in range and writes it to disk, real generator + real solver", async () => {
    const outcomes = await runCertifyRange({
      certBaseDir,
      start: "2026-09-01",
      days: 2,
      force: false,
      dayFor,
      certifyFn: certifyOneDay,
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.status === "certified")).toBe(true);

    const onDisk = await readAllCertificates(certBaseDir, "crackstep");
    expect(onDisk.map((c) => c.day).sort()).toEqual(["2026-09-01", "2026-09-02"]);
  }, 30_000);

  it("skips an already-certified day (never re-solves) unless --force", async () => {
    await runCertifyRange({ certBaseDir, start: "2026-09-01", days: 1, force: false, dayFor, certifyFn: certifyOneDay });

    let certifyCalls = 0;
    const countingCertify: typeof certifyOneDay = async (day) => {
      certifyCalls += 1;
      return certifyOneDay(day);
    };

    const outcomes = await runCertifyRange({
      certBaseDir,
      start: "2026-09-01",
      days: 1,
      force: false,
      dayFor,
      certifyFn: countingCertify,
    });
    expect(outcomes[0]!.status).toBe("skipped-existing");
    expect(certifyCalls).toBe(0);

    const forced = await runCertifyRange({
      certBaseDir,
      start: "2026-09-01",
      days: 1,
      force: true,
      dayFor,
      certifyFn: countingCertify,
    });
    expect(forced[0]!.status).toBe("certified");
    expect(certifyCalls).toBe(1);
  }, 30_000);

  it("a day certifyOneDay could not certify is reported 'rejected' and is NEVER written to disk (planted violation)", async () => {
    const alwaysRejects: typeof certifyOneDay = async () => ({
      outcome: "rejected-all-attempts",
      rejections: [{ nonce: 0, seed: "fake-seed:0", reason: "unsolvable" }],
    });

    const outcomes = await runCertifyRange({
      certBaseDir,
      start: "2026-09-01",
      days: 1,
      force: false,
      dayFor,
      certifyFn: alwaysRejects,
    });
    expect(outcomes[0]!.status).toBe("rejected");
    expect(outcomes[0]!.detail).toContain("unsolvable");

    const onDisk = await readAllCertificates(certBaseDir, "crackstep");
    expect(onDisk).toHaveLength(0); // the gap is honest — nothing was shipped for this day
  });

  it("formatOutcome renders OK/SKIP/FAIL distinctly", () => {
    expect(formatOutcome({ day: "2026-09-01", status: "certified", detail: "par=19" })).toMatch(/^\[OK\]/);
    expect(formatOutcome({ day: "2026-09-01", status: "skipped-existing", detail: "x" })).toMatch(/^\[SKIP\]/);
    expect(formatOutcome({ day: "2026-09-01", status: "rejected", detail: "x" })).toMatch(/^\[FAIL\]/);
  });
});

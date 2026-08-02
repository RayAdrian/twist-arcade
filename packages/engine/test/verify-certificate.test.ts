// packages/engine/test/verify-certificate.test.ts
//
// verifyCertificate ships in M1 (testkit/checks.ts, formerly testkit/contract.ts pre finding
// 2) with ZERO existing tests — not even the happy path (HP-005 / INV-007 in the M1 test
// plan). It is the certificate re-verifier the M3d harness certify loop and the nightly
// re-verification CI job depend on; an unproven verifyCertificate means neither of those has
// any evidence it actually accepts a real certificate or rejects a forged/corrupt one.

import { describe, expect, it } from "vitest";
import {
  miniCrackstep,
  MINI_CRACKSTEP_KNOWN_SOLUTION,
} from "../testkit/fixtures/mini-crackstep";
import { verifyCertificate, type CertificateReplayInput } from "../testkit/checks";
import { IllegalReplayMoveError } from "../src/replay";

function baseCert(): CertificateReplayInput {
  return {
    gameId: miniCrackstep.meta.id,
    gameVersion: miniCrackstep.meta.version,
    engineVersion: "verify-certificate-test",
    seed: "verify-certificate-test-seed",
    moveLog: MINI_CRACKSTEP_KNOWN_SOLUTION.map((m) => ({ to: m.to })),
  };
}

describe("verifyCertificate — happy path (HP-005)", () => {
  it("does not throw for a certificate whose moveLog replays to a won terminal", () => {
    expect(() => verifyCertificate(miniCrackstep, baseCert())).not.toThrow();
  });
});

describe("verifyCertificate — rejection paths (INV-007)", () => {
  it("(a) throws naming the mismatched gameId", () => {
    const cert = { ...baseCert(), gameId: "some-other-game" };
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/gameId/);
    try {
      verifyCertificate(miniCrackstep, cert);
      expect.unreachable("verifyCertificate should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("some-other-game");
      expect((err as Error).message).toContain(miniCrackstep.meta.id);
    }
  });

  it("(b) throws naming the mismatched gameVersion", () => {
    const cert = { ...baseCert(), gameVersion: 99 };
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/gameVersion/);
    try {
      verifyCertificate(miniCrackstep, cert);
      expect.unreachable("verifyCertificate should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("99");
      expect((err as Error).message).toContain(String(miniCrackstep.meta.version));
    }
  });

  it("(c) throws 'did not reach a won status' for a moveLog that legally replays to `lost`", () => {
    // Dead-end path (also used by fixtures-sanity.test.ts): 0 -> 1 -> 4 -> 7 -> 6 -> 3, then
    // stuck (all of cell 3's neighbors {0,6,4} are already crumbled) -> { kind: "lost" }.
    const cert: CertificateReplayInput = {
      ...baseCert(),
      moveLog: [{ to: 1 }, { to: 4 }, { to: 7 }, { to: 6 }, { to: 3 }],
    };
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/did not reach a won status/);
  });

  it("(d) throws IllegalReplayMoveError (from the inner replay) for a moveLog containing an illegal move", () => {
    // Cell 1's neighbors from 0 are {1,3}; jumping straight to a non-adjacent, non-crumbled
    // cell like 5 is not a legal first move.
    const cert: CertificateReplayInput = {
      ...baseCert(),
      moveLog: [{ to: 5 }],
    };
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(IllegalReplayMoveError);
  });
});

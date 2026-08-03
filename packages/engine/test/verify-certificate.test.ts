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

  // Correction C10 (stage-5 fix): verifyCertificate replayed a certificate's moveLog to `won`
  // but never checked `par` against it at all. `par` is THE published number — fairness proof,
  // difficulty calibration, and share hook at once — so a certificate that replays correctly
  // but carries a forged par is worse than none: it carries the authority of "verified" while
  // lying about the one number everything downstream trusts. A tampered cert (par: 999) used
  // to verify clean; it must not.
  it("(e) throws when a tampered `par` no longer matches moveLog.length", () => {
    const cert: CertificateReplayInput = { ...baseCert(), par: 999 };
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/par/);
  });

  it("(f) does NOT throw when `par` correctly matches moveLog.length (par is optional, but must be honest when present)", () => {
    const cert: CertificateReplayInput = { ...baseCert(), par: MINI_CRACKSTEP_KNOWN_SOLUTION.length };
    expect(() => verifyCertificate(miniCrackstep, cert)).not.toThrow();
  });

  it("(g) throws when `parKind` is present but not one of the two contractual values (JSON-boundary corruption)", () => {
    const cert = { ...baseCert(), parKind: "definitely-not-a-real-parKind" } as unknown as CertificateReplayInput;
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/parKind/);
  });

  it("(h) does NOT throw for either real parKind value", () => {
    expect(() =>
      verifyCertificate(miniCrackstep, { ...baseCert(), parKind: "optimal" })
    ).not.toThrow();
    expect(() =>
      verifyCertificate(miniCrackstep, { ...baseCert(), parKind: "best-in-budget" })
    ).not.toThrow();
  });

  it("(i) throws when `guessFree` is present but not a boolean (a JSON-parsed certificate has no compile-time type safety)", () => {
    const cert = { ...baseCert(), guessFree: "yes" } as unknown as CertificateReplayInput;
    expect(() => verifyCertificate(miniCrackstep, cert)).toThrow(/guessFree/);
  });
});

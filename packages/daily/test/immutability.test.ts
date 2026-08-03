import { describe, expect, it } from "vitest";
import { assertNoShippedManifestChanged, findImmutabilityViolations } from "../src/immutability";

// Plan §2.3.2: "CI diffs COMMITTED CHANGES ON THIS BRANCH VS. THE BASE REF for data/daily/*.json
// and hard-fails if any file whose day <= today-at-build changes at all (byte-diff). Shipped days
// are frozen forever; era bumps apply only to not-yet-shipped days." This is the guard the task
// calls out by name as needing a planted-violation demonstration, not just a unit test in
// isolation — see also src/bin/check-daily-immutability.ts (should-fix 8: this comment previously
// named a nonexistent scripts/check-daily-immutability.mjs) for the real git-diff-driven CLI this
// predicate backs, and the final report for a live retune-and-watch-it-fail demonstration against
// real git history in this worktree.

describe("immutability.ts — findImmutabilityViolations() / assertNoShippedManifestChanged()", () => {
  it("no violations when nothing changed", () => {
    expect(findImmutabilityViolations([], "2026-09-10")).toEqual([]);
  });

  it("no violations when only FUTURE (not-yet-shipped) days changed", () => {
    const violations = findImmutabilityViolations(["2026-09-11", "2026-09-20"], "2026-09-10");
    expect(violations).toEqual([]);
  });

  it("flags a change to a day exactly equal to today — 'today' has already shipped by build time", () => {
    const violations = findImmutabilityViolations(["2026-09-10"], "2026-09-10");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.day).toBe("2026-09-10");
  });

  it("flags a change to a PAST (already-shipped) day", () => {
    const violations = findImmutabilityViolations(["2026-09-01"], "2026-09-10");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.day).toBe("2026-09-01");
  });

  it("flags every shipped day independently when several changed at once", () => {
    const violations = findImmutabilityViolations(["2026-09-01", "2026-09-05", "2026-09-15"], "2026-09-10");
    expect(violations.map((v) => v.day).sort()).toEqual(["2026-09-01", "2026-09-05"]);
  });

  it("PLANTED VIOLATION: assertNoShippedManifestChanged throws when a shipped manifest was retuned", () => {
    // This is the exact failure mode the guard exists for: someone silently retunes a bot on a
    // day that already shipped. The assertion must throw — a build break, never a warning.
    expect(() => assertNoShippedManifestChanged(["2026-09-03"], "2026-09-10")).toThrow(/2026-09-03/);
  });

  it("does not throw for a legitimate future-day edit (curating an upcoming day is normal)", () => {
    expect(() => assertNoShippedManifestChanged(["2026-09-15"], "2026-09-10")).not.toThrow();
  });
});

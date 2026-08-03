// packages/harness/test/index-importable.test.ts — the package's declared "main"/"types" entry
// (package.json) must actually export every symbol other packages/tests import by name from
// "@twist-arcade/harness" (in-repo, this resolves via the workspace; an external consumer would
// hit the same barrel). A silent gap here (a symbol that exists in src/ but never made it into
// index.ts) would only surface as a confusing "not exported" error at a future call site —
// cheap to catch directly instead.

import { describe, expect, it } from "vitest";
import * as harness from "../src/index";

describe("@twist-arcade/harness's public barrel", () => {
  it("exports the solver building blocks (reach/retrograde individually — see C3 in the module doc)", () => {
    expect(typeof harness.reach).toBe("function");
    expect(typeof harness.retrograde).toBe("function");
    expect(typeof harness.solveTwoPlayerGame).toBe("function");
    expect(typeof harness.flipValue).toBe("function");
    expect(typeof harness.assertSolvablePreconditions).toBe("function");
  });

  it("exports the roster, runner, metrics, and suites surfaces", () => {
    expect(typeof harness.resolveNamedAgent).toBe("function");
    expect(typeof harness.mirrorAgent).toBe("function");
    expect(typeof harness.runMatchup).toBe("function");
    expect(typeof harness.computeMatchupMetrics).toBe("function");
    expect(typeof harness.agentWinRate).toBe("function");
    expect(typeof harness.evaluateCiGates).toBe("function");
    expect(typeof harness.runCiSuite).toBe("function");
    expect(typeof harness.assertSuiteOk).toBe("function");
  });

  it("exports the report formatters", () => {
    expect(typeof harness.toReportJson).toBe("function");
    expect(typeof harness.formatMatchupTable).toBe("function");
    expect(typeof harness.formatCiSuiteTable).toBe("function");
    expect(typeof harness.formatSolveResult).toBe("function");
  });

  it("does NOT export the CLI's process entry point (main is not a library concern)", () => {
    expect((harness as Record<string, unknown>).main).toBeUndefined();
  });
});

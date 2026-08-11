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
    expect(typeof harness.worstCapHitRate).toBe("function");
    expect(typeof harness.EmptyExceptionJustificationError).toBe("function");
    // C63: added alongside the up-front UnknownExceptionGateError refusal and the
    // InvalidMirrorProbeDeclarationError runtime-matches-type check — both need to be reachable
    // from the public barrel like every other suites.ts error/gate export above.
    expect(typeof harness.UnknownExceptionGateError).toBe("function");
    expect(harness.KNOWN_EXCEPTIONABLE_GATES instanceof Set).toBe(true);
    expect(typeof harness.InvalidMirrorProbeDeclarationError).toBe("function");
  });

  it("exports the report formatters", () => {
    expect(typeof harness.toReportJson).toBe("function");
    expect(typeof harness.toMatchupReportJson).toBe("function");
    expect(typeof harness.formatMatchupTable).toBe("function");
    expect(typeof harness.formatCiSuiteTable).toBe("function");
    expect(typeof harness.formatSolveResult).toBe("function");
  });

  it("does NOT export the CLI's process entry point (main is not a library concern)", () => {
    expect((harness as Record<string, unknown>).main).toBeUndefined();
  });

  // Added when the solo validation model (M3c/M3d) was rebased onto this two-player barrel —
  // a two-lane merge is exactly the kind of change that could silently drop a symbol (or a
  // rename-on-conflict alias, like `percentile`/`soloPercentile` below) without a test to
  // catch it, matching this file's own stated purpose.
  it("exports the solo agent roster, runner, metrics, probes, gates, solver, and certificate pipeline", () => {
    expect(typeof harness.buildAgent).toBe("function");
    expect(typeof harness.buildSoloRoster).toBe("function");
    expect(typeof harness.buildSafeMoveAgent).toBe("function");
    expect(typeof harness.buildViewPolicyAgent).toBe("function");
    expect(typeof harness.resolveStrongPolicy).toBe("function");
    expect(typeof harness.staticClock).toBe("function");
    expect(typeof harness.StrongPolicyUnavailableError).toBe("function");

    expect(typeof harness.pairedSeeds).toBe("function");
    expect(typeof harness.playSoloRun).toBe("function");
    expect(typeof harness.runSoloAgentOverSeeds).toBe("function");
    expect(typeof harness.UnwrappedAgentOnHiddenInformationEngineError).toBe("function");

    expect(typeof harness.computeSoloDistributionMetrics).toBe("function");
    expect(typeof harness.mean).toBe("function");
    expect(typeof harness.median).toBe("function");
    expect(typeof harness.stddev).toBe("function");
    expect(typeof harness.coefficientOfVariation).toBe("function");
    expect(typeof harness.safeRatio).toBe("function");
    // Collision fold-in: both this lane's solo-metrics and the two-player metrics.ts define
    // their OWN `percentile` — the bare name stays bound to the two-player one (established
    // first), and the solo one is re-exported under this alias.
    expect(typeof harness.soloPercentile).toBe("function");

    expect(typeof harness.grindProbe).toBe("function");
    expect(typeof harness.runAlwaysSafeProbe).toBe("function");
    expect(typeof harness.alwaysSafeVsStrongRatio).toBe("function");
    expect(typeof harness.MissingSafeMoveError).toBe("function");

    expect(typeof harness.evaluateSoloGates).toBe("function");
    expect(typeof harness.allGatesPass).toBe("function");

    expect(typeof harness.dfsSolver).toBe("function");
    expect(typeof harness.idaStarSolver).toBe("function");
    expect(typeof harness.StochasticEngineUnsupportedError).toBe("function");

    expect(typeof harness.certifyDay).toBe("function");
    expect(typeof harness.writeCertificate).toBe("function");
    expect(typeof harness.readCertificate).toBe("function");
    expect(typeof harness.readAllCertificates).toBe("function");
    expect(typeof harness.certificatePath).toBe("function");
    expect(typeof harness.rejectionRate).toBe("function");
    expect(typeof harness.bufferDaysRemaining).toBe("function");
    expect(typeof harness.computePathFeatures).toBe("function");
    expect(typeof harness.randomPlayoutStats).toBe("function");
    expect(typeof harness.StochasticEngineCertifyUnsupportedError).toBe("function");
    expect(typeof harness.CertificateDayMismatchError).toBe("function");

    expect(typeof harness.calibrate).toBe("function");
    expect(typeof harness.dayOverDayDriftSigma).toBe("function");
    expect(typeof harness.withinBand).toBe("function");
    expect(typeof harness.zScore).toBe("function");
  });

  it("both lanes' independently-named GateResult/GateStatus survive the merge under distinct exported names (suites.ts's aliased to Ci*, solo-gates.ts's kept bare)", () => {
    // Types only — nothing to check with typeof, but this documents (and would fail to
    // typecheck, not just at runtime, if it regressed) that both are actually importable
    // side by side.
    const ciStatus: import("../src/suites").GateStatus = "pass";
    const soloStatus: import("../src/solo-gates").GateStatus = "pass";
    expect(ciStatus).toBe("pass");
    expect(soloStatus).toBe("pass");
  });
});

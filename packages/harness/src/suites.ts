// packages/harness/src/suites.ts — the roadmap §6 two-player CI gate table, wired as failing
// assertions (plan §7.5). `pnpm harness suite <gameId> --suite ci|nightly` runs this.
//
// SCOPE: this module owns exactly the gates that are HARNESS-COMPUTED self-play numbers —
// strong-vs-random, first-player win rate, draw rate, mean plies / cap-hit rate, and
// ruthless-vs-standard. The other roadmap §6 CI rows (engine contract suite, redaction
// contract, bundle budget, a11y) are computed by other milestones' own CI steps (M1's testkit,
// the shell team's build/axe steps) — folding them in here would mean this module either
// silently no-ops on them or fakes a result, both worse than each owning its own row.
//
// TWO LAYERS, DELIBERATELY SEPARATE (this is what makes "plant a violation, confirm it fires"
// actually checkable per gate rather than only as one expensive end-to-end blob):
//   1. `evaluateCiGates` — a PURE function over already-computed numbers (`GateInputs`). Every
//      threshold has a test that plants a violation of EXACTLY that number and nothing else,
//      cheaply and deterministically (see suites.test.ts).
//   2. `runCiSuite` — wires `evaluateCiGates` to REAL self-play via `runMatchup`, resolving the
//      "strong" (ruthless tier) / "standard" tier / "random" agents from the game's own
//      manifest + roster.ts. A smaller end-to-end test proves this wiring is real (a
//      deliberately-sabotaged ruthless tier == randomPolicy must trip strong-vs-random for
//      real, not just in the pure evaluator).

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { DifficultyTier, GameManifest, HarnessThresholds } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "./roster";
import { resolveNamedAgent } from "./roster";
import { runMatchup, type MatchupReport, type RunMatchupOptions } from "./runner";
import { agentWinRate } from "./metrics";

export type GateStatus = "pass" | "fail" | "warn" | "n/a";

export interface GateResult {
  readonly gate: string;
  readonly status: GateStatus;
  readonly detail: string;
  /** Present iff a manifest `exceptions[]` entry matched this gate and downgraded a would-be
   *  "fail" to "warn" (plan §7.5: an exception is visible in review, never a silent pass). */
  readonly exceptionJustification?: string;
}

/** The already-computed numbers `evaluateCiGates` gates on — kept separate from `MatchupReport`
 *  so the pure evaluator can be tested with hand-built values, no real self-play required. */
export interface GateInputs {
  strongVsRandomWinRate: number;
  firstPlayerWinRate: number;
  drawRate: number;
  meanPlies: number;
  capHitRate: number;
  /** `null` when the manifest has no `"standard"` tier to compare against — reported as an
   *  explicit "n/a" gate (C2's "a skipped gate and a passed gate must never look the same"
   *  applies here exactly as it does to the solo suites). */
  ruthlessVsStandardWinRate: number | null;
}

interface ManifestException {
  readonly gate: string;
  readonly justification: string;
}

/** Applies a manifest exception (if any) to a raw "fail" verdict: downgrades to "warn" with the
 *  justification attached. A raw "pass"/"warn"/"n/a" is returned unchanged — an exception only
 *  ever SOFTENS a fail, it can never manufacture one, and it is applied per gate name (an
 *  exception for gate X must never touch gate Y). */
function applyException(gate: string, raw: GateStatus, detail: string, exceptions: readonly ManifestException[]): GateResult {
  if (raw !== "fail") return { gate, status: raw, detail };
  const exception = exceptions.find((e) => e.gate === gate);
  if (!exception) return { gate, status: "fail", detail };
  return { gate, status: "warn", detail, exceptionJustification: exception.justification };
}

/**
 * Pure gate evaluation (see module doc for why this is split from `runCiSuite`). `suite`
 * selects only the ruthless-vs-standard row's severity (warn at PR budget vs hard-fail
 * nightly, per roadmap §6) — every other row's threshold is suite-independent.
 */
export function evaluateCiGates(
  inputs: GateInputs,
  thresholds: HarnessThresholds,
  exceptions: readonly ManifestException[] = [],
  suite: "ci" | "nightly" = "ci"
): GateResult[] {
  const results: GateResult[] = [];

  {
    const pass = inputs.strongVsRandomWinRate >= thresholds.strongVsRandomMinWinRate;
    results.push(
      applyException(
        "strong-vs-random",
        pass ? "pass" : "fail",
        `${(inputs.strongVsRandomWinRate * 100).toFixed(1)}% (min ${(thresholds.strongVsRandomMinWinRate * 100).toFixed(1)}%)`,
        exceptions
      )
    );
  }

  {
    const [lo, hi] = thresholds.firstPlayerWinRateRange;
    const pass = inputs.firstPlayerWinRate >= lo && inputs.firstPlayerWinRate <= hi;
    results.push(
      applyException(
        "first-player-win-rate",
        pass ? "pass" : "fail",
        `${(inputs.firstPlayerWinRate * 100).toFixed(1)}% (band [${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%])`,
        exceptions
      )
    );
  }

  {
    const pass = inputs.drawRate <= thresholds.maxDrawRate;
    results.push(
      applyException(
        "draw-rate",
        pass ? "pass" : "fail",
        `${(inputs.drawRate * 100).toFixed(1)}% (max ${(thresholds.maxDrawRate * 100).toFixed(1)}%)`,
        exceptions
      )
    );
  }

  {
    const [lo, hi] = thresholds.pliesRange;
    const inBand = inputs.meanPlies >= lo && inputs.meanPlies <= hi;
    const noCapHits = inputs.capHitRate === 0;
    const pass = inBand && noCapHits;
    const detail = !inBand
      ? `mean ${inputs.meanPlies.toFixed(1)} plies (band [${lo}, ${hi}])`
      : !noCapHits
        ? `mean ${inputs.meanPlies.toFixed(1)} plies in band, but cap-hit rate ${(inputs.capHitRate * 100).toFixed(2)}% > 0 (any cap hit fails)`
        : `mean ${inputs.meanPlies.toFixed(1)} plies, 0 cap hits`;
    results.push(applyException("mean-plies", pass ? "pass" : "fail", detail, exceptions));
  }

  {
    if (inputs.ruthlessVsStandardWinRate === null) {
      results.push({ gate: "ruthless-vs-standard", status: "n/a", detail: "manifest has no \"standard\" tier" });
    } else {
      const pass = inputs.ruthlessVsStandardWinRate >= thresholds.ruthlessVsStandardMinWinRate;
      const detail = `${(inputs.ruthlessVsStandardWinRate * 100).toFixed(1)}% (min ${(thresholds.ruthlessVsStandardMinWinRate * 100).toFixed(1)}%, ${suite})`;
      if (pass) {
        results.push({ gate: "ruthless-vs-standard", status: "pass", detail });
      } else if (suite === "nightly") {
        results.push(applyException("ruthless-vs-standard", "fail", detail, exceptions));
      } else {
        // PR-budget ci suite: a below-threshold ruthless-vs-standard WARNS, never hard-fails
        // (roadmap §6) — this is not a manifest exception, it is the gate's own defined
        // severity at this suite tier, so it bypasses applyException entirely.
        results.push({ gate: "ruthless-vs-standard", status: "warn", detail });
      }
    }
  }

  return results;
}

export class SuiteFailedError extends Error {
  constructor(failing: readonly Pick<GateResult, "gate" | "status" | "detail">[]) {
    const names = failing.map((g) => `${g.gate} (${g.detail})`).join(", ");
    super(`CI suite failed: ${names}`);
    this.name = "SuiteFailedError";
  }
}

export interface CiSuiteReport {
  readonly gameId: string;
  readonly suite: "ci" | "nightly";
  /** True iff no gate has status "fail" ("warn" and "n/a" do not fail the suite). */
  readonly ok: boolean;
  readonly gates: readonly GateResult[];
  readonly matchups: {
    readonly strongVsRandom: MatchupReport;
    readonly strongSelfPlay: MatchupReport;
    readonly ruthlessVsStandard: MatchupReport | null;
  };
}

export interface RunCiSuiteOptions {
  readonly games?: number; // per matchup; default 200 (PR budget)
  readonly seed: string;
  readonly suite?: "ci" | "nightly"; // default "ci"
  readonly clock?: RunMatchupOptions["clock"];
}

function findTier(manifest: GameManifest, id: DifficultyTier["id"]): DifficultyTier | undefined {
  return manifest.difficultyTiers.find((t) => t.id === id);
}

function tierAgent<S extends WithEffects, M extends Json>(name: string, tier: DifficultyTier): AgentSpec<S, M> {
  return { kind: "policy", name, policy: tierPolicy<S, M>(tier), budget: tier.budget };
}

/**
 * Runs the real self-play this gate table needs (strong-vs-random, strong self-play, and
 * ruthless-vs-standard when the manifest has a "standard" tier) and evaluates every gate
 * against the manifest's own threshold overrides (falling back to
 * `DEFAULT_HARNESS_THRESHOLDS`) and exceptions.
 */
export function runCiSuite<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: RunCiSuiteOptions
): CiSuiteReport {
  const games = opts.games ?? 200;
  const suite = opts.suite ?? "ci";
  const thresholds: HarnessThresholds = { ...DEFAULT_HARNESS_THRESHOLDS, ...manifest.thresholds };
  const exceptions = manifest.exceptions ?? [];

  const ruthlessTier = findTier(manifest, "ruthless");
  if (!ruthlessTier) {
    throw new Error(
      `runCiSuite: manifest "${manifest.id}" has no "ruthless" difficulty tier — the CI gate ` +
        "table's strong-vs-random and strong-self-play rows have no agent to run."
    );
  }
  const ruthless = tierAgent<S, M>("ruthless", ruthlessTier);
  const random = resolveNamedAgent<S, M>("random");

  const strongVsRandom = runMatchup(engine, ruthless, random, {
    games,
    seed: `${opts.seed}:strong-vs-random`,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  const strongSelfPlay = runMatchup(engine, ruthless, ruthless, {
    games,
    seed: `${opts.seed}:strong-self-play`,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });

  const standardTier = findTier(manifest, "standard");
  const ruthlessVsStandard = standardTier
    ? runMatchup(engine, ruthless, tierAgent<S, M>("standard", standardTier), {
        games,
        seed: `${opts.seed}:ruthless-vs-standard`,
        ...(opts.clock ? { clock: opts.clock } : {}),
      })
    : null;

  const inputs: GateInputs = {
    strongVsRandomWinRate: agentWinRate(strongVsRandom.outcomes, "ruthless"),
    firstPlayerWinRate: strongSelfPlay.metrics.firstPlayerWinRate,
    drawRate: strongSelfPlay.metrics.drawRate,
    meanPlies: strongSelfPlay.metrics.meanPlies,
    capHitRate: strongSelfPlay.metrics.capHitRate,
    ruthlessVsStandardWinRate: ruthlessVsStandard ? agentWinRate(ruthlessVsStandard.outcomes, "ruthless") : null,
  };

  const gates = evaluateCiGates(inputs, thresholds, exceptions, suite);

  return {
    gameId: manifest.id,
    suite,
    ok: gates.every((g) => g.status !== "fail"),
    gates,
    matchups: { strongVsRandom, strongSelfPlay, ruthlessVsStandard },
  };
}

/** Throws `SuiteFailedError` iff `report.ok` is false — the actual "wired as a failing
 *  assertion" call site (`cli.ts`'s `harness suite` command uses this to set the process exit
 *  code non-zero). Never called implicitly by `runCiSuite` itself, so a caller that wants the
 *  full report even on failure (e.g. to print it) can always get one. */
export function assertSuiteOk(report: CiSuiteReport): void {
  if (!report.ok) {
    throw new SuiteFailedError(report.gates.filter((g) => g.status === "fail"));
  }
}

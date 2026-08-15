// packages/harness/test/ci-gates.test.ts — TDD anchor for M4's CI wiring layer
// (packages/harness/src/ci-gates.ts). Red first: ci-gates.ts does not exist yet.
//
// This module is the "per-game gate runs keyed correctly" piece the M4 CI workflow calls: it
// composes the ALREADY-BUILT, ALREADY-TESTED lanes (suites.ts for two-player; solo-gates.ts +
// solo-runner.ts + probes-solo.ts + certify.ts for solo) into ONE dispatcher selected by
// `manifest.solo.format` — never by player count (platform-corrections.md C2) — and makes that
// selection a RUNTIME-ENFORCED invariant (`selectGateKind` / the kind-mismatch guard in
// `runGameCiGate`), not just a convention a future caller has to remember.
//
// Standing warning this file exists to answer (project convention): a gate never observed
// failing is not a gate. Every planted-violation test below drives a REAL run through the real
// lanes (real self-play, a real solo roster, a real certificate on disk) rather than a
// hand-built report object, so a break in the wiring itself — not just in the pure evaluators
// suites.test.ts/solo-gates.test.ts already cover — would show up here.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { TTTMove, TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { ActiveSpec, GameEngine, Json, PlayerId, Status, WithEffects } from "@twist-arcade/engine";
import { bankRun, createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { safeMove as mineRunSafeMove } from "@twist-arcade/mine-run";
import type { GameManifest } from "@twist-arcade/game-spec";
import {
  DEFAULT_CI_GATE_GAMES,
  DEFAULT_SOLO_SEED_COUNT,
  GateKindMismatchError,
  HiddenInfoBudgetTooLowError,
  MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE,
  runGameCiGate,
  runSoloChaseCiGate,
  runSoloPuzzleCiGate,
  runTwoPlayerCiGate,
  selectGateKind,
} from "../src/ci-gates";
import { certifyDay, writeCertificate } from "../src/certify";
import { runCiSuite } from "../src/suites";
import { dfsSolver } from "../src/solver/generic-solo";
import { holeWalk, type HoleWalkMove, type HoleWalkState } from "./fixtures/hole-walk";
import { createAlwaysSafeBrokenMineRun, createAlwaysSafeHealthyMineRun } from "./fixtures/mine-run-mutants";

// ---------------------------------------------------------------------------------------
// selectGateKind / runGameCiGate — C2's runtime-enforced dispatch.
// ---------------------------------------------------------------------------------------

describe("selectGateKind — C2: keyed by manifest.solo.format, never by player count", () => {
  it("a manifest with no solo block is two-player, regardless of players.max", () => {
    expect(selectGateKind({})).toBe("two-player");
  });

  it("solo.format 'score-chase' selects solo-chase even though players.max === 1 (not puzzle)", () => {
    expect(selectGateKind({ solo: { format: "score-chase" } })).toBe("solo-chase");
  });

  it("solo.format 'daily-puzzle' selects solo-puzzle", () => {
    expect(selectGateKind({ solo: { format: "daily-puzzle" } })).toBe("solo-puzzle");
  });

  it("an unrecognized format throws loudly rather than silently falling through", () => {
    expect(() =>
      selectGateKind({ solo: { format: "not-a-real-format" as never } })
    ).toThrow(/unrecognized/);
  });
});

describe("runGameCiGate — refuses a caller-supplied kind that disagrees with the manifest's own format", () => {
  const chaseManifest: GameManifest = {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
  };

  it("throws GateKindMismatchError when asked to run 'solo-puzzle' against a score-chase manifest", async () => {
    await expect(
      runGameCiGate(bankRun, chaseManifest, {
        kind: "solo-puzzle",
        baseDir: "/nonexistent",
        today: "2026-09-14",
        dayFor: (d) => d,
      })
    ).rejects.toThrow(GateKindMismatchError);
  });

  it("throws GateKindMismatchError when asked to run 'two-player' against a solo manifest", async () => {
    await expect(
      runGameCiGate(bankRun, chaseManifest, { kind: "two-player", seed: "mismatch-test" })
    ).rejects.toThrow(GateKindMismatchError);
  });
});

// ---------------------------------------------------------------------------------------
// Two-player lane — thin wrapper over runCiSuite; the only NEW behavior is the explicit,
// always->=100 `games` default (G-14: "CI gate configs must pass an explicit runs (>=100)
// rather than relying on defaults").
// ---------------------------------------------------------------------------------------

describe("runTwoPlayerCiGate", () => {
  it("DEFAULT_CI_GATE_GAMES is explicitly >= 100 (G-14)", () => {
    expect(DEFAULT_CI_GATE_GAMES).toBeGreaterThanOrEqual(100);
  });

  const sabotagedManifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "ci-gates.test.ts sabotaged fixture — ruthless tier is literally randomPolicy.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };

  it("calling with no `games` override still runs the default (>=100) games, not suites.ts's own 200 default silently", () => {
    // A deliberately small explicit override proves the wrapper actually forwards `games` — if
    // it silently ignored the caller's value and fell through to some hardcoded number, this
    // report's own recorded matchup game count would betray it.
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, { seed: "ci-gates:2p:override", games: 24 });
    // Never null here — this manifest has no ciGateBudget.deferGatesToNightly, so matchups ran
    // for real (the C27 nullable case is exercised directly in suites.test.ts).
    expect(report.matchups!.strongVsRandom.metrics.games).toBe(24);
  });

  it("a sabotaged ruthless tier trips strong-vs-random for real through this wrapper", () => {
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, { seed: "ci-gates:2p:sabotaged", games: 40 });
    expect(report.ok).toBe(false);
    expect(report.gates.find((g) => g.gate === "strong-vs-random")?.status).toBe("fail");
  });

  it("routes through runGameCiGate's dispatcher identically for a two-player manifest", async () => {
    const result = await runGameCiGate(classicTicTacToe, sabotagedManifest, {
      kind: "two-player",
      seed: "ci-gates:2p:dispatched",
      games: 40,
    });
    expect(result.kind).toBe("two-player");
    expect(result.ok).toBe(false);
  });

  it("C71 Part 1 / C77: forwards seedCount to runCiSuite for real — 5 independent seedRuns, total games conserved", () => {
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, {
      seed: "ci-gates:2p:seedcount",
      games: 20,
      seedCount: 5,
    });
    expect(report.matchups).toBeNull();
    expect(report.seedRuns).toHaveLength(5);
    expect(report.seedRuns!.reduce((sum, r) => sum + r.strongVsRandom.metrics.games, 0)).toBe(20);
    expect(report.precision).toBeDefined();
  });

  it("seedCount omitted: byte-identical single-seed default, no seedRuns/precision", () => {
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, {
      seed: "ci-gates:2p:no-seedcount",
      games: 20,
    });
    expect(report.matchups).not.toBeNull();
    expect(report.seedRuns).toBeUndefined();
    expect(report.precision).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------
// C64 (docs/plans/degeneracy-probes.md): runTwoPlayerCiGate composes runCiSuite's six-plus-
// mirror-declaration rows with runProbeSuite's three degeneracy-probe rows onto ONE report —
// real wiring, not hand-built reports (this is the "gate never observed failing is not a gate"
// standing warning applied to the COMPOSITION seam itself, not just each half in isolation).
// ---------------------------------------------------------------------------------------

// classic-ttt's own point-reflection mirror: cell -> 8 - cell (same shape as Fadeout's real
// mirrorMove on the identical 3x3 board — games/fadeout/probes.ts).
function tttMirrorMoveFixture(_state: TTTState, lastOppMove: TTTMove | null, legalMoves: readonly TTTMove[]): TTTMove | null {
  if (lastOppMove === null) return null;
  const reflected = 8 - lastOppMove.cell;
  return legalMoves.find((m) => m.cell === reflected) ?? null;
}

describe("runTwoPlayerCiGate — C64: composes the two-player degeneracy probe suite (mirror/stall/rush) onto the same report", () => {
  const healthyManifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Healthy TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "ci-gates.test.ts C64 healthy fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 50 }, minReplyMs: 0 },
    ],
  };

  it("adds mirror-probe/stall-probe/rush-probe onto the existing six rows, never perturbing them (append-only, S0's own discipline extended to this composition)", () => {
    const plainCiReport = runCiSuite(classicTicTacToe, healthyManifest, { seed: "ci-gates:c64:append-only", games: 30 });
    const composed = runTwoPlayerCiGate(classicTicTacToe, healthyManifest, {
      seed: "ci-gates:c64:append-only",
      games: 30,
      mirrorMove: tttMirrorMoveFixture,
    });

    // The six pre-existing rows are BYTE-IDENTICAL between a bare runCiSuite call and this
    // composition, same seed, same games — proving the composition never mutates or reorders
    // them, only appends after.
    expect(composed.gates.slice(0, plainCiReport.gates.length)).toEqual(plainCiReport.gates);

    const probeGateNames = composed.gates.slice(plainCiReport.gates.length).map((g) => g.gate);
    expect(probeGateNames).toEqual(["mirror-probe", "stall-probe", "rush-probe"]);
  });

  it("mirror-probe exclusivity holds through the FULL composition: a manifest that DECLARES mirrorProbe gets exactly ONE mirror-probe row (the n/a declaration), even when opts.mirrorMove is ALSO supplied", () => {
    const declaringManifest: GameManifest = {
      ...healthyManifest,
      mirrorProbe: { applicable: false, reason: "ci-gates.test.ts C64: declared inapplicable, mirrorMove supplied anyway" },
    };
    const composed = runTwoPlayerCiGate(classicTicTacToe, declaringManifest, {
      seed: "ci-gates:c64:mirror-exclusivity",
      games: 20,
      mirrorMove: tttMirrorMoveFixture,
    });
    const mirrorRows = composed.gates.filter((g) => g.gate === "mirror-probe");
    expect(mirrorRows).toHaveLength(1);
    expect(mirrorRows[0]!.status).toBe("n/a");
    expect(mirrorRows[0]!.detail).toContain("declared inapplicable");
    // stall-probe/rush-probe still ran for real — the declaration is mirror-specific.
    expect(composed.gates.find((g) => g.gate === "stall-probe")).toBeDefined();
    expect(composed.gates.find((g) => g.gate === "rush-probe")).toBeDefined();
  });

  it("omitting mirrorMove entirely still produces exactly one mirror-probe row (n/a, 'unavailable')", () => {
    const composed = runTwoPlayerCiGate(classicTicTacToe, healthyManifest, {
      seed: "ci-gates:c64:mirror-omitted",
      games: 20,
    });
    const mirrorRows = composed.gates.filter((g) => g.gate === "mirror-probe");
    expect(mirrorRows).toHaveLength(1);
    expect(mirrorRows[0]!.status).toBe("n/a");
  });

  // CORRECTED (found while running this test): the FIRST version of this test tried to trip
  // stall-probe by sabotaging the ruthless opponent to `{kind:"random"}` and asserting a
  // specific ["warn","fail"] outcome — a wrong assumption about classic-ttt specifically, not an
  // implementation bug. stallPolicy explicitly treats an immediate WIN as its worst outcome
  // (stall.ts's own doc: "ending the game right here is the WORST outcome for a stalling
  // agent"), so stall's WIN rate has no reliable relationship to how weak its opponent is — the
  // measured run came back "pass". Fixed to isolate what this test actually needs to prove
  // (a REAL measured number feeds a REAL gate decision, honoring manifest.thresholds overrides
  // and the ci/nightly severity split) from what it does NOT need to assume (which direction a
  // stochastic matchup's win rate happens to land): an intentionally impossible-to-pass
  // threshold override, so ANY real (non-negative) win rate trips "fail" deterministically.
  it("PLANTED VIOLATION: a manifest threshold override makes ANY real measured stall win rate fail — proves a REAL number (not a hand-built one) drives the gate, with the ci/nightly severity split honored", () => {
    const zeroTolerance: GameManifest = {
      ...healthyManifest,
      thresholds: { stallProbeWinRateWarn: -1, stallProbeWinRateFail: -1 }, // any real (>=0) win rate fails
    };
    const ci = runTwoPlayerCiGate(classicTicTacToe, zeroTolerance, { seed: "ci-gates:c64:stall-threshold-ci", games: 20 });
    // ci-tier severity split (plan §1.4): a would-be fail downgrades to warn.
    expect(ci.gates.find((g) => g.gate === "stall-probe")!.status).toBe("warn");

    const nightly = runTwoPlayerCiGate(classicTicTacToe, zeroTolerance, {
      seed: "ci-gates:c64:stall-threshold-nightly",
      games: 20,
      suite: "nightly",
    });
    expect(nightly.gates.find((g) => g.gate === "stall-probe")!.status).toBe("fail");
    expect(nightly.ok).toBe(false);
  });

  it("routes through runGameCiGate's dispatcher with mirrorMove threaded through identically", async () => {
    const result = await runGameCiGate(classicTicTacToe, healthyManifest, {
      kind: "two-player",
      seed: "ci-gates:c64:dispatched",
      games: 20,
      mirrorMove: tttMirrorMoveFixture,
    });
    expect(result.kind).toBe("two-player");
    if (result.kind === "two-player") {
      expect(result.report.gates.find((g) => g.gate === "mirror-probe")).toBeDefined();
    }
  });

  it("C27 deferral: probe rows defer alongside the six existing rows, through the full composition", () => {
    const deferredManifest: GameManifest = {
      ...healthyManifest,
      ciGateBudget: { deferGatesToNightly: { reason: "ci-gates.test.ts C64 deferral fixture" } },
    };
    const composed = runTwoPlayerCiGate(classicTicTacToe, deferredManifest, {
      seed: "ci-gates:c64:defer",
      mirrorMove: tttMirrorMoveFixture,
    });
    // healthyManifest declares no "standard" tier and no solvedValue — TWO structural facts
    // (suites.ts's own documented precedent) that survive deferral unconditionally as "n/a",
    // never "deferred": ruthless-vs-standard has nothing to compare without a standard tier,
    // and solved-value-reached has nothing to confirm without a proven value, at any tier.
    const STRUCTURALLY_NA = new Set(["ruthless-vs-standard", "solved-value-reached"]);
    for (const gate of composed.gates) {
      if (STRUCTURALLY_NA.has(gate.gate)) {
        expect(gate.status, `gate ${gate.gate}`).toBe("n/a");
        continue;
      }
      expect(gate.status, `gate ${gate.gate}`).toBe("deferred");
    }
  });
});

// ---------------------------------------------------------------------------------------
// STAGE-6 FINDING: rush-probe's proven-draw relief fired on ANY reached solvedValue, not only
// a draw — the guard never checked `solvedValue.value === "draw"` — while the relief's own
// detail text hardcodes "a proven, reached draw". A reached p0-win/p1-win claim would have
// gotten UNEARNED relief (rush measures nothing) plus a report sentence asserting a draw that
// was never proven. Proven with a REAL, deterministically-reached (not hand-built) p0-win claim
// below — a tiny local fixture engine where seat 0 wins on its own first move, every game,
// regardless of policy, so self-play genuinely reaches firstPlayerWinRate 100% (>= the 90%
// floor) without depending on any real game's actual balance.
// ---------------------------------------------------------------------------------------

interface P0AlwaysWinsState extends WithEffects {
  readonly turn: PlayerId;
}
interface P0AlwaysWinsMove {
  readonly [key: string]: Json;
}

/** Seat 0 has exactly one legal move, which ends the game with seat 0 the winner — deterministic
 *  regardless of which policy occupies either seat. Exists ONLY so a `solvedValue: {value:
 *  "p0-win"}` claim is genuinely, reliably REACHED by real self-play in a test, without needing
 *  a real game whose actual balance happens to favor P1 90%+ of the time. */
const p0AlwaysWins: GameEngine<P0AlwaysWinsState, P0AlwaysWinsMove, P0AlwaysWinsState> = {
  meta: {
    id: "p0-always-wins-fixture",
    name: "P0 Always Wins (ci-gates.test.ts stage-6 fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },
  setup: () => ({ turn: 0, lastEffects: [] }),
  legalMoves: (state, player) => (player === state.turn ? [{}] : []),
  isLegal: (state, player) => player === state.turn,
  active: (state): ActiveSpec => ({ mode: "sequential", player: state.turn }),
  apply: (state) => ({ turn: state.turn === 0 ? 1 : 0, lastEffects: [] }),
  status: (state): Status => (state.turn === 1 ? { kind: "won", winner: 0 } : { kind: "ongoing" }),
  playerView: (state) => state,
  encode: (state) => JSON.stringify(state),
  decode: (s) => JSON.parse(s) as P0AlwaysWinsState,
};

describe("runTwoPlayerCiGate — C64 stage-6: rush-probe's proven-draw relief must NOT fire on a non-draw solvedValue", () => {
  const p0WinManifest: GameManifest = {
    id: "p0-always-wins-fixture",
    title: "P0 Always Wins",
    classic: "n/a",
    ruleSentence: "ci-gates.test.ts stage-6 fixture: seat 0 always wins on its own first move.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
    solvedValue: { value: "p0-win", proof: "ci-gates.test.ts: seat 0 wins on its own first move by construction" },
  };

  it("self-play genuinely REACHES the proven p0-win claim (sanity: the fixture does what it claims)", () => {
    const report = runTwoPlayerCiGate(p0AlwaysWins, p0WinManifest, { seed: "ci-gates:c64:p0win-sanity", games: 20 });
    const solvedValueReached = report.gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedValueReached.status).toBe("pass");
    expect(solvedValueReached.detail).toContain("100.0%");
  });

  it("PLANTED VIOLATION (regression): rush-probe measures for REAL — never n/a — despite the reached p0-win claim, and never asserts a draw that was never proven", () => {
    const report = runTwoPlayerCiGate(p0AlwaysWins, p0WinManifest, { seed: "ci-gates:c64:p0win-rush", games: 20 });
    const rush = report.gates.find((g) => g.gate === "rush-probe")!;
    // The bug: this used to be "n/a" citing "a proven, reached draw" — false on both counts for
    // a p0-win claim. Fixed: rush-probe must be a REAL measurement (this engine always ends
    // after one ply either way, so rush's parity score is deterministic and well above the fail
    // threshold — mirrorSeats:true means rush plays each seat every pair, winning as seat 0 and
    // losing as seat 1, landing near a 50% parity score, comfortably >= rushProbeScoreFail).
    expect(rush.status).not.toBe("n/a");
    expect(["warn", "fail"]).toContain(rush.status);
    // Specifically the n/a relief's own phrase — NOT a bare "draw" substring check, which would
    // false-positive on the real measured detail's own "(wins + 0.5*draws)/games" formula text.
    expect(rush.detail).not.toContain("proven, reached draw");
  });
});

// ---------------------------------------------------------------------------------------
// Solo score-chase lane — real roster, real probes, against bank-run.
// ---------------------------------------------------------------------------------------

describe("runSoloChaseCiGate", () => {
  it("DEFAULT_SOLO_SEED_COUNT is explicitly >= 100 (G-14's spirit extended to solo seed counts)", () => {
    expect(DEFAULT_SOLO_SEED_COUNT).toBeGreaterThanOrEqual(100);
  });

  const chaseManifest: GameManifest = {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
  };

  // bank-run is perfect-information, so a "safeMove" hook receives the state itself (V === S).
  const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });

  it("a healthy bank-run (real bust risk) clears the Always-Safe gate for real", () => {
    // Scoped deliberately to the ONE gate this test is about: bank-run's tiny ROUND_CAP (6)
    // is an M0/M1 fixture property unrelated to the Always-Safe question (it also trips
    // medianRunLength, which wants >=15 decisions, and — since its round cap sits exactly at
    // grindProbe's default confirmations count — the always-legal-at-streak-0 "bank" move,
    // a genuinely round-capped action, can pass the probe's replay-confirmation window; see
    // the dedicated grind-probe test below, which sidesteps this by using a much smaller
    // confirmations budget). None of that bears on whether Always-Safe (never taking risk)
    // actually under-performs Strong (which does take risk) — which is what this test proves.
    const report = runSoloChaseCiGate(bankRun, chaseManifest, {
      seed: "ci-gates:chase:healthy",
      seedCount: 120,
      safeMove: alwaysBank,
    });
    const gate = report.gates.find((g) => g.name === "alwaysSafeVsStrong")!;
    expect(gate.status).toBe("pass");
    expect(report.alwaysSafeVsStrong).toBeLessThan(1);
  });

  it("the Grind probe trips (hard fail) against the planted zero-risk farming-loop engine", () => {
    const brokenEngine = createBankRun({ plantFarmingLoop: true });
    const report = runSoloChaseCiGate(brokenEngine, chaseManifest, {
      seed: "ci-gates:chase:grind",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    const gate = report.gates.find((g) => g.name === "grindProbe")!;
    expect(gate.status).toBe("fail");
    expect(report.grind.found).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("routes through runGameCiGate's dispatcher identically for a solo-chase manifest", async () => {
    const result = await runGameCiGate(bankRun, chaseManifest, {
      kind: "solo-chase",
      seed: "ci-gates:chase:dispatched",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    expect(result.kind).toBe("solo-chase");
    expect(typeof result.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C19's hidden-info follow-up (orchestrator finding, mid-task): for a
// `hiddenInformation: true` engine, cost is `seeds x moves x K x rollouts-per-world` — K (the
// determinization sample count) is COUPLED to the same rollout budget
// (determinizedFlatMonteCarloPolicy: K = budget.n / legalMoves.length), so scaling the budget
// down scales K down too, in the SAME step. C6 already proved a too-weak Strong makes every
// solo gate meaningless (a gate defined relative to a reference agent is only as trustworthy
// as that agent) — these tests prove a scaled-down budget either (a) stays above the floor
// known to preserve real Always-Safe separation, using the SAME Mine Run healthy/degenerate
// mutant fixtures probes-solo.test.ts's C6 close-out already validated the shipped roster
// against, or (b) refuses loudly (HiddenInfoBudgetTooLowError) BEFORE running anything
// expensive, rather than silently emitting a ratio measured against a Strong too weak to mean
// anything.
// ---------------------------------------------------------------------------------------

describe("runSoloChaseCiGate — C19 hidden-info budget scaling (rollouts AND the coupled K)", () => {
  const mineRunChaseManifest: GameManifest = {
    id: "mine-run-fixture",
    title: "Mine Run",
    classic: "Minesweeper",
    ruleSentence: "ci-gates.test.ts Mine Run fixture.",
    tags: [],
    estMinutes: 3,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase", moveCap: 30 },
  };

  it("MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE is a positive floor (sanity)", () => {
    expect(MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE).toBeGreaterThan(0);
  });

  it("refuses loudly, BEFORE running any self-play, when a scaled-down soloChaseCiRollouts drops K below the floor", () => {
    // 6x6 board -> 36 root legal moves. At 50 rollouts, K ~= 1.4 per candidate — the exact
    // shape probes-solo.test.ts's own tuning notes found insufficient (their ~60-rollout,
    // ~1-2-samples/candidate case reproduced a naive majority-vote wrapper's weak separation).
    const engine = createAlwaysSafeHealthyMineRun();
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 50 },
    };
    expect(() =>
      runSoloChaseCiGate(engine, manifest, {
        seed: "ci-gates:c19:hidden-info-too-low",
        seedCount: 100,
        safeMove: mineRunSafeMove,
        suite: "ci",
      })
    ).toThrow(HiddenInfoBudgetTooLowError);
  });

  it("does NOT throw the floor guard for the platform default (1000) on the same board — only an aggressive override trips it", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    expect(() =>
      runSoloChaseCiGate(engine, mineRunChaseManifest, {
        seed: "ci-gates:c19:hidden-info-default",
        seedCount: 3,
        safeMove: mineRunSafeMove,
        suite: "ci",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  }, 30_000);

  it("a scaled-down but VIABLE budget (320, ~8.9 samples/candidate on this 36-cell board) still separates healthy from degenerate — the coordinator's exact ask, proven against the real Mine Run engine and its real mutant fixtures", () => {
    const seeds = 15;
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 320 },
    };

    const healthy = runSoloChaseCiGate(createAlwaysSafeHealthyMineRun(), manifest, {
      seed: "ci-gates:c19:separation-healthy",
      seedCount: seeds,
      safeMove: mineRunSafeMove,
      suite: "ci",
    });
    expect(healthy.alwaysSafeVsStrong).toBeLessThan(0.95);

    const degenerate = runSoloChaseCiGate(createAlwaysSafeBrokenMineRun(), manifest, {
      seed: "ci-gates:c19:separation-degenerate",
      seedCount: seeds,
      safeMove: mineRunSafeMove,
      suite: "ci",
    });
    expect(degenerate.alwaysSafeVsStrong).toBeGreaterThanOrEqual(0.95);
  }, 180_000);

  it("suite 'nightly' ignores soloChaseCiRollouts and is never subject to the ci-only override (matches the two-player lane's rule)", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    // An override this low would throw under suite "ci" (see the test above); "nightly" must
    // ignore it entirely and fall back to the platform default, so this must NOT throw.
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 50 },
    };
    expect(() =>
      runSoloChaseCiGate(engine, manifest, {
        seed: "ci-gates:c19:nightly-ignores-override",
        seedCount: 3,
        safeMove: mineRunSafeMove,
        suite: "nightly",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  }, 30_000);

  it("the guard never fires for a perfect-information game (bank-run) regardless of how low the budget goes", () => {
    const chaseManifest: GameManifest = {
      id: "bank-run-fixture",
      title: "Bank Run",
      classic: "press-your-luck",
      ruleSentence: "Push your luck or bank it.",
      tags: [],
      estMinutes: 1,
      modes: { bot: false, hotseat: false, asyncLink: false },
      players: { min: 1, max: 1 },
      difficultyTiers: [],
      solo: { format: "score-chase" },
      ciGateBudget: { soloChaseCiRollouts: 1 },
    };
    const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });
    expect(() =>
      runSoloChaseCiGate(bankRun, chaseManifest, {
        seed: "ci-gates:c19:perfect-info-immune",
        seedCount: 20,
        safeMove: alwaysBank,
        suite: "ci",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C27: `manifest.ciGateBudget.deferGatesToNightly` — Mine Run's real-
// board Strong-dependent solo-chase gates cost ~4.6h at seedCount=100 (measured), unaffordable
// in CI. Wired here through `runSoloChaseCiGate`'s REAL call path (not just the pure
// `evaluateSoloGates` unit tests in solo-gates.test.ts): at suite "ci" with an active deferral,
// Strong (and Always-Safe, which needs Strong's scores) never runs at all; at suite "nightly"
// the deferral is ignored and the full roster runs for real, exactly like every other
// `ciGateBudget` field's suite-scoping rule in this module.
// ---------------------------------------------------------------------------------------

describe("runSoloChaseCiGate — C27: manifest.ciGateBudget.deferGatesToNightly", () => {
  const DEFER_REASON = "Strong-dependent; ~4.6h at seedCount=100 in CI — platform-corrections.md C27";

  const chaseManifest: GameManifest = {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
    ciGateBudget: { deferGatesToNightly: { reason: DEFER_REASON } },
  };
  const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });

  it("suite 'ci' (default): every Strong-dependent row is 'deferred', alwaysSafeVsStrong is undefined (Strong never ran), and greedyVsRandomRatio/grindProbe are STILL real", () => {
    const report = runSoloChaseCiGate(bankRun, chaseManifest, {
      seed: "ci-gates:c27:defer-ci",
      seedCount: 100,
      safeMove: alwaysBank,
    });

    for (const name of ["strongVsRandomRatio", "distributionOverlap", "strongVsGreedyRatio", "strongScoreCV", "alwaysSafeVsStrong", "medianRunLength", "capHitRate", "ceilingPileUp"]) {
      const gate = report.gates.find((g) => g.name === name)!;
      expect(gate.status, `gate ${name}`).toBe("deferred");
      expect(gate.detail).toContain("nightly");
      expect(gate.detail).toContain(DEFER_REASON);
    }
    expect(report.gates.find((g) => g.name === "greedyVsRandomRatio")!.status).not.toBe("deferred");
    // grindProbe is real (not deferred) here too — its actual pass/fail is a property of the
    // bank-run FIXTURE's default round-cap shape (documented above at this describe block's own
    // "healthy" test), orthogonal to deferral, so this test only asserts it was ACTUALLY
    // evaluated rather than skipped. "ok can be true alongside deferred rows" (the provisional-
    // pass case) is already proven at the pure-evaluator level in solo-gates.test.ts and
    // suites.test.ts; the dedicated planted-violation test below proves the integration-level
    // analogue with a grindProbe FAIL specifically.
    expect(report.gates.find((g) => g.name === "grindProbe")!.status).not.toBe("deferred");
    expect(report.alwaysSafeVsStrong).toBeUndefined();
  });

  it("suite 'ci': the deferred run is dramatically cheaper — no Always-Safe probe, no Strong roster run at all (proven by absence of the fields those would populate, not by timing, which is inherently noisy)", () => {
    const report = runSoloChaseCiGate(bankRun, chaseManifest, {
      seed: "ci-gates:c27:defer-cheap",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    // metrics is the CI-tier PARTIAL shape — no strong-dependent keys present at all.
    expect(Object.keys(report.metrics).sort()).toEqual(
      ["greedyMedian", "greedyVsRandomRatio", "randomMedian", "randomP75", "randomP90"].sort()
    );
  });

  it("suite 'nightly': IGNORES the deferral entirely — the full roster (random, greedy, AND strong) runs for real, every row is measured, alwaysSafeVsStrong is a real number", () => {
    const report = runSoloChaseCiGate(bankRun, chaseManifest, {
      seed: "ci-gates:c27:defer-nightly-ignored",
      seedCount: 100,
      safeMove: alwaysBank,
      suite: "nightly",
    });

    for (const gate of report.gates) {
      expect(gate.status, `gate ${gate.name}`).not.toBe("deferred");
    }
    expect(typeof report.alwaysSafeVsStrong).toBe("number");
    // metrics is the FULL shape now — strong-dependent keys present.
    expect(Object.keys(report.metrics)).toContain("strongMedian");
  });

  it("routes through runGameCiGate's dispatcher identically, deferral intact", async () => {
    const result = await runGameCiGate(bankRun, chaseManifest, {
      kind: "solo-chase",
      seed: "ci-gates:c27:dispatched",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    expect(result.kind).toBe("solo-chase");
    expect(typeof result.ok).toBe("boolean");
    if (result.kind === "solo-chase") {
      expect(result.report.gates.find((g) => g.name === "alwaysSafeVsStrong")?.status).toBe("deferred");
    }
  });

  it("PLANTED VIOLATION: a deferred CI run is STILL a real fail when grindProbe trips — proves deferral is not a blanket free pass", () => {
    const brokenEngine = createBankRun({ plantFarmingLoop: true });
    const report = runSoloChaseCiGate(brokenEngine, chaseManifest, {
      seed: "ci-gates:c27:defer-grind-fail",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    expect(report.gates.find((g) => g.name === "grindProbe")?.status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("real Mine Run engine (6x6 fixture): suite 'ci' with deferral active never runs Strong — proven by real elapsed time staying near Random/Greedy's cost, not Strong's (which alone took tens of seconds in the C19 tests above at the same seed count)", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    const manifest: GameManifest = {
      id: "mine-run-fixture",
      title: "Mine Run",
      classic: "Minesweeper",
      ruleSentence: "ci-gates.test.ts Mine Run C27 fixture.",
      tags: [],
      estMinutes: 3,
      modes: { bot: false, hotseat: false, asyncLink: false },
      players: { min: 1, max: 1 },
      difficultyTiers: [],
      solo: { format: "score-chase", moveCap: 30 },
      ciGateBudget: { soloChaseCiRollouts: 320, deferGatesToNightly: { reason: DEFER_REASON } },
    };
    const started = Date.now();
    const report = runSoloChaseCiGate(engine, manifest, {
      seed: "ci-gates:c27:mine-run-defer-real",
      seedCount: 15,
      safeMove: mineRunSafeMove,
    });
    const elapsedMs = Date.now() - started;
    expect(report.gates.find((g) => g.name === "alwaysSafeVsStrong")?.status).toBe("deferred");
    expect(report.alwaysSafeVsStrong).toBeUndefined();
    // The C19 test above ran Strong at the SAME 320-rollout/15-seed config and took ~50s just
    // for the healthy/degenerate PAIR (so ~tens of seconds for ONE run). Random+greedy alone
    // (no Strong, no Always-Safe) finishing in well under that is the real, observable proof
    // this test exists to make — generous margin (10s) to stay robust on a loaded CI box.
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------
// Solo daily-puzzle lane — real certificates on disk, real verifyCertificate re-check.
// ---------------------------------------------------------------------------------------

function isoDay(offsetFromEpoch: number): string {
  const base = new Date(Date.UTC(2026, 8, 14)); // 2026-09-14
  base.setUTCDate(base.getUTCDate() + offsetFromEpoch);
  return base.toISOString().slice(0, 10);
}

function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe("runSoloPuzzleCiGate", () => {
  const puzzleManifest: GameManifest = {
    id: "hole-walk-fixture",
    title: "Hole Walk",
    classic: "puzzle",
    ruleSentence: "Walk corner to corner without crossing your own trail or a hole.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "daily-puzzle" },
    // hole-walk's known solvable seed certifies at L*=5 — below the platform default
    // certificateParRange [8, 80] (a real launch game's band; this is a 4x3 test fixture, not
    // a shippable puzzle). Widened via the manifest's own threshold-override mechanism
    // (plan §7.5) so the certificatePar gate means something for THIS fixture's actual scale,
    // exactly the escape hatch a real tiny/tutorial puzzle would also use.
    thresholds: { certificateParRange: [3, 10] },
  };

  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "ci-gates-certs-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const SOLVABLE_SEED = "hunt:0"; // see certify.test.ts's own comment: known solvable, L*=5

  it("reports certificatePresent as a hard fail when today's day has no stored certificate", async () => {
    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, {
      baseDir,
      today: isoDay(0),
      dayFor,
    });
    const gate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toMatch(/missing/);
    expect(report.ok).toBe(false);
  });

  it("a real certified day passes certificatePresent via a genuine re-verified replay", async () => {
    const today = isoDay(0);
    const result = certifyDay({
      gameId: "hole-walk-fixture",
      gameVersion: 1,
      engineVersion: "test",
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      day: today,
      seedFor: () => SOLVABLE_SEED,
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      randomPlayoutTrials: 200,
    });
    expect(result.outcome).toBe("certified");
    await writeCertificate(baseDir, result.certificate!);

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const presentGate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(presentGate.status).toBe("pass");
    expect(presentGate.detail).toMatch(/verified/);
    const parGate = report.gates.find((g) => g.name === "certificatePar")!;
    expect(parGate.status).toBe("pass");
  });

  it("a tampered par on disk (C10) fails certificatePresent via a genuine re-verification, not a hand-checked field", async () => {
    const today = isoDay(0);
    const result = certifyDay({
      gameId: "hole-walk-fixture",
      gameVersion: 1,
      engineVersion: "test",
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      day: today,
      seedFor: () => SOLVABLE_SEED,
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      randomPlayoutTrials: 200,
    });
    expect(result.outcome).toBe("certified");
    const tampered = { ...result.certificate!, par: 999 };
    await writeCertificate(baseDir, tampered);

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const presentGate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(presentGate.status).toBe("fail");
    expect(presentGate.detail).toMatch(/FAILED CI replay verification/);
    expect(report.ok).toBe(false);
  });

  it("certifiedBufferDays reflects a real contiguous run read off disk, and alerts below 30", async () => {
    const today = isoDay(0);
    // Certify exactly 5 contiguous days starting today — comfortably below the 30-day alert
    // band and the 7-day hard-fail floor is still cleared (5 >= 7? no: 5 < 7, so this ALSO
    // exercises the hard-fail branch for real).
    for (let i = 0; i < 5; i++) {
      const day = dayFor(today, i);
      const result = certifyDay({
        gameId: "hole-walk-fixture",
        gameVersion: 1,
        engineVersion: "test",
        engine: holeWalk,
        solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
        day,
        seedFor: () => SOLVABLE_SEED,
        solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
        maxNonceAttempts: 1,
        minPar: 3,
        maxForcedMoveFraction: 0.9,
        maxRandomPlayoutSolveRate: 0.9,
        randomPlayoutTrials: 200,
      });
      expect(result.outcome).toBe("certified");
      await writeCertificate(baseDir, result.certificate!);
    }

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const bufferGate = report.gates.find((g) => g.name === "certifiedBufferDays")!;
    expect(bufferGate.detail).toMatch(/^5 days buffered/);
    expect(bufferGate.status).toBe("fail"); // 5 < minCertifiedBufferDays (7)
    expect(report.ok).toBe(false);
  });

  it("routes through runGameCiGate's dispatcher identically for a solo-puzzle manifest", async () => {
    const result = await runGameCiGate(holeWalk, puzzleManifest, {
      kind: "solo-puzzle",
      baseDir,
      today: isoDay(0),
      dayFor,
    });
    expect(result.kind).toBe("solo-puzzle");
    expect(typeof result.ok).toBe("boolean");
  });
});

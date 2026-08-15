// packages/harness/test/runner.test.ts — TDD anchor for the 2-player self-play matchup
// executor (plan §7.1's minimal `run`, extended with §7.2's full metric set). Red first:
// runner.ts does not exist yet.

import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { replay, type ReplayRecord, type StepRecord } from "@twist-arcade/engine";
import type { Clock } from "@twist-arcade/bots";
import { corridor, type CorridorMove, type CorridorState } from "./fixtures/corridor";
import { doors, type DoorsMove, type DoorsState } from "./fixtures/doors";
import { simulDuel } from "./fixtures/simul-duel";
import { resolveNamedAgent, mirrorAgent, type PolicyAgentSpec } from "../src/roster";
import { HiddenInformationUnsupportedError, runMatchup } from "../src/runner";

/** A deterministic, always-advancing fake clock — never zero elapsed (which would otherwise
 *  make throughputGamesPerSec divide-by-zero into Infinity, silently corrupting a JSON report;
 *  see runner.ts's own defensive clamp) and, critically, IDENTICAL across two separately
 *  constructed instances given the same call pattern — which is exactly what the determinism
 *  test below needs. */
function fakeClock(): Clock {
  let t = 0;
  return {
    now(): number {
      t += 1;
      return t;
    },
  };
}

describe("runMatchup() on classic-ttt", () => {
  it("plays exactly `games` games, each terminating within TTT's 9-ply ceiling, no cap hits", () => {
    const random = resolveNamedAgent<TTTState, TTTMove>("random");
    const report = runMatchup(classicTicTacToe, random, resolveNamedAgent("random"), {
      games: 20,
      seed: "runner-test:random-vs-random",
      clock: fakeClock(),
    });

    expect(report.outcomes).toHaveLength(20);
    expect(report.metrics.games).toBe(20);
    for (const o of report.outcomes) {
      expect(o.plies).toBeGreaterThanOrEqual(1);
      expect(o.plies).toBeLessThanOrEqual(9);
      expect(o.capHit).toBe(false);
      // Review Note 8 + stage-6 MUST FIX: every ply actually played must be recorded, not
      // discarded, as one StepRecord per ply (TTT is strictly sequential, so each StepRecord
      // holds exactly one [seat, move] pair — see the simultaneous test below for the n-actor
      // case a flat per-actor log couldn't express at all).
      expect(o.moves).toHaveLength(o.plies);
      expect(o.moves[0]).toEqual({ moves: [[0, { cell: expect.any(Number) }]] });
    }
    expect(report.metrics.capHitRate).toBe(0);
    // Sanity bounds — random-vs-random TTT: draws and both-seat wins should all be possible,
    // and every rate must be a real, finite fraction in [0,1].
    expect(report.metrics.drawRate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.drawRate).toBeLessThanOrEqual(1);
    expect(report.metrics.firstPlayerWinRate).toBeGreaterThan(0);
    expect(report.metrics.firstPlayerWinRate).toBeLessThan(1);
    expect(Number.isFinite(report.throughputGamesPerSec)).toBe(true);
    expect(report.throughputGamesPerSec).toBeGreaterThan(0);
  });

  it("mirrors seats: with mirrorSeats (default), each matchSeed pair plays both seat assignments", () => {
    const report = runMatchup(classicTicTacToe, resolveNamedAgent("random"), resolveNamedAgent("greedy"), {
      games: 10,
      seed: "runner-test:mirror-seats",
      clock: fakeClock(),
    });
    // 10 games -> 5 mirrored pairs -> matchSeed "…:0".."…:4", each appearing exactly twice with
    // seatAgent flipped.
    const seeds = report.outcomes.map((o) => o.matchSeed);
    const uniqueSeeds = new Set(seeds);
    expect(uniqueSeeds.size).toBe(5);
    for (const seed of uniqueSeeds) {
      const pair = report.outcomes.filter((o) => o.matchSeed === seed);
      expect(pair).toHaveLength(2);
      expect(pair[0]!.seatAgent).toEqual(["random", "greedy"]);
      expect(pair[1]!.seatAgent).toEqual(["greedy", "random"]);
    }
  });

  it("a strong search agent beats random decisively (sanity check that the roster is really wired through)", () => {
    const strong = resolveNamedAgent<TTTState, TTTMove>("mcts100");
    const random = resolveNamedAgent<TTTState, TTTMove>("random");
    const report = runMatchup(classicTicTacToe, strong, random, {
      games: 20,
      seed: "runner-test:strong-vs-random",
      clock: fakeClock(),
    });
    const strongWinRate = report.outcomes.filter(
      (o) => o.winnerSeat !== null && o.seatAgent[o.winnerSeat] === "mcts100"
    ).length / report.outcomes.length;
    // Loose bound (not the strict >=90% CI anchor, which lives on a single seat/budget in
    // packages/bots's own MCTS tests) — this is a wiring sanity check, not a re-proof of MCTS
    // strength; it just needs to show the roster-resolved agent is actually searching.
    expect(strongWinRate).toBeGreaterThan(0.7);
  });

  it("throws on games < 1 rather than silently returning an empty/degenerate report", () => {
    expect(() =>
      runMatchup(classicTicTacToe, resolveNamedAgent("random"), resolveNamedAgent("random"), {
        games: 0,
        seed: "runner-test:zero-games",
      })
    ).toThrow(RangeError);
  });
});

describe("runMatchup() determinism (plan §9's TDD anchor)", () => {
  it("fixed seed => byte-identical JSON report across two independent runs", () => {
    const build = () =>
      runMatchup(
        classicTicTacToe,
        resolveNamedAgent<TTTState, TTTMove>("mcts100"),
        resolveNamedAgent<TTTState, TTTMove>("random"),
        {
          games: 12,
          seed: "runner-test:determinism",
          clock: fakeClock(),
        }
      );
    const reportA = build();
    const reportB = build();
    expect(JSON.stringify(reportA)).toBe(JSON.stringify(reportB));
  });
});

describe("runMatchup() on the cyclic corridor fixture (no engine-specific assumptions leak in)", () => {
  it("random-vs-random terminates well under the ply cap despite the graph's cycles", () => {
    const report = runMatchup(corridor, resolveNamedAgent("random"), resolveNamedAgent("random"), {
      games: 15,
      seed: "runner-test:corridor-random",
      maxPlies: 200,
      clock: fakeClock(),
    });
    expect(report.outcomes).toHaveLength(15);
    for (const o of report.outcomes) {
      expect(o.capHit).toBe(false);
      expect(o.winnerSeat).not.toBeNull(); // corridor always ends in a win, never a rules-draw
    }
  });
});

describe("runMatchup() on a simultaneous engine — GameOutcome.moves round-trips through replay() " +
  "(stage-6 MUST FIX: a flat per-actor log couldn't express this; StepRecord[] can)", () => {
  it("every ply's StepRecord carries BOTH seats' moves together (the boundary a flat log had no way to mark)", () => {
    const report = runMatchup(simulDuel, resolveNamedAgent("random"), resolveNamedAgent("random"), {
      games: 8,
      seed: "runner-test:simultaneous-moves-shape",
      maxPlies: 20,
      mirrorSeats: false,
      clock: fakeClock(),
    });
    expect(report.outcomes).toHaveLength(8);
    for (const o of report.outcomes) {
      // simulDuel's active() is ALWAYS simultaneous (both seats act every ply) — one
      // StepRecord per ply, exactly `o.plies` of them, each with exactly 2 [seat, move] pairs.
      expect(o.moves).toHaveLength(o.plies);
      for (const step of o.moves) {
        expect(step.moves).toHaveLength(2);
        const seatsSeen = step.moves.map(([seat]) => seat).sort();
        expect(seatsSeen).toEqual([0, 1]);
      }
    }
  });

  it("a recorded log replays to the SAME terminal status through replay() — the case a flat log couldn't express at all", () => {
    const report = runMatchup(simulDuel, resolveNamedAgent("random"), resolveNamedAgent("random"), {
      games: 8,
      seed: "runner-test:simultaneous-replay",
      maxPlies: 20,
      mirrorSeats: false,
      clock: fakeClock(),
    });
    expect(report.outcomes.length).toBeGreaterThan(0);

    for (const outcome of report.outcomes) {
      const record: ReplayRecord = {
        gameId: simulDuel.meta.id,
        gameVersion: simulDuel.meta.version,
        engineVersion: "test",
        numPlayers: 2,
        seed: outcome.matchSeed,
        steps: [...outcome.moves] as StepRecord[],
      };

      // Must not throw IllegalReplayMoveError — every recorded move must still be legal when
      // replayed from setup() through the SAME rngFor(seed, stepIndex) derivation runner.ts
      // documents as identical to replay.ts's own (this module's doc comment on RNG CONVENTIONS).
      const { states, status } = replay(simulDuel, record);
      expect(states).toHaveLength(outcome.plies + 1); // setup state + one state per ply

      if (outcome.capHit) {
        expect(status.kind).toBe("ongoing"); // adjudicated draw: cap hit before rules resolved it
      } else if (outcome.winnerSeat !== null) {
        expect(status).toEqual({ kind: "won", winner: outcome.winnerSeat });
      } else {
        expect(status.kind).toBe("draw"); // a genuine rules-drawn terminal, never "scored" here
      }
    }
  });
});

describe("runMatchup() refuses hiddenInformation:true games (MUST FIX — correction C1, reproduced live)", () => {
  // The stage-6 review demonstrated this live: a policy that simply reads `state.secret` off
  // the canonical state (never the view) wins the "doors" fixture 10/10, because nothing in
  // runMatchup()/playOneGame() ever refused to hand it that state. On a real hidden-info game
  // this is exactly correction C1's "passing gate on a game unplayable blind" — the number is
  // real, it just means something other than what a reviewer of a green CI gate believes.
  const cheatPolicy: PolicyAgentSpec<DoorsState, DoorsMove> = {
    kind: "policy",
    name: "cheater",
    budget: { kind: "rollouts", n: 1 },
    policy: {
      chooseMove({ state }) {
        // A genuine C1 violation: reads the CANONICAL state's hidden secret directly, never
        // `engine.playerView(state, player)`. If runMatchup ever hands this the real state,
        // seat 0 wins every single game.
        return { move: { open: state.secret }, stats: { elapsedMs: 0 } };
      },
    },
  };

  it("throws HiddenInformationUnsupportedError BEFORE playing a single game against a planted cheater policy", () => {
    // Minor finding 2: this used to be solver/types.ts's UnsupportedGameError, whose message
    // hardwires a "reach/retrograde:" prefix — misleading for a runner-side refusal that has
    // nothing to do with the exact solver. The runner now throws its own error class.
    const random = resolveNamedAgent<DoorsState, DoorsMove>("random");
    expect(() =>
      runMatchup(doors, cheatPolicy, random, {
        games: 10,
        seed: "runner-test:c1-cheater",
        clock: fakeClock(),
      })
    ).toThrow(HiddenInformationUnsupportedError);
  });

  it("refuses regardless of which side of the matchup the hidden-info engine's agents occupy " +
    "(mirror agents get canonical state too — runner.ts's guard must sit before EITHER kind runs)", () => {
    const mirror = mirrorAgent<DoorsState, DoorsMove>((_state, _lastOppMove, legal) => legal[0]!);
    expect(() =>
      runMatchup(doors, mirror, resolveNamedAgent<DoorsState, DoorsMove>("random"), {
        games: 2,
        seed: "runner-test:c1-mirror",
        clock: fakeClock(),
      })
    ).toThrow(HiddenInformationUnsupportedError);
  });
});

describe("mirrorAgent() wiring (mirror is per-game — the runner just has to call the 3-arg shape correctly)", () => {
  it("passes null lastOppMove on the mirror seat's first move, then the tracked opponent move after", () => {
    const seenLastOppMoves: (CorridorMove | null)[] = [];
    // A trivial mirror: record what it was called with, then always play "right" (always legal
    // in corridor except at the terminal, which never reaches chooseMove).
    const mirror = mirrorAgent<CorridorState, CorridorMove>((_state, lastOppMove, legal) => {
      seenLastOppMoves.push(lastOppMove);
      return legal.find((m) => m.dir === "right") ?? legal[0]!;
    });
    const rusher = resolveNamedAgent<CorridorState, CorridorMove>("rush");

    // `mirror` in seat 0 so its OWN first call is genuinely the game's first move — with
    // `mirror` in seat 1 instead, it would only ever be asked after seat 0 has already moved
    // once, so `lastOppMove` would never actually be null (a test bug caught on the first run
    // of this test, not an implementation bug — worth leaving this note since it's the exact
    // kind of "looks right, isn't" mistake this project's standing warning calls out).
    runMatchup(corridor, mirror, rusher, {
      games: 1,
      seed: "runner-test:mirror-wiring",
      clock: fakeClock(),
    });

    expect(seenLastOppMoves.length).toBeGreaterThan(0);
    expect(seenLastOppMoves[0]).toBeNull();
    for (const m of seenLastOppMoves.slice(1)) {
      expect(m).not.toBeNull();
    }
  });

  // C64 finding (docs/plans/degeneracy-probes.md): Fadeout's and Tilt's own mirrorMove
  // (probes.ts) are documented, verbatim, to return `null` when there is no opponent move yet
  // to mirror or the reflected target is no longer legal, with "the harness's mirror-bot policy
  // falls back to a random legal move in either case" — a fallback that was documented in two
  // game packages but never actually implemented here (Nine Grids' own mirrorMove never returns
  // null at all — it falls back INTERNALLY to `legalMoves[0]`, a corrected claim; see
  // roster.ts's MirrorAgentSpec.mirrorMove doc for the full stage-6 note). The only pre-existing
  // exercise of a real mirrorMove (scripts/research/tilt-t4-gates.ts) sits outside
  // scripts/tsconfig.json's own `include`, so this gap was never even typechecked, let alone
  // tested. PLANTED VIOLATION: a mirrorMove that ALWAYS returns null must never crash the
  // engine with an illegal/absent move — the runner must substitute a real legal move every time.
  it("a mirrorMove that ALWAYS returns null never crashes the engine — the runner substitutes a real legal move every ply (the documented, previously-unimplemented 'null -> fallback random' convention)", () => {
    const alwaysNullMirror = mirrorAgent<TTTState, TTTMove>(() => null);
    const opponent = resolveNamedAgent<TTTState, TTTMove>("random");
    // classicTicTacToe.isLegal (called by apply()) would throw on an illegal/absent move — no
    // games completing without throwing IS the assertion; mirrorSeats:false pins the null-mirror
    // to seat 1 (P2) so its very first call also exercises `lastOppMove !== null` (P1 always
    // moves first), covering the "reflected target no longer legal" branch shape too, not just
    // the "nothing to mirror yet" one.
    expect(() =>
      runMatchup(classicTicTacToe, opponent, alwaysNullMirror, {
        games: 20,
        seed: "runner-test:mirror-null-fallback",
        mirrorSeats: false,
      })
    ).not.toThrow();
  });

  it("the null-fallback picks moves that vary run to run (a real uniform-random draw from legalMoves, not a hardcoded pick like 'always legal[0]')", () => {
    const seenFirstMoves = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const alwaysNullMirror = mirrorAgent<TTTState, TTTMove>(() => null);
      const opponent = resolveNamedAgent<TTTState, TTTMove>("random");
      const report = runMatchup(classicTicTacToe, alwaysNullMirror, opponent, {
        games: 1,
        seed: `runner-test:mirror-null-fallback-variety:${i}`,
        mirrorSeats: false,
      });
      const firstMove = report.outcomes[0]!.moves[0]!.moves[0]![1] as TTTMove;
      seenFirstMoves.add(firstMove.cell);
    }
    // 8 independent seeds over 9 cells: a hardcoded "always legal[0]" bug would collapse this to
    // size 1; a real uniform draw makes that astronomically unlikely.
    expect(seenFirstMoves.size).toBeGreaterThan(1);
  });

  // platform-corrections.md C81 / task #26: the null-fallback substitution above was previously
  // invisible to the harness once it happened — nothing counted it. A mirror row scoring "0% win
  // rate" could mean "mirrored and lost every game" or "never mirrored at all, lost to
  // deterministic fallback play," and a report had no way to tell the two apart. `GameOutcome`
  // now records, per game, how many of the mirror seat's own moves were real reflections vs.
  // fallback substitutions, and `computeMatchupMetrics` aggregates that into
  // `MatchupMetrics.mirrorFallbackRate` — the fraction of the mirror agent's own moves this
  // matchup that were fallback, not an actual mirror.
  it("a mirrorMove that ALWAYS returns null: every one of its own moves counts as a fallback substitution (mirrorFallbackRate === 1)", () => {
    const alwaysNullMirror = mirrorAgent<TTTState, TTTMove>(() => null);
    const opponent = resolveNamedAgent<TTTState, TTTMove>("random");
    const report = runMatchup(classicTicTacToe, opponent, alwaysNullMirror, {
      games: 10,
      seed: "runner-test:mirror-fallback-rate-always-null",
      mirrorSeats: false,
    });
    for (const outcome of report.outcomes) {
      expect(outcome.mirrorFallbackCount).toBe(outcome.mirrorMoveCount);
      expect(outcome.mirrorMoveCount).toBeGreaterThan(0);
    }
    expect(report.metrics.mirrorFallbackRate).toBe(1);
  });

  it("a mirrorMove that ALWAYS reflects successfully (never falls back): mirrorFallbackRate === 0", () => {
    // classic-ttt's own point-reflection, always legal on an empty-ish opening (worst case it
    // isn't, but center-first openings on this board always have their reflection free) — using
    // a policy that always finds a legal reflection would be state-dependent to construct exactly,
    // so instead this fakes an agent that reports "no fallback" by mirroring corridor's single-
    // legal-move-per-ply shape, where the reflected target coincides with the only legal move by
    // construction (the fixture's own "always play right" policy, reused as a mirror).
    const alwaysSucceedsMirror = mirrorAgent<CorridorState, CorridorMove>((_state, _lastOppMove, legal) => legal[0]!);
    const rusher = resolveNamedAgent<CorridorState, CorridorMove>("rush");
    const report = runMatchup(corridor, alwaysSucceedsMirror, rusher, {
      games: 5,
      seed: "runner-test:mirror-fallback-rate-always-succeeds",
      mirrorSeats: false,
    });
    for (const outcome of report.outcomes) {
      expect(outcome.mirrorFallbackCount).toBe(0);
      expect(outcome.mirrorMoveCount).toBeGreaterThan(0);
    }
    expect(report.metrics.mirrorFallbackRate).toBe(0);
  });

  it("a matchup with NO mirror agent at all reports mirrorFallbackRate: null (never 0 — 0 would falsely claim perfect mirror content)", () => {
    const random = resolveNamedAgent<TTTState, TTTMove>("random");
    const report = runMatchup(classicTicTacToe, random, resolveNamedAgent<TTTState, TTTMove>("greedy"), {
      games: 5,
      seed: "runner-test:mirror-fallback-rate-no-mirror",
    });
    expect(report.metrics.mirrorFallbackRate).toBeNull();
    for (const outcome of report.outcomes) {
      expect(outcome.mirrorMoveCount).toBe(0);
      expect(outcome.mirrorFallbackCount).toBe(0);
    }
  });
});

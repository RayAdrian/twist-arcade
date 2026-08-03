// packages/harness/test/runner.test.ts — TDD anchor for the 2-player self-play matchup
// executor (plan §7.1's minimal `run`, extended with §7.2's full metric set). Red first:
// runner.ts does not exist yet.

import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { Clock } from "@twist-arcade/bots";
import { corridor, type CorridorMove, type CorridorState } from "./fixtures/corridor";
import { resolveNamedAgent, mirrorAgent } from "../src/roster";
import { runMatchup } from "../src/runner";

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
});

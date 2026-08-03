import { describe, expect, it } from "vitest";
import { proposeRotation, RotationError, type RotationGame, type ScheduledDay } from "../src/rotation";

// Plan §1.2: the rotation generator proposes future days from a deterministic weighted policy —
// Fadeout (flagship) >=1x/week, every launch game >=1x/14 days, no game twice in a row, no two
// solo days in a row, a solo game only ever scheduled where a certificate exists. It is
// deterministic and idempotent over already-committed days: it only ever APPENDS days after the
// end of the existing history, never touches or re-derives a day already committed — that
// property is inherent here (the function's `history` parameter is read-only input, and its
// return value only ever covers the requested future range).

const FADEOUT: RotationGame = { gameId: "fadeout", kind: "vs-bot", role: "flagship" };
const TTT: RotationGame = { gameId: "tic-tac-toe", kind: "vs-bot", role: "regular" };
const CRACKSTEP: RotationGame = { gameId: "crackstep", kind: "solo-puzzle", role: "solo-frequent" };
const MINE_RUN: RotationGame = { gameId: "mine-run", kind: "solo-chase", role: "regular" };

const ALWAYS_CERTIFIED = () => true;
const NEVER_CERTIFIED = () => false;

describe("rotation.ts — proposeRotation()", () => {
  it("is deterministic: two calls with identical inputs produce an identical schedule", () => {
    const games = [FADEOUT, TTT, CRACKSTEP, MINE_RUN];
    const a = proposeRotation("2026-09-01", 20, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    const b = proposeRotation("2026-09-01", 20, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    expect(a).toEqual(b);
  });

  it("never repeats the immediately preceding day's game", () => {
    const games = [FADEOUT, TTT];
    const schedule = proposeRotation("2026-09-01", 30, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.gameId).not.toBe(schedule[i - 1]!.gameId);
    }
  });

  it("never schedules two solo days in a row", () => {
    const games = [FADEOUT, CRACKSTEP, MINE_RUN];
    const schedule = proposeRotation("2026-09-01", 30, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    const soloKinds = new Set(["solo-puzzle", "solo-chase"]);
    for (let i = 1; i < schedule.length; i++) {
      const prevSolo = soloKinds.has(schedule[i - 1]!.kind);
      const curSolo = soloKinds.has(schedule[i]!.kind);
      expect(prevSolo && curSolo).toBe(false);
    }
  });

  it("Fadeout (flagship) appears at least once in every rolling 7-day window", () => {
    const games = [FADEOUT, TTT, CRACKSTEP];
    const schedule = proposeRotation("2026-09-01", 28, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    for (let start = 0; start + 7 <= schedule.length; start++) {
      const window = schedule.slice(start, start + 7);
      expect(window.some((d) => d.gameId === "fadeout")).toBe(true);
    }
  });

  it("every registered game appears at least once in every rolling 14-day window", () => {
    const games = [FADEOUT, TTT, CRACKSTEP, MINE_RUN];
    const schedule = proposeRotation("2026-09-01", 40, [], { games, hasCertificate: ALWAYS_CERTIFIED });
    for (let start = 0; start + 14 <= schedule.length; start++) {
      const window = schedule.slice(start, start + 14);
      for (const g of games) {
        expect(window.some((d) => d.gameId === g.gameId)).toBe(true);
      }
    }
  });

  it("never schedules a solo game on a day with no certificate — falls through to another eligible game", () => {
    const games = [FADEOUT, TTT, CRACKSTEP];
    const schedule = proposeRotation("2026-09-01", 14, [], { games, hasCertificate: NEVER_CERTIFIED });
    expect(schedule.some((d) => d.gameId === "crackstep")).toBe(false);
    // Coverage is honestly unmet for the uncertified solo game — proposeRotation does not lie
    // about it by scheduling anyway; that is the whole point of the certificate gate.
  });

  it("continues correctly from existing history — idempotent: it never re-emits a day already committed", () => {
    const games = [FADEOUT, TTT];
    const history: ScheduledDay[] = [
      { day: "2026-08-30", gameId: "fadeout", kind: "vs-bot" },
      { day: "2026-08-31", gameId: "tic-tac-toe", kind: "vs-bot" },
    ];
    const schedule = proposeRotation("2026-09-01", 5, history, { games, hasCertificate: ALWAYS_CERTIFIED });
    expect(schedule).toHaveLength(5);
    expect(schedule.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    // The day right after history's last day-off-Fadeout is still respected: yesterday
    // (2026-08-31) was tic-tac-toe, so today must not also be tic-tac-toe.
    expect(schedule[0]!.gameId).not.toBe("tic-tac-toe");
  });

  it("does NOT treat history's last game as 'yesterday' when startDay isn't literally the day after it — a gap breaks adjacency", () => {
    // history's last entry is 2026-09-05 (fadeout); starting the proposal at 2026-10-01 (a
    // large gap) must NOT forbid fadeout on 2026-10-01 — "no repeat yesterday's game" is about
    // literal calendar adjacency, not "whatever was scheduled most recently regardless of when."
    // With only fadeout eligible in a single-vs-bot-game roster, this would otherwise throw
    // RotationError even though nothing about 2026-10-01 is actually constrained.
    const history: ScheduledDay[] = [{ day: "2026-09-05", gameId: "fadeout", kind: "vs-bot" }];
    const schedule = proposeRotation("2026-10-01", 1, history, { games: [FADEOUT], hasCertificate: ALWAYS_CERTIFIED });
    expect(schedule).toEqual([{ day: "2026-10-01", gameId: "fadeout", kind: "vs-bot" }]);
  });

  it("STILL forbids a repeat when history's last day truly IS the day before startDay", () => {
    const history: ScheduledDay[] = [{ day: "2026-09-30", gameId: "fadeout", kind: "vs-bot" }];
    const games = [FADEOUT, TTT];
    const schedule = proposeRotation("2026-10-01", 1, history, { games, hasCertificate: ALWAYS_CERTIFIED });
    expect(schedule[0]!.gameId).not.toBe("fadeout");
  });

  it("throws RotationError rather than silently violating a constraint when no eligible game exists for a day", () => {
    // A single solo-only roster with no certificates leaves NOTHING eligible, ever.
    const games = [CRACKSTEP];
    expect(() => proposeRotation("2026-09-01", 1, [], { games, hasCertificate: NEVER_CERTIFIED })).toThrow(RotationError);
  });
});

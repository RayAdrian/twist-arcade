import { describe, expect, it } from "vitest";
import type { GameManifest } from "@twist-arcade/game-spec";
import { pickNextTwist } from "../src/next-twist";

function manifest(partial: Partial<GameManifest> & { id: string }): GameManifest {
  return {
    title: partial.id,
    classic: "Tic-Tac-Toe",
    ruleSentence: "x",
    tags: [],
    estMinutes: 3,
    modes: { bot: true, hotseat: true, asyncLink: false },
    players: { min: 1, max: 2 },
    difficultyTiers: [],
    ...partial,
  };
}

describe("pickNextTwist — §8.3, the end-screen loop", () => {
  it("returns null at registry-size-1 (no other game exists)", () => {
    const only = manifest({ id: "fadeout" });
    expect(pickNextTwist("fadeout", [only])).toBeNull();
  });

  it("prefers the same classic over anything else", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe" });
    const sameClassic = manifest({ id: "gravity-ttt", classic: "Tic-Tac-Toe" });
    const otherClassic = manifest({ id: "crackstep", classic: "Minesweeper" });
    const result = pickNextTwist("fadeout", [current, sameClassic, otherClassic]);
    expect(result?.id).toBe("gravity-ttt");
  });

  it("falls back to a shared mechanic tag when no same-classic game exists", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe", tags: ["decay"] });
    const sharedTag = manifest({ id: "mine-run", classic: "Minesweeper", tags: ["decay", "press-your-luck"] });
    const noOverlap = manifest({ id: "crackstep", classic: "Minesweeper", tags: ["puzzle"] });
    const result = pickNextTwist("fadeout", [current, sharedTag, noOverlap]);
    expect(result?.id).toBe("mine-run");
  });

  it("falls back to ANY other game when neither classic nor tag overlaps", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe", tags: ["decay"] });
    const unrelated = manifest({ id: "crackstep", classic: "Minesweeper", tags: ["puzzle"] });
    const result = pickNextTwist("fadeout", [current, unrelated]);
    expect(result?.id).toBe("crackstep");
  });

  it("no-repeat: excludes the immediately-previously-suggested id when an alternative exists", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe" });
    const a = manifest({ id: "gravity-ttt", classic: "Tic-Tac-Toe" });
    const b = manifest({ id: "blind-ttt", classic: "Tic-Tac-Toe" });
    // Without the no-repeat guard, alphabetical tie-break would pick "blind-ttt" both times.
    const result = pickNextTwist("fadeout", [current, a, b], "blind-ttt");
    expect(result?.id).toBe("gravity-ttt");
  });

  it("no-repeat is relaxed when the excluded id is the ONLY other game (never returns null when a real choice exists)", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe" });
    const onlyOther = manifest({ id: "gravity-ttt", classic: "Tic-Tac-Toe" });
    const result = pickNextTwist("fadeout", [current, onlyOther], "gravity-ttt");
    expect(result?.id).toBe("gravity-ttt");
  });

  it("deterministic tie-break by id when rank is equal", () => {
    const current = manifest({ id: "fadeout", classic: "Tic-Tac-Toe" });
    const z = manifest({ id: "z-game", classic: "Tic-Tac-Toe" });
    const a = manifest({ id: "a-game", classic: "Tic-Tac-Toe" });
    const result = pickNextTwist("fadeout", [current, z, a]);
    expect(result?.id).toBe("a-game");
  });

  it("is a pure function: same inputs always produce the same output", () => {
    const manifests = [
      manifest({ id: "fadeout", classic: "Tic-Tac-Toe" }),
      manifest({ id: "gravity-ttt", classic: "Tic-Tac-Toe" }),
    ];
    const r1 = pickNextTwist("fadeout", manifests);
    const r2 = pickNextTwist("fadeout", manifests);
    expect(r1).toEqual(r2);
  });
});

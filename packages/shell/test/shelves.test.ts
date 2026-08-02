import { describe, expect, it } from "vitest";
import type { GameManifest } from "@twist-arcade/game-spec";
import { buildShelves } from "../src/shelves";

function manifest(id: string, classic: string): GameManifest {
  return {
    id,
    title: id,
    classic,
    ruleSentence: "x",
    tags: [],
    estMinutes: 3,
    modes: { bot: true, hotseat: true, asyncLink: false },
    players: { min: 1, max: 2 },
    difficultyTiers: [],
  };
}

describe("buildShelves — plan §8.2, scales 6 -> 40+ without rewrite", () => {
  it("1 game: no named shelf (needs >=2 for a classic family); it lands in 'All games'", () => {
    const manifests = [manifest("fadeout", "Tic-Tac-Toe")];
    const shelves = buildShelves(manifests);
    expect(shelves).toHaveLength(1);
    expect(shelves[0]!.title).toBe("All games");
    expect(shelves[0]!.games.map((g) => g.id)).toEqual(["fadeout"]);
  });

  it("6 games, one classic with 2 twists: exactly one named shelf + remainder in All games", () => {
    const manifests = [
      manifest("fadeout", "Tic-Tac-Toe"),
      manifest("gravity-ttt", "Tic-Tac-Toe"),
      manifest("crackstep", "Minesweeper"),
      manifest("mine-run", "Minesweeper Chase"),
      manifest("hangman-twist", "Hangman"),
      manifest("connect-twist", "Connect Four"),
    ];
    const shelves = buildShelves(manifests);
    const named = shelves.filter((s) => s.classic === "Tic-Tac-Toe");
    expect(named).toHaveLength(1);
    expect(named[0]!.title).toBe("Twists on Tic-Tac-Toe");
    expect(named[0]!.games.map((g) => g.id)).toEqual(["fadeout", "gravity-ttt"]);

    const allGames = shelves.find((s) => s.title === "All games");
    expect(allGames?.games.map((g) => g.id).sort()).toEqual(
      ["crackstep", "mine-run", "hangman-twist", "connect-twist"].sort()
    );
  });

  it("every game appears in exactly one shelf, at any scale (15-manifest fixture)", () => {
    const manifests: GameManifest[] = [];
    for (let i = 0; i < 15; i++) {
      // 3 classics with 3 games each (9), remaining 6 are singleton classics.
      const classic = i < 9 ? `Classic-${Math.floor(i / 3)}` : `Singleton-${i}`;
      manifests.push(manifest(`game-${i}`, classic));
    }
    const shelves = buildShelves(manifests);
    const allIds = shelves.flatMap((s) => s.games.map((g) => g.id));
    expect(allIds.sort()).toEqual(manifests.map((m) => m.id).sort());
    expect(new Set(allIds).size).toBe(manifests.length); // no duplicates
  });

  it("a classic-family shelf caps at 8 games and sets hasMore (40-manifest fixture)", () => {
    const manifests: GameManifest[] = [];
    for (let i = 0; i < 10; i++) manifests.push(manifest(`ttt-${i}`, "Tic-Tac-Toe"));
    for (let i = 0; i < 30; i++) manifests.push(manifest(`solo-${i}`, `Solo-${i}`));
    const shelves = buildShelves(manifests);
    const tttShelf = shelves.find((s) => s.classic === "Tic-Tac-Toe")!;
    expect(tttShelf.games).toHaveLength(8);
    expect(tttShelf.hasMore).toBe(true);
  });

  it("a classic with exactly 2 games does NOT set hasMore", () => {
    const manifests = [manifest("a", "X"), manifest("b", "X")];
    const shelves = buildShelves(manifests);
    expect(shelves[0]!.hasMore).toBe(false);
  });

  it("shelf order is stable/deterministic across calls with the same input", () => {
    const manifests = [
      manifest("a", "X"),
      manifest("b", "X"),
      manifest("c", "Y"),
      manifest("d", "Z"),
    ];
    const s1 = buildShelves(manifests);
    const s2 = buildShelves(manifests);
    expect(s1.map((s) => s.title)).toEqual(s2.map((s) => s.title));
  });

  it("an empty manifest list produces no shelves", () => {
    expect(buildShelves([])).toEqual([]);
  });
});

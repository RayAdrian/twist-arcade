// @vitest-environment jsdom
//
// games/crackstep/ui/SidePanel.test.tsx — TDD for the "Floor left" progress readout + material
// legend (design 2a's Crackstep desktop panel). Rendered via GamePresentation.extraControls
// (packages/game-spec/src/presentation.ts's existing, previously-unused-by-Crackstep sibling
// slot) — a game-owned control block next to the board, never inside the board grid itself.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CrackstepState, TileKind } from "../engine";
import { SidePanel } from "./SidePanel";

afterEach(() => cleanup());

// 0 1 2      1 = stone hub; 3, 5 are holes; start at 4, unvisited elsewhere.
// 3 4 5
const TILES: TileKind[] = ["crumble", "stone", "crumble", "hole", "crumble", "hole"];

function view(overrides: Partial<CrackstepState> = {}): CrackstepState {
  const visited = Array(6).fill(false);
  visited[4] = true;
  return {
    width: 3,
    height: 2,
    tiles: TILES,
    crumbled: Array(6).fill(false),
    visited,
    pos: 4,
    lastEffects: [],
    ...overrides,
  };
}

function renderPanel(v: CrackstepState) {
  return render(<SidePanel view={v} legal={[]} onMove={() => {}} seat={0} prefs={{ reducedMotion: false, theme: "light" }} />);
}

describe("SidePanel — Floor left readout", () => {
  it("shows the count of tiles still remaining (walkable, not yet visited)", () => {
    // 4 walkable cells (0,1,2,4); cell 4 (start) is already visited -> 3 remaining.
    renderPanel(view());
    expect(screen.getByText("Floor left")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("updates as more tiles are visited", () => {
    const visited = Array(6).fill(false);
    visited[4] = true;
    visited[1] = true;
    renderPanel(view({ visited }));
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("SidePanel — material legend", () => {
  it("names all four tile materials and their fates", () => {
    renderPanel(view());
    expect(screen.getByText(/wood/i)).toBeInTheDocument();
    expect(screen.getByText(/crumbles when you leave/i)).toBeInTheDocument();
    expect(screen.getByText(/stone/i)).toBeInTheDocument();
    expect(screen.getByText(/holds forever/i)).toBeInTheDocument();
    expect(screen.getByText(/rubble/i)).toBeInTheDocument();
    expect(screen.getByText(/gone for good/i)).toBeInTheDocument();
    expect(screen.getByText(/hole/i)).toBeInTheDocument();
    expect(screen.getByText(/never was floor/i)).toBeInTheDocument();
  });
});

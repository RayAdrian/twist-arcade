// @vitest-environment jsdom
//
// games/tilt/ui/Telegraph.test.tsx — TDD for the static tilt telegraph (plan §6.1/§6.2):
// visible from ply 1, steps at each turn advance, same counting source as announce()'s
// proximity phrase (board-view.test.ts already covers that shared source directly).

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Rng } from "@twist-arcade/engine";
import { TILT_PERIOD, tilt, toMoveOf, type TiltMove, type TiltState } from "../engine";
import { Telegraph } from "./Telegraph";

afterEach(() => cleanup());

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function play(moves: TiltMove[]): TiltState {
  let state = tilt.setup(2, NO_OP_RNG);
  for (const move of moves) {
    const mover = toMoveOf(state.grid);
    state = tilt.apply(state, new Map([[mover, move]]), NO_OP_RNG);
  }
  return state;
}

function renderTelegraph(view: TiltState) {
  const seat = toMoveOf(view.grid);
  return render(
    <Telegraph
      view={view}
      legal={tilt.legalMoves(view, seat)}
      onMove={() => {}}
      seat={seat}
      prefs={{ reducedMotion: false, theme: "light" }}
    />
  );
}

describe("Telegraph — visible from ply 1, static (plan §6.1)", () => {
  it("shows the full tiltPeriod countdown on the opening position", () => {
    renderTelegraph(play([]));
    expect(screen.getByTestId("tilt-countdown-value")).toHaveTextContent(String(TILT_PERIOD));
  });

  it("counts down as plies are played", () => {
    renderTelegraph(play([{ column: 0 }]));
    expect(screen.getByTestId("tilt-countdown-value")).toHaveTextContent(String(TILT_PERIOD - 1));
  });

  it("resets to the full period immediately after a tilt fires", () => {
    // 4 plies with tiltPeriod=4 fires the tilt on the 4th.
    const moves: TiltMove[] = Array.from({ length: TILT_PERIOD }, (_, i) => ({ column: i % 2 === 0 ? 0 : 1 }));
    renderTelegraph(play(moves));
    expect(screen.getByTestId("tilt-countdown-value")).toHaveTextContent(String(TILT_PERIOD));
  });

  it("always names the direction marker (grayscale-safe: text, not color)", () => {
    renderTelegraph(play([]));
    expect(screen.getByTestId("tilt-floor-marker")).toHaveTextContent(/right/i);
  });

  it("is aria-hidden (the same information is already in announce()'s live-region text)", () => {
    renderTelegraph(play([]));
    expect(screen.getByTestId("tilt-telegraph")).toHaveAttribute("aria-hidden", "true");
  });
});

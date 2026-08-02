import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ScoreHUD } from "../src/components/ScoreHUD";

// plan §7.1: the HUD two-player games don't have; replaces TurnIndicator in solo mode.
// Daily puzzle: "moves 12 · par 19". Score chase: "score 340" (+ "84 / 250 moves" if a
// budget exists). Numbers are ALWAYS present as static text (the count-up transition is a
// pure visual enhancement — reduced motion must lose nothing).

describe("ScoreHUD", () => {
  it("daily puzzle framing: 'moves N · par P'", () => {
    render(<ScoreHUD movesUsed={12} par={19} />);
    expect(screen.getByText("moves 12 · par 19")).toBeInTheDocument();
  });

  it("score chase with a move budget: 'score S · used / budget moves'", () => {
    render(<ScoreHUD movesUsed={84} score={340} moveBudget={250} />);
    expect(screen.getByText("score 340 · 84 / 250 moves")).toBeInTheDocument();
  });

  it("score chase with NO budget: just 'score S'", () => {
    render(<ScoreHUD movesUsed={84} score={340} />);
    expect(screen.getByText("score 340")).toBeInTheDocument();
  });

  it("plain moves-only fallback when neither par nor score is given", () => {
    render(<ScoreHUD movesUsed={5} />);
    expect(screen.getByText("5 moves")).toBeInTheDocument();
  });

  it("appends a banked line when banked is provided", () => {
    render(<ScoreHUD movesUsed={5} score={100} banked={40} />);
    expect(screen.getByText(/banked 40/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ScoreHUD movesUsed={12} par={19} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

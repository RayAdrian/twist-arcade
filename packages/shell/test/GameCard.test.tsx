import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { GameManifest } from "@twist-arcade/game-spec";
import { GameCard } from "../src/components/GameCard";

// plan §4.13 / ux-lens §4: fixed anatomy — glyph, twist title, "a twist on {classic}", the
// SAME canonical rule sentence, chips (tags + ~length), whole card is the link. Text-first
// by design (thumbnails don't differentiate these games — the twist is verbal).

const manifest: GameManifest = {
  id: "fadeout",
  title: "Fadeout Tic-Tac-Toe",
  classic: "Tic-Tac-Toe",
  ruleSentence: "Classic tic-tac-toe, but pieces vanish after 3 turns.",
  tags: ["decay"],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false },
  players: { min: 1, max: 2 },
  difficultyTiers: [],
};

describe("GameCard", () => {
  it("renders the title, classic attribution, rule sentence, and length chip", () => {
    render(<GameCard manifest={manifest} />);
    expect(screen.getByText("Fadeout Tic-Tac-Toe")).toBeInTheDocument();
    expect(screen.getByText(/a twist on Tic-Tac-Toe/i)).toBeInTheDocument();
    expect(screen.getByText(manifest.ruleSentence)).toBeInTheDocument();
    expect(screen.getByText("~3 min")).toBeInTheDocument();
    expect(screen.getByText("decay")).toBeInTheDocument();
  });

  it("the whole card is a single link to /play/{id}", () => {
    render(<GameCard manifest={manifest} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/play/fadeout");
    // The title text lives INSIDE the link, not as a separate sibling heading with its own
    // (redundant) link — "whole card is the play affordance" (ux-lens §4).
    expect(link).toHaveTextContent("Fadeout Tic-Tac-Toe");
  });

  it("has no axe violations", async () => {
    const { container } = render(<GameCard manifest={manifest} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

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

  // Regression (orchestrator review of design 1b): Crackstep has no classic-game ancestor to
  // attribute — an original design, not a twist on anything. Prefixing "a twist on " onto a
  // placeholder string used to render garbled copy on the card. platform-corrections.md C77
  // item 4 / task #23 replaced that string-sentinel convention with a real
  // `classic: string | null` type — Crackstep's real manifest (games/crackstep/manifest.ts) now
  // sets `classic: null`, so this test exercises `null` directly rather than an "N/A"-shaped
  // string. The pinned behavior is unchanged: Crackstep shows no attribution line at all.
  it("omits the attribution line when classic is null (e.g. Crackstep, no classic-game ancestor)", () => {
    const soloPuzzle: GameManifest = {
      ...manifest,
      id: "crackstep",
      title: "Crackstep",
      classic: null,
    };
    render(<GameCard manifest={soloPuzzle} />);
    expect(screen.queryByText(/a twist on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  });
});

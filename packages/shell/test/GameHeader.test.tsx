import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { GameHeader } from "../src/components/GameHeader";

// Design 2a ("Play, result, how-to, loading — same anatomy, zine material"): every game
// screen shares one header anatomy — a "◂ Library" link back to "/", the game title, and a
// trailing chip (either a "daily N" badge for a certified daily puzzle, or a "◌ {tag}" facet
// chip otherwise). Chrome-only; never renders canonical game state.

describe("GameHeader", () => {
  it("renders a Library link back to the site root", () => {
    render(<GameHeader title="Fadeout" accent="p1" />);
    const link = screen.getByRole("link", { name: /library/i });
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders the game title as a heading", () => {
    render(<GameHeader title="Fadeout" accent="p1" />);
    expect(screen.getByRole("heading", { name: "Fadeout" })).toBeInTheDocument();
  });

  it("renders the trailing chip text when given", () => {
    render(<GameHeader title="Fadeout" accent="p1" chip="◌ decay" />);
    expect(screen.getByText("◌ decay")).toBeInTheDocument();
  });

  it("renders no chip at all when chip is omitted", () => {
    render(<GameHeader title="Fadeout" accent="p1" />);
    expect(screen.queryByText(/◌/)).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<GameHeader title="Crackstep" accent="p2" chip="daily 41" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { CountdownBadge } from "../src/components/CountdownBadge";

// plan §4.6: >=16px circle, bold numeral, 4.5:1 in both themes; the AUTHORITATIVE imminence
// encoding (opacity suggests, the number states). Scoping to <=2 turns is the GAME's job, not
// a shell clamp (thresholds vary per game) — CountdownBadge just renders whatever value it's
// given.

describe("CountdownBadge", () => {
  it("renders the numeral", () => {
    render(<CountdownBadge value={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("is aria-hidden — the authoritative text already lives in the cell's accessibleName, so this is a redundant visual channel, not a second live announcement", () => {
    const { container } = render(<CountdownBadge value={1} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<CountdownBadge value={1} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

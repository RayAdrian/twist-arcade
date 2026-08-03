import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { BoardShell } from "../src/components/BoardShell";
import { Cell } from "../src/components/Cell";
import { CalloutLayer } from "../src/components/CalloutLayer";

// plan §4.15 / §6.3: the first-occurrence teaching callout. Anchored non-modal popover
// (shadcn Popover primitives, no focus trap, no scrim, role="status"), positioned at the
// cell the game names via BoardContext's registry. Degrades to the board's top edge
// (never throws) when the named cellId is unregistered. Never blocks input — it must not
// steal focus, and it renders nothing at all when there is no pending first-occurrence.

function Board({ overlay, firstOccurrence }: { overlay?: React.ReactNode; firstOccurrence?: null }) {
  void firstOccurrence;
  return (
    <BoardShell rows={1} cols={2} disabled={false} onCellAction={() => {}} boardLabel="Test board" overlay={overlay}>
      <Cell id="a" row={0} col={0} accessibleName="Row 1, column 1. Empty." />
      <Cell id="b" row={0} col={1} accessibleName="Row 1, column 2. Empty." />
    </BoardShell>
  );
}

describe("CalloutLayer", () => {
  it("renders nothing when firstOccurrence is null", () => {
    render(<Board overlay={<CalloutLayer firstOccurrence={null} />} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the callout text anchored to a registered cell", () => {
    render(<Board overlay={<CalloutLayer firstOccurrence={{ text: "Your X faded — pieces last 3 turns.", anchor: "a" }} />} />);
    expect(screen.getByRole("status")).toHaveTextContent("Your X faded — pieces last 3 turns.");
  });

  it("degrades to the board's top edge (still renders, never throws) when the anchor cellId is unregistered", () => {
    expect(() =>
      render(<Board overlay={<CalloutLayer firstOccurrence={{ text: "Fallback text", anchor: "does-not-exist" }} />} />)
    ).not.toThrow();
    expect(screen.getByRole("status")).toHaveTextContent("Fallback text");
  });

  it("degrades to the board's top edge when the anchor is not a cellId string at all", () => {
    render(<Board overlay={<CalloutLayer firstOccurrence={{ text: "Non-string anchor", anchor: 42 }} />} />);
    expect(screen.getByRole("status")).toHaveTextContent("Non-string anchor");
  });

  it("never steals focus (document.activeElement is unaffected by mount)", () => {
    document.body.focus();
    render(<Board overlay={<CalloutLayer firstOccurrence={{ text: "x", anchor: "a" }} />} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("has no axe violations when showing a callout", async () => {
    const { container } = render(
      <Board overlay={<CalloutLayer firstOccurrence={{ text: "Your X faded — pieces last 3 turns.", anchor: "a" }} />} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

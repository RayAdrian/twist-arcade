import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { RuleCard } from "../src/components/RuleCard";

// plan §4.2: single line, always visible, the only paragraph on the screen. Dev-mode
// assertion: sentence <=90 chars — WARN loudly, never crash (manifest contract).

describe("RuleCard", () => {
  it("renders the sentence", () => {
    render(<RuleCard sentence="Classic tic-tac-toe, but pieces vanish after 3 turns." onHow={() => {}} />);
    expect(screen.getByText("Classic tic-tac-toe, but pieces vanish after 3 turns.")).toBeInTheDocument();
  });

  it("calls onHow when the 'How?' trigger is activated", async () => {
    const onHow = vi.fn();
    render(<RuleCard sentence="x" onHow={onHow} />);
    await userEvent.click(screen.getByRole("button", { name: /how/i }));
    expect(onHow).toHaveBeenCalledTimes(1);
  });

  it("warns (console.error) but does NOT throw when the sentence exceeds 90 chars", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const long = "x".repeat(91);
    expect(() => render(<RuleCard sentence={long} onHow={() => {}} />)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does NOT warn for a sentence at or under 90 chars", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RuleCard sentence={"x".repeat(90)} onHow={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("has no axe violations", async () => {
    const { container } = render(<RuleCard sentence="x" onHow={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

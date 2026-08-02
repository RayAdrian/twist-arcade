import { describe, expect, it } from "vitest";
import type { Effect } from "@twist-arcade/engine";
import { composeAnnouncement, isDecayClassEffects, shellTurnPhrase } from "../src/announcer";

// The critical spec (ux-lens §8, plan §6.2): after every applied step, compose ONE
// sentence-sequence for the polite region, in fixed order: what happened -> what's
// imminent -> whose turn. The turn phrase is SHELL-owned; games never write it.

describe("shellTurnPhrase — shell-owned, games never write it", () => {
  it("your-turn -> 'Your move.'", () => {
    expect(shellTurnPhrase({ phase: "your-turn" })).toBe("Your move.");
  });

  it("their-turn -> \"{actor}'s move.\"", () => {
    expect(shellTurnPhrase({ phase: "their-turn", actorLabel: "Sam" })).toBe("Sam's move.");
  });

  it("handoff -> 'Pass the device to {actor}.'", () => {
    expect(shellTurnPhrase({ phase: "handoff", actorLabel: "Sam" })).toBe("Pass the device to Sam.");
  });

  it("bot-thinking -> 'Bot is thinking…'", () => {
    expect(shellTurnPhrase({ phase: "bot-thinking" })).toBe("Bot is thinking…");
  });

  it("finished -> '' (result carried by the assertive region, not the turn phrase)", () => {
    expect(shellTurnPhrase({ phase: "finished" })).toBe("");
  });
});

describe("isDecayClassEffects — gates full-board readback (verbosity is its own a11y failure)", () => {
  it("true when lastEffects contains decayed, crumbled, or removed", () => {
    expect(isDecayClassEffects([{ type: "decayed" }])).toBe(true);
    expect(isDecayClassEffects([{ type: "crumbled" }])).toBe(true);
    expect(isDecayClassEffects([{ type: "removed" }])).toBe(true);
  });

  it("false for placed/moved/captured/banked/revealed/rotated and empty", () => {
    const nonDecay: Effect[] = [{ type: "placed" }, { type: "moved" }, { type: "banked" }];
    expect(isDecayClassEffects(nonDecay)).toBe(false);
    expect(isDecayClassEffects([])).toBe(false);
  });

  it("true if even ONE effect in a mixed batch is decay-class", () => {
    expect(isDecayClassEffects([{ type: "placed" }, { type: "decayed" }])).toBe(true);
  });
});

describe("composeAnnouncement — fixed order: happened -> imminent -> boardSummary -> turn", () => {
  it("composes all four fragments in order, single-spaced", () => {
    const result = composeAnnouncement({
      moved: "Bot placed O, middle center.",
      imminent: "Your X at top left fades next turn.",
      boardSummary: "Board is now: X middle center, O middle right.",
      turnPhrase: "Your move.",
    });
    expect(result).toBe(
      "Bot placed O, middle center. Your X at top left fades next turn. Board is now: X middle center, O middle right. Your move."
    );
  });

  it("elides an empty imminent fragment cleanly (no double space, no stray leading space)", () => {
    const result = composeAnnouncement({
      moved: "Bot placed O, middle center.",
      imminent: "",
      turnPhrase: "Your move.",
    });
    expect(result).toBe("Bot placed O, middle center. Your move.");
  });

  it("omits boardSummary entirely when not provided (non-decay events)", () => {
    const result = composeAnnouncement({
      moved: "You placed X, top left.",
      imminent: "",
      turnPhrase: "Bot is thinking…",
    });
    expect(result).toBe("You placed X, top left. Bot is thinking…");
  });

  it("omits an empty turnPhrase too (e.g. the finished phase)", () => {
    const result = composeAnnouncement({ moved: "You won.", turnPhrase: "" });
    expect(result).toBe("You won.");
  });

  it("never produces double spaces or trailing/leading whitespace from any combination", () => {
    const result = composeAnnouncement({ moved: "", imminent: "", boardSummary: "", turnPhrase: "" });
    expect(result).toBe("");
  });
});

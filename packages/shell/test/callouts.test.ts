import { beforeEach, describe, expect, it } from "vitest";
import {
  hasPlayedFirstGame,
  hasShownCallout,
  markCalloutShown,
  markFirstGamePlayed,
} from "../src/callouts";

// The `ta:firsts:{gameId}` record is SHARED by two independent mechanisms (plan §5.2.8,
// §5.2.10, §5.6) — the first-occurrence callout flags and the first-game bot-softening flag
// — read via one storage read. Since platform-corrections.md made `firstOccurrence` an
// ARRAY (a game may have more than one teachable "first"), the callout side must track
// per-`flagKey` shown state, not a single boolean.

describe("callouts.ts — per-flagKey first-occurrence + first-game-played flags", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a flagKey has not been shown until marked", () => {
    expect(hasShownCallout("fadeout", "first-fade")).toBe(false);
    markCalloutShown("fadeout", "first-fade");
    expect(hasShownCallout("fadeout", "first-fade")).toBe(true);
  });

  it("two distinct flagKeys for the same game are independent (array firstOccurrence)", () => {
    markCalloutShown("crackstep", "first-crumble");
    expect(hasShownCallout("crackstep", "first-crumble")).toBe(true);
    expect(hasShownCallout("crackstep", "first-stone-survival")).toBe(false);
  });

  it("flagKeys are namespaced per game", () => {
    markCalloutShown("fadeout", "first-fade");
    expect(hasShownCallout("crackstep", "first-fade")).toBe(false);
  });

  it("firstGamePlayed starts unset and can be marked independently of callout flags", () => {
    expect(hasPlayedFirstGame("fadeout")).toBe(false);
    markCalloutShown("fadeout", "first-fade");
    expect(hasPlayedFirstGame("fadeout")).toBe(false); // sharing storage, not sharing meaning
    markFirstGamePlayed("fadeout");
    expect(hasPlayedFirstGame("fadeout")).toBe(true);
    expect(hasShownCallout("fadeout", "first-fade")).toBe(true); // unaffected
  });

  it("survives corrupt storage by treating everything as unshown (never throws)", () => {
    window.localStorage.setItem("ta:firsts:fadeout", "{not json");
    expect(() => hasShownCallout("fadeout", "first-fade")).not.toThrow();
    expect(hasShownCallout("fadeout", "first-fade")).toBe(false);
  });
});

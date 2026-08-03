// games/fadeout/manifest.test.ts

import { describe, expect, it } from "vitest";
import { fadeoutManifestDraft, RULE_SENTENCE } from "./manifest";
import { createFadeoutEngine } from "./engine";

describe("fadeout manifest draft", () => {
  it("rule sentence is <=90 chars and matches the canonical wording", () => {
    expect(RULE_SENTENCE.length).toBeLessThanOrEqual(90);
    expect(RULE_SENTENCE).toBe("Your pieces vanish 3 turns after you place them.");
  });

  it("id matches engine.meta.id for every ruleset config (contract test will assert this once wired)", () => {
    const engine = createFadeoutEngine({ decayTiming: "place-first", playThrough: false, repetition: "superko" });
    expect(fadeoutManifestDraft.id).toBe(engine.meta.id);
  });

  it("players min/max are 2/2 (matches engine.meta)", () => {
    expect(fadeoutManifestDraft.players).toEqual({ min: 2, max: 2 });
  });

  it("every difficulty tier uses a deterministic `rollouts` budget (never deadlineMs, plan §6/§9)", () => {
    for (const tier of fadeoutManifestDraft.difficultyTiers) {
      expect(tier.budget.kind).toBe("rollouts");
    }
  });

  it("tiers are ordered casual < standard < ruthless by rollout budget", () => {
    const rollouts = fadeoutManifestDraft.difficultyTiers.map((t) =>
      t.budget.kind === "rollouts" ? t.budget.n : -1
    );
    expect(rollouts).toEqual([...rollouts].sort((a, b) => a - b));
  });

  it("solo is undefined (Fadeout is a 2-player game, not a solo puzzle/chase)", () => {
    expect(fadeoutManifestDraft.solo).toBeUndefined();
  });
});

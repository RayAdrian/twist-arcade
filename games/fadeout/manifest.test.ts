// games/fadeout/manifest.test.ts

import { describe, expect, it } from "vitest";
import { FADEOUT_RULESET_CONFIG, fadeoutManifest, RULE_SENTENCE } from "./manifest";
import { createFadeoutEngine } from "./engine";

describe("fadeout manifest (frozen for registration)", () => {
  it("rule sentence is <=90 chars and matches the canonical wording", () => {
    expect(RULE_SENTENCE.length).toBeLessThanOrEqual(90);
    expect(RULE_SENTENCE).toBe("Your pieces vanish 3 turns after you place them.");
  });

  it("id matches engine.meta.id for the frozen config", () => {
    const engine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);
    expect(fadeoutManifest.id).toBe(engine.meta.id);
  });

  it("players min/max are 2/2 (matches engine.meta)", () => {
    expect(fadeoutManifest.players).toEqual({ min: 2, max: 2 });
  });

  it("every difficulty tier uses a deterministic `rollouts` budget (never deadlineMs, plan §6/§9)", () => {
    for (const tier of fadeoutManifest.difficultyTiers) {
      expect(tier.budget.kind).toBe("rollouts");
    }
  });

  it("tiers are ordered casual < standard < ruthless by rollout budget", () => {
    const rollouts = fadeoutManifest.difficultyTiers.map((t) => (t.budget.kind === "rollouts" ? t.budget.n : -1));
    expect(rollouts).toEqual([...rollouts].sort((a, b) => a - b));
  });

  it("solo is undefined (Fadeout is a 2-player game, not a solo puzzle/chase)", () => {
    expect(fadeoutManifest.solo).toBeUndefined();
  });

  it("the frozen config is remove-first/solid/threefold — the proven-exact draw variant (solve report §1.1/§3.1)", () => {
    expect(FADEOUT_RULESET_CONFIG).toEqual({
      decayTiming: "remove-first",
      playThrough: false,
      repetition: "threefold",
    });
  });

  it("carries no manifest exceptions — criteria 1/2 are satisfied on proven evidence, not a criterion-5 escalation", () => {
    expect(fadeoutManifest.exceptions).toBeUndefined();
  });
});

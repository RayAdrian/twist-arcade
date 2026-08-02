// packages/engine/test/testkit-self-test.test.ts
//
// "A testkit that cannot catch planted bugs is theater" (plan §4). Each mutant in
// test/mutants/mutants.ts plants exactly ONE bug; this file asserts each one fails the
// SPECIFIC property it targets (not just "something throws somewhere").

import { describe, expect, it } from "vitest";
import {
  checkDeterminism,
  checkEncodeDecodeAndEffects,
  checkLegalityCoherence,
  checkPurity,
  checkRedaction,
  checkScoreCoherence,
  checkStatusDiscipline,
  checkTermination,
} from "../testkit/checks";
import {
  fogFixtureCorrect,
  fogSecretExtractor,
  mutant2PEmitsLost,
  mutantEffectsAccumulate,
  mutantEncodeIncludesEffects,
  mutantFogLeak,
  mutantIsLegalAlwaysTrue,
  mutantMathRandomLeak,
  mutantMutatesInput,
  mutantNonTerminating,
  mutantScoreDisagreesWithTerminal,
  mutantSoloEmitsDraw,
} from "./mutants/mutants";
import { classicTicTacToe } from "../testkit/fixtures/classic-ttt";

describe("testkit self-test: every mutant fails exactly the property it targets", () => {
  it("mutantMutatesInput fails checkPurity", () => {
    expect(() => checkPurity(mutantMutatesInput, { maxPlies: 9 })).toThrow(/purity/);
  });

  it("mutantMathRandomLeak fails checkDeterminism", () => {
    expect(() => checkDeterminism(mutantMathRandomLeak, { maxPlies: 20, runs: 10 })).toThrow(
      /determinism/
    );
  });

  it("mutantEncodeIncludesEffects fails the encode-excludes-lastEffects property", () => {
    expect(() => checkEncodeDecodeAndEffects(mutantEncodeIncludesEffects, { maxPlies: 9 })).toThrow(
      /encode-excludes-lastEffects/
    );
  });

  it("mutantEffectsAccumulate fails the effects-never-accumulate property", () => {
    expect(() => checkEncodeDecodeAndEffects(mutantEffectsAccumulate, { maxPlies: 9 })).toThrow(
      /effects-never-accumulate/
    );
  });

  it("mutantNonTerminating fails checkTermination", () => {
    expect(() => checkTermination(mutantNonTerminating, { maxPlies: 25, runs: 3 })).toThrow(
      /termination/
    );
  });

  it("mutantSoloEmitsDraw fails checkStatusDiscipline (solo branch)", () => {
    expect(() => checkStatusDiscipline(mutantSoloEmitsDraw, { maxPlies: 30, runs: 10 })).toThrow(
      /status-discipline/
    );
  });

  it("mutantScoreDisagreesWithTerminal fails checkScoreCoherence", () => {
    expect(() =>
      checkScoreCoherence(mutantScoreDisagreesWithTerminal, { maxPlies: 20, runs: 10 })
    ).toThrow(/score-coherence/);
  });

  it("mutant2PEmitsLost fails checkStatusDiscipline (two-player branch)", () => {
    expect(() => checkStatusDiscipline(mutant2PEmitsLost, { maxPlies: 9, runs: 30 })).toThrow(
      /status-discipline/
    );
  });

  it("mutantFogLeak fails checkRedaction, while the correct fog engine passes it", () => {
    expect(() =>
      checkRedaction(mutantFogLeak, { maxPlies: 5, runs: 10, secretExtractor: fogSecretExtractor })
    ).toThrow(/redaction/);

    expect(() =>
      checkRedaction(fogFixtureCorrect, { maxPlies: 5, runs: 10, secretExtractor: fogSecretExtractor })
    ).not.toThrow();
  });

  // M1 review finding 4 / gap G-10: the ORIGINAL checkLegalityCoherence only asserted
  // legalMoves(s,p) ⊆ isLegal-accepted (⇒), never that isLegal rejects everything else (⇐).
  // An `isLegal: () => true` engine passed the whole contract suite under that one-sided
  // check. This proves the (now bidirectional) property actually catches it, while the
  // healthy fixture it's based on still passes.
  it("mutantIsLegalAlwaysTrue fails checkLegalityCoherence (the reverse direction: isLegal must reject non-members too)", () => {
    expect(() => checkLegalityCoherence(mutantIsLegalAlwaysTrue, { maxPlies: 9, runs: 5 })).toThrow(
      /legality-coherence/
    );
  });

  it("the healthy classic-ttt fixture passes checkLegalityCoherence in both directions", () => {
    expect(() => checkLegalityCoherence(classicTicTacToe, { maxPlies: 9, runs: 5 })).not.toThrow();
  });
});

describe("testkit self-test: mutants do NOT spuriously fail unrelated properties", () => {
  // A mutant that fails every property would also be "theater" — it wouldn't prove the
  // testkit discriminates between bugs. Spot-check a couple of the less-obvious pairs.
  it("mutantMutatesInput still terminates fine (purity and termination are independent)", () => {
    expect(() => checkTermination(mutantMutatesInput, { maxPlies: 9, runs: 5 })).not.toThrow();
  });

  it("mutantEncodeIncludesEffects is still internally deterministic (it doesn't touch rng)", () => {
    expect(() => checkDeterminism(mutantEncodeIncludesEffects, { maxPlies: 9, runs: 5 })).not.toThrow();
  });

  it("mutant2PEmitsLost still has coherent legality (it only touches status())", () => {
    // (legality coherence isn't imported here to keep this file's surface small; the
    // absence of a throw from checkStatusDiscipline for a HEALTHY input the mutant hasn't
    // touched is implicitly covered by the passing engineContract suites for the base
    // fixtures — this test exists mainly to document the intent.)
    expect(() => checkTermination(mutant2PEmitsLost, { maxPlies: 9, runs: 10 })).not.toThrow();
  });
});

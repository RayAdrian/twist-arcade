// packages/engine/test/testkit-self-test.test.ts
//
// "A testkit that cannot catch planted bugs is theater" (plan §4). Each mutant in
// test/mutants/mutants.ts plants exactly ONE bug; this file asserts each one fails the
// SPECIFIC property it targets (not just "something throws somewhere").

import { describe, expect, it } from "vitest";
import {
  checkDeterminism,
  checkEncodeDecodeAndEffects,
  checkEncodeInjectivity,
  checkLegalityCoherence,
  checkPurity,
  checkRedaction,
  checkScoreCoherence,
  checkStatusDiscipline,
  checkTermination,
} from "../testkit/checks";
import {
  fogEffectsLeakSecretExtractor,
  fogFixtureCorrect,
  fogFixtureEffectsLeakCorrect,
  fogSecretExtractor,
  mutant2PEmitsLost,
  mutantEffectsAccumulate,
  mutantEncodeConstant,
  mutantEncodeIncludesEffects,
  mutantFogEffectsLeak,
  mutantFogLeak,
  mutantIsLegalAlwaysTrue,
  mutantMathRandomLeak,
  mutantMutatesInput,
  mutantMutatesMovesMap,
  mutantNonTerminating,
  mutantScoreDisagreesWithTerminal,
  mutantScoredWrongLength,
  mutantSoloEmitsDraw,
  mutantStatusUnstableUnderEncodeDecode,
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

  // M1 review finding 8 / gap G-3: "status stable under encode/decode" was named in plan §4
  // but never implemented in the kit.
  it("mutantStatusUnstableUnderEncodeDecode fails the status-stable-under-encode-decode property", () => {
    // runs: 20 (not fewer) — the bug only manifests at a `draw` terminal, and a `draw` is a
    // minority outcome under uniform-random TTT play (roughly 1-in-12); empirically the first
    // draw among seeds "encode-2-0".."encode-2-19" is at run INDEX 11 — the 12th playout — so
    // `runs` must be >= 12. Verified: runs of 10 and 11 do NOT catch it. 20 keeps real margin.
    expect(() =>
      checkEncodeDecodeAndEffects(mutantStatusUnstableUnderEncodeDecode, { maxPlies: 9, runs: 20 })
    ).toThrow(/status-stable-under-encode-decode/);
  });

  // M1 review finding 8 / gap G-11: `scored.scores.length === numPlayers` is a Status
  // invariant stated in plan §3's comment but enforced nowhere until now.
  it("mutantScoredWrongLength fails checkStatusDiscipline's scores.length invariant", () => {
    expect(() =>
      checkStatusDiscipline(mutantScoredWrongLength, { maxPlies: 20, runs: 10 })
    ).toThrow(/status-discipline/);
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

  // RED-002 (M1 test plan) / DoD §13's "a planted secret-leaking effect on a fog fixture
  // variant is caught" — a REQUIRED gap closure. mutantFogLeak leaks the secret via the
  // whole state (its `secret` FIELD leaks too), so the effects-array leak path specifically
  // has never been exercised in isolation. mutantFogEffectsLeak correctly omits the `secret`
  // field pre-reveal but passes a secret-carrying effect straight through.
  it("mutantFogEffectsLeak fails checkRedaction via lastEffects ALONE (the field itself is correctly redacted), while the correct effects-leak fixture passes it", () => {
    expect(() =>
      checkRedaction(mutantFogEffectsLeak, {
        maxPlies: 5,
        runs: 10,
        secretExtractor: fogEffectsLeakSecretExtractor,
      })
    ).toThrow(/redaction/);

    expect(() =>
      checkRedaction(fogFixtureEffectsLeakCorrect, {
        maxPlies: 5,
        runs: 10,
        secretExtractor: fogEffectsLeakSecretExtractor,
      })
    ).not.toThrow();
  });

  it("mutantFogEffectsLeak's `secret` FIELD is itself correctly omitted pre-reveal — the leak is isolated to lastEffects", () => {
    const state = mutantFogEffectsLeak.setup(1, { next: () => 0.5, int: () => 41, shuffle: (xs) => [...xs] });
    const peeked = mutantFogEffectsLeak.apply(state, new Map([[0, { kind: "peek" as const }]]), {
      next: () => 0.5,
      int: () => 0,
      shuffle: (xs) => [...xs],
    });
    const view = mutantFogEffectsLeak.playerView(peeked, 0) as unknown as Record<string, unknown>;
    expect("secret" in view).toBe(false);
    // ...yet the secret is recoverable from lastEffects alone.
    expect(JSON.stringify(view)).toContain(String(peeked.secret));
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

  // M2 entry checklist Gap G-2: encode() injectivity was never checked, so a constant/
  // collision-prone encode passed the whole kit (encode(decode(encode(s)))===encode(s) is
  // trivially true for a constant, and checkDeterminism compares via encode() too).
  it("mutantEncodeConstant fails checkEncodeInjectivity, while the healthy fixture passes it", () => {
    expect(() => checkEncodeInjectivity(mutantEncodeConstant, { maxPlies: 9, runs: 10 })).toThrow(
      /encode-injectivity/
    );
    expect(() => checkEncodeInjectivity(classicTicTacToe, { maxPlies: 9, runs: 10 })).not.toThrow();
  });

  // M2 entry checklist Gap G-9: Object.freeze(map) cannot stop map.set()/.clear() because a
  // Map's storage lives in internal slots, not enumerable own properties — so an apply() that
  // mutates its `moves` argument used to pass checkPurity silently.
  it("mutantMutatesMovesMap fails checkPurity, specifically naming the `moves` argument", () => {
    expect(() => checkPurity(mutantMutatesMovesMap, { maxPlies: 9 })).toThrow(/purity/);
    expect(() => checkPurity(mutantMutatesMovesMap, { maxPlies: 9 })).toThrow(/moves/);
  });
});

// M1 review finding 3 / gap G-8 / defect D-1: plan §3 and correction C1 require secrets be
// OMITTED ("absence is structural"), not masked with a sentinel value — a masked field is
// present-but-fake. fogFixtureCorrect used to mask (`secret: state.revealed ? state.secret :
// -1`), which is exactly the anti-pattern C1 forbids, and modeled the wrong reference for
// any game team copying it. checkRedaction's string-inclusion probe cannot tell the
// difference (a sentinel that doesn't textually collide with the real secret still "passes"),
// so this must be asserted structurally: the key itself must be absent from the view object.
describe("fog fixture honesty: omit, don't mask (M1 review finding 3)", () => {
  it("fogFixtureCorrect's pre-reveal view has NO `secret` key at all (structural absence, not a sentinel)", () => {
    const state = fogFixtureCorrect.setup(1, { next: () => 0.5, int: () => 41, shuffle: (xs) => [...xs] });
    const view = fogFixtureCorrect.playerView(state, 0) as unknown as Record<string, unknown>;
    expect("secret" in view).toBe(false);
  });

  it("after reveal, the view DOES carry `secret` — that's the whole point of the move", () => {
    const state = fogFixtureCorrect.setup(1, { next: () => 0.5, int: () => 41, shuffle: (xs) => [...xs] });
    const revealed = fogFixtureCorrect.apply(state, new Map([[0, { kind: "reveal" as const }]]), {
      next: () => 0.5,
      int: () => 0,
      shuffle: (xs) => [...xs],
    });
    const view = fogFixtureCorrect.playerView(revealed, 0);
    expect(view.revealed && view.secret).toBe(revealed.secret);
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

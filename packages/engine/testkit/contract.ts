// packages/engine/testkit/contract.ts — the vitest ADAPTER over testkit/checks.ts (plan §4).
//
// M1 review finding 2: this file (and only this file, within the testkit) may import
// "vitest" — it is the thin `describe`/`it` registration layer every game's engine.test.ts
// calls via `engineContract()`. All of the actual property logic lives in the vitest-FREE
// testkit/checks.ts, which is what a plain Node CI job (the M3d certify loop, the nightly
// certificate re-verifier) should import instead of this file. Importing this module at all
// evaluates its top-level `import ... from "vitest"`, which throws outside a real vitest
// worker — that is by design for the adapter, and exactly the problem checks.ts avoids.

import type { Json, WithEffects } from "../src/types";
import type { ContractOptions } from "./checks";
import {
  checkDeterminism,
  checkEncodeDecodeAndEffects,
  checkEncodeInjectivity,
  checkLegalityCoherence,
  checkPerfectInfoIdentity,
  checkPlayerViewTotal,
  checkPurity,
  checkRedaction,
  checkScoreCoherence,
  checkStatusDiscipline,
  checkTermination,
} from "./checks";
import type { GameEngine } from "../src/types";
import { describe, it } from "vitest";

/**
 * Registers describe/it blocks (vitest) — every game's engine.test.ts calls this. The solo
 * branch auto-activates when meta.maxPlayers === 1; the two-player branch otherwise.
 */
export function engineContract<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const isSolo = engine.meta.maxPlayers === 1;

  describe(`engineContract: ${engine.meta.id}`, () => {
    it("does not mutate its inputs (purity)", () => {
      checkPurity(engine, opts);
    });

    it(`terminates within the ply cap (${opts.maxPlies ?? 200})`, () => {
      checkTermination(engine, opts);
    });

    it("is deterministic: same seed + same moves ⇒ identical trajectory and effects", () => {
      checkDeterminism(engine, opts);
    });

    it(
      "encode/decode is canonical and excludes lastEffects; effects are never accumulated; " +
        "status is stable under encode/decode",
      () => {
        checkEncodeDecodeAndEffects(engine, opts);
      }
    );

    it("encode() is injective: logically distinct states never share an encoded string", () => {
      checkEncodeInjectivity(engine, opts);
    });

    it("isLegal agrees with legalMoves in both directions (iff)", () => {
      checkLegalityCoherence(engine, opts);
    });

    it("playerView never throws, for any seat or the spectator", () => {
      checkPlayerViewTotal(engine, opts);
    });

    if (!engine.meta.hiddenInformation) {
      it("perfect-info games: playerView is the identity", () => {
        checkPerfectInfoIdentity(engine, opts);
      });
    }

    if (engine.meta.hiddenInformation) {
      it("redacts all secrets (incl. from lastEffects) from every non-omniscient view", () => {
        checkRedaction(engine, opts);
      });
    }

    if (engine.score) {
      it("score() is coherent with the scored terminal", () => {
        checkScoreCoherence(engine, opts);
      });
    }

    if (isSolo) {
      describe("solo branch", () => {
        it("never emits `draw`, and any `won` has winner === 0", () => {
          checkStatusDiscipline(engine, opts);
        });
      });
    } else {
      describe("two-player branch", () => {
        it("never emits `lost` (solo-only status)", () => {
          checkStatusDiscipline(engine, opts);
        });
      });
    }
  });
}

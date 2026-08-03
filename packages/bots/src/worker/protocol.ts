// packages/bots/src/worker/protocol.ts — BotRequest/BotResponse wire types (plan §6).
//
// JSON-plain over postMessage: `encodedState` is a STRING (`engine.encode(state)`), never a
// live `S` object. Two reasons: (1) states must survive the worker's structured-clone
// boundary, and (2) `encode`/`decode` is already the platform's one canonical serialization
// (replay, certificates) — reusing it here means the worker gets C4's "decode throws on
// malformed input, never returns a partial state" guarantee for free, on the one boundary in
// the whole platform that receives state from outside the process.
//
// `move` in `BotResponse` is typed `Json` rather than a game-specific `M` for the same reason
// the registry itself erases `S`/`M`/`V` (game-spec's registry.ts): the worker host is generic
// over every registered game, so it cannot know each game's concrete move type statically.

import type { Json, PlayerId } from "@twist-arcade/engine";
import type { SearchStats } from "../policy";

export interface BotRequest {
  requestId: string;
  gameId: string; // registry key -> loadEngine()
  encodedState: string; // engine.encode(state) at the caller's side; decoded inside the worker
  player: PlayerId;
  tierId: "casual" | "standard" | "ruthless"; // DifficultyTier.id — resolved via the game's manifest
  seed: string; // matchSeed; policy rng = rngFor(seed + ":bot", step)
  step: number;
  /** First-game-softening seam (tiers.ts's SOFTEN doc / TierPolicyOptions.soften). This flag
   *  IS JSON-plain and safely rides the wire; the game-specific "is this move twist-exploiting"
   *  PREDICATE it depends on is NOT (it's a function) and never travels here — the host resolves
   *  that predicate locally, inside the worker process, via
   *  HandleBotRequestOptions.resolveIsTwistExploitingMove (worker/host.ts). Omit or false: no
   *  softening, the tier's ordinary blunder config (if any) applies unchanged. */
  soften?: boolean;
}

/**
 * Discriminated union rather than "throw across postMessage": a thrown Error does not survive
 * structured clone with its prototype/instanceof intact, and the whole point of a typed
 * refusal (e.g. NonDeterministicBudgetError) is that the CALLER can recognize which typed
 * failure occurred. `ok: false` carries a plain, JSON-plain `{ name, message }` — enough for
 * the caller to branch on `error.name` without relying on cross-realm `instanceof`.
 */
export type BotResponse =
  | { requestId: string; ok: true; move: Json; stats: SearchStats }
  | { requestId: string; ok: false; error: { name: string; message: string } };

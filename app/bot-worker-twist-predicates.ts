// app/bot-worker-twist-predicates.ts — per-game "is this move twist-exploiting" predicates for
// first-game softening (plan §5.2.10; packages/bots/src/tiers.ts's own SOFTEN doc).
//
// `BotRequest.soften` already rides the wire (protocol.ts) and `tierPolicy` already knows how to
// act on it (raise epsilon specifically on a flagged move — tiers.ts) — but only if it is handed
// a game-specific `isTwistExploitingMove` PREDICATE, and a predicate cannot cross postMessage (a
// function isn't JSON-plain). `HandleBotRequestOptions.resolveIsTwistExploitingMove` is the seam
// that resolves one LOCALLY, inside the worker process, from a `gameId` — this file is that
// resolution table's data half, kept here (app-owned) rather than in `@twist-arcade/shell`,
// because a per-game predicate is exactly the kind of game-specific knowledge packages/shell is
// not allowed to hold (plan §2's non-goals: "the shell... implements none of [any game]").
//
// Empty today, deliberately: no shipped game has decided what "twist-exploiting" means for it
// yet — Fadeout's is F4 scope (the exact-solve team defines it once the ruleset's own solve work
// is further along). This file's SHAPE is the plumbing S2 owes F4: adding Fadeout's entry here
// is the ONLY change F4 needs to make for `soften` to go live end-to-end (BotRequest.soften ->
// this resolver -> tierPolicy's epsilon raise) — nothing in useGame, bot-driver.ts, or
// bot-worker.ts changes.
//
// eslint-disable @typescript-eslint/no-explicit-any -- this table is the one place the
// per-game S/M erasure the registry itself uses (RegistryEntry's own `any`s) is unavoidable:
// each game's predicate operates on ITS OWN concrete state/move types, and this map is
// necessarily generic over every registered game.

import type { GameEngine } from "@twist-arcade/engine";

export type TwistExploitingMovePredicateFactory = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<any, any, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => (state: any, move: any) => boolean;

export const TWIST_EXPLOITING_MOVE_PREDICATES: Partial<Record<string, TwistExploitingMovePredicateFactory>> = {
  // <twist-predicate:insert> — e.g. fadeout: (engine) => isFadeoutTwistExploitingMove (F4)
};

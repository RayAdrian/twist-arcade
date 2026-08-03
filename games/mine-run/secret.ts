// games/mine-run/secret.ts — the secretExtractor for engineContract's redaction property
// (docs/plans/mine-run.md §3.2). Kept in its own module (not inline in a test) because it is
// also the natural place to document the reasoning behind the two tokens below.
//
// Two kinds of secret token, per plan §3.2:
//  1. The literal canonical-field fragment `"mines":[` — this guards against the MASKING
//     anti-pattern specifically: if a future revision ever spread raw state into a view (or
//     accidentally serialized a `mines` key), this substring would appear in the JSON output.
//     playerView() here never uses that key name at all, so this token should NEVER match, at
//     any viewer, at any point in a run — it is a permanent, unconditional secret.
//  2. A STRUCTURAL per-mine fragment: `"<cell>":{"mine":true}`, the EXACT JSON shape a
//     serialized view carries when index `cell` holds the `{mine:true}` variant. This is a
//     deliberate change from an earlier design that tagged each mine with an artificial,
//     unguessable string (`"__MINE_SECRET_<n>__"`) specifically so it could never collide
//     with legitimate view content. That reasoning was backwards: a token engineered so it
//     CANNOT collide with legitimate content also CANNOT match a real leak, because a real
//     leak of this shape produces ordinary view content, not a tag. Concretely: the spectator
//     carve-out's guard is `player === null && status.kind !== "ongoing"`; if that regresses
//     to `player === null` alone (an entirely plausible one-line mistake), playerView() leaks
//     the full mine layout to ANY spectator, mid-run included — but it does so by emitting
//     real `{"mine":true}` entries, which never contain the substring `__MINE_SECRET_`, so the
//     old tagged extractor passed the regression straight through `checkRedaction` (proven by
//     test/redaction-mutant.test.ts's "spectator carve-out regression" mutant). Anchoring the
//     token to the actual shape the bug produces gives it teeth: it can only ever appear when
//     cell `n` truly serializes as `{"mine":true}`, which must never happen outside the one
//     legitimate case this module's `spectatorAtTerminal` gate exists to allow.
//
// self-test (test/secret-token-collision.test.ts) proves the `"mines":[` token's collision-
// freedom, and separately proves this extractor's own gating (secret for the player and for
// an ONGOING spectator; dropped only for a TERMINAL spectator) matches secret.ts's intent.

import type { PlayerId } from "@twist-arcade/engine";
import type { MineRunState } from "./engine";

export const MINES_FIELD_TOKEN = '"mines":[';

/** The exact JSON fragment an unrevealed mine `cell` would carry if playerView() emitted the
 *  spectator-terminal `{mine:true}` disclosure for it — a structural check anchored to the
 *  real leak shape, not an artificial tag (see the module doc comment above for why). */
export function mineSecretToken(cell: number): string {
  return `"${cell}":{"mine":true}`;
}

/** Status shape is intentionally NOT imported from engine.ts here (secret.ts must stay a leaf
 *  the redaction test can reason about independently) — the terminal check only needs the two
 *  fields status() itself derives from, so it is inlined via the same public formula. */
function isOngoing(state: MineRunState, totalCells: number): boolean {
  const safeTotal = totalCells - state.mines.length;
  const safeRevealed = state.revealed.length - state.exploded.length;
  return state.revealsLeft > 0 && safeRevealed < safeTotal;
}

/**
 * Builds the secretExtractor engineContract's checkRedaction property requires whenever
 * meta.hiddenInformation is true. `viewerId` follows the testkit's convention: -1 means the
 * spectator (player === null).
 */
export function makeMineRunSecretExtractor(
  totalCells: number
): (state: unknown, viewer: PlayerId) => string[] {
  return (stateUnknown: unknown, viewer: PlayerId): string[] => {
    const state = stateUnknown as MineRunState;
    const secrets = [MINES_FIELD_TOKEN];
    const spectatorAtTerminal = viewer === -1 && !isOngoing(state, totalCells);
    if (spectatorAtTerminal) return secrets; // post-game spectator reveal is explicitly allowed
    const exploded = new Set(state.exploded);
    for (const m of state.mines) {
      if (!exploded.has(m)) secrets.push(mineSecretToken(m));
    }
    return secrets;
  };
}

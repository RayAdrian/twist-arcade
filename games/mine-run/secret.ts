// games/mine-run/secret.ts — the secretExtractor for engineContract's redaction property
// (docs/plans/mine-run.md §3.2). Kept in its own module (not inline in a test) because it is
// also the natural place to document the token-collision-proof argument the plan asks for.
//
// Two kinds of secret token, per plan §3.2:
//  1. The literal canonical-field fragment `"mines":[` — this guards against the MASKING
//     anti-pattern specifically: if a future revision ever spread raw state into a view (or
//     accidentally serialized a `mines` key), this substring would appear in the JSON output.
//     playerView() here never uses that key name at all, so this token should NEVER match, at
//     any viewer, at any point in a run — it is a permanent, unconditional secret.
//  2. Per-mine tokens for every mine NOT YET exploded, tagged with a prefix
//     (`"__MINE_SECRET_<n>__"`) that cannot collide with any legitimate view content: real
//     view values are bare numbers, `{"n":<int>}`, `{"exploded":true}`, or `{"mine":true}` —
//     none of which can ever produce the substring `__MINE_SECRET_`. A mine's token stops
//     being a secret once it is exploded (it is public information from that point on, R7)
//     and — per plan §3.2's spectator carve-out — stops being a secret for the SPECTATOR
//     viewer specifically once the run has ended (playerView(state, null) may then legally
//     show the full layout).
//
// self-test (test/secret-token-collision.test.ts) proves point 2's collision-proof claim
// directly rather than asserting it in a comment only.

import type { PlayerId } from "@twist-arcade/engine";
import type { MineRunState } from "./engine";

export const MINES_FIELD_TOKEN = '"mines":[';

export function mineSecretToken(cell: number): string {
  return `"__MINE_SECRET_${cell}__"`;
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

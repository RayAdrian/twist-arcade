// games/bid-tac-toe/probes.ts — the per-game mirror-bot probe (plan §6): "point symmetry is
// board geometry the interface deliberately doesn't expose", so every game that IS
// point-symmetric (tag your manifest "symmetric" once this is real) exports its own
// `mirrorMove`.
//
// ---------------------------------------------------------------------------------------
// THE MIRROR PROBE: deliberately NOT implemented here (platform-corrections.md C48, routed
// at C62).
//
// The board IS spatially symmetric — cell (r, c) reflects to cell through the center exactly
// like Nine Grids' or Order vs Chaos' boards do. What breaks the mirror is the OTHER axis every
// move on this game carries: a `{ kind: "bid", amount, star? }` move spends chips from a
// PRIVATE, ASYMMETRIC budget (manifest.ts's own note: "the bid axis (budgets/star) is not
// reflectable... a per-cell reflection has no meaningful analogue for a bid move"). Copying the
// opponent's cell choice through the center is well-defined; copying their BID has no meaning at
// all once the two seats' remaining budgets have diverged (which happens after the very first
// unequal bid) — there is no reflection of "spend 3 chips" that preserves anything about the
// position, unlike a board cell's reflection preserving the game's actual symmetry.
//
// This is the C48 ruling shape (docs/plans/platform-corrections.md C48): "where mirroring is
// provably not value-preserving, the probe cannot measure its claim — a WARN invites someone to
// tune away a number that never meant anything." The correct report for this game's mirror probe
// is `n/a`, with this reason — not the roster's default WARN-on-absence behavior. That
// distinction lives in the harness's gate-reporting layer (packages/harness/src/suites.ts's
// `evaluateMirrorProbeGate`, routed at C62) — this file supplies only the reason string;
// `manifest.ts` declares `mirrorProbe: { applicable: false, reason:
// MIRROR_PROBE_NOT_APPLICABLE_REASON }`, which is what makes `runCiSuite`'s real report carry a
// `mirror-probe: n/a` row citing this text.
//
// No `mirrorMove` is exported from this file on purpose (replacing the earlier scaffold
// placeholder, which played whichever move happened to be first in `legalMoves` — legal, never
// throwing, but not an actual mirror strategy): exporting it would risk it being wired into
// `mirrorAgent()` later and silently read as a real (and meaningless) win-rate number instead of
// the `n/a` this game's structure actually calls for. No "symmetric" tag either, for the same
// reason manifest.ts already gave before this constant existed: CI would hard-require a probe
// this game has a principled reason not to ship.
export const MIRROR_PROBE_NOT_APPLICABLE_REASON =
  "the board is spatially symmetric, but every move also spends chips from a private, " +
  "asymmetric bid budget (and the star can be held by only one seat) — bids and the star have " +
  "no reflective analogue, so a mirrored bid preserves nothing about the position once the two " +
  "seats' remaining budgets diverge. Report as n/a with this reason, never a WARN " +
  "(platform-corrections.md C48's ruling shape).";

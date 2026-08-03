// packages/game-spec/src/presentation.ts — GamePresentation (plan §5.3), React-shaped;
// React import is TYPE-ONLY (ComponentType), so this package stays a near-zero-runtime
// types module even though it references React's type surface.
//
// DoD note (orchestrator amendment, 2026-08-02): @twist-arcade/shell — the team that
// consumes these types to build the actual Board/GameShell components — is explicitly
// PERMITTED to depend on React as a real runtime dependency; it is a UI package. The
// "no package imports react except game-spec (type-only) and app/" rule in the plan's DoD
// (§13) describes the state of THIS milestone's packages (engine, game-spec) before the
// shell package exists — it was never meant to forbid a future UI package from using React
// for real. See scripts/check-engine-purity.sh (added this milestone) for the dependency
// check this repo actually enforces: packages/engine has zero runtime deps and never
// imports react; every other package is unconstrained on that front.

import type { ComponentType } from "react";
import type { Effect, GameMeta, Json, PlayerId, Status, WithEffects } from "@twist-arcade/engine";
import type { ReplayRecord } from "@twist-arcade/engine";

export interface BoardProps<V extends WithEffects, M extends Json> {
  view: V; // the seat's VIEW, never canonical S — redaction by type;
  //   effects arrive via view.lastEffects (already redacted)
  legal: M[];
  onMove(m: M): void; // shell wraps with commit/lockout/undo
  seat: PlayerId | "spectator";
  prefs: { reducedMotion: boolean; theme: "light" | "dark" };
}

/**
 * Discriminated union describing what the shell's live region (AriaAnnouncer) needs to
 * compose a sentence: what happened -> what's imminent -> whose turn / what the state is.
 * Generic over V (never S) so `boardSummary` can carry the actual redacted seat view rather
 * than an opaque re-serialized blob — announce() can read straight off it.
 *
 *  - `moved`     — a move was just applied; carries the effects it produced (same Effect
 *                  vocabulary as WithEffects.lastEffects) so the announcer and any
 *                  first-occurrence callout share one mapping.
 *  - `imminent`  — a preview of what WILL happen if nothing intervenes (e.g. a tile is 1
 *                  turn from crumbling) — this is what makes decay/expiry legible to a
 *                  screen reader, not just sighted players watching a CountdownBadge.
 *  - `boardSummary` — a full-board readback (e.g. on focus, or "read the board" shortcut).
 *  - `status`    — a terminal or phase transition (won/lost/draw/scored).
 *
 * The shell owns sequencing and composing these into one spoken sentence; a game only ever
 * supplies the per-event fragment via announce().
 */
export type GameEvent<V extends WithEffects = WithEffects> =
  | { kind: "moved"; player: PlayerId; move: Json; effects: readonly Effect[] }
  | { kind: "imminent"; effects: readonly Effect[] }
  | { kind: "boardSummary"; view: V }
  | { kind: "status"; status: Status };

export interface Frame {
  title: string;
  body: string;
}

export interface GamePresentation<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects = S,
> {
  Board: ComponentType<BoardProps<V, M>>;
  /**
   * ADDED post-freeze, shell-side (S1 implementation gap, flagged for orchestrator sign-off —
   * see the shell team's final report): `BoardShell` needs `rows`/`cols` for its APG grid math
   * (`aria-rowcount`/`colcount`, the roving-tabindex cursor) and `GameManifest` carries no board
   * dimensions at all — there was no way for `GameShell` to render `BoardShell` around a game's
   * `Board` without it. Additive only (no existing field changed shape), computed from the
   * current view since some boards may not be a fixed size across a game's lifetime.
   */
  boardDimensions(view: V): { rows: number; cols: number };
  announce(ev: GameEvent<V>): string;
  /**
   * ARRAY, not a single entry (platform-corrections.md, folded in while this shape is still
   * pre-freeze — M1 review finding 5): games have more than one teachable "first" (e.g. the
   * first crumble AND the first near-miss decay warning both deserve a one-time callout), and
   * a single slot could only ever key one of them. Each entry's `flagKey` is independent —
   * it namespaces that entry's own once-per-device "seen it" flag, so triggering one entry
   * never suppresses another.
   */
  firstOccurrence?: {
    flagKey: string;
    trigger(ev: GameEvent<V>): boolean;
    text: string;
    anchor(ev: GameEvent<V>): Json;
  }[];
  /** Emoji move-timeline BODY only; shell owns the frame. Solo games get the certificate
   *  handed alongside by the shell (par lives in the header) — the artifact body may diff
   *  the player's log against solver values (🟩🟨🟥 struggle-shape) offline. */
  shareArtifact(record: ReplayRecord, finalView: V): string;
  howSheetFrames: [Frame, Frame, Frame];
  textureLine?(finalView: V): string;
}

// Re-exported so game authors don't need a second import for the meta type their
// presentation module commonly references alongside GamePresentation.
export type { GameMeta };

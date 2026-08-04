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
 *                  ADDITIVE WIDENING (stage-6 F3 review, must-fix 1): carries `view` alongside
 *                  `effects`, mirroring `boardSummary` below. `effects` alone can only ever
 *                  describe what a mover's OWN just-applied overflow decayed THIS ply — it is
 *                  structurally silent the very first time any mark reaches its final turn
 *                  (a player's 3rd placement, which fills that mark's queue to cap without
 *                  popping anything), and it can never name a cell. `view` lets a game compute
 *                  the full STANDING set of marks at `remaining === 1`, cell names included, on
 *                  every call — not just the ply a decay happened to fire.
 *  - `boardSummary` — a full-board readback (e.g. on focus, or "read the board" shortcut).
 *  - `status`    — a terminal or phase transition (won/lost/draw/scored).
 *
 * The shell owns sequencing and composing these into one spoken sentence; a game only ever
 * supplies the per-event fragment via announce().
 */
export type GameEvent<V extends WithEffects = WithEffects> =
  | { kind: "moved"; player: PlayerId; move: Json; effects: readonly Effect[] }
  | { kind: "imminent"; effects: readonly Effect[]; view: V }
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
   *
   * ORCHESTRATOR SIGN-OFF (stage-6 review escalation): per-view, on the presentation — endorsed,
   * not a static manifest number. Dynamic boards are real (a seed-varied grid at setup, or a
   * shrinking-board twist mid-game), and a static manifest field would be actively WRONG for
   * those, not merely redundant; the manifest is the eager catalog payload shipped to `/` and
   * must stay small and data-only, so it is not the right home for this even as a cache.
   *
   * CONTRACT (binding on every implementation): this function must be TOTAL and PURE over every
   * `view` the game can ever hand it for the lifetime of a game instance — called on every
   * render, its result directly drives `BoardShell`'s roving-tabindex cursor math and ARIA grid
   * attributes, so it must never throw, never return `{0,0}` or any other placeholder for a
   * view it doesn't recognize, and never depend on anything other than `view` itself (no
   * randomness, no closed-over mutable state). `BoardShell` clamps its cursor against
   * whatever `rows`/`cols` this returns on every render specifically so a SHRINKING board (this
   * function legitimately returning smaller dimensions than the previous render) never strands
   * the roving tabindex on a cell position that no longer exists — that clamp only works if this
   * function's own return value is always a value BoardShell can trust immediately, for the
   * CURRENT view, with no lag or exception.
   */
  boardDimensions(view: V): { rows: number; cols: number };
  /**
   * OPTIONAL, additive (Mine Run, mine-run.md §8.1): a game-owned control block rendered as a
   * SIBLING immediately after `BoardShell`/`Board` and before `ControlsRow` — never inside the
   * board grid itself. Exists because a handful of games have exactly one bespoke control that
   * needs live `view`/`onMove` access but is not a board cell (Mine Run's BankBar: the
   * bank/continue decision, shown as a wide button beside the at-risk-streak and vault chips).
   *
   * Deliberately NOT rendered inside `BoardShell`'s children: that container is a CSS grid
   * sized exactly `rows x cols` (`BoardShell.tsx`'s `gridTemplateColumns`/`gridTemplateRows`),
   * and its `role="row"` wrapper's children are expected to be `role="gridcell"`s by every
   * assistive-tech consumer of the APG grid pattern — an extra non-cell child there risks both
   * a broken grid track (an 11th implicit-row item bleeding past the intended board box) and an
   * ARIA structural violation. A sibling slot avoids both while still reusing the exact same
   * `BoardProps` shape a Board already receives, so a game's extras component reads the same
   * `view`/`legal`/`onMove`/`seat`/`prefs` its Board does.
   *
   * Omitted entirely by every game that doesn't need it (Fadeout, Crackstep) — no behavior
   * change for them.
   */
  extraControls?: ComponentType<BoardProps<V, M>>;
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

// packages/shell/src/effects-map.ts — the effects-to-animation mapper (plan §9.3).
//
// Pure function keyed on the engine's `lastEffects` vocabulary (already redacted — this
// module never sees canonical `S`, only `view.lastEffects`). The governing rule: every
// animation restates a state change a static encoding already shows, so reduced-motion loses
// ZERO information — it only ever removes the transition (`instant: true`, duration 0), the
// resulting state is identical either way. Unknown effect types are ignored gracefully
// (kind "none") so a game inventing a new effect type never crashes the shell.
//
// Scope note: the vocabulary table in the plan also lists three ROW that are NOT driven by
// an Effect at all — "(age step)" (driven by Cell's `ageStep` prop changing at turn
// advance), "(final turn)" (driven by a CountdownBadge reaching 1), and "(win)" (driven by
// `status`, rendered by ResultModal/BoardShell). Those can't be produced by a function whose
// only input is `effects: readonly Effect[]` — they're implemented directly where that prop
// changes (Cell's `data-age` transition, `finalPulseAnimation` below, ResultModal's win-line
// rendering) rather than routed through this mapper. `finalPulseAnimation` is exported here
// because, like the effect-driven rows, it is pure and unit-testable in isolation.

import type { Effect } from "@twist-arcade/engine";
import { DURATIONS } from "./design-tokens";

export interface AnimationPrefs {
  reducedMotion: boolean;
}

export type EffectAnimationKind =
  | "place"
  | "vanish"
  | "vanish-ghost"
  | "moved"
  | "revealed"
  | "rotated"
  | "banked"
  | "none";

export interface CellAnimation {
  /** The source effect, passed through so a caller can read game-specific fields
   *  (e.g. `cell`, `from`/`to`) that this generic mapper has no opinion on. */
  effect: Effect;
  kind: EffectAnimationKind;
  /** 0 whenever `instant` is true (nothing to transition — render the final state directly). */
  durationMs: number;
  /** True under reduced motion, OR when kind is "none" (nothing to animate either way). */
  instant: boolean;
}

const KIND_BY_TYPE: Record<string, { kind: EffectAnimationKind; durationMs: number }> = {
  placed: { kind: "place", durationMs: DURATIONS.place },
  removed: { kind: "vanish", durationMs: DURATIONS.vanish },
  captured: { kind: "vanish", durationMs: DURATIONS.vanish },
  decayed: { kind: "vanish-ghost", durationMs: DURATIONS.vanish },
  crumbled: { kind: "vanish-ghost", durationMs: DURATIONS.vanish },
  moved: { kind: "moved", durationMs: DURATIONS.moved },
  revealed: { kind: "revealed", durationMs: DURATIONS.moved },
  rotated: { kind: "rotated", durationMs: DURATIONS.vanish },
  banked: { kind: "banked", durationMs: DURATIONS.moved },
};

export function mapEffects(effects: readonly Effect[], prefs: AnimationPrefs): CellAnimation[] {
  return effects.map((effect) => {
    const entry = KIND_BY_TYPE[effect.type];
    if (!entry) {
      return { effect, kind: "none", durationMs: 0, instant: true };
    }
    const instant = prefs.reducedMotion;
    return {
      effect,
      kind: entry.kind,
      durationMs: instant ? 0 : entry.durationMs,
      instant,
    };
  });
}

/** The one-time final-turn pulse (ux-lens §2/§9): dropped ENTIRELY under reduced motion —
 *  not "instant", simply absent, since a continuous/attention-grabbing pulse is exactly the
 *  kind of motion reduced-motion users are opting out of, and the countdown badge already
 *  states the same "1 turn left" information statically. */
export function finalPulseAnimation(prefs: AnimationPrefs): { show: boolean; durationMs: number } {
  if (prefs.reducedMotion) return { show: false, durationMs: 0 };
  return { show: true, durationMs: DURATIONS.finalPulse };
}

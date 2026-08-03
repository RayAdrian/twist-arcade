// packages/shell/src/haptics.ts — navigator.vibrate wrapper + mute (ux-lens §7, plan §9.3).
//
// Driven off the same effects stream a game's Board consumes: light on own placement, medium
// on a piece vanishing (decayed/crumbled), a distinct success pattern on win. Guarded:
// silently absent where navigator.vibrate doesn't exist, and never throws even if the
// browser refuses the call (some browsers throw when vibrate is invoked outside a user
// gesture, or when the permission policy blocks it).

export type HapticPattern = "light" | "medium" | "success";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 30,
  success: [15, 40, 15, 40, 60],
};

export function vibrate(pattern: HapticPattern, muted: boolean): void {
  if (muted) return;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav || typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw (permission policy, no user gesture) — never surface this.
  }
}

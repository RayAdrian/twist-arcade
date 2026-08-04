// packages/shell/src/motion.ts — UI direction §5.3, R1: the ONE gate every Motion One call
// site (board path OR chrome, shell OR games) must go through. eslint.config.mjs enforces this
// structurally (`rawAnimateImportBanPaths`): a bare `import { animate } from "motion"` (or
// "motion/mini") anywhere else is a lint error, exactly like the framer-motion/gsap board-path
// ban. This file is the one place that import is allowed.
//
// WHY this exists: Motion One's `animate()` does not itself respect `prefers-reduced-motion` —
// left ungated, an entrance animation whose markup starts at `opacity: 0` (or off-screen) would
// leave that content permanently invisible for a reduced-motion user, or on any JS failure (R2:
// "never author hidden initial states" — the "from" state may exist ONLY inside the keyframes
// argument passed here, never in markup/CSS). Deleting or bypassing this gate is exactly the
// defect class R1 calls out as already having shipped elsewhere; test/motion.test.ts's reduced-
// motion assertions are written to catch that mutation (see the test file's own comment).
import { animate } from "motion/mini";

/** The subset of Motion One's DOM keyframes this gate understands: each CSS/independent-
 *  transform property maps to either a single final value or a `[from, to, ...]` array (Motion
 *  One's own keyframes shape). Kept intentionally narrow — board/chrome call sites in this
 *  plan only ever use opacity, independent transforms (x/y/scale/rotate), and simple CSS
 *  properties (e.g. `strokeDashoffset` for the SVG stroke-draw place animation). */
export type SafeKeyframes = Record<string, number | string | Array<number | string>>;

export interface AnimateSafeOptions {
  duration?: number;
  delay?: number;
  easing?: string;
  [key: string]: unknown;
}

export interface AnimateSafeHandle {
  /** Resolves when the animation (or, under reduce, immediately) has finished. */
  finished: Promise<void>;
  /** Stops the animation in flight. A no-op under reduce, since there is nothing running. */
  stop(): void;
}

const INDEPENDENT_TRANSFORMS = ["x", "y", "scale", "rotate"] as const;
type IndependentTransform = (typeof INDEPENDENT_TRANSFORMS)[number];

function isIndependentTransform(key: string): key is IndependentTransform {
  return (INDEPENDENT_TRANSFORMS as readonly string[]).includes(key);
}

function lastValue(value: number | string | Array<number | string>): number | string {
  return Array.isArray(value) ? value[value.length - 1]! : value;
}

function toTransformFunction(prop: IndependentTransform, value: number | string): string {
  switch (prop) {
    case "x":
      return `translateX(${typeof value === "number" ? `${value}px` : value})`;
    case "y":
      return `translateY(${typeof value === "number" ? `${value}px` : value})`;
    case "scale":
      return `scale(${value})`;
    case "rotate":
      return `rotate(${typeof value === "number" ? `${value}deg` : value})`;
  }
}

/** Applies the FINAL frame of `keyframes` to `element` synchronously — direct style
 *  assignment, no WAAPI, no requestAnimationFrame — so a reduced-motion (or no-JS-before-this-
 *  ran) render never shows a hidden/incomplete "from" state, even for one frame. */
function applyFinalFrame(element: Element, keyframes: SafeKeyframes): void {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  const transformParts: string[] = [];
  for (const [key, value] of Object.entries(keyframes)) {
    const final = lastValue(value);
    if (isIndependentTransform(key)) {
      transformParts.push(toTransformFunction(key, final));
      continue;
    }
    // Any other key is a standard CSSStyleDeclaration property name (camelCase is valid
    // directly on `.style`, e.g. `opacity`, `strokeDashoffset`, `backgroundColor`).
    (element.style as unknown as Record<string, string>)[key] = String(final);
  }
  if (transformParts.length > 0) element.style.transform = transformParts.join(" ");
}

/** Reads the live OS-level `prefers-reduced-motion` state. Exported so a caller without its
 *  own board-context reducedMotion flag (chrome, mostly) can rely on the same query
 *  animateSafe's own default falls back to, and so tests can assert it directly. Degrades to
 *  `false` (never throws) when `matchMedia` isn't available — same "assume motion is fine
 *  unless told otherwise" default GameShell.tsx's own `useMediaQuery` hook uses. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The ONE sanctioned entry point for every Motion One animation in this product (UI direction
 * §5.3, R1). Pass the caller's own already-known reduced-motion state when one exists (e.g.
 * board-context's `reducedMotion`, read once per board via GameShell's `useMediaQuery`) as the
 * 4th argument; omit it to let this function read `prefersReducedMotion()` itself (the usual
 * case for chrome call sites with no board context).
 *
 * Under reduce: applies the final keyframe synchronously (see `applyFinalFrame`) and returns an
 * already-resolved handle — Motion One's real `animate()` is never invoked, so there is no
 * WAAPI/rAF dispatch at all on this path. Otherwise: delegates straight to Motion One's
 * `animate()`.
 */
export function animateSafe(
  element: Element,
  keyframes: SafeKeyframes,
  options?: AnimateSafeOptions,
  reducedMotion: boolean = prefersReducedMotion()
): AnimateSafeHandle {
  if (reducedMotion) {
    applyFinalFrame(element, keyframes);
    return {
      finished: Promise.resolve(),
      stop() {
        // Nothing is running under reduce — stop() is a no-op, kept only so callers can treat
        // both branches' handles identically without a feature check.
      },
    };
  }

  const controls = animate(element, keyframes, options);
  return {
    finished: controls.finished.then(() => undefined),
    stop: () => controls.stop(),
  };
}

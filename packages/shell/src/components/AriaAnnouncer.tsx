// packages/shell/src/components/AriaAnnouncer.tsx — plan §4.14. Singleton per page: one
// POLITE aria-live region for turn flow, one ASSERTIVE region used exactly once per game for
// the result. Visually hidden. Purely presentational — the composition happens in
// announcer.ts / useGame; this component just renders whatever it's handed. Content REPLACES
// each render (no queue), which is what "latest state wins" requires.
//
// "use client" — hooks (useState/useEffect/useRef for the I7 forced-mutation logic below).
"use client";

import { useEffect, useRef, useState } from "react";

// Written as an escape (not a literal invisible character) so it isn't flagged by
// no-irregular-whitespace and stays visually obvious in a diff/review.
const ZERO_WIDTH_SPACE = "\u200b";

export interface AriaAnnouncerProps {
  polite: string;
  assertive: string;
  /** I7: a live region's AT support is typically MutationObserver-based — an identical string
   *  re-rendered with no DOM change never gets re-announced (two consecutive human turns that
   *  happen to produce the same phrase, e.g. "Your move.", would silently not repeat it).
   *  `token` is an opaque value whose IDENTITY (not content) marks "this is a genuinely NEW
   *  announcement event" — pass something that changes per real event (e.g. useGame's own
   *  `announcement` object, which is a fresh object literal every time it composes one, even
   *  when the resulting text is byte-identical to the last one). Optional and backward
   *  compatible: omitted (or unchanged), this component behaves exactly as before — a caller
   *  with no repeat-detection need isn't forced to invent a token. */
  token?: unknown;
}

/** Appends an invisible, alternating zero-width-space marker whenever `token` changes identity
 *  AND the incoming text is identical to what was last rendered — forcing a real DOM mutation
 *  without altering what the text actually says (the marker is invisible and never spoken).
 *  When `token` is omitted (or unchanged since the last render), this is a pure passthrough. */
function useAnnouncedText(token: unknown, text: string): string {
  const [display, setDisplay] = useState(text);
  const prevTextRef = useRef(text);
  const toggleRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      // First run: `prevTextRef` was seeded from this SAME initial `text` (nothing to compare
      // against yet), so skip the mutation check entirely — otherwise the very first render
      // would spuriously compare `text` to itself and append a marker nothing needed.
      mountedRef.current = true;
      return;
    }
    if (text !== "" && text === prevTextRef.current) {
      toggleRef.current = !toggleRef.current;
      setDisplay(text + (toggleRef.current ? ZERO_WIDTH_SPACE : ""));
    } else {
      toggleRef.current = false;
      setDisplay(text);
    }
    prevTextRef.current = text;
    // Deliberately keyed on `token` (identity), not `text` (content) — see the prop doc above:
    // this effect must re-run on every genuinely NEW event even when `text` repeats verbatim,
    // which a `text`-only dependency could never detect. When `token` is omitted, its value is
    // `undefined` on every render, so this simplifies to "only `text` changes drive updates" —
    // the exact prior (pre-I7) behavior.
  }, [token, text]);

  return display;
}

export function AriaAnnouncer({ polite, assertive, token }: AriaAnnouncerProps) {
  const politeDisplay = useAnnouncedText(token, polite);
  const assertiveDisplay = useAnnouncedText(token, assertive);

  return (
    <>
      <div aria-live="polite" role="status" className="sr-only">
        {politeDisplay}
      </div>
      <div aria-live="assertive" role="alert" className="sr-only">
        {assertiveDisplay}
      </div>
    </>
  );
}

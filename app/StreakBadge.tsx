"use client";

// app/StreakBadge.tsx — the masthead's streak flame (Riso Zine home direction, design 1b;
// ui-direction.md §2.1 wireframe: "streak flame (mono) only when >0"). Colocated with
// app/page.tsx (not packages/shell/src/components/), matching the existing
// app/play/[gameId]/PlayClient.tsx convention: a page-specific client leaf, not a shared shell
// component other routes would import.
//
// This is the ONLY client-interactive piece of the home page — everything else in app/page.tsx
// is a Server Component (no "use client"), so isolating the one thing that genuinely needs
// localStorage/`window` to this small island keeps the rest of the page's JS bundle at zero.
//
// Reads `readStreak()` in an effect, not during render: `window.localStorage` does not exist
// during SSR, and reading it synchronously in a lazy `useState` initializer would still run
// during the CLIENT's first render pass before hydration reconciles against the server's HTML
// (React would warn/mismatch since the server rendered nothing). Rendering `null` until the
// effect fires means the server and the client's first paint agree (both render nothing), and
// the streak value appears as a normal post-mount state update — never a hydration mismatch.
// streak.ts's own record never changes while this page stays mounted (the only writer,
// recordDailyCompletion, runs from a game's own terminal-transition effect, on a different
// route) — so a one-time read-on-mount is correct here, not a subscription.

import { useEffect, useState } from "react";
import { readStreak, shouldShowStreakFlame } from "@twist-arcade/shell";

export function StreakBadge() {
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    const streak = readStreak();
    setCurrent(shouldShowStreakFlame(streak) ? streak.current : null);
  }, []);

  // Never a hollow placeholder (e.g. an empty badge or a bare "0"/"N") when there is no real
  // streak yet — absence is the honest state (this page's conflict-2 resolution: no fabricated
  // numbers, see app/page.tsx's own module doc). Nothing renders here at all until a genuine
  // nonzero streak is read from storage.
  if (current === null) return null;

  return (
    <span
      className="inline-flex shrink-0 -rotate-3 items-center gap-1 border-ui border-ink bg-marker px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-ink shadow-print-2"
      aria-label={`${current} day streak`}
    >
      <span aria-hidden="true">🔥</span>
      {current}
    </span>
  );
}

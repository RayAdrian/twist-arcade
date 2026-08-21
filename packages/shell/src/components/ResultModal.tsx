// packages/shell/src/components/ResultModal.tsx — plan §4.10: "the most important screen"
// (ux-lens §5). shadcn Dialog, full-screen takeover. Strict priority order, top to bottom:
// result + texture line -> move-timeline artifact preview -> Rematch (primary, initial focus)
// -> Next twist (secondary, with its rule sentence, hidden entirely when there is none) ->
// Share (tertiary) -> streak line -> (reserved account-offer slot — empty until Phase 3, not
// built). Focus trapped (Radix Dialog default); Escape closes to the finished board.
//
// Simplification, documented (S1 scope): the exact per-variant COPY table (won/lost/draw/
// scored/solo variants, §7.2) is solo-accommodation work assigned to S3/Phase 1, alongside
// ScoreHUD wiring and the daily header. This component builds the reusable MACHINERY — layout
// priority order, focus management, the share outcome state machine (idle/pending/copied/
// failed) — generically: the caller (GameShell, and later the S3 solo wiring) passes an
// already-composed `resultText` rather than this component deriving copy from `Status` itself.
//
// "use client" — hooks (see board-context.tsx's comment).
"use client";

import { useEffect, useRef, useState } from "react";
import type { GameManifest } from "@twist-arcade/game-spec";
import type { ShareOutcome } from "../share-frame";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

export interface ResultModalProps {
  open: boolean;
  resultText: string;
  textureLine?: string;
  /** The game's shareArtifact() output — also displayed as the move-timeline preview. */
  artifactBody: string;
  /** The FULL composed share text (title + result phrase + artifactBody + daily/restart
   *  decoration + url — the exact text a successful share would have sent), shown in the
   *  share-failed fallback (I4). Deliberately NOT just `artifactBody`: the player should be
   *  able to copy/share the same thing a working share button would have, not merely the
   *  game's own move-timeline fragment in isolation. */
  shareFallbackText: string;
  /** Exactly one suggestion, or null when there is no other game in the registry (§8.4). */
  nextTwist: GameManifest | null;
  /** Canonical path to `nextTwist` (e.g. `/play/{id}`) — rendered as a REAL `<a href>` (C4: this
   *  entry previously had no navigation seam at all — GameShell built its own onClick handler
   *  with a comment saying "the caller wires navigation," but exposed no prop for a caller to do
   *  so). Ignored (any value is fine, including "") when `nextTwist` is null. */
  nextTwistHref: string;
  onRematch(): void;
  /** Fires on click, purely for the caller's no-repeat bookkeeping (`recentlyShownId`) — never
   *  the navigation itself; the `<a href>` above IS the navigation (C4). Optional since a caller
   *  with no bookkeeping need (or a test) shouldn't be forced to pass a no-op. */
  onNextTwistClick?(): void;
  onShare(): Promise<ShareOutcome>;
  /** Escape closes to the finished board — the board stays inspectable underneath. */
  onOpenChange(open: boolean): void;
  streakLine?: string;
  /** Default "Rematch" — solo/daily variants (S3) relabel this ("Try again", etc.). */
  primaryLabel?: string;
  /** Design 2a's rotated "day N" stamp — rendered only when this result is a certified daily
   *  run (the caller's own `daily.dayNumber`, e.g. GameShell's `daily` prop). Omitted entirely
   *  (no stamp) for a casual, non-daily result. */
  dayNumber?: number;
}

// "dismissed" (stage-6 must-fix 1: the user backed out of the native share sheet) renders
// identically to "idle" below — nothing happened, so there is nothing to confirm or apologize
// for. It is its own ShareState member rather than reusing "idle" directly so `onShare`'s
// return value maps 1:1 onto a state without a lossy translation step at the call site.
type ShareState = { kind: "idle" } | { kind: "copied" } | { kind: "shared" } | { kind: "dismissed" } | { kind: "failed" };

const COPIED_CONFIRMATION_MS = 2000;

export function ResultModal({
  open,
  resultText,
  textureLine,
  artifactBody,
  shareFallbackText,
  nextTwist,
  nextTwistHref,
  onRematch,
  onNextTwistClick,
  onShare,
  onOpenChange,
  streakLine,
  primaryLabel = "Rematch",
  dayNumber,
}: ResultModalProps) {
  const rematchRef = useRef<HTMLButtonElement>(null);
  const [shareState, setShareState] = useState<ShareState>({ kind: "idle" });

  useEffect(() => {
    if (shareState.kind !== "copied") return;
    const timer = setTimeout(() => setShareState({ kind: "idle" }), COPIED_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [shareState]);

  // Reset transient share state every time the modal (re)opens for a new result.
  useEffect(() => {
    if (open) setShareState({ kind: "idle" });
  }, [open]);

  async function handleShare() {
    const outcome = await onShare();
    setShareState({ kind: outcome });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="relative max-w-md rounded-xl border-brush border-ink bg-paper-lift p-6 shadow-print-4"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          rematchRef.current?.focus();
        }}
      >
        {dayNumber !== undefined && (
          <span
            aria-hidden="true"
            className="absolute -top-3 right-3 rotate-3 rounded border-ui border-ink bg-accent-p2 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-paper shadow-print-2"
          >
            day {dayNumber}
          </span>
        )}

        {/* Material pass only (UI direction §4 is the full torn-score-slip rebuild — sheet/
         *  slip layout, stamp rotation + winner-accent color, receipt-tear mask, staggered
         *  timeline entrance — all deferred to that later item, which also needs a winner-accent
         *  prop this component doesn't take yet). This restyle stays inside item 1's "material
         *  foundation" scope: paper-lift surface, print-shop stroke/shadow, and the three type
         *  faces, with every existing prop, behavior, and test-visible string untouched. */}
        <DialogTitle className="text-center font-display text-2xl font-bold text-ink">{resultText}</DialogTitle>
        {textureLine && <p className="text-center font-texture text-ink-muted">{textureLine}</p>}

        <p className="my-4 text-center font-mono text-2xl tracking-wide" aria-label="move timeline">
          {artifactBody}
        </p>

        <div className="flex flex-col gap-3">
          <button
            ref={rematchRef}
            type="button"
            onClick={onRematch}
            className="h-14 rounded-xl border-brush border-ink bg-paper-lift font-display text-lg font-bold text-ink shadow-print-3 active:translate-x-0.5 active:translate-y-0.5 active:shadow-print-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {primaryLabel}
          </button>

          {nextTwist && (
            <a
              href={nextTwistHref}
              onClick={onNextTwistClick}
              className="rounded-xl border-ui border-ink-muted bg-paper-lift px-4 py-2 text-left shadow-print-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="font-display font-semibold text-ink">{`Next: ${nextTwist.title} →`}</span>
              <br />
              <span className="font-texture text-ink-muted">{nextTwist.ruleSentence}</span>
            </a>
          )}

          <div>
            <button
              type="button"
              onClick={handleShare}
              className="h-12 w-full rounded-xl border-hairline border-ink-muted text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              ↗ Share result
            </button>
            {shareState.kind === "copied" && (
              <p role="status" className="mt-1 inline-block rounded-full bg-marker px-3 py-1 text-center text-sm font-medium text-ink">
                Copied
              </p>
            )}
            {shareState.kind === "failed" && (
              <div role="status" className="mt-1 text-center text-sm text-ink-muted">
                <p>Couldn&apos;t share — long-press to copy</p>
                {/* I4: the FULL composed text (title, result, url, daily/restart lines), not
                 *  just the game's own artifactBody fragment — a <textarea> (not <input>) so
                 *  every line is actually visible, not squished/scrolled in a single-line box. */}
                <textarea
                  readOnly
                  value={shareFallbackText}
                  aria-label="Share text"
                  rows={shareFallbackText.split("\n").length}
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1 w-full resize-none rounded-lg border-hairline border-ink-muted bg-paper-shade px-2 py-1 text-center text-ink"
                />
              </div>
            )}
          </div>
        </div>

        {streakLine && <p className="mt-4 text-center font-mono text-sm text-ink-muted">{streakLine}</p>}
      </DialogContent>
    </Dialog>
  );
}

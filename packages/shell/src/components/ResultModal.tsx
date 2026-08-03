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
  /** Exactly one suggestion, or null when there is no other game in the registry (§8.4). */
  nextTwist: GameManifest | null;
  onRematch(): void;
  onNextTwist(): void;
  onShare(): Promise<ShareOutcome>;
  /** Escape closes to the finished board — the board stays inspectable underneath. */
  onOpenChange(open: boolean): void;
  streakLine?: string;
  /** Default "Rematch" — solo/daily variants (S3) relabel this ("Try again", etc.). */
  primaryLabel?: string;
}

type ShareState = { kind: "idle" } | { kind: "copied" } | { kind: "shared" } | { kind: "failed" };

const COPIED_CONFIRMATION_MS = 2000;

export function ResultModal({
  open,
  resultText,
  textureLine,
  artifactBody,
  nextTwist,
  onRematch,
  onNextTwist,
  onShare,
  onOpenChange,
  streakLine,
  primaryLabel = "Rematch",
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
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          rematchRef.current?.focus();
        }}
      >
        <DialogTitle className="text-center text-lg font-bold text-ink">{resultText}</DialogTitle>
        {textureLine && <p className="text-center text-sm text-ink-muted">{textureLine}</p>}

        <p className="my-4 text-center text-2xl" aria-label="move timeline">
          {artifactBody}
        </p>

        <div className="flex flex-col gap-3">
          <button
            ref={rematchRef}
            type="button"
            onClick={onRematch}
            className="rounded border-2 border-ink px-4 py-3 font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {primaryLabel}
          </button>

          {nextTwist && (
            <button
              type="button"
              onClick={onNextTwist}
              className="rounded border border-ink-muted px-4 py-2 text-left text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="font-medium">{`Next: ${nextTwist.title} →`}</span>
              <br />
              <span className="text-ink-muted">{nextTwist.ruleSentence}</span>
            </button>
          )}

          <div>
            <button
              type="button"
              onClick={handleShare}
              className="w-full rounded px-4 py-2 text-sm text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              ↗ Share result
            </button>
            {shareState.kind === "copied" && (
              <p role="status" className="text-center text-sm text-ink-muted">
                Copied
              </p>
            )}
            {shareState.kind === "failed" && (
              <div role="status" className="mt-1 text-center text-sm text-ink-muted">
                <p>Couldn&apos;t share — long-press to copy</p>
                <input
                  readOnly
                  value={artifactBody}
                  aria-label="Share text"
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1 w-full rounded border border-ink-muted bg-paper px-2 py-1 text-center text-ink"
                />
              </div>
            )}
          </div>
        </div>

        {streakLine && <p className="mt-4 text-center text-sm text-ink-muted">{streakLine}</p>}
      </DialogContent>
    </Dialog>
  );
}

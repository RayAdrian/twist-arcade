// packages/shell/src/components/HowSheet.tsx — plan §4.3. Bottom sheet: the rule sentence +
// the game's 3-frame illustrated strip, nothing else. Built on the Dialog primitive (focus
// trap, Esc-to-close, scrim-tap-to-close, and focus-return-to-trigger all come from Radix's
// Dialog for free); positioned as a bottom sheet rather than a centered modal.
//
// "use client" — an interactive dialog (open/onOpenChange), and needed regardless so this
// file never breaks a Server Component's build via the shared barrel (board-context.tsx's
// comment has the full story).
"use client";

import type { Frame } from "@twist-arcade/game-spec";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

export interface HowSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  sentence: string;
  frames: [Frame, Frame, Frame];
}

function isEmptyFrame(frame: Frame): boolean {
  return frame.title.trim().length === 0 && frame.body.trim().length === 0;
}

export function HowSheet({ open, onOpenChange, sentence, frames }: HowSheetProps) {
  // "frame-asset missing" (plan §4.3): a blank frame degrades out of the strip entirely
  // rather than rendering an empty-looking card — the sentence alone is never blocked.
  const visibleFrames = frames.filter((f) => !isEmptyFrame(f));

  // Design 2a's alternating step-chip colors (ink / accent-p1 / accent-p2), cycling if a game
  // ever grows beyond 3 steps — purely decorative numbering, never load-bearing for order
  // (the list itself is already ordered DOM, `<ol>`).
  const CHIP_BG = ["bg-accent-p1", "bg-accent-p2", "bg-ink"];
  const TILTS = ["-rotate-[0.3deg]", "rotate-[0.25deg]", "-rotate-[0.2deg]"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bottom-0 left-1/2 top-auto max-h-[85dvh] max-h-[85svh] w-full max-w-lg -translate-x-1/2 translate-y-0 rounded-b-none rounded-t-lg border-brush border-ink bg-paper-lift shadow-print-4"
        aria-describedby={undefined}
      >
        <span aria-hidden="true" className="mx-auto block h-1 w-12 rounded-full bg-ink-muted" />
        <DialogTitle className="mt-2 inline-block rounded border-hairline border-ink bg-accent-p2 px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-paper">
          How this twist works
        </DialogTitle>
        <p className="mt-3 font-display text-xl font-extrabold text-ink">{sentence}</p>
        {visibleFrames.length > 0 && (
          <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {visibleFrames.map((frame, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-xl border-ui border-ink bg-paper-zine p-3 ${TILTS[i % TILTS.length]}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-mono text-sm font-semibold text-paper ${CHIP_BG[i % CHIP_BG.length]}`}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-display font-bold text-ink">{frame.title}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{frame.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

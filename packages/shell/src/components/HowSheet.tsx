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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bottom-0 left-1/2 top-auto max-h-[85dvh] max-h-[85svh] w-full max-w-lg -translate-x-1/2 translate-y-0 rounded-b-none rounded-t-lg"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          How this twist works
        </DialogTitle>
        <p className="text-ink">{sentence}</p>
        {visibleFrames.length > 0 && (
          <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {visibleFrames.map((frame, i) => (
              <li key={i} className="rounded border border-ink-muted p-2">
                <p className="font-bold text-ink">{frame.title}</p>
                <p className="text-sm text-ink-muted">{frame.body}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

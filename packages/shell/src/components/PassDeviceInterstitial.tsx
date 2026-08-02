// packages/shell/src/components/PassDeviceInterstitial.tsx — plan §4.12. Variant chosen by
// `engine.meta.hiddenInformation` (the caller's job, not this component's): `true` -> a
// full-screen BLOCKING interstitial (board hidden, focus on the confirm button); `false`
// (open-info, e.g. Fadeout) -> a non-blocking turn BANNER — board stays visible, input is
// already enabled for the next player, so there is nothing to confirm and no button at all.

import { useEffect, useRef } from "react";

export interface PassDeviceInterstitialProps {
  nextLabel: string;
  variant: "blocking" | "banner";
  onReady(): void;
}

export function PassDeviceInterstitial({ nextLabel, variant, onReady }: PassDeviceInterstitialProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (variant === "blocking") buttonRef.current?.focus();
  }, [variant]);

  if (variant === "banner") {
    return (
      <div role="status" className="rounded bg-paper px-3 py-2 text-center text-sm text-ink">
        Pass the device to {nextLabel}.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-paper text-ink">
      <p className="text-lg">Pass the device to {nextLabel}.</p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onReady}
        className="rounded border-2 border-ink px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        I&apos;m {nextLabel} — show board
      </button>
    </div>
  );
}

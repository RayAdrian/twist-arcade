// app/play/[gameId]/loading.tsx — the board-shaped skeleton Next shows while the async
// PlayPage server component resolves (plan §3.1). Deliberately similar to GameShell's own
// internal "loading" state visual (packages/shell/src/components/GameShell.tsx) — the two
// hand off to each other so nothing visibly jumps: this fires before the page's `gameId` is
// even known, so it can't paint the real rule sentence yet.

export default function PlayLoading() {
  return (
    <div className="mx-auto max-w-md p-4">
      <div aria-hidden="true" className="h-5 w-40 animate-pulse rounded bg-ink-muted/20" />
      <div aria-hidden="true" className="mt-3 h-4 w-full animate-pulse rounded bg-ink-muted/20" />
      <div
        aria-hidden="true"
        className="relative mx-auto mt-4 animate-pulse rounded bg-ink-muted/20"
        style={{ width: "min(calc(100vw - 32px), 52svh)", aspectRatio: "1 / 1" }}
      />
    </div>
  );
}

// packages/shell/src/components/AriaAnnouncer.tsx — plan §4.14. Singleton per page: one
// POLITE aria-live region for turn flow, one ASSERTIVE region used exactly once per game for
// the result. Visually hidden. Purely presentational — the composition happens in
// announcer.ts / useGame; this component just renders whatever it's handed. Content REPLACES
// each render (no queue), which is what "latest state wins" requires.

export interface AriaAnnouncerProps {
  polite: string;
  assertive: string;
}

export function AriaAnnouncer({ polite, assertive }: AriaAnnouncerProps) {
  return (
    <>
      <div aria-live="polite" role="status" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" role="alert" className="sr-only">
        {assertive}
      </div>
    </>
  );
}

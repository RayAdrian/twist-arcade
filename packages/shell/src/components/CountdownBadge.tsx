// packages/shell/src/components/CountdownBadge.tsx — plan §4.6. The AUTHORITATIVE imminence
// encoding: opacity (Cell's ageStep) suggests, this numeral states. >=16px circle, bold
// numeral, 4.5:1 in both themes (ink-on-paper reversed: a solid ink disc with a paper-colored
// numeral — verified in test/tokens.contrast.test.ts since ink/paper always clears 4.5:1).
//
// Server-renderable (no interactivity) — aria-hidden because the SAME information is already
// present in the cell's accessibleName ("...fades in 1 turn"); a sighted+screen-reader user
// would otherwise hear it announced twice.

export interface CountdownBadgeProps {
  value: number;
}

export function CountdownBadge({ value }: CountdownBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[11px] font-bold leading-none text-paper"
    >
      {value}
    </span>
  );
}

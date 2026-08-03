// packages/shell/src/components/Cell.tsx — plan §4.5. Shell owns target/focus/badge-slot/
// ghost-rendering/the >=48px floor; the game owns `occupant` content only.
//
// "use client" — hooks + pointer/keyboard handlers (see board-context.tsx's comment).
"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { AGE_OPACITY } from "../design-tokens";
import { useBoardContext } from "./board-context";
import { CountdownBadge } from "./CountdownBadge";

export interface CellProps {
  id: string;
  row: number;
  col: number;
  occupant?: ReactNode;
  ageStep?: 0 | 1 | 2;
  countdown?: number;
  ghost?: ReactNode;
  staged?: boolean;
  accessibleName: string;
  disabled?: boolean;
  /** Default 48 (plan §7's floor). The ONE sanctioned seam for a game to legally use a smaller
   *  tappable target — e.g. Mine Run's 32px cells, paired with its own two-tap confirm flow so
   *  a smaller, denser board still can't be mis-tapped into an irreversible move. Before this,
   *  MIN_CELL_PX and the `min-w-[48px]`/`min-h-[48px]` classes were hardcoded here with no way
   *  for any game to opt into a different floor at all. */
  minCellPx?: number;
}

const DEFAULT_MIN_CELL_PX = 48;

export function Cell({
  id,
  row,
  col,
  occupant,
  ageStep = 0,
  countdown,
  ghost,
  staged,
  accessibleName,
  disabled,
  minCellPx = DEFAULT_MIN_CELL_PX,
}: CellProps) {
  const board = useBoardContext();
  const ref = useRef<HTMLDivElement>(null);
  const pointerDownAt = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return board.registerCell(id, { row, col, el });
    // `board` is intentionally omitted: registerCell's identity is stable across BoardShell
    // renders in practice, and re-running this effect on every BoardShell re-render would
    // thrash the registry (unregister/re-register every Cell on any state change).
  }, [id, row, col]);

  // Dev-mode cell-size floor (plan §4.4/§11.2): the Playwright 320px-viewport test is the
  // real CI gate; this ResizeObserver is the fast-feedback dev-time companion, guarded so it
  // never runs in production and never throws where ResizeObserver is unavailable.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof ResizeObserver === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && width < minCellPx) {
          console.error(
            `Cell "${id}": width ${width}px is below the ${minCellPx}px minimum tappable-target floor (plan §7). Redesign the board — do not shrink the target.`
          );
        }
        if (height > 0 && height < minCellPx) {
          console.error(
            `Cell "${id}": height ${height}px is below the ${minCellPx}px minimum tappable-target floor (plan §7). Redesign the board — do not shrink the target.`
          );
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, minCellPx]);

  const isCursor = board.cursor.row === row && board.cursor.col === col;

  function tryCommit(actionAt: number) {
    board.commit(id, actionAt, disabled);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    pointerDownAt.current = performance.now();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const downAt = pointerDownAt.current;
    pointerDownAt.current = null;
    if (downAt === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) tryCommit(downAt);
  }

  function onPointerCancel() {
    pointerDownAt.current = null;
  }

  // C5: an assistive-tech activation (e.g. TalkBack's double-tap gesture) may dispatch a bare
  // `click` with no pointerdown/pointerup pair at all — `onPointerUp` alone leaves that gesture
  // with no path to `commit()`, and the board would silently never respond to it. A REAL pointer
  // tap already commits via `onPointerUp` above, and the browser's own follow-up synthetic
  // `click` for that tap always carries `detail >= 1` (the OS/browser-assigned click count) —
  // only a script/AT-synthesized click reports `detail === 0` — so gating on that is how this
  // commits the AT gesture without ever double-committing a real tap.
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.detail === 0) tryCommit(performance.now());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tryCommit(performance.now());
    }
  }

  // I8: this inline `style.opacity` value ALWAYS wins over the `opacity-50` utility CLASS below
  // (inline style beats any class at the same element, full stop) — so `staged` previously had
  // a class that could never actually take visual effect. `staged` must be accounted for HERE,
  // in the computed value itself, not just as a class alongside it.
  const opacity = staged ? 0.5 : ageStep === 1 ? AGE_OPACITY[1] : ageStep === 2 ? AGE_OPACITY[2] : AGE_OPACITY[0];
  const transitionClass = board.reducedMotion ? "" : "transition-opacity duration-age ease-arcade";

  return (
    <div
      ref={ref}
      id={`cell-${id}`}
      role="gridcell"
      aria-label={accessibleName}
      aria-disabled={disabled ? "true" : undefined}
      aria-rowindex={row + 1}
      aria-colindex={col + 1}
      data-age={ageStep}
      data-staged={staged ? "true" : undefined}
      tabIndex={isCursor ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onKeyDown={onKeyDown}
      // `minWidth`/`minHeight` are inline (not a `min-w-[${minCellPx}px]` Tailwind class) because
      // Tailwind's JIT scanner only ever sees LITERAL source text — a runtime-interpolated class
      // string never generates real CSS for it. Inline style has no such limitation and is
      // exactly how `opacity`/`aspectRatio` already work on this same element.
      style={{ opacity, aspectRatio: "1 / 1", minWidth: minCellPx, minHeight: minCellPx }}
      className={`relative flex items-center justify-center border border-ink-muted ${transitionClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
    >
      {ghost && (
        <span aria-hidden="true" className="absolute inset-2 border border-dashed border-ink-muted">
          {ghost}
        </span>
      )}
      {occupant}
      {countdown !== undefined && (
        <span className="absolute -right-1 -top-1">
          <CountdownBadge value={countdown} />
        </span>
      )}
    </div>
  );
}

// packages/shell/src/components/Cell.tsx — plan §4.5. Shell owns target/focus/badge-slot/
// ghost-rendering/the >=48px floor; the game owns `occupant` content only.

import { type ReactNode, useEffect, useRef } from "react";
import { AGE_OPACITY } from "../design-tokens";
import { useBoardContext } from "./board-context";
import { CountdownBadge } from "./CountdownBadge";

const MIN_CELL_PX = 48;

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
}

export function Cell({ id, row, col, occupant, ageStep = 0, countdown, ghost, staged, accessibleName, disabled }: CellProps) {
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
        if (width > 0 && width < MIN_CELL_PX) {
          console.error(
            `Cell "${id}": width ${width}px is below the 48px minimum tappable-target floor (plan §7). Redesign the board — do not shrink the target.`
          );
        }
        if (height > 0 && height < MIN_CELL_PX) {
          console.error(
            `Cell "${id}": height ${height}px is below the 48px minimum tappable-target floor (plan §7). Redesign the board — do not shrink the target.`
          );
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

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

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tryCommit(performance.now());
    }
  }

  const opacity = ageStep === 1 ? AGE_OPACITY[1] : ageStep === 2 ? AGE_OPACITY[2] : AGE_OPACITY[0];
  const transitionClass = board.reducedMotion ? "" : "transition-opacity duration-age ease-arcade";

  return (
    <div
      ref={ref}
      id={`cell-${id}`}
      role="gridcell"
      aria-label={accessibleName}
      aria-disabled={disabled ? "true" : undefined}
      data-age={ageStep}
      data-staged={staged ? "true" : undefined}
      tabIndex={isCursor ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      style={{ opacity, aspectRatio: "1 / 1" }}
      className={`relative flex min-h-[48px] min-w-[48px] items-center justify-center border border-ink-muted ${transitionClass} ${
        staged ? "opacity-50" : ""
      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
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

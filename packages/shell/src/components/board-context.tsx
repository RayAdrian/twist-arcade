// packages/shell/src/components/board-context.tsx — BoardContext (plan §4.4): the machinery
// shared between BoardShell (the provider) and every Cell (the consumer). Games never read
// this directly — it's internal shell wiring.
//
// "use client" — useContext is a hook; without this, any Server Component reachable through
// the package's barrel (packages/shell/src/index.ts) that imports something re-exported
// alongside this file fails the Next.js build ("You're importing a component that needs
// useContext... mark the file with the 'use client' directive") — discovered when app/page.tsx
// (a Server Component importing only GameCard from the same barrel) broke `next build` because
// every hook-using shell component lacked its own directive and only GameShell had one.
"use client";

import { createContext, useContext } from "react";

export interface CellRegistration {
  row: number;
  col: number;
  el: HTMLElement;
}

export interface BoardContextValue {
  rows: number;
  cols: number;
  disabled: boolean;
  reducedMotion: boolean;
  cursor: { row: number; col: number };
  /** Registers a cell's grid position for keyboard-cursor math and the first-occurrence
   *  callout's anchor resolution (plan §6.3). Returns an unregister function. */
  registerCell(cellId: string, reg: CellRegistration): () => void;
  /** Moves the roving-tabindex cursor AND real DOM focus to (row, col), clamped to bounds. */
  moveCursor(row: number, col: number): void;
  /** Resolves a registered cell's DOM element by id — used by CalloutLayer to anchor a
   *  first-occurrence callout at the cell the game names (plan §6.3's anchor-resolution
   *  convention). Returns undefined for an unregistered id (the cell vanished, or the game
   *  passed something that was never a real cellId) — CalloutLayer degrades to the board's
   *  top edge in that case, never throwing. */
  getCellElement(cellId: string): HTMLElement | undefined;
  /** The board grid's own container element, used as CalloutLayer's degraded fallback
   *  anchor ("the board's top edge") when a named cellId isn't registered. */
  boardEl: HTMLElement | null;
  /** Requests a commit for `cellId`. `actionAt` is the instant the GESTURE began (pointerdown
   *  for pointer input, the keydown instant for keyboard) — NOT necessarily "now", since a
   *  drag can complete after a lockout window closes but must still be judged by when it
   *  started (plan §7's "ignore taps within 250ms of a board-state change" rule). Silently
   *  no-ops when the board is disabled or the action began during a lockout window. */
  commit(cellId: string, actionAt: number, cellDisabled?: boolean): void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) {
    throw new Error("Cell must be rendered inside a BoardShell (BoardContext is missing)");
  }
  return ctx;
}

// games/mine-run/index.ts — public package surface for @twist-arcade/mine-run.
//
// package.json's main/types/exports all point at this file (matching the same convention
// @twist-arcade/engine and @twist-arcade/game-spec use: `"main": "./src/index.ts"` there,
// `"./index.ts"` here since this package has no src/ subdirectory). Before this file existed,
// `import("@twist-arcade/mine-run")` threw ERR_MODULE_NOT_FOUND (Fable review should-fix 5) —
// nothing consumes the package yet, but registry wiring (`games/registry.ts`) will hit this
// immediately, and the M1 review already flagged the identically-shaped gap (G-13) once.
//
// Re-exports the GameEngine surface (engine.ts), the CSP module (csp.ts), the mandatory
// Always-Safe hook (probes.ts, platform §6/§7.4 — the harness hard-errors without one for a
// solo score chase), the redaction secretExtractor (secret.ts), AND (below) the GamePresentation
// assembly + GameDefinition — this is the UI pass (gates settled per C46/C52, registration is
// the explicit post-gate step per C15/C28), mirroring games/tilt/index.ts's own structure.

export {
  createMineRun,
  mineRun,
  MineRunDecodeError,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_MINES,
  DEFAULT_BUDGET,
  neighbors,
  countAdjacentMines,
  floodFrom,
} from "./engine";
export type {
  MineRunState,
  MineRunMove,
  MineRunView,
  MineRunCellView,
  CreateMineRunOptions,
} from "./engine";

export { analyzeFrontier, sampleConsistentState, frontierFallbackUsed, frontierComponentCount } from "./csp";
export type { FrontierAnalysis } from "./csp";

export { createMineRunHeuristic } from "./heuristic";

export { safeMove, chooseSafeMove, assertRevealBudgetScarcity, RevealBudgetNotScarceError } from "./probes";

export { makeMineRunSecretExtractor, mineSecretToken, MINES_FIELD_TOKEN } from "./secret";

// --- presentation assembly (mine-run.md §8, gates settled — C46/C52) ----------------------

import { replay } from "@twist-arcade/engine";
import type { Effect, ReplayRecord } from "@twist-arcade/engine";
import type { GameDefinition, GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { moveToCellId, timelineToBody } from "@twist-arcade/shell";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, mineRun } from "./engine";
import type { MineRunMove, MineRunState, MineRunView } from "./engine";
import { mineRunManifest } from "./manifest";
import { boardSummaryText, imminentTrailer, movedText, statusText } from "./ui/announce";
import { BankBar } from "./ui/BankBar";
import { Board } from "./ui/Board";

function numberField(e: Effect, field: string): number | undefined {
  const v = e[field];
  return typeof v === "number" ? v : undefined;
}

/**
 * ANNOUNCE COMPOSITION (see ui/announce.ts's own module doc for the full reasoning): "moved"
 * carries what happened from `effects` alone; "imminent" carries the streak/vault/reveals-left
 * trailer from `view`, since "moved" never receives one (game-spec's own GameEvent contract).
 * Both compose into the SAME polite-region sentence, in the same dispatch, in useGame.ts — this
 * mirrors Tilt's own "moved"+"imminent" split (games/tilt/index.ts), just with the roles of
 * "what happened" vs. "what's imminent" reassigned to "what happened" vs. "what that leaves you
 * with", since Mine Run has no analogous proximity-to-event countdown to report.
 */
function announce(ev: GameEvent<MineRunView>): string {
  switch (ev.kind) {
    case "moved":
      return movedText(ev.effects);
    case "imminent":
      return imminentTrailer(ev.effects, ev.view);
    case "boardSummary":
      return boardSummaryText(ev.view);
    case "status":
      return statusText(ev.status);
  }
}

/**
 * The bank/mine event sequence, bare HOUSE_ALPHABET glyphs only (packages/shell/src/
 * share-frame.ts's `HOUSE_ALPHABET = [..., "💥", ..., "🏦"]` and its `validateBody`/
 * `tokenizeBodyLine` — a fixed alphabet of BARE glyphs, no embedded digits, no separators).
 *
 * DEVIATION FROM mine-run.md §7's LITERAL EXAMPLE, FOUND WHILE IMPLEMENTING, NOT BEFORE: the
 * plan's own worked examples show space-separated, number-suffixed tokens ("🏦7 🏦12 🏦9 💥 🏦21
 * 💥 🏦4"). That string cannot pass `validateBody` as shipped — spaces and digits are not in
 * `HOUSE_ALPHABET`, and `tokenizeBodyLine` throws `ShareGrammarError` on the first character
 * outside the allowed set. Every other shipped game (Fadeout, Crackstep) already resolves this
 * by keeping the body a bare-glyph SEQUENCE and moving numbers into the free-text `statLine`
 * (uncapped alphabet, only a length cap) — this file follows that same, already-established
 * convention rather than inventing a second one. Reported per the standing brief: the document
 * disagreed with the shipped grammar module, and the shipped module wins.
 */
export function mineRunShareSymbols(record: ReplayRecord): string[] {
  const { states } = replay(mineRun, record);
  const symbols: string[] = [];
  for (let i = 0; i < record.steps.length; i++) {
    const after = states[i + 1]!;
    for (const e of after.lastEffects) {
      if (e.type === "banked") symbols.push("\u{1F3E6}"); // 🏦
      if (e.type === "exploded") symbols.push("\u{1F4A5}"); // 💥
    }
  }
  return symbols;
}

// `finalView` is part of GamePresentation's frozen shareArtifact signature but unused here: the
// bank/mine sequence and best-streak figure are both derived from `record` via `replay()` (the
// full move-by-move trajectory, which `finalView` alone cannot provide), matching Crackstep's
// own `shareArtifact` which derives everything from `record` for the identical reason.
function shareArtifact(record: ReplayRecord, _finalView: MineRunView): string {
  const symbols = mineRunShareSymbols(record);
  const minesHit = symbols.filter((s) => s === "\u{1F4A5}").length;

  // Best streak ever reached (not just the final one, which may have been banked or wiped away
  // long before the run ended) — the honest "how far did you push it" number, derived the same
  // way crackstepShareSymbols derives its own per-step facts: from the REPLAYED states, not a
  // re-guess from finalView alone.
  const { states } = replay(mineRun, record);
  let bestStreak = 0;
  for (const s of states) bestStreak = Math.max(bestStreak, s.streakValue);

  const statLine =
    minesHit === 0
      ? "never lost a point"
      : `best streak ${bestStreak} \u{00B7} ${minesHit} streak${minesHit === 1 ? "" : "s"} lost to mines`;

  return `${timelineToBody(symbols)}\n${statLine}`;
}

/**
 * textureLine (mine-run.md §7): only the ONE template below is honestly computable from this
 * hook's real signature, `textureLine?(finalView: V): string` — a single terminal VIEW, no
 * `ReplayRecord`. The plan's other two templates ("Your 21-streak died one square from a
 * proven-safe run", "Banked 12 — the next square was a mine") both narrate a SPECIFIC past
 * event (which cell, what was available at that moment) that only exists in the move log —
 * this hook is never handed one (contrast `shareArtifact`, which is). Shipping either of those
 * from `finalView` alone would mean fabricating a claim about history this function cannot see
 * — exactly the class of error C18 found in Crackstep's own share invariant. Documented as a
 * scope cut, not silently dropped, matching Tilt's own precedent for a signature-shaped gap.
 */
function textureLine(finalView: MineRunView): string {
  if (finalView.minesExploded === 0 && finalView.banked === 0) {
    return "Never gambled, never lost \u{2014} never rich.";
  }
  return "";
}

const howSheetFrames: GamePresentation<MineRunState, MineRunMove, MineRunView>["howSheetFrames"] = [
  { title: "Reveal to grow the streak", body: "Reveal squares safely and the streak climbs: +1, +2, +3." },
  { title: "Bank to keep it", body: "Bank anytime to move the streak into your vault — banked points are safe forever." },
  { title: "A mine wipes what's unbanked", body: "Hit a mine and only your UNBANKED streak is lost. What's already banked stays yours." },
];

export const presentation: GamePresentation<MineRunState, MineRunMove, MineRunView> = {
  Board,
  extraControls: BankBar,

  boardDimensions(_view: MineRunView): { rows: number; cols: number } {
    return { rows: DEFAULT_HEIGHT, cols: DEFAULT_WIDTH };
  },

  announce,

  // mine-run.md §8.3: two distinct teachable firsts (a real, shipped use of the platform's
  // firstOccurrence ARRAY — platform-corrections.md's "Related" section: "games have more than
  // one teachable first... each entry carries its own once-per-device flag key"). Callout TEXT
  // is a plain string per game-spec's frozen contract (not a function of the event) — the plan's
  // own examples embed the dynamic streak-lost/banked amount ("streak of 12", "Banked —"), which
  // this hook cannot parameterize; Fadeout's firstOccurrence carries the identical, already-
  // documented limitation for its own analogous callout.
  firstOccurrence: [
    {
      flagKey: "mine-run-first-mine",
      trigger(ev: GameEvent<MineRunView>): boolean {
        return ev.kind === "moved" && ev.effects.some((e) => e.type === "exploded");
      },
      text: "\u{1F4A5} Mine — your unbanked streak is gone. Banked points are safe.",
      anchor(ev: GameEvent<MineRunView>) {
        if (ev.kind !== "moved") return "";
        const exploded = ev.effects.find((e) => e.type === "exploded");
        const cell = exploded ? numberField(exploded, "cell") : undefined;
        return cell === undefined ? "" : moveToCellId({ t: "reveal", cell } satisfies MineRunMove);
      },
    },
    {
      flagKey: "mine-run-first-bank",
      trigger(ev: GameEvent<MineRunView>): boolean {
        return ev.kind === "moved" && ev.effects.some((e) => e.type === "banked");
      },
      text: "Banked — these points are safe for the rest of the run.",
      // No single cell to anchor a bank confirmation at (it is not tied to a board position) —
      // a non-string anchor is CalloutLayer's own documented degraded case, resolving to the
      // board's top edge, which is the right fallback for a whole-board confirmation.
      anchor(ev: GameEvent<MineRunView>) {
        return ev.kind === "moved" ? ev.move : null;
      },
    },
  ],

  shareArtifact,
  howSheetFrames,
  textureLine,
};

export const definition: GameDefinition<MineRunState, MineRunMove, MineRunView> = {
  manifest: mineRunManifest,
  engine: mineRun,
  presentation,
};

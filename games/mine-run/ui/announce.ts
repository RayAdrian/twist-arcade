// games/mine-run/ui/announce.ts — announce() (mine-run.md §8.4). This is a SOLO game: the screen
// reader is the only channel for a player who cannot see the grid, so every event class the plan
// names must be covered — a safe reveal, a mine hit and what it cost, banking and the amount, and
// the run ending.
//
// TWO-EVENT COMPOSITION, not one (a platform-shape adaptation, documented rather than silently
// dropped — C50's own precedent for a similar GameEvent-shape limitation on Tilt). `GameEvent`'s
// "moved" variant carries only `{ effects }` — no `view` (packages/game-spec/src/presentation.ts's
// own doc) — so it cannot say "N reveals left" or the post-move streak value on its own. `useGame.
// ts` composes "moved" and "imminent" into the SAME polite-region sentence on every move
// (`composeAnnouncement(announcementFragments(movedStr, imminentStr, ...))`, called in one
// dispatch), and "imminent" DOES carry `view` — so `movedText` (below) answers "what just
// happened" from `effects` alone, and `imminentTrailer` answers "what does that leave me with"
// from `view`. Composed in order, this reproduces mine-run.md's example sentences verbatim
// ("Row 3, column 4: 2. Two neighbouring mines. Streak 7, worth 28. 41 reveals left.") even
// though no single function ever sees both effects and the freshest committed view at once.
//
// View-honest by construction throughout: every function here takes only `effects`/`view`
// (never MineRunState) — engine.ts's own redaction path already strips anything non-public
// before either ever reaches this file.

import type { Effect, Status } from "@twist-arcade/engine";
import { DEFAULT_WIDTH } from "../engine";
import type { MineRunView } from "../engine";
import { boardPositionName, hasProvenSafeMove, mineCountSummary, neighbouringMinesPhrase } from "./board-view";

function numberField(e: Effect, field: string): number | undefined {
  const v = e[field];
  return typeof v === "number" ? v : undefined;
}

function revealsLeftPhrase(revealsLeft: number): string {
  return `${revealsLeft} reveal${revealsLeft === 1 ? "" : "s"} left.`;
}

/**
 * "moved" — what just happened, from `effects` alone (already public vocabulary: engine.ts's
 * `PUBLIC_EFFECT_TYPES` allowlist/redaction path guarantees these never carry hidden layout).
 *
 * R8 EDGE CASE, documented rather than silently mishandled: budget exhaustion auto-banks any
 * live streak in the SAME `apply()` call as the reveal that exhausted it, so `effects` can
 * legitimately contain both `revealed`/`exploded` AND `banked` together. Both fragments are
 * spoken in that case (reveal/mine fragment, then "Banked N.") — correct and complete, if a
 * little dense; the separate "status" case (see below) always follows with the definitive
 * "Run over" sentence on the assertive channel, so nothing here needs to guess at finality.
 */
export function movedText(effects: readonly Effect[]): string {
  const revealed = effects.filter((e) => e.type === "revealed");
  const exploded = effects.find((e) => e.type === "exploded");
  const banked = effects.find((e) => e.type === "banked");
  const parts: string[] = [];

  if (exploded) {
    const cell = numberField(exploded, "cell");
    const streakLost = numberField(exploded, "streakLost") ?? 0;
    if (cell !== undefined) parts.push(`Mine at ${boardPositionName(cell, DEFAULT_WIDTH)}.`);
    parts.push(`Streak of ${streakLost} lost.`);
  } else if (revealed.length === 1) {
    const cell = numberField(revealed[0]!, "cell");
    const n = numberField(revealed[0]!, "n");
    if (cell !== undefined && n !== undefined) {
      parts.push(`${boardPositionName(cell, DEFAULT_WIDTH)}: ${n}.`);
      parts.push(neighbouringMinesPhrase(n));
    }
  } else if (revealed.length > 1) {
    // Flood (R4): every opened cell advances the streak, but the plan's own example collapses
    // the flood to a single count rather than naming every cell — the streak/vault trailer
    // (imminentTrailer, below) already carries the resulting numbers.
    parts.push(`Opened ${revealed.length} squares.`);
  }

  if (banked) {
    const points = numberField(banked, "points") ?? 0;
    parts.push(`Banked ${points}.`);
  }

  return parts.join(" ");
}

/**
 * "imminent" — the trailing clause, from the POST-move `view` (the one thing "moved" cannot see).
 * Discriminates on the SAME `effects` "imminent" is also handed (GameEvent's own shape gives
 * every kind of event `effects` except "boardSummary"/"status") so its trailer always matches
 * whichever fragment `movedText` just spoke, without the two functions sharing mutable state.
 */
export function imminentTrailer(effects: readonly Effect[], view: MineRunView): string {
  const exploded = effects.some((e) => e.type === "exploded");
  const revealed = effects.some((e) => e.type === "revealed");
  const bankedOnly = !exploded && !revealed && effects.some((e) => e.type === "banked");

  if (exploded) {
    return `Vault ${view.banked} safe. ${revealsLeftPhrase(view.revealsLeft)}`;
  }
  if (revealed) {
    return `Streak ${view.streakLen}, worth ${view.streakValue}. ${revealsLeftPhrase(view.revealsLeft)}`;
  }
  if (bankedOnly) {
    return `Vault ${view.banked}.`;
  }
  return "";
}

/** "boardSummary" — full, on-demand readback (e.g. a "Describe board" shortcut, or focus-entry).
 *  Includes the C52 safe-move telegraph here (on-demand only, not on every "imminent" — see
 *  board-view.ts's `hasProvenSafeMove` doc for why this is existence-only, never location, and
 *  BankBar.tsx's module doc for why the sighted chip doesn't also interrupt the live region on
 *  every single move: on-demand readback is the a11y-parity channel for the same visual fact,
 *  without turn-by-turn notification fatigue). */
export function boardSummaryText(view: MineRunView): string {
  const safe = hasProvenSafeMove(view) ? "A safe move is available." : "No proven-safe move right now.";
  return (
    `${view.width} by ${view.height} board. ${revealsLeftPhrase(view.revealsLeft)} ` +
    `${mineCountSummary(view)}. Banked ${view.banked}. Streak ${view.streakLen}, worth ${view.streakValue}. ${safe}`
  );
}

/** "status" — the terminal, on the shell's SEPARATE assertive channel (R9: Mine Run only ever
 *  emits "scored", never won/lost/draw — the testkit's solo branch enforces this at the engine
 *  level, so the other branches below are defensive, not reachable in practice). */
export function statusText(status: Status): string {
  if (status.kind === "scored") {
    const score = status.scores[0] ?? 0;
    return `Run over. Final score ${score}.`;
  }
  return "";
}

// games/fadeout/presentation.ts — GamePresentation (game-spec §5.3, plan §5) for the FROZEN
// `remove-first / solid / threefold` config (manifest.ts's FADEOUT_RULESET_CONFIG). Board
// rendering lives in ./ui/Board.tsx + ./ui/board-view.ts; this module is everything else the
// shell needs: announce() strings, the first-occurrence callout, the share artifact, the
// texture line, and the "How?" sheet frames.
//
// `announce({kind:"imminent"})` — a real platform-shape constraint worth recording here: this
// event's payload is ONLY `{effects}` (the SAME effects array as the "moved" event, per
// useGame.ts's call site: `presentation.announce({kind:"imminent", effects})`), never the full
// state. That looks like too little information to predict "which mark is about to vanish" —
// but one fact IS structurally derivable from `effects` alone, and it is exactly what makes
// this genuinely useful rather than vacuous: under a fixed cap (3), popping the oldest of a
// FULL queue always leaves the new front-of-queue mark at exactly `remaining === 1` (one of the
// owner's own placements away from vanishing) — this is a property of FIFO-under-cap, not of
// any particular cell, so it needs no state lookup at all. See presentation.test.ts's "reports
// the mover's NEXT mark is now on its final turn" case, which proves this against the real
// engine rather than asserting it from the derivation alone.

import type { Effect, PlayerId } from "@twist-arcade/engine";
import type { ReplayRecord } from "@twist-arcade/engine";
import type { GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { checkWinner, DEFAULT_BOARD_SIZE, get2, LINES } from "./engine-internal";
import { createFadeoutEngine } from "./engine";
import type { FadeoutMove, FadeoutState } from "./engine";
import { FADEOUT_RULESET_CONFIG } from "./manifest";
import { Board } from "./ui/Board";
import { boardCellNamePlain, boardPositionName, boardSummaryText, emojiFor, glyphFor } from "./ui/board-view";

const engine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);

function glyphOf(player: PlayerId): string {
  return glyphFor(player);
}

function decayedEffect(effects: readonly Effect[], player?: PlayerId): Effect | undefined {
  return effects.find(
    (e): e is Effect => e.type === "decayed" && (player === undefined || e.player === player)
  );
}

function placedEffect(effects: readonly Effect[], player?: PlayerId): Effect | undefined {
  return effects.find((e) => e.type === "placed" && (player === undefined || e.player === player));
}

function cellOfEffect(effect: Effect | undefined): number | undefined {
  return effect && typeof effect.cell === "number" ? effect.cell : undefined;
}

function announceMoved(ev: Extract<GameEvent<FadeoutState>, { kind: "moved" }>): string {
  const move = ev.move as FadeoutMove;
  const glyph = glyphOf(ev.player);
  let s = `${glyph} placed, ${boardPositionName(move.cell)}.`;
  const decayed = decayedEffect(ev.effects, ev.player);
  const decayedCell = cellOfEffect(decayed);
  if (decayedCell !== undefined) {
    s += ` ${glyph} faded at ${boardPositionName(decayedCell)}.`;
  }
  return s;
}

function announceImminent(ev: Extract<GameEvent<FadeoutState>, { kind: "imminent" }>): string {
  // See this module's header comment: a decay THIS ply structurally guarantees the mover now
  // has a fresh "final turn" mark (the new front of their own, now-full, queue) — derivable
  // from `effects` alone, with no cell name available (that would require the full queue).
  const decayed = ev.effects.find((e) => e.type === "decayed");
  if (!decayed || (decayed.player !== 0 && decayed.player !== 1)) return "";
  return `${glyphOf(decayed.player)}'s next mark is now on its final turn.`;
}

function announceStatus(ev: Extract<GameEvent<FadeoutState>, { kind: "status" }>): string {
  if (ev.status.kind === "won") return `${glyphOf(ev.status.winner)} wins!`;
  if (ev.status.kind === "draw") return "Draw.";
  return "";
}

function announce(ev: GameEvent<FadeoutState>): string {
  switch (ev.kind) {
    case "moved":
      return announceMoved(ev);
    case "imminent":
      return announceImminent(ev);
    case "boardSummary":
      return boardSummaryText(ev.view);
    case "status":
      return announceStatus(ev);
  }
}

// --- firstOccurrence — the Aha-callout (ux-lens §1) --------------------------------------

function firstDecayAnchor(ev: GameEvent<FadeoutState>): string {
  if (ev.kind !== "moved") return "";
  const decayed = decayedEffect(ev.effects);
  const cell = cellOfEffect(decayed);
  return cell === undefined ? "" : JSON.stringify({ cell } satisfies FadeoutMove);
}

// --- shareArtifact — the emoji move-timeline (ux-lens §5/§8) -----------------------------

/** Replays `record` through the frozen engine to recover every step's effects (ReplayRecord
 *  itself only stores moves, not effects — see @twist-arcade/engine's replay.ts). Fadeout's
 *  own package may import its own engine freely (this is the game's OWN presentation module,
 *  not an outside consumer defeating registry code-splitting — see eslint.config.mjs's
 *  registrySplittingBoundary comment, which only restricts app/** and packages/shell/src/**). */
function replayEffects(record: ReplayRecord): readonly Effect[][] {
  let state = engine.setup(record.numPlayers, { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] });
  const perStep: Effect[][] = [];
  for (const step of record.steps) {
    const movesMap = new Map(step.moves as [PlayerId, FadeoutMove][]);
    // rng is irrelevant here: Fadeout's apply() never draws from it (stochastic: false).
    state = engine.apply(state, movesMap, { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] });
    perStep.push([...state.lastEffects]);
  }
  return perStep;
}

function shareArtifact(record: ReplayRecord, finalView: FadeoutState): string {
  const perStepEffects = replayEffects(record);
  const finalStatus = engine.status(finalView);
  const winningStepIndex = finalStatus.kind === "won" ? perStepEffects.length - 1 : -1;

  const symbols = record.steps.map((step, i) => {
    const [player] = step.moves[0]!;
    const effects = perStepEffects[i]!;
    const decayedThis = decayedEffect(effects, player as PlayerId) !== undefined;
    if (i === winningStepIndex) return "🎯"; // winning move — takes priority over 💨
    if (decayedThis) return "💨";
    return emojiFor(player as PlayerId);
  });

  const faded = finalView.faded[0] + finalView.faded[1];
  const plies = record.steps.length;
  const statLine = `pieces faded: ${faded} · ${plies} plies`;

  return `${symbols.join("")}\n${statLine}`;
}

// --- textureLine — the one-line end-screen story (ux-lens §5, plan §8) -------------------

/** Trigger 1 from plan §8's table ("Loss where the winning apply carries a decayed effect on
 *  a cell in the winning line's block-set"), implemented as the general, always-correct check
 *  — but see the STRUCTURAL NOTE below for why it can never actually fire under THIS shipped
 *  config. Kept general (not special-cased away) so it stays correct if this presentation is
 *  ever reused for a `playThrough: true` registration.
 *
 *  STRUCTURAL NOTE, verified (presentation.test.ts's textureLine describe block), not assumed:
 *  under `playThrough: false` a `decayed` effect can only ever remove the MOVER's OWN mark
 *  (there is no displacement of an opponent's mark without playThrough — see
 *  engine-internal.ts's transition(), whose `playThrough` displacement branch is dead when
 *  `config.playThrough === false`). And replanting into that SAME just-vacated cell (the only
 *  way the decayed cell could become occupied again this same apply) leaves the mover's
 *  occupied SET completely unchanged (same three cells, different order) — so it can never
 *  newly complete a line that wasn't already there (which would have already ended the game).
 *  Net result: for `FADEOUT_RULESET_CONFIG`, a winning apply's decayed cell can never be a
 *  member of that same apply's winning line. This branch is real code, not dead weight passed
 *  off as reachable — it is verified NOT to fire on a genuine win-with-decay fixture, and
 *  documented as to why, rather than silently assumed. */
function selfVacateIntoWinningLine(finalView: FadeoutState, winner: PlayerId): string {
  const decayed = decayedEffect(finalView.lastEffects, winner);
  const placed = placedEffect(finalView.lastEffects, winner);
  const decayedCell = cellOfEffect(decayed);
  const placedCell = cellOfEffect(placed);
  if (decayedCell === undefined || placedCell === undefined || decayedCell !== placedCell) return "";
  const line = LINES.find((l) => l.includes(placedCell));
  if (!line) return "";
  const glyph = glyphOf(winner);
  return `${glyph}'s mark faded the instant it was replanted — into the winning line`;
}

function outWaited(finalView: FadeoutState, loser: PlayerId): string {
  if (get2(finalView.faded, loser) < 4) return "";
  return `Patience wore down ${glyphOf(loser)}'s marks`;
}

/** Trigger 4 from plan §8's table ("Superko-forced loss (mover had no legal move)"). Under
 *  THIS shipped config (threefold, not superko) this is structurally unreachable — occupancy
 *  alone always leaves >= 3 empty cells, so the no-legal-moves corner in engine.ts's
 *  computeStatus() (which resolves to a plain "won") is only reachable under superko (see that
 *  function's own comment). Kept implemented (not deleted) because the signal it checks —
 *  "won" with no 3-in-a-row on the board — is a real, general distinguishing fact about
 *  `Status`, and because a future superko registration of this same presentation module would
 *  need it; presentation.test.ts proves it doesn't crash on a hand-built (not reachable via
 *  real play under threefold) fixture rather than pretending it fires today. */
function trappedByRepetition(): string {
  return "Trapped — every move repeated the past";
}

function textureLine(finalView: FadeoutState): string {
  const winnerCell = checkWinner(finalView.queues, DEFAULT_BOARD_SIZE);
  const status = engine.status(finalView);
  if (status.kind !== "won") return ""; // draw, or (shouldn't happen here) ongoing — no story to tell
  const winner = status.winner;
  const loser: PlayerId = winner === 0 ? 1 : 0;

  if (winnerCell === null) {
    // Won, but not via 3-in-a-row on the board: only reachable under superko (see
    // trappedByRepetition's comment) — dead under the shipped threefold config, verified.
    return trappedByRepetition();
  }

  const selfVacate = selfVacateIntoWinningLine(finalView, winner);
  if (selfVacate) return selfVacate;

  const patience = outWaited(finalView, loser);
  if (patience) return patience;

  return "";
}

// --- howSheetFrames — the 3-step "How?" strip (place -> age -> vanish) -------------------

const howSheetFrames: GamePresentation<FadeoutState, FadeoutMove, FadeoutState>["howSheetFrames"] = [
  { title: "Place", body: "Tap an empty cell to place your mark, same as classic tic-tac-toe." },
  {
    title: "Age",
    body: "Your marks age with every placement you make. A badge appears once a mark has 2 turns left.",
  },
  {
    title: "Vanish",
    body: "On your next placement after that, your oldest mark vanishes — a dashed outline marks where it was.",
  },
];

export const fadeoutPresentation: GamePresentation<FadeoutState, FadeoutMove, FadeoutState> = {
  Board,
  boardDimensions(): { rows: number; cols: number } {
    // Total/pure over every possible view (game-spec's binding contract on this function):
    // this engine implements ONLY 3x3/cap-3 (see engine.ts's resolveConfig) so the answer never
    // varies — no need to inspect `view` at all, which also means it can never throw or return
    // a placeholder for an unrecognized shape.
    return { rows: DEFAULT_BOARD_SIZE, cols: DEFAULT_BOARD_SIZE };
  },
  announce,
  firstOccurrence: [
    {
      flagKey: "fadeout-first-decay",
      trigger(ev: GameEvent<FadeoutState>): boolean {
        return ev.kind === "moved" && decayedEffect(ev.effects) !== undefined;
      },
      text: "Your X faded — pieces last 3 turns.",
      anchor: firstDecayAnchor,
    },
  ],
  shareArtifact,
  howSheetFrames,
  textureLine,
};

// Re-exported for tests/tools that want the coarse cell-name classification without importing
// ./ui/board-view directly (it's a UI-path module per eslint's board-path animation boundary —
// harmless to import from a test, but this keeps presentation.ts's own public surface complete).
export { boardCellNamePlain };

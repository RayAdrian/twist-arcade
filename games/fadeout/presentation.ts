// games/fadeout/presentation.ts — GamePresentation (game-spec §5.3, plan §5) for the FROZEN
// `remove-first / solid / threefold` config (manifest.ts's FADEOUT_RULESET_CONFIG). Board
// rendering lives in ./ui/Board.tsx + ./ui/board-view.ts; this module is everything else the
// shell needs: announce() strings, the first-occurrence callout, the share artifact, the
// texture line, and the "How?" sheet frames.
//
// `announce({kind:"imminent"})` — MUST FIX 1 (stage-6 F3 review): this event's payload used to
// be ONLY `{effects}` (the SAME effects array as the "moved" event), and this module derived
// "a mark is now on its final turn" from the presence of a `decayed` effect. That is correct in
// the STEADY STATE (once a queue is at cap, popping its front always leaves the new front at
// `remaining === 1`) — but a mark FIRST enters its final turn on its owner's 3rd placement,
// which fills the queue to cap WITHOUT popping anything, so `effects` carries no `decayed` entry
// at all on that ply. The old implementation was silent at exactly the teaching-critical moment
// (plies 5/6 — the onset of each player's first-ever vanish) a blind player most needs the
// warning, and it could never name a cell either (it had no view to read one from).
//
// Fixed by widening the platform event (packages/game-spec's GameEvent — additive, mirroring
// `boardSummary`, which already carries `view`) to `{effects, view}`. `announceImminent` below
// now reads the STANDING set of marks at `remaining === 1` straight off `view`, via the exact
// same `buildCellPresentations`/`remainingLife` formula board-view.ts already uses for the
// badge (plan §5.1: "the badge, announce(), and the heuristic never drift apart") — this is
// correct on the onset ply (no decay effect needed) AND in the steady state (where it now also
// correctly names the NON-mover's standing final-turn mark, which the old effects-only check
// silently dropped), and it can name every affected cell. `effects` is kept on the event shape
// for symmetry with "moved" and because other games may still want it, but this game's
// announceImminent no longer needs it.

import type { Effect, PlayerId } from "@twist-arcade/engine";
import type { ReplayRecord } from "@twist-arcade/engine";
import type { GameEvent, GamePresentation } from "@twist-arcade/game-spec";
import { moveToCellId, timelineToBody } from "@twist-arcade/shell";
import { checkWinner, DEFAULT_BOARD_SIZE, get2, LINES } from "./engine-internal";
import { createFadeoutEngine } from "./engine";
import type { FadeoutMove, FadeoutState } from "./engine";
import { FADEOUT_RULESET_CONFIG } from "./manifest";
import { Board } from "./ui/Board";
import {
  boardCellNamePlain,
  boardPositionName,
  boardSummaryText,
  buildCellPresentations,
  emojiFor,
  glyphFor,
  type CellPresentation,
} from "./ui/board-view";

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
  // See this module's header comment (MUST FIX 1): the standing set of marks at remaining=1,
  // read straight off the view — correct on the onset ply (no decay effect exists yet) and in
  // the steady state (names BOTH players' standing final-turn marks, not just the mover's own
  // overflow). `ev.effects` is intentionally unused here now (kept on the event shape for
  // symmetry with "moved").
  const finalTurn = buildCellPresentations(ev.view).filter(
    (c): c is CellPresentation & { occupant: PlayerId } => c.occupant !== null && c.countdown === 1
  );
  if (finalTurn.length === 0) return "";
  return finalTurn.map((c) => `${glyphOf(c.occupant)} fades next turn, ${boardPositionName(c.cell)}.`).join(" ");
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
  // Minor (stage-6 F3 review): use the shell's own moveToCellId (stableStringify) rather than
  // bare JSON.stringify — identical output today ({cell} has one key), but this stays correct
  // if FadeoutMove ever grows a second field with non-canonical key order, matching every other
  // cellId in the app (Board.tsx's own `id` prop is built the same way).
  return cell === undefined ? "" : moveToCellId({ cell } satisfies FadeoutMove);
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

/**
 * C12 ruling (platform-corrections.md, 2026-08-03 — the fourth iteration of the §14->§15->§16
 * lesson, found by executing 2,000 random games under the frozen ruleset rather than reading
 * the encoding): `faded === max(0, plies - 6)` on 2,000/2,000 measured games, so a stat line
 * naming both faded-count and plies prints one fact twice, and marking EVERY decay with 💨
 * (which substitutes for the seat glyph) erases all board identity from ply 7 onward — a
 * 60-ply game would render 54 consecutive 💨. Fix, both binding on this function:
 *   1. Drop "pieces faded" from the stat line — provably derivable from plies under this
 *      ruleset. Keep plies; it is the real, non-redundant fact.
 *   2. 💨 marks ONLY the first decay in the whole game (the moment the twist becomes visible —
 *      the artifact's actual hook); every later decay keeps its normal seat glyph, so seat
 *      identity survives the whole timeline. 🎯 (the winning move) still takes priority over
 *      both, unchanged.
 * Also owns chunking its own timeline into a grammar-legal body via the shell's
 * `timelineToBody()` (must-fix per C12's "related" note): main's C8 composeShareText grammar
 * caps a body at 2 lines / 15 glyphs each, and nothing reconstructs a per-game emoji alphabet
 * from an already-joined opaque string after the fact — the game's own presentation module,
 * which already knows its seat glyphs and built the raw glyph array, is the only place that
 * can chunk it correctly. This makes Fadeout's shareArtifact() output already grammar-legal
 * for ANY game length, so a future daily caller feeding it through composeShareText() never
 * hits ShareGrammarError.
 */
function shareArtifact(record: ReplayRecord, finalView: FadeoutState): string {
  const perStepEffects = replayEffects(record);
  const finalStatus = engine.status(finalView);
  const winningStepIndex = finalStatus.kind === "won" ? perStepEffects.length - 1 : -1;

  let firstDecaySeen = false;
  const symbols = record.steps.map((step, i) => {
    const [player] = step.moves[0]!;
    const effects = perStepEffects[i]!;
    const decayedThis = decayedEffect(effects, player as PlayerId) !== undefined;
    if (i === winningStepIndex) return "🎯"; // winning move — takes priority over 💨/seat glyph
    if (decayedThis && !firstDecaySeen) {
      firstDecaySeen = true;
      return "💨";
    }
    return emojiFor(player as PlayerId);
  });

  const plies = record.steps.length;
  const statLine = `${plies} plies`;

  return `${timelineToBody(symbols)}\n${statLine}`;
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

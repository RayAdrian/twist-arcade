// games/fadeout/solver/strategy.ts — greedy optimal-strategy extraction + the
// strategy-description-length ("quotability") judgment (plan §2.3 pass 3, §1's decision table).
//
// Extraction is always done against the RAW (pass-1) graph, starting from the ROOT (empty
// board). This is deliberately sound for BOTH repetition rules, not an approximation: the
// witness walk (raw-engine.ts's stepWitness) never revisits a position, and starting history is
// empty at the root, so "no witness entry collides with historyBefore" is trivially true the
// whole way through — the exact same argument pass2-superko.ts's WIN shortcut relies on.
// winWitnessMoves()'s own test suite (raw-engine.test.ts) replays the extracted line through
// the REAL engine under both `superko` and `threefold` to confirm this directly rather than
// resting on the argument alone.

import { positionKey } from "../engine";
import { winWitnessMoves, type RawSolveResult } from "./raw-engine";

export interface StrategyExtraction {
  /** true iff the root has a forced win to extract (rootValue === "win"). A draw or loss root
   *  has no forced LINE to quote — see `quotabilityNote` for what that means for the decision. */
  hasForcedWin: boolean;
  /** Cell sequence from the empty board, alternating P0/P1, ending in P0's winning placement.
   *  Empty when `hasForcedWin` is false. */
  cells: number[];
  /** Human-readable, ready-to-quote rendering of `cells`, e.g. "P0: 4 -> P1: 1 -> P0: 5". */
  description: string;
  /** The plan's §2.2/§5.5 quotability judgment: does this forced line fit in a short, googleable
   *  sentence? Heuristic, not a hard science — see the field's derivation in `extractStrategy`. */
  quotable: boolean;
  quotabilityNote: string;
}

/** Threshold picked from the plan's own framing (§2.2: "if the winning line fits in a
 *  googleable sentence, the game dies on the open web"): a forced win expressible in a HANDFUL
 *  of plies (both players combined) is the kind of thing that turns into a one-line spoiler
 *  ("P1 always wins by X-Y-Z"); a longer or branching line is not memorizable prose. Fadeout's
 *  own state-space anchor (§2.1: ~1.4x10^5 positions) makes even a "short" forced line still
 *  require knowing the SPECIFIC board, unlike classic TTT's well-known center-opening trap —
 *  worth weighing alongside the raw ply count, not instead of it (see the note text below).
 */
const QUOTABLE_PLY_THRESHOLD = 5;

export function extractStrategy(raw: RawSolveResult): StrategyExtraction {
  if (raw.rootValue !== "win") {
    return {
      hasForcedWin: false,
      cells: [],
      description: "(no forced win from the empty board — see rootValue for the actual result)",
      quotable: false,
      quotabilityNote:
        raw.rootValue === "draw"
          ? "Root is a draw: there is no forced win to quote at all, which is itself the strongest " +
            "possible answer to the quotability question — nobody can post a spoiler for a line " +
            "that doesn't exist."
          : "Root is a loss for the first player: no forced win to quote for P0; note this as a " +
            "criterion-1 finding in its own right (a P1-favored root is not what any variant should ship).",
    };
  }

  const rootKey = positionKey({ queues: [[], []], toMove: 0 });
  const cells = [...winWitnessMoves(raw, rootKey)];

  const description = cells
    .map((cell, i) => `${i % 2 === 0 ? "P0" : "P1"}: ${cell}`)
    .join(" -> ");

  const quotable = cells.length <= QUOTABLE_PLY_THRESHOLD;
  const quotabilityNote = quotable
    ? `Forced win completes in ${cells.length} plies total (${description}) — short enough to ` +
      "state as a one-line spoiler; treat as quotable/dead-on-the-open-web unless the specific " +
      "line is highly position-dependent (varies a lot by what the opponent tries, which this " +
      "extraction — a single canonical line — does not by itself demonstrate either way)."
    : `Forced win requires ${cells.length} plies (${description}) — long enough that it is not a ` +
      "one-sentence spoiler; the position-dependence across ~1.4x10^5 reachable states further " +
      "argues against easy memorization.";

  return { hasForcedWin: true, cells, description, quotable, quotabilityNote };
}

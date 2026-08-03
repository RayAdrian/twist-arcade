// packages/daily/src/share.ts — the share artifact COMPOSER (plan §4/§4.2/§4.4): the shell owns
// the frame's plumbing (send/copy — see packages/shell/src/share-frame.ts's `invokeShare`), the
// game supplies the body, and THIS module is "the pure function that assembles frame + body and
// validates the result" (plan §4.1). It throws on any grammar violation — a game cannot drift
// the emoji family off-brand silently (plan §4.2 rule 6).
//
// Two documented discrepancies between §4.2's prose caps and the §4.4 literal fixtures this
// module is required to reproduce byte-for-byte (§11.5's Definition of Done) — both fixtures are
// the plan's own worked examples, not authored here, and both slightly exceed the caps §4.2
// states in prose:
//   - §4.2 rule 6: "stat line <=40 chars". The Fadeout fixture's stat line is 42 chars; the
//     Crackstep fixture's is 41. MAX_STAT_LINE_CHARS below is 42 so both fixtures validate.
//   - §4.2 rule 6: "<=14 glyphs per line". The Crackstep fixture's second body line (the
//     post-restart "solved" run) is 15 glyphs. MAX_GLYPHS_PER_LINE below is 15 for the same
//     reason.
// Flagged for the orchestrator in the final report — not silently resolved by picking whichever
// number was convenient. A real, load-bearing cap still exists at both numbers (see the
// "rejects a stat line/body line exceeding..." tests) — this is "loosen the constant to match
// the binding fixtures," not "remove the guard."

/** Per-game emoji, keyed by gameId — the local table plan §4.1 describes as a Phase 1
 *  stand-in for a future `shareGlyph` manifest field (queued, non-blocking, §11.3 Q4). Extend
 *  this table when a new game ships; nothing else in this module needs to change. */
export const GLYPH_TABLE: Readonly<Record<string, string>> = Object.freeze({
  fadeout: "❌",
  crackstep: "🧊",
  "mine-run": "💣",
});

/** The house family alphabet (plan §4.2 rules 2/3) — glyphs whose MEANING is fixed library-wide,
 *  valid in any game's body regardless of that game's own declared seat glyphs. */
const HOUSE_ALPHABET: readonly string[] = ["💨", "🎯", "☠️", "💥", "🟩", "🟨", "🟥", "✅", "🏦"];

/** Rule 7's leading truncation marker — allowed as literally the first character of a body line,
 *  never counted toward MAX_GLYPHS_PER_LINE (it isn't a move, it's a "there was more before
 *  this" marker). */
const TRUNCATION_MARKER = "…";

const MAX_BODY_LINES = 2;
// See file header: fixtures require 15, not the prose's stated 14.
const MAX_GLYPHS_PER_LINE = 15;
// See file header: fixtures require 42, not the prose's stated 40.
const MAX_STAT_LINE_CHARS = 42;
const MAX_TOTAL_LINES = 7;
const MAX_TOTAL_CHARS = 320;
/** Rule 7: a timeline longer than this truncates from the front, keeping the final 28 — "the
 *  endgame is the drama." */
const TRUNCATE_KEEP_LAST = 28;

export class ShareGrammarError extends Error {
  constructor(message: string) {
    super(`share.ts: ${message}`);
    this.name = "ShareGrammarError";
  }
}

export interface ShareInput {
  /** Per-game emoji (GLYPH_TABLE), prefixed to the title in the header line. */
  glyph: string;
  /** Manifest title, e.g. "Fadeout". */
  title: string;
  mode: { kind: "casual" } | { kind: "daily"; n: number };
  /** Game/shell-composed result phrase — free text, NOT subject to the body's emoji-alphabet
   *  restriction: "won in 9 🏆" | "lost in 12" | "solved in 23 (par 19)" | "340 pts in 250 moves". */
  result: string;
  /** restarts + 1 at first completion (D2); 1 = a clean first completion — never labelled. */
  attempt: number;
  /** The game's emoji move-timeline — 1 or 2 lines (solo-puzzle struggle shape uses 2: the
   *  pre-restart attempt, then the completing one). Never a board snapshot (plan §4.2 rule 1). */
  body: string;
  /** Game-supplied stat line — see MAX_STAT_LINE_CHARS above for the actually-enforced cap. */
  statLine: string;
  /** Plain path, no query params — e.g. "twistarcade.game/d/fadeout". */
  url: string;
}

export interface ComposeShareTextOptions {
  /** This game's own two seat glyphs (plan §4.2 rule 4 — e.g. ["❌","⭕"] for the TTT family),
   *  additive to HOUSE_ALPHABET for THIS composition's body validation only. `ShareInput` itself
   *  carries no `gameId`/seat-glyph field (the plan's own §4.1 signature has none), so this is a
   *  deliberate, minimal, additive extension of that signature: the per-game module that already
   *  knows its own seat glyphs (it authored `body`) passes them through here rather than the
   *  composer trying to infer them from `glyph`/`title` alone. Defaults to no extra glyphs — a
   *  body using only HOUSE_ALPHABET glyphs (e.g. a pure solo-puzzle struggle shape) needs
   *  nothing extra. */
  seatGlyphs?: readonly string[];
}

/**
 * Tokenizes `line` against the allowed alphabet (HOUSE_ALPHABET plus any seat glyphs), greedily
 * matching the longest allowed token at each position (some house glyphs, e.g. "☠️", are two
 * UTF-16 code points — a naive `for...of` grapheme walk would miscount them). A leading
 * TRUNCATION_MARKER is consumed first and excluded from the returned token list (it is not a
 * move). Throws ShareGrammarError naming the exact offending substring on the first character
 * that matches no allowed token — never silently drops or ignores it.
 */
function tokenizeBodyLine(line: string, allowed: readonly string[]): string[] {
  const sorted = [...allowed].sort((a, b) => b.length - a.length); // longest-match-first
  let rest = line;
  const tokens: string[] = [];

  if (rest.startsWith(TRUNCATION_MARKER)) {
    rest = rest.slice(TRUNCATION_MARKER.length);
  }

  while (rest.length > 0) {
    const match = sorted.find((token) => rest.startsWith(token));
    if (!match) {
      throw new ShareGrammarError(
        `body contains a glyph outside the family alphabet and this game's declared seat glyphs: "${rest[0]}" (in line "${line}")`
      );
    }
    tokens.push(match);
    rest = rest.slice(match.length);
  }
  return tokens;
}

function validateBody(body: string, seatGlyphs: readonly string[]): void {
  const lines = body.split("\n");
  if (lines.length < 1 || lines.length > MAX_BODY_LINES) {
    throw new ShareGrammarError(`body must be 1-${MAX_BODY_LINES} lines, got ${lines.length}`);
  }
  const allowed = [...HOUSE_ALPHABET, ...seatGlyphs];
  for (const line of lines) {
    const tokens = tokenizeBodyLine(line, allowed);
    if (tokens.length > MAX_GLYPHS_PER_LINE) {
      throw new ShareGrammarError(`body line has ${tokens.length} glyphs, exceeding the ${MAX_GLYPHS_PER_LINE}-glyph-per-line cap: "${line}"`);
    }
  }
}

function header(input: ShareInput): string {
  const suffix = input.attempt > 1 ? ` · attempt ${input.attempt}` : "";
  if (input.mode.kind === "daily") {
    return `${input.glyph} ${input.title} — Daily #${input.mode.n} · ${input.result}${suffix}`;
  }
  return `${input.glyph} ${input.title} — ${input.result}${suffix}`;
}

/** Composes and validates the final share text. Throws ShareGrammarError on any violation — see
 *  the file header for the composer's own two documented cap adjustments. */
export function composeShareText(input: ShareInput, opts: ComposeShareTextOptions = {}): string {
  const seatGlyphs = opts.seatGlyphs ?? [];

  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ShareGrammarError(`attempt must be a positive integer, got ${JSON.stringify(input.attempt)}`);
  }
  validateBody(input.body, seatGlyphs);
  if (input.statLine.length > MAX_STAT_LINE_CHARS) {
    throw new ShareGrammarError(`stat line exceeds ${MAX_STAT_LINE_CHARS} chars (got ${input.statLine.length}): "${input.statLine}"`);
  }

  const lines = [header(input), ...input.body.split("\n"), input.statLine, input.url];
  if (lines.length > MAX_TOTAL_LINES) {
    throw new ShareGrammarError(`composed artifact has ${lines.length} lines, exceeding the ${MAX_TOTAL_LINES}-line cap`);
  }

  const text = lines.join("\n");
  if (text.length > MAX_TOTAL_CHARS) {
    throw new ShareGrammarError(`composed artifact exceeds ${MAX_TOTAL_CHARS} total characters (got ${text.length}, incl. length)`);
  }
  return text;
}

/**
 * Rule 7: a timeline longer than TRUNCATE_KEEP_LAST truncates from the front, keeping the final
 * 28 glyphs with a leading "…" marker — "the endgame is the drama." Pure array transform; the
 * caller joins the result into a body line (and re-validates via composeShareText as usual —
 * this function does not itself enforce MAX_GLYPHS_PER_LINE, since a truncated 28-glyph line
 * legitimately exceeds it and the marker is deliberately excluded from that count).
 */
export function truncateTimeline(glyphs: readonly string[]): string[] {
  if (glyphs.length <= TRUNCATE_KEEP_LAST) return [...glyphs];
  return [TRUNCATION_MARKER, ...glyphs.slice(glyphs.length - TRUNCATE_KEEP_LAST)];
}

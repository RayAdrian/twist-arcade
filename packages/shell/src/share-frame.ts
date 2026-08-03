// packages/shell/src/share-frame.ts — the share artifact FRAME composer + invoker (plan §4.11),
// PLUS the per-game GRAMMAR composer/validator (plan §4/§4.2/§4.4). Consolidated into one file
// per platform-corrections.md C8 (2026-08-03 ruling) — see that file for the full finding.
//
// Two layers live here, not one, because they serve different callers and are NOT redundant
// duplicates of each other despite both being "share composers":
//
//   - composeShareArtifact / ShareFrameInput / invokeShare: the OUTER frame every GameShell
//     share button calls, regardless of game (title/result/url, the daily "Daily #N"/"(par p)"/
//     inline "· attempt k" decoration, an optional glyph prefix). It treats the game's own
//     `artifactBody` (`presentation.shareArtifact()`'s return value — packages/game-spec's
//     FROZEN platform-owned contract, `packages/game-spec/src/presentation.ts`) as an OPAQUE
//     STRING: that contract returns a single string which may already combine a move-timeline
//     with a stat line, so this layer cannot and does not validate its contents. Never renders a
//     board snapshot (ux-lens §5).
//
//   - composeShareText / ShareInput / GLYPH_TABLE / ShareGrammarError / truncateTimeline /
//     timelineToBody: the STRICTER per-game grammar (plan §4.2's emoji-alphabet rules) a game's
//     own presentation module can use to CONSTRUCT that opaque body — a lower-level toolkit, not
//     a replacement for the frame above. Ported here from packages/daily/src/share.ts (deleted)
//     because it is game/body-composition logic, not a daily-specific concept, and
//     packages/shell is the layer every game's presentation module already sits above.
//
// Before C8, packages/shell shipped only the (buggy) frame above — no glyph, a bare "#37"
// instead of "Daily #37", and a separate restart line instead of the inline "· attempt k" — and
// packages/daily separately shipped a plan-correct composeShareText with no frame counterpart.
// Both gaps are closed here: composeShareArtifact's header now carries the corrected grammar,
// and composeShareText/its helpers (including must-fix 3's timelineToBody, see below) live
// alongside it as the one implementation of each.

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

export class ShareFrameTooLongError extends Error {
  constructor(totalLines: number) {
    super(`share artifact must be <=7 lines total, got ${totalLines}`);
    this.name = "ShareFrameTooLongError";
  }
}

export interface ShareFrameInput {
  title: string;
  /** Optional per-game emoji prefix (e.g. GLYPH_TABLE's entry for this gameId) — C8: shell's
   *  frame previously had no glyph concept at all, one of the three named grammar gaps. Omitted
   *  entirely (no leading space) when not supplied, so existing non-daily/non-glyph callers are
   *  byte-for-byte unaffected. */
  glyph?: string;
  /** e.g. "won in 9 moves 🏆", "solved in 23" — game/shell-composed result phrase. */
  resultPhrase: string;
  /** The game's shareArtifact() output — may itself be multi-line (timeline + stat line). */
  artifactBody: string;
  url: string;
  /** Daily mode: header becomes "{glyph }{title} — Daily #{dayNumber} · {resultPhrase}" +
   *  " (par {par})" when a par exists (plan §7.4's worked example, corrected per C8 to the
   *  binding "Daily #N" form rather than the bare "#N" this frame originally shipped with). */
  daily?: { dayNumber: number; par?: number };
  /** Restart count (plan §15 addendum 3 — two-player dailies included, so a fifth attempt is
   *  never silently presented as a first). C8: rendered INLINE on the header as
   *  " · attempt {restarts + 1}" (never labelled at all when `attempt` would be 1) rather than
   *  a separate line — the third named grammar gap, matching packages/daily's binding grammar. */
  restarts?: number;
}

/** Composes the final share text. Asserts <=7 lines total (dev + this unit test enforce it;
 *  an 8-line body trips ShareFrameTooLongError before anything is ever shared). */
export function composeShareArtifact(input: ShareFrameInput): string {
  const glyphPrefix = input.glyph ? `${input.glyph} ` : "";
  const attempt = (input.restarts ?? 0) + 1;
  const attemptSuffix = attempt > 1 ? ` · attempt ${attempt}` : "";

  const header = input.daily
    ? `${glyphPrefix}${input.title} — Daily #${input.daily.dayNumber} · ${input.resultPhrase}` +
      (input.daily.par !== undefined ? ` (par ${input.daily.par})` : "") +
      attemptSuffix
    : `${glyphPrefix}${input.title} — ${input.resultPhrase}${attemptSuffix}`;

  const lines = [header, input.artifactBody, input.url];

  const text = lines.join("\n");
  const totalLines = text.split("\n").length;
  if (totalLines > 7) {
    throw new ShareFrameTooLongError(totalLines);
  }
  return text;
}

/**
 * Invokes the share: `navigator.share` where available (mobile — reports "shared"), else
 * clipboard + confirmation ("copied"). If `share()` rejects for a reason OTHER than the user
 * dismissing the sheet, falls back to clipboard rather than giving up immediately (plan §4.10:
 * "share-failed (clipboard fallback then error text...)"). Only reports "failed" when neither
 * path succeeds — never throws.
 *
 * Stage-6 must-fix 1: a rejected `navigator.share()` promise is not one uniform failure —
 * `AbortError` is the browser's own name for "the user dismissed the sheet without sharing,"
 * distinct from the API genuinely refusing (permission denied, no share target, etc.). The
 * previous version caught every rejection identically and fell through to
 * `clipboard.writeText`, which succeeds silently on desktop Chrome — so dismissing the sheet
 * was indistinguishable from actually sharing, and `shareOutcomeToPath("copied")` fired
 * `share_done` for a share nobody sent. An explicit cancel must report "dismissed" and must
 * NOT fall through to the clipboard at all: silently copying the artifact after someone
 * deliberately backed out is also surprising, unwanted UX, not just a metrics problem.
 */
export async function invokeShare(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;

  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ text });
      return "shared";
    } catch (err) {
      // Deliberately NOT `err instanceof Error` — a real `navigator.share()` rejection is a
      // DOMException, and DOMException is not reliably `instanceof Error` across environments
      // (confirmed false under jsdom here, true in real Chrome) despite always carrying a
      // `.name`. Duck-typing on `.name` is what actually works everywhere `invokeShare` runs.
      const name = typeof err === "object" && err !== null && "name" in err ? (err as { name: unknown }).name : undefined;
      if (name === "AbortError") {
        return "dismissed"; // explicit cancel — never silently copy on the player's behalf.
      }
      // Some other rejection (the API genuinely refusing) — fall through to clipboard below.
    }
  }

  if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
    try {
      await nav.clipboard.writeText(text);
      return "copied";
    } catch {
      return "failed";
    }
  }

  return "failed";
}

// ------------------------------------------------------------------------------------------
// composeShareText() and its grammar helpers — ported from packages/daily/src/share.ts (C8).
// ------------------------------------------------------------------------------------------
//
// Two documented discrepancies between plan §4.2's prose caps and the §4.4 literal fixtures
// this composer is required to reproduce byte-for-byte (per this package's Definition of Done)
// — both fixtures are the plan's own worked examples, not authored here, and both slightly
// exceed the caps §4.2 states in prose:
//   - §4.2 rule 6: "stat line <=40 chars". The Fadeout fixture's stat line is 42 chars; the
//     Crackstep fixture's is 41. MAX_STAT_LINE_CHARS below is 42 so both fixtures validate.
//   - §4.2 rule 6: "<=14 glyphs per line". The Crackstep fixture's second body line (the
//     post-restart "solved" run) is 15 glyphs. MAX_GLYPHS_PER_LINE below is 15 for the same
//     reason.
// A real, load-bearing cap still exists at both numbers (see the "rejects a stat line/body line
// exceeding..." tests) — this is "loosen the constant to match the binding fixtures," not
// "remove the guard."

/** Per-game emoji, keyed by gameId — the local table plan §4.1 describes as a Phase 1
 *  stand-in for a future `shareGlyph` manifest field (queued, non-blocking, §11.3 Q4). Extend
 *  this table when a new game ships; nothing else in this module needs to change. Deliberately
 *  NOT part of GameManifest (game-spec is a frozen platform-owned seam) and deliberately kept as
 *  a flat, hand-maintained table rather than inferred — C8 moved this module INTO shell, but the
 *  table's CONTENT is still scoped to the specific launch games named in the plan, same as
 *  before the move. */
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
// See the discrepancy note above: fixtures require 15, not the prose's stated 14.
const MAX_GLYPHS_PER_LINE = 15;
// See the discrepancy note above: fixtures require 42, not the prose's stated 40.
const MAX_STAT_LINE_CHARS = 42;
const MAX_TOTAL_LINES = 7;
const MAX_TOTAL_CHARS = 320;
/** Rule 7: a timeline longer than this truncates from the front, keeping the final 28 — "the
 *  endgame is the drama." Also must-fix 3's reconciliation constant: 28 === 2 x 14, plainly the
 *  intent behind having both a 2-line body cap AND a 28-glyph keep-last rule at once. */
const TRUNCATE_KEEP_LAST = 28;
/** must-fix 3: the per-LINE chunk size timelineToBody() splits into when a body needs 2 lines —
 *  intentionally 14, not the 15-glyph MAX_GLYPHS_PER_LINE ceiling, so that TRUNCATE_KEEP_LAST's
 *  28 kept glyphs divide evenly into exactly 2 lines with no remainder. */
const LINE_CHUNK = 14;

export class ShareGrammarError extends Error {
  constructor(message: string) {
    super(`share-frame.ts: ${message}`);
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
   *  pre-restart attempt, then the completing one). Never a board snapshot (plan §4.2 rule 1).
   *  For a long single-run timeline, build this via `timelineToBody()` rather than joining
   *  `truncateTimeline()`'s output directly into one line (must-fix 3 — see that function). */
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

function shareTextHeader(input: ShareInput): string {
  const suffix = input.attempt > 1 ? ` · attempt ${input.attempt}` : "";
  if (input.mode.kind === "daily") {
    return `${input.glyph} ${input.title} — Daily #${input.mode.n} · ${input.result}${suffix}`;
  }
  return `${input.glyph} ${input.title} — ${input.result}${suffix}`;
}

/** Composes and validates the final share text. Throws ShareGrammarError on any violation — see
 *  this module's header for the composer's own two documented cap adjustments. */
export function composeShareText(input: ShareInput, opts: ComposeShareTextOptions = {}): string {
  const seatGlyphs = opts.seatGlyphs ?? [];

  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ShareGrammarError(`attempt must be a positive integer, got ${JSON.stringify(input.attempt)}`);
  }
  validateBody(input.body, seatGlyphs);
  if (input.statLine.length > MAX_STAT_LINE_CHARS) {
    throw new ShareGrammarError(`stat line exceeds ${MAX_STAT_LINE_CHARS} chars (got ${input.statLine.length}): "${input.statLine}"`);
  }

  const lines = [shareTextHeader(input), ...input.body.split("\n"), input.statLine, input.url];
  const text = lines.join("\n");

  // Should-fix 5 (stage-6 review): count the ACTUAL rendered lines (`text.split("\n").length`,
  // AFTER joining) rather than `lines.length` (the array of composed PARTS). `lines.length`
  // structurally maxes out at 5 for any legal 2-line body (header + 2 body + stat + url) — it
  // can never see a single FIELD (statLine here, in principle body/url too) that itself smuggles
  // embedded "\n"s and inflates the real printed line count well past 7. This is the same
  // text-based counting composeShareArtifact (above, in this file) already used correctly.
  const totalLines = text.split("\n").length;
  if (totalLines > MAX_TOTAL_LINES) {
    throw new ShareGrammarError(`composed artifact has ${totalLines} lines, exceeding the ${MAX_TOTAL_LINES}-line cap`);
  }

  if (text.length > MAX_TOTAL_CHARS) {
    throw new ShareGrammarError(`composed artifact exceeds ${MAX_TOTAL_CHARS} total characters (got ${text.length}, incl. length)`);
  }
  return text;
}

/**
 * Rule 7: a timeline longer than TRUNCATE_KEEP_LAST truncates from the front, keeping the final
 * 28 glyphs with a leading "…" marker — "the endgame is the drama." Pure array transform.
 *
 * Must-fix 3 (stage-6 review): this function's OWN doc previously told the caller to "join the
 * result into a body line" (singular) — but 28 kept glyphs (or anything from 16-28 glyphs, where
 * truncation never even engages) always exceeds MAX_GLYPHS_PER_LINE (15) once joined into ONE
 * line, so following this function's own documented usage always threw ShareGrammarError.
 * `truncateTimeline` itself is unchanged (still a flat array; still does not enforce the
 * per-line cap) — callers must use `timelineToBody()` below to turn its output into a
 * grammar-legal multi-line body instead of joining it directly.
 */
export function truncateTimeline(glyphs: readonly string[]): string[] {
  if (glyphs.length <= TRUNCATE_KEEP_LAST) return [...glyphs];
  return [TRUNCATION_MARKER, ...glyphs.slice(glyphs.length - TRUNCATE_KEEP_LAST)];
}

/**
 * Must-fix 3: composes a GRAMMAR-LEGAL body (<=MAX_BODY_LINES lines, each <=MAX_GLYPHS_PER_LINE
 * glyphs) from a full move-timeline of any length — truncating via `truncateTimeline()` first,
 * then chunking into lines of at most LINE_CHUNK (14) glyphs apiece. Rule 6 (<=15 glyphs/line)
 * and rule 7 (keep the final 28) only reconcile as exactly 2 body lines (28 = 2 x 14) — a
 * timeline of 16-28 glyphs never triggers truncation but still needs the 2-line split purely to
 * respect the per-line cap; this function is the one place both rules are honored together, so a
 * game's presentation module never has to reimplement the reconciliation itself.
 *
 * A leading truncation marker (present only when truncation actually engaged, i.e. the timeline
 * was > 28 glyphs) is re-attached to the FIRST resulting line only — it marks "there was more
 * game before this," not a per-line concern, and tokenizeBodyLine already excludes it from the
 * per-line glyph count.
 */
export function timelineToBody(glyphs: readonly string[]): string {
  const kept = truncateTimeline(glyphs);
  const hasMarker = kept[0] === TRUNCATION_MARKER;
  const marker = hasMarker ? kept[0]! : "";
  const rest = hasMarker ? kept.slice(1) : kept;

  if (rest.length <= MAX_GLYPHS_PER_LINE) {
    return marker + rest.join("");
  }

  const chunks: string[] = [];
  for (let i = 0; i < rest.length && chunks.length < MAX_BODY_LINES; i += LINE_CHUNK) {
    chunks.push(rest.slice(i, i + LINE_CHUNK).join(""));
  }
  if (marker && chunks.length > 0) {
    chunks[0] = marker + chunks[0];
  }
  return chunks.join("\n");
}

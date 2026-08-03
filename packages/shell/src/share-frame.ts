// packages/shell/src/share-frame.ts — the share artifact FRAME composer + invoker (plan
// §4.11). The shell owns title/result/URL and the daily "#n"/"(par p)"/restart-line
// decoration; the game owns `artifactBody` (its emoji move-timeline, via
// `presentation.shareArtifact()`). Never renders a board snapshot (ux-lens §5).

export type ShareOutcome = "shared" | "copied" | "failed";

export class ShareFrameTooLongError extends Error {
  constructor(totalLines: number) {
    super(`share artifact must be <=7 lines total, got ${totalLines}`);
    this.name = "ShareFrameTooLongError";
  }
}

export interface ShareFrameInput {
  title: string;
  /** e.g. "won in 9 moves 🏆", "solved in 23" — game/shell-composed result phrase. */
  resultPhrase: string;
  /** The game's shareArtifact() output — may itself be multi-line (timeline + stat line). */
  artifactBody: string;
  url: string;
  /** Daily mode: header becomes "{title} #{dayNumber} — {resultPhrase}" + " (par {par})"
   *  when a par exists (plan §7.4's worked example: "Crackstep #14 — solved in 23 (par 19)"). */
  daily?: { dayNumber: number; par?: number };
  /** Mandatory restart line whenever > 0 (plan §15 addendum 3 — two-player dailies included,
   *  so a fifth attempt is never silently presented as a first). */
  restarts?: number;
}

/** Composes the final share text. Asserts <=7 lines total (dev + this unit test enforce it;
 *  an 8-line body trips ShareFrameTooLongError before anything is ever shared). */
export function composeShareArtifact(input: ShareFrameInput): string {
  const header = input.daily
    ? `${input.title} #${input.daily.dayNumber} — ${input.resultPhrase}` +
      (input.daily.par !== undefined ? ` (par ${input.daily.par})` : "")
    : `${input.title} — ${input.resultPhrase}`;

  const lines = [header, input.artifactBody];
  if (input.restarts && input.restarts > 0) {
    lines.push(`${input.restarts} restart${input.restarts === 1 ? "" : "s"}`);
  }
  lines.push(input.url);

  const text = lines.join("\n");
  const totalLines = text.split("\n").length;
  if (totalLines > 7) {
    throw new ShareFrameTooLongError(totalLines);
  }
  return text;
}

/**
 * Invokes the share: `navigator.share` where available (mobile — reports "shared"), else
 * clipboard + confirmation ("copied"). If `share()` itself rejects (user cancelled, or the
 * API refuses), falls back to clipboard rather than giving up immediately (plan §4.10:
 * "share-failed (clipboard fallback then error text...)"). Only reports "failed" when
 * neither path succeeds — never throws.
 */
export async function invokeShare(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;

  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ text });
      return "shared";
    } catch {
      // Fall through to the clipboard fallback below.
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

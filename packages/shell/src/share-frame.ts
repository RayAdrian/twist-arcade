// packages/shell/src/share-frame.ts — the share artifact FRAME composer + invoker (plan
// §4.11). The shell owns title/result/URL and the daily "#n"/"(par p)"/restart-line
// decoration; the game owns `artifactBody` (its emoji move-timeline, via
// `presentation.shareArtifact()`). Never renders a board snapshot (ux-lens §5).

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

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

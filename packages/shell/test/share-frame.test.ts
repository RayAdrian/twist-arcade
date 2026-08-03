import { afterEach, describe, expect, it, vi } from "vitest";
import { composeShareArtifact, invokeShare, ShareFrameTooLongError } from "../src/share-frame";

// plan §4.11: shell owns the FRAME (title/result/URL, daily "#n"/"(par p)", restart line);
// the game owns artifactBody. Composer asserts <=7 lines total.

describe("composeShareArtifact — non-daily", () => {
  it("matches the ux-lens §5 worked example exactly", () => {
    const text = composeShareArtifact({
      title: "Fadeout Tic-Tac-Toe",
      resultPhrase: "won in 9 moves 🏆",
      artifactBody: "❌⭕❌⭕❌💨⭕❌🎯\npieces faded: 3 · longest-lived X: 5 turns",
      url: "tttwist.game/fadeout",
    });
    expect(text).toBe(
      "Fadeout Tic-Tac-Toe — won in 9 moves 🏆\n" +
        "❌⭕❌⭕❌💨⭕❌🎯\npieces faded: 3 · longest-lived X: 5 turns\n" +
        "tttwist.game/fadeout"
    );
  });
});

describe("composeShareArtifact — daily", () => {
  it("matches the plan §7.4 worked example: title #n — result (par p)", () => {
    const text = composeShareArtifact({
      title: "Crackstep",
      resultPhrase: "solved in 23",
      artifactBody: "🟩🟩🟨🟩🟥",
      url: "tttwist.game/d/crackstep",
      daily: { dayNumber: 14, par: 19 },
    });
    expect(text.split("\n")[0]).toBe("Crackstep #14 — solved in 23 (par 19)");
  });

  it("omits the par suffix when the certificate carries no par", () => {
    const text = composeShareArtifact({
      title: "Crackstep",
      resultPhrase: "solved in 23",
      artifactBody: "🟩🟩🟨🟩🟥",
      url: "tttwist.game/d/crackstep",
      daily: { dayNumber: 14 },
    });
    expect(text.split("\n")[0]).toBe("Crackstep #14 — solved in 23");
  });
});

describe("composeShareArtifact — restart line (plan §15 addendum 3: mandatory when restarts > 0, 2P dailies included)", () => {
  it("is absent when restarts is 0 or undefined", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      restarts: 0,
    });
    expect(text).not.toMatch(/restart/);
  });

  it("singular '1 restart' when restarts === 1", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      restarts: 1,
    });
    expect(text.split("\n")).toContain("1 restart");
  });

  it("plural '3 restarts' when restarts > 1, placed between body and url", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      restarts: 3,
    });
    const lines = text.split("\n");
    expect(lines[lines.length - 2]).toBe("3 restarts");
    expect(lines[lines.length - 1]).toBe("tttwist.game/fadeout");
  });
});

describe("composeShareArtifact — the <=7-line assertion", () => {
  it("does not throw at exactly 7 lines", () => {
    const sixLineBody = Array.from({ length: 5 }, (_, i) => `line ${i}`).join("\n");
    expect(() =>
      composeShareArtifact({
        title: "T",
        resultPhrase: "r",
        artifactBody: sixLineBody, // header(1) + body(5) + url(1) = 7
        url: "u",
      })
    ).not.toThrow();
  });

  it("throws ShareFrameTooLongError on an 8-line total", () => {
    const sevenLineBody = Array.from({ length: 6 }, (_, i) => `line ${i}`).join("\n");
    expect(() =>
      composeShareArtifact({
        title: "T",
        resultPhrase: "r",
        artifactBody: sevenLineBody, // header(1) + body(6) + url(1) = 8
        url: "u",
      })
    ).toThrow(ShareFrameTooLongError);
  });
});

describe("invokeShare — native share sheet where available, else clipboard, else failed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses navigator.share when available and reports 'shared'", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText: vi.fn() } });
    const outcome = await invokeShare("hello world");
    expect(share).toHaveBeenCalledWith({ text: "hello world" });
    expect(outcome).toBe("shared");
  });

  it("falls back to clipboard when navigator.share is unavailable, reports 'copied'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const outcome = await invokeShare("hello world");
    expect(writeText).toHaveBeenCalledWith("hello world");
    expect(outcome).toBe("copied");
  });

  it("reports 'failed' when neither share nor clipboard is available", async () => {
    vi.stubGlobal("navigator", {});
    const outcome = await invokeShare("hello world");
    expect(outcome).toBe("failed");
  });

  it("falls back to clipboard when navigator.share rejects for a non-cancel reason (plan §4.10: 'clipboard fallback then error text')", async () => {
    const share = vi.fn().mockRejectedValue(new Error("share() refused"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    const outcome = await invokeShare("hello world");
    expect(writeText).toHaveBeenCalledWith("hello world");
    expect(outcome).toBe("copied");
  });

  it("reports 'failed' (never throws) when BOTH a non-cancel share failure AND the clipboard fallback fail", async () => {
    const share = vi.fn().mockRejectedValue(new Error("share() refused"));
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    const outcome = await invokeShare("hello world");
    expect(outcome).toBe("failed");
  });

  it("reports 'failed' (never throws) when clipboard.writeText itself rejects with no share API", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const outcome = await invokeShare("hello world");
    expect(outcome).toBe("failed");
  });

  it("reports 'dismissed' (never falls through to clipboard) when navigator.share rejects with AbortError — a user-dismissed share sheet (stage-6 must-fix 1)", async () => {
    // navigator.share's real rejection for a user-dismissed sheet is a DOMException named
    // "AbortError" — NOT a generic Error. Before the fix, invokeShare caught ANY rejection
    // (including this one) and fell through to clipboard.writeText, which silently succeeds on
    // desktop Chrome — so a dismissal was reported as "copied" and inflated share_done.
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    const share = vi.fn().mockRejectedValue(abortError);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    const outcome = await invokeShare("hello world");
    expect(outcome).toBe("dismissed");
    expect(writeText).not.toHaveBeenCalled();
  });
});

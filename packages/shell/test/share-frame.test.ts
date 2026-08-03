import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeShareArtifact,
  composeShareText,
  GLYPH_TABLE,
  invokeShare,
  ShareFrameTooLongError,
  ShareGrammarError,
  timelineToBody,
  truncateTimeline,
  type ShareInput,
} from "../src/share-frame";

// plan §4.11 + platform-corrections.md C8: two composers live in this one file (see the
// module header in ../src/share-frame.ts for why they're not redundant):
//   - composeShareArtifact: the OUTER frame every GameShell share button calls (title/result/
//     URL, the daily "Daily #N"/"(par p)"/inline "· attempt k" decoration, an optional glyph
//     prefix). Treats artifactBody as an opaque string.
//   - composeShareText: the STRICTER per-game grammar (glyph alphabet, body line/glyph caps,
//     stat line cap, truncateTimeline/timelineToBody) a game's own presentation module can use
//     to build that opaque body from. Ported here from packages/daily/src/share.ts, which is
//     deleted — this is now the one implementation.

describe("composeShareArtifact — non-daily", () => {
  it("matches the ux-lens §5 worked example exactly (no glyph, no restarts -> unchanged from before C8)", () => {
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

  it("prefixes an optional glyph onto the header (C8: shell's frame previously had no glyph at all)", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      glyph: "❌",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "u",
    });
    expect(text.split("\n")[0]).toBe("❌ Fadeout — won");
  });
});

describe("composeShareArtifact — daily (C8: header corrected to 'Daily #N', not the bare '#N' shell shipped with)", () => {
  it("matches the plan-binding grammar: title — Daily #n · result (par p)", () => {
    const text = composeShareArtifact({
      title: "Crackstep",
      resultPhrase: "solved in 23",
      artifactBody: "🟩🟩🟨🟩🟥",
      url: "tttwist.game/d/crackstep",
      daily: { dayNumber: 14, par: 19 },
    });
    expect(text.split("\n")[0]).toBe("Crackstep — Daily #14 · solved in 23 (par 19)");
  });

  it("omits the par suffix when the certificate carries no par", () => {
    const text = composeShareArtifact({
      title: "Crackstep",
      resultPhrase: "solved in 23",
      artifactBody: "🟩🟩🟨🟩🟥",
      url: "tttwist.game/d/crackstep",
      daily: { dayNumber: 14 },
    });
    expect(text.split("\n")[0]).toBe("Crackstep — Daily #14 · solved in 23");
  });
});

describe("composeShareArtifact — attempt is INLINE on the header, not a separate line (C8: the third named grammar gap)", () => {
  it("is absent (no ' · attempt' suffix at all) when restarts is 0 or undefined — a clean first completion is never labelled", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      restarts: 0,
    });
    expect(text.split("\n")[0]).toBe("Fadeout — won");
    expect(text).not.toMatch(/attempt/i);
  });

  it("'· attempt 2' inline on the header when restarts === 1 (attempt = restarts + 1) — no separate restart line at all", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      restarts: 1,
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Fadeout — won · attempt 2");
    expect(lines).toHaveLength(3); // header, body, url — no third "restart" line anymore
  });

  it("'· attempt 4' inline when restarts === 3, combined with daily + par + glyph", () => {
    const text = composeShareArtifact({
      title: "Fadeout",
      glyph: "❌",
      resultPhrase: "won",
      artifactBody: "❌⭕",
      url: "tttwist.game/fadeout",
      daily: { dayNumber: 37, par: 10 },
      restarts: 3,
    });
    expect(text.split("\n")[0]).toBe("❌ Fadeout — Daily #37 · won (par 10) · attempt 4");
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

// --- Everything below is ported from packages/daily/test/share.test.ts (C8: one
// implementation, one set of tests) -----------------------------------------------------------

describe("composeShareText() reproduces the three plan §4.4 fixtures byte-for-byte", () => {
  it("fixture 1: two-player daily win, clean first attempt (Fadeout)", () => {
    const input: ShareInput = {
      glyph: "❌",
      title: "Fadeout",
      mode: { kind: "daily", n: 37 },
      result: "won in 9 🏆",
      attempt: 1,
      body: "❌⭕❌⭕❌💨⭕❌🎯",
      statLine: "pieces faded: 2 · longest-lived X: 5 turns",
      url: "twistarcade.game/d/fadeout",
    };
    const expected = [
      "❌ Fadeout — Daily #37 · won in 9 🏆",
      "❌⭕❌⭕❌💨⭕❌🎯",
      "pieces faded: 2 · longest-lived X: 5 turns",
      "twistarcade.game/d/fadeout",
    ].join("\n");
    expect(composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toBe(expected);
  });

  it("fixture 2: two-player casual loss — no daily header, no #", () => {
    const input: ShareInput = {
      glyph: "❌",
      title: "Fadeout",
      mode: { kind: "casual" },
      result: "lost in 12",
      attempt: 1,
      body: "❌⭕❌⭕💨⭕❌💨⭕❌⭕🎯",
      statLine: "pieces faded: 4 · longest-lived X: 3 turns",
      url: "twistarcade.game/d/fadeout",
    };
    const expected = [
      "❌ Fadeout — lost in 12",
      "❌⭕❌⭕💨⭕❌💨⭕❌⭕🎯",
      "pieces faded: 4 · longest-lived X: 3 turns",
      "twistarcade.game/d/fadeout",
    ].join("\n");
    expect(composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toBe(expected);
  });

  it("fixture 3: solo daily with par, one restart — attempt 2, two-line struggle-shape body", () => {
    const input: ShareInput = {
      glyph: "🧊",
      title: "Crackstep",
      mode: { kind: "daily", n: 37 },
      result: "solved in 23 (par 19)",
      attempt: 2,
      body: ["🟩🟩🟩🟨🟨🟩🟩🟥💥", "🟩🟩🟩🟩🟩🟨🟨🟩🟩🟩🟩🟩🟩🟩✅"].join("\n"),
      statLine: "1 restart · the floor crumbles behind you",
      url: "twistarcade.game/d/crackstep",
    };
    const expected = [
      "🧊 Crackstep — Daily #37 · solved in 23 (par 19) · attempt 2",
      "🟩🟩🟩🟨🟨🟩🟩🟥💥",
      "🟩🟩🟩🟩🟩🟨🟨🟩🟩🟩🟩🟩🟩🟩✅",
      "1 restart · the floor crumbles behind you",
      "twistarcade.game/d/crackstep",
    ].join("\n");
    expect(composeShareText(input)).toBe(expected);
  });
});

function baseInput(overrides: Partial<ShareInput> = {}): ShareInput {
  return {
    glyph: "❌",
    title: "Fadeout",
    mode: { kind: "casual" },
    result: "won in 9 🏆",
    attempt: 1,
    body: "❌⭕❌⭕❌💨⭕❌🎯",
    statLine: "pieces faded: 2",
    url: "twistarcade.game/d/fadeout",
    ...overrides,
  };
}

describe("composeShareText() — grammar validation throws on violations rather than drifting silently", () => {
  it("rejects a body glyph outside the family alphabet and the declared seat glyphs", () => {
    const input = baseInput({ body: "❌⭕🐸🎯" }); // 🐸 is not in any allowed alphabet
    expect(() => composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toThrow(ShareGrammarError);
  });

  it("rejects a body glyph that IS in the house alphabet but not declared as this game's seat glyph", () => {
    const input = baseInput({ body: "❌⭕🎯" }); // ⭕/❌ never declared for this call
    expect(() => composeShareText(input, { seatGlyphs: [] })).toThrow(/glyph/i);
  });

  it("rejects more than 2 body lines", () => {
    const input = baseInput({ body: "🎯\n💨\n🎯" });
    expect(() => composeShareText(input, { seatGlyphs: [] })).toThrow(/line/i);
  });

  it("rejects a body line exceeding the per-line glyph cap", () => {
    const tooMany = Array.from({ length: 20 }, () => "💨").join("");
    const input = baseInput({ body: tooMany });
    expect(() => composeShareText(input, { seatGlyphs: [] })).toThrow(/glyph/i);
  });

  it("rejects a stat line exceeding the enforced character cap", () => {
    const input = baseInput({ statLine: "x".repeat(60) });
    expect(() => composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toThrow(/stat/i);
  });

  it("rejects a non-positive/non-integer attempt", () => {
    expect(() => composeShareText(baseInput({ attempt: 0 }), { seatGlyphs: ["❌", "⭕"] })).toThrow(/attempt/i);
    expect(() => composeShareText(baseInput({ attempt: 1.5 }), { seatGlyphs: ["❌", "⭕"] })).toThrow(/attempt/i);
  });

  it("omits the attempt suffix entirely when attempt === 1 (a clean first completion is never labelled)", () => {
    const text = composeShareText(baseInput({ attempt: 1 }), { seatGlyphs: ["❌", "⭕"] });
    expect(text).not.toMatch(/attempt/i);
  });

  it("rejects a composed artifact exceeding 320 total characters", () => {
    const input = baseInput({ statLine: "y".repeat(42), url: "twistarcade.game/d/fadeout".padEnd(280, "z") });
    expect(() => composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toThrow(/320|length/i);
  });

  it("rejects a composed artifact exceeding 7 total lines, INCLUDING when a single field smuggles embedded newlines (should-fix 5)", () => {
    // Stage-6 finding: the previous version counted `lines.length` (the ARRAY of composed
    // parts: header + body-lines + statLine + url), which structurally maxes out at 5 for any
    // legal 2-line body — so the guard was dead code against the real threat, a field (statLine
    // here) that itself contains embedded "\n"s. A statLine with 6 embedded newlines produces an
    // 11-LINE artifact once actually rendered, and the old check never saw it. Counting
    // `text.split("\n").length` AFTER joining (this file's composeShareArtifact already did this
    // correctly — that's should-fix 5's "keep shell's text-based line counting") catches it.
    const smugglingStatLine = "line1\nline2\nline3\nline4\nline5\nline6\nline7";
    const input = baseInput({ statLine: smugglingStatLine });
    expect(() => composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).toThrow(/7|line/i);
  });

  it("does not throw for a legal input at the actual 7-line ceiling", () => {
    const input = baseInput({ body: "🎯" }); // legal on its own; header+body+stat+url = 4 lines
    expect(() => composeShareText(input, { seatGlyphs: ["❌", "⭕"] })).not.toThrow();
  });
});

describe("truncateTimeline() (rule 7: long games truncate from the front, keeping the final 28)", () => {
  it("leaves a <=28-glyph timeline untouched", () => {
    const glyphs = Array.from({ length: 28 }, () => "🎯");
    expect(truncateTimeline(glyphs)).toEqual(glyphs);
  });

  it("keeps only the final 28 with a leading ellipsis marker when longer", () => {
    const glyphs = Array.from({ length: 40 }, (_, i) => (i === 39 ? "🎯" : "💨"));
    const result = truncateTimeline(glyphs);
    expect(result[0]).toBe("…");
    expect(result.length).toBe(29); // 28 kept + the leading marker
    expect(result[result.length - 1]).toBe("🎯"); // the endgame is the drama — always kept
  });
});

describe("timelineToBody() — must-fix 3: composes a valid (<=2 lines, <=15 glyphs/line) body from ANY timeline, including long ones truncateTimeline alone could not safely be joined into one line for", () => {
  it("a short timeline (<=15 glyphs) stays a single line, unchanged from a plain join", () => {
    const glyphs = Array.from({ length: 9 }, () => "🎯");
    expect(timelineToBody(glyphs)).toBe(glyphs.join(""));
  });

  it("EXECUTED PROOF (stage-6 must-fix 3): a 40-glyph timeline no longer throws when composed through composeShareText — it used to, unconditionally, for any 16-28 move timeline too", () => {
    const glyphs = Array.from({ length: 40 }, (_, i) => (i === 39 ? "🎯" : "💨"));
    const body = timelineToBody(glyphs);
    expect(() => composeShareText(baseInput({ body }), { seatGlyphs: [] })).not.toThrow();
    // Rule 6/7 reconciliation: 28 kept === 2 lines of <=14 — split into exactly 2 lines here.
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    // Array.from (not .length) to count by Unicode CODE POINT, not UTF-16 code unit — 🎯/💨 are
    // each one code point but two UTF-16 units, so `.length` overcounts by 2x here.
    for (const line of lines) {
      const glyphCount = Array.from(line.startsWith("…") ? line.slice(1) : line).length;
      expect(glyphCount).toBeLessThanOrEqual(15);
    }
    expect(body.endsWith("🎯")).toBe(true); // the endgame is still the drama
    expect(body.startsWith("…")).toBe(true); // truncation marker preserved on the first line
  });

  it("a 16-28 move timeline (no truncation triggers, but a single joined line would still exceed the 15-glyph cap) also splits into 2 lines rather than throwing", () => {
    const glyphs = Array.from({ length: 20 }, () => "🎯");
    const body = timelineToBody(glyphs);
    expect(() => composeShareText(baseInput({ body }), { seatGlyphs: [] })).not.toThrow();
    expect(body.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("exactly 28 glyphs (the truncateTimeline threshold) splits into two 14-glyph lines", () => {
    const glyphs = Array.from({ length: 28 }, () => "🎯");
    const body = timelineToBody(glyphs);
    const lines = body.split("\n");
    expect(lines).toEqual(["🎯".repeat(14), "🎯".repeat(14)]);
  });
});

describe("GLYPH_TABLE (per-game emoji, Phase 1 local table per plan §4.1)", () => {
  it("has an entry for every launch game named in the plan's worked examples", () => {
    expect(GLYPH_TABLE.fadeout).toBe("❌");
    expect(GLYPH_TABLE.crackstep).toBe("🧊");
    expect(GLYPH_TABLE["mine-run"]).toBe("💣");
  });
});

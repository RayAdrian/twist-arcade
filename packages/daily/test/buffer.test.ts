import { describe, expect, it } from "vitest";
import { classifyBuffer, findFirstMissingDay } from "../src/buffer";

// Plan §1.2's buffer policy (mirrors the certificate buffer, platform §7.7): ">=90 days of
// manifests committed at all times; CI alerts below 30, hard-fails below 7."

describe("buffer.ts — classifyBuffer()", () => {
  it("ok at and above 90", () => {
    expect(classifyBuffer(90)).toBe("ok");
    expect(classifyBuffer(120)).toBe("ok");
  });
  it("still ok between 30 and 89 (alert threshold is BELOW 30, not below 90)", () => {
    expect(classifyBuffer(30)).toBe("ok");
    expect(classifyBuffer(89)).toBe("ok");
  });
  it("alert below 30, down to and including 7", () => {
    expect(classifyBuffer(29)).toBe("alert");
    expect(classifyBuffer(7)).toBe("alert");
  });
  it("fail below 7", () => {
    expect(classifyBuffer(6)).toBe("fail");
    expect(classifyBuffer(0)).toBe("fail");
  });
});

// Should-fix 7 (stage-6 review): "90 files over 200 days with a hole next Tuesday reads
// buffer=ok" — a COUNT of upcoming manifests says nothing about whether every day between today
// and the furthest committed one is actually present. findFirstMissingDay walks that range and
// names the first gap, which is exactly the 6am-incident shape plan §1.2 promises can't happen.
describe("buffer.ts — findFirstMissingDay() (should-fix 7: contiguity, not just count)", () => {
  it("returns null when every day from today through the furthest upcoming day is present", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    expect(findFirstMissingDay(days, "2026-09-01")).toBeNull();
  });

  it("returns null on an empty list (nothing committed at all is a buffer-count problem, not a contiguity one)", () => {
    expect(findFirstMissingDay([], "2026-09-01")).toBeNull();
  });

  it("finds a hole in the MIDDLE of an otherwise-large committed range — the exact 'buffer=ok but a day is missing' bug", () => {
    // 90 files, but 2026-09-05 is missing — a naive count (89 upcoming, still >= 30) would read
    // "ok" and never notice.
    const days: string[] = [];
    for (let i = 1; i <= 90; i++) {
      const day = `2026-09-${String(i).padStart(2, "0")}`;
      if (day === "2026-09-05" || i > 30) continue; // keep the fixture small; a gap early is enough to prove it
      days.push(day);
    }
    const missing = findFirstMissingDay(days, "2026-09-01");
    expect(missing).toBe("2026-09-05");
  });

  it("returns null when today itself is already past every committed day (nothing upcoming to check — verify-manifests's buffer-count guard owns that case instead)", () => {
    expect(findFirstMissingDay(["2026-09-01"], "2026-09-05")).toBeNull();
  });

  it("does not flag days that are before `today` as missing, even if absent", () => {
    // 2026-09-01/02 were never committed (game predates them, or they're pre-epoch) — only the
    // range [today, furthest upcoming day] matters.
    expect(findFirstMissingDay(["2026-09-03", "2026-09-04"], "2026-09-03")).toBeNull();
  });
});

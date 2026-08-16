import { afterEach, describe, expect, it, vi } from "vitest";
import { getUmamiConfig } from "./analytics-config";

// app/analytics-config.test.ts — C91: NEXT_PUBLIC_UMAMI_WEBSITE_ID / NEXT_PUBLIC_UMAMI_SCRIPT_URL
// existed in .env.example with zero readers. getUmamiConfig() is the single source of truth
// both the server-rendered <Script> gate (app/layout.tsx) and the client provider-wiring effect
// (app/AnalyticsBootstrap.tsx) call — so the two can never drift out of sync with each other,
// the exact "declaration that looks like wiring and isn't" shape C91 is about. Unconfigured is
// the normal local-dev state and must stay a silent, no-op null — never a throw, never a
// partial/half-populated config.

describe("getUmamiConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when both vars are unset — the deliberate no-op state for local dev", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "");
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when only the website id is set (no script url)", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "abc-123");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "");
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when only the script url is set (no website id)", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://cloud.umami.is/script.js");
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns the config when both vars are set", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "abc-123");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://cloud.umami.is/script.js");
    expect(getUmamiConfig()).toEqual({
      websiteId: "abc-123",
      scriptUrl: "https://cloud.umami.is/script.js",
    });
  });
});

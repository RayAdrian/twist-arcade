import { afterEach, describe, expect, it, vi } from "vitest";
import { getSiteUrl } from "../src/site-url";

// packages/shell/test/site-url.test.ts — plan/C91: NEXT_PUBLIC_SITE_URL exists in
// .env.example but nothing reads it. getSiteUrl() is the one place GameShell.tsx (and any
// future share/OG caller in this package) resolves an absolute origin from — see
// GameShell.test.tsx's own "share URL" assertions for the consumer side.

describe("getSiteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns NEXT_PUBLIC_SITE_URL when set, with any trailing slash stripped", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://twistarcade.game/");
    expect(getSiteUrl()).toBe("https://twistarcade.game");
  });

  it("returns NEXT_PUBLIC_SITE_URL verbatim (minus trailing slash) when it has no trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("falls back to window.location.origin in the browser when the env var is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const originalLocation = window.location;
    // jsdom's window.location isn't directly assignable — redefine the property to stub origin.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, origin: "http://127.0.0.1:54471" },
    });
    try {
      expect(getSiteUrl()).toBe("http://127.0.0.1:54471");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});

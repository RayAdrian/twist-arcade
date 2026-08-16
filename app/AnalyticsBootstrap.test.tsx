import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// app/AnalyticsBootstrap.test.tsx — C91 / plan §12 Q1: the app must go through
// packages/daily/src/metrics.ts's configureMetricsProvider(), never wire a vendor SDK
// directly. `@twist-arcade/daily` is mocked so this test observes exactly what
// AnalyticsBootstrap calls, decoupled from umamiProvider's own real implementation (already
// covered by that package's own metrics.test.ts).
const configureMetricsProvider = vi.fn();
const umamiProviderSentinel = { track: vi.fn() };
vi.mock("@twist-arcade/daily", () => ({
  configureMetricsProvider,
  umamiProvider: umamiProviderSentinel,
}));

async function importFresh() {
  vi.resetModules();
  const [{ AnalyticsBootstrap }] = await Promise.all([import("./AnalyticsBootstrap")]);
  return AnalyticsBootstrap;
}

describe("AnalyticsBootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    configureMetricsProvider.mockClear();
  });

  it("renders nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "");
    const AnalyticsBootstrap = await importFresh();
    const { container } = render(<AnalyticsBootstrap />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never calls configureMetricsProvider when Umami is unconfigured — the deliberate no-op state for local dev", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "");
    const AnalyticsBootstrap = await importFresh();
    render(<AnalyticsBootstrap />);
    expect(configureMetricsProvider).not.toHaveBeenCalled();
  });

  it("wires umamiProvider through configureMetricsProvider once both vars are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "abc-123");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://cloud.umami.is/script.js");
    const AnalyticsBootstrap = await importFresh();
    render(<AnalyticsBootstrap />);
    expect(configureMetricsProvider).toHaveBeenCalledWith(umamiProviderSentinel);
  });

  it("wires umamiProvider only when the website id is missing (script url alone is not enough)", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://cloud.umami.is/script.js");
    const AnalyticsBootstrap = await importFresh();
    render(<AnalyticsBootstrap />);
    expect(configureMetricsProvider).not.toHaveBeenCalled();
  });
});

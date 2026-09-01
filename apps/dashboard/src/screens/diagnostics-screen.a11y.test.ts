import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./diagnostics-screen.js";
import type { DiagnosticsScreen } from "./diagnostics-screen.js";
import type { DashboardApi, DiagnosticsLine } from "../api/client.js";

/**
 * The diagnostics viewer scanned by axe in both themes, in four shapes: a populated tail (mixed
 * levels, so every level colour renders), an empty ring (just the controls + empty note), a live raise
 * (the `debug` verbosity banner with its filled revert window), and the error state (a rejected poll
 * shows the `role="alert"` banner). Mounted by ASSIGNING the `api` stub as a property; the screen polls
 * on connect, so the stub must resolve or a stray rejection pollutes the run (a rejection is a finding).
 * Every colour is a `--wt-*` token. Mirrors `service-status-screen.a11y.test.ts`.
 */
const SEED: DiagnosticsLine[] = [
  { at: "2026-08-31T10:00:00Z", level: "info", event: "http.request", requestId: "r1" },
  { at: "2026-08-31T10:00:01Z", level: "warn", event: "outbox.retry" },
  { at: "2026-08-31T10:00:02Z", level: "error", event: "db.timeout" },
  { at: "2026-08-31T10:00:03Z", level: "debug", event: "cache.miss" },
];

function stubApi(lines: DiagnosticsLine[], overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getRecentLogs: vi.fn().mockResolvedValue({ lines: lines.map((l) => ({ ...l })) }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: DiagnosticsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("diagnostics-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated tail", async () => {
    const { el, host } = await mountWidget<DiagnosticsScreen>(
      "dashboard-diagnostics-screen",
      { api: stubApi(SEED) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with an empty ring", async () => {
    const { el, host } = await mountWidget<DiagnosticsScreen>(
      "dashboard-diagnostics-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a live raise (verbosity banner)", async () => {
    const { el, host } = await mountWidget<DiagnosticsScreen>(
      "dashboard-diagnostics-screen",
      {
        api: stubApi(SEED, {
          getVerbosity: vi
            .fn()
            .mockResolvedValue({ level: "debug", revertsAt: "2026-08-31T10:15:00Z" }),
        }),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const { el, host } = await mountWidget<DiagnosticsScreen>(
      "dashboard-diagnostics-screen",
      {
        api: stubApi(SEED, {
          getRecentLogs: vi.fn().mockRejectedValue({ code: "server.internal" }),
        }),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

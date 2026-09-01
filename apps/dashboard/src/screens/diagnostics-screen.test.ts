import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLine } from "../api/client.js";
import { DiagnosticsScreen } from "./diagnostics-screen.js";

/**
 * The live diagnostics viewer. Its `api` is a stub: `getRecentLogs` returns a known ring the screen
 * tails on connect + every poll, `getVerbosity` reports the current level (+ pending revert), and
 * `setVerbosity` is a spy the raise control calls. Assertions cover each behaviour on its own: it POLLS
 * the ring on connect and renders the lines; the raise control posts `("debug", <window>)` then
 * refreshes; the pause control freezes the tail (the interval fires but skips the fetch) and resume
 * restarts it; clear empties the rendered rows locally; the interval is CLEARED on disconnect (no leak);
 * a live raise renders the revert window with its `{time}` placeholder filled (never a literal brace);
 * and a rejected poll surfaces a localised `role="alert"`, never the raw wire code. Mirrors
 * `service-status-screen.test.ts`.
 */

afterEach(cleanupWidgets);

const SEED: DiagnosticsLine[] = [
  { at: "2026-08-31T10:00:00Z", level: "info", event: "http.request", requestId: "r1" },
  { at: "2026-08-31T10:00:01Z", level: "error", event: "db.timeout" },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  lines: DiagnosticsLine[] = SEED,
): DashboardApi {
  return {
    getRecentLogs: vi.fn().mockResolvedValue({ lines: lines.map((l) => ({ ...l })) }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight refresh (the awaited getRecentLogs/getVerbosity) and the follow-up render. */
async function flush(el: DiagnosticsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: DiagnosticsScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const errorKey = (el: DiagnosticsScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

describe("diagnostics-screen", () => {
  it("polls recent logs on connect and renders lines", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(api.getRecentLogs).toHaveBeenCalledWith(200);
    expect(api.getVerbosity).toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).toContain("http.request");
    expect(el.shadowRoot!.textContent).toContain("db.timeout");
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("shows the empty state when the ring is empty", async () => {
    const api = stubApi({}, []);
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=empty]")).not.toBeNull();
    expect(q(el, "[data-test=log]")).toBeNull();
  });

  it("raising verbosity posts debug + a window, then refreshes", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    const before = (api.getRecentLogs as ReturnType<typeof vi.fn>).mock.calls.length;
    q(el, "[data-test=raise-verbosity]")!.click();
    await flush(el);
    expect(api.setVerbosity).toHaveBeenCalledWith("debug", expect.any(Number));
    // The raise refreshes, so the ring is re-pulled at least once more.
    expect((api.getRecentLogs as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      before,
    );
  });

  it("renders the revert window with its {time} placeholder filled (never a literal brace)", async () => {
    const api = stubApi({
      getVerbosity: vi
        .fn()
        .mockResolvedValue({ level: "debug", revertsAt: "2026-08-31T10:15:00Z" }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    const window = q(el, "[data-test=verbosity-window]");
    expect(window).not.toBeNull();
    // The whole rendered tree must never leak the raw `{time}` token.
    expect(el.shadowRoot!.textContent).not.toContain("{");
  });

  it("does not render the verbosity banner while the level is the standing default", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=verbosity-on]")).toBeNull();
  });

  it("clear empties the rendered rows locally", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=log]")).not.toBeNull();
    q(el, "[data-test=clear]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=log]")).toBeNull();
    expect(q(el, "[data-test=empty]")).not.toBeNull();
  });

  it("polls on the interval, pauses/resumes, and stops after disconnect (no leak)", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi();
      const { el, host } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
        api,
      });
      // Settle the immediate refresh fired from connectedCallback.
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      const calls = () => (api.getRecentLogs as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(calls()).toBe(1);

      // One interval tick re-polls.
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls()).toBe(2);

      // Pausing freezes the tail: the interval still fires but skips the fetch.
      q(el, "[data-test=toggle-pause]")!.click();
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(1500 * 3);
      expect(calls()).toBe(2);

      // Resuming restarts the fetch on the next tick.
      q(el, "[data-test=toggle-pause]")!.click();
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls()).toBe(3);

      // Disconnect clears the interval — no further polls fire (proof-by-deletion: dropping
      // clearInterval from disconnectedCallback keeps this count rising).
      host.remove();
      await vi.advanceTimersByTimeAsync(1500 * 5);
      expect(calls()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-flights the poll: a tick while a refresh is in flight is skipped", async () => {
    vi.useFakeTimers();
    try {
      // The first getRecentLogs is DEFERRED (a promise we resolve by hand); later calls resolve at
      // once. So the connect refresh stays in flight until we release it.
      let releaseFirst!: (v: { lines: DiagnosticsLine[] }) => void;
      const firstPending = new Promise<{ lines: DiagnosticsLine[] }>((resolve) => {
        releaseFirst = resolve;
      });
      const getRecentLogs = vi
        .fn()
        .mockReturnValueOnce(firstPending)
        .mockResolvedValue({ lines: [] });
      const api = stubApi({ getRecentLogs });
      await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      const calls = () => getRecentLogs.mock.calls.length;
      // connectedCallback fired one refresh, now awaiting the deferred first response.
      expect(calls()).toBe(1);

      // Two ticks fire WHILE the first refresh is still in flight → both guarded, no new fetch
      // (proof-by-deletion: dropping the `if (this.#inFlight) return` early-return lets these through,
      // so the count climbs and this assertion goes red).
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls()).toBe(1);

      // Release the first response; the guard clears in its `finally`.
      releaseFirst({ lines: [] });
      await vi.advanceTimersByTimeAsync(0);

      // The next tick is now free to poll again.
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a rejected poll as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({
      getRecentLogs: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(errorKey(el)).toBe("management_session.required");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("management_session.required", "es-ES"));
    expect(banner).not.toContain("management_session.required");
  });

  it("falls back to server.internal when a rejected poll carries no code", async () => {
    const api = stubApi({ getVerbosity: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("surfaces a rejected raise as a localised role=alert", async () => {
    const api = stubApi({
      setVerbosity: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    q(el, "[data-test=raise-verbosity]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("authorization.not_permitted");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("authorization.not_permitted", "es-ES"));
  });
});

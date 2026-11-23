import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLine, DiagnosticsLog } from "../api/client.js";
import { DiagnosticsScreen } from "./diagnostics-screen.js";

afterEach(cleanupWidgets);

const SEED: DiagnosticsLine[] = [
  { at: "2026-08-31T10:00:00Z", level: "info", event: "http.request", requestId: "r1" },
  {
    at: "2026-08-31T10:00:01Z",
    level: "error",
    event: "db.timeout",
    requestId: "r2",
    reason: "Timed out",
  },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  lines: DiagnosticsLine[] = SEED,
): DashboardApi {
  return {
    getRecentLogs: vi.fn().mockResolvedValue({
      lines: lines.filter((line) => line.level !== "info"),
      timeZone: "Asia/Tokyo",
      oldestScannedAt: lines[0]?.at ?? null,
    }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

function deferredLog() {
  let resolve!: (value: DiagnosticsLog) => void;
  const promise = new Promise<DiagnosticsLog>((finish) => (resolve = finish));
  return { promise, resolve };
}

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
    expect(api.getRecentLogs).toHaveBeenCalledWith(200, "warn");
    expect(api.getVerbosity).toHaveBeenCalled();
    const log = q(el, "[data-test=log]")!;
    expect(log.textContent).not.toContain("http.request");
    expect(log.textContent).toContain("db.timeout");
    expect(log.textContent).toContain("19:00:01");
    expect(log.textContent).toContain("reason=Timed out");
    expect(log.textContent).toContain("r2");
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("requests all levels and searches visible details and request IDs", async () => {
    const response = { timeZone: "Asia/Tokyo", oldestScannedAt: SEED[0]!.at };
    const api = stubApi({
      getRecentLogs: vi
        .fn()
        .mockResolvedValueOnce({ ...response, lines: [SEED[1]] })
        .mockResolvedValue({ ...response, lines: SEED }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    const filter = q(el, "wt-combobox[name=log-level]");
    expect(filter).not.toBeNull();
    await chooseOption(filter!, "all");
    await vi.waitFor(() => {
      expect(api.getRecentLogs).toHaveBeenLastCalledWith(200, "all");
      expect(q(el, "[data-test=log]")?.textContent).toContain("http.request");
    });

    const search = q(el, "wt-input[name=log-search]")!.shadowRoot!.querySelector("input")!;
    for (const term of ["timed OUT", "r2", "outside this log"]) {
      search.value = term;
      search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await el.updateComplete;
      if (term === "outside this log") {
        expect(q(el, "[data-test=no-matches]")).not.toBeNull();
      } else {
        const text = q(el, "[data-test=log]")?.textContent;
        expect(text).toContain("db.timeout");
        expect(text).not.toContain("http.request");
      }
    }
  });

  it("keeps a late response for the old level out of the current log", async () => {
    const warning = deferredLog();
    const all = deferredLog();
    const getRecentLogs = vi.fn().mockReturnValueOnce(warning.promise).mockReturnValue(all.promise);
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
      api: stubApi({ getRecentLogs }),
    });
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox")!, "all");

    const info = { timeZone: "Europe/Madrid", oldestScannedAt: SEED[0]!.at };
    warning.resolve({ ...info, lines: [SEED[1]!] });
    await vi.waitFor(() => expect(getRecentLogs).toHaveBeenLastCalledWith(200, "all"));
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain("db.timeout");

    all.resolve({ ...info, lines: SEED });
    await vi.waitFor(() => expect(q(el, "[data-test=log]")?.textContent).toContain("http.request"));
  });

  it("sets the log lines in the design system's monospace font", async () => {
    const { el, host } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
      api: stubApi(),
    });
    await flush(el);
    host.style.setProperty("--wt-font-family-mono", "serif");
    expect(getComputedStyle(q(el, "[data-test=log]")!).fontFamily).toBe("serif");
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

  it("reports when detailed logging ends in the venue time zone", async () => {
    const api = stubApi({
      getVerbosity: vi
        .fn()
        .mockResolvedValue({ level: "debug", revertsAt: "2026-08-31T10:15:00Z" }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    const window = q(el, "[data-test=verbosity-window]");
    expect(window?.textContent).toContain("19:15");
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

      // Disconnect clears the interval, so no further polls fire.
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
      const first = deferredLog();
      const empty = { lines: [], timeZone: "Europe/Madrid", oldestScannedAt: null };
      const getRecentLogs = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(empty);
      const api = stubApi({ getRecentLogs });
      await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      const calls = () => getRecentLogs.mock.calls.length;
      // connectedCallback fired one refresh, now awaiting the deferred first response.
      expect(calls()).toBe(1);

      // Two ticks fire WHILE the first refresh is still in flight: both guarded, no new fetch.
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls()).toBe(1);

      // Release the first response; the guard clears in its `finally`.
      first.resolve(empty);
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

describe("diagnostics-screen verbosity and polling details", () => {
  it("shows debug verbosity without a revert window when no revert is pending", async () => {
    const api = stubApi({
      getVerbosity: vi.fn().mockResolvedValue({ level: "debug", revertsAt: null }),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await vi.waitFor(() => expect(q(el, "[data-test=verbosity-on]")).not.toBeNull());

    expect(q(el, "[data-test=verbosity-window]")).toBeNull();
  });

  it("takes the interval poll through the passive background client, and the first load through the active one", async () => {
    vi.useFakeTimers();
    try {
      const background = stubApi();
      const api = stubApi({ background } as Partial<DashboardApi>);
      await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      expect(api.getRecentLogs).toHaveBeenCalledTimes(1);
      expect(background.getRecentLogs).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1500);

      expect(background.getRecentLogs).toHaveBeenCalledTimes(1);
      expect(background.getVerbosity).toHaveBeenCalledTimes(1);
      expect(api.getRecentLogs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("diagnostics-screen messages across an outage", () => {
  it("keeps a raise's connection failure when the polls recover", async () => {
    vi.useFakeTimers();
    try {
      const getRecentLogs = vi
        .fn()
        .mockResolvedValueOnce({ lines: SEED })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({
          lines: [{ at: "2026-08-31T10:00:02Z", level: "info", event: "poll.recovered" }],
        });
      const api = stubApi({
        getRecentLogs,
        setVerbosity: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      });
      const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);
      await el.updateComplete;
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));

      q(el, "[data-test=raise-verbosity]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.setVerbosity).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(1500);
      await el.updateComplete;

      expect(getRecentLogs).toHaveBeenCalledTimes(4);
      expect(el.shadowRoot!.textContent).toContain("poll.recovered");
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a failed raise's message when the next raise succeeds", async () => {
    const api = stubApi({
      setVerbosity: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(undefined),
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
    await flush(el);
    q(el, "[data-test=raise-verbosity]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
    );
    q(el, "[data-test=raise-verbosity]")!.click();
    await vi.waitFor(() => expect(api.setVerbosity).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "[role=alert]")).toBeNull();
  });
});

let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("es-ES");
});
afterEach(() => setLocale(previousLocale));

it.each(["send", "discard"] as const)(
  "shows a draft for the administrator to %s",
  async (decision) => {
    const decideProblemDescription = vi.fn(async () => {});
    const api = stubApi({
      getProblemDescriptions: async () => [
        { reportId: "report", description: "Printer jammed", time: 1767225600000 },
      ],
      decideProblemDescription,
    });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
      api,
      canReviewDescriptions: true,
    });
    await expect
      .poll(() => q(el, "[data-problem-description]")?.textContent ?? "")
      .toContain("Printer jammed");
    await userEvent.click(q(el, `[data-description-decision="${decision}"]`)!);
    expect(decideProblemDescription).toHaveBeenCalledExactlyOnceWith("report", decision);
    await expect.poll(() => q(el, "[data-problem-description]")).toBeNull();
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(q(el, "[data-description-heading]"));
  },
);

const reviewFailures = ["authorization.not_permitted", "server.internal"];
it.each(reviewFailures)("keeps review hidden after %s", async (code) => {
  const load = vi.fn().mockRejectedValue({ code });
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({ getProblemDescriptions: load }),
    canReviewDescriptions: true,
  });
  await flush(el);
  expect(load).toHaveBeenCalledOnce();
  expect(q(el, "[data-description-refresh]")).toBeNull();
});

const DRAFT = { reportId: "report", description: "Printer jammed", time: 1767225600000 };

it("reloads the drafts when the screen is shown again", async () => {
  const load = vi.fn().mockResolvedValue([DRAFT]);
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({ getProblemDescriptions: load }),
    canReviewDescriptions: true,
  });
  await flush(el);
  expect(load).toHaveBeenCalledOnce();
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  await flush(el);
  expect(load).toHaveBeenCalledTimes(2);
});

it("does not start a second draft read while the first is still loading", async () => {
  const load = vi.fn(() => new Promise<never>(() => {}));
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({ getProblemDescriptions: load }),
    canReviewDescriptions: true,
  });
  await flush(el);
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  await flush(el);
  expect(load).toHaveBeenCalledOnce();
});

it("sends one decision when the button is pressed twice before the screen redraws", async () => {
  const decideProblemDescription = vi.fn(() => new Promise<void>(() => {}));
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({ getProblemDescriptions: async () => [DRAFT], decideProblemDescription }),
    canReviewDescriptions: true,
  });
  await expect.poll(() => q(el, "[data-problem-description]")).not.toBeNull();
  const send = q(el, '[data-description-decision="send"]')!;
  send.click();
  send.click();
  expect(decideProblemDescription).toHaveBeenCalledOnce();
});

it("keeps the draft and says the decision failed when the server refuses it", async () => {
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({
      getProblemDescriptions: async () => [DRAFT],
      decideProblemDescription: vi.fn().mockRejectedValue({ code: "server.internal" }),
    }),
    canReviewDescriptions: true,
  });
  await expect.poll(() => q(el, "[data-problem-description]")).not.toBeNull();
  await userEvent.click(q(el, '[data-description-decision="discard"]')!);
  await expect
    .poll(() => q(el, ".error[role=alert]")?.textContent)
    .toBe(t("problem_report.review_failed"));
  expect(q(el, "[data-problem-description]")?.textContent).toContain("Printer jammed");
});

it("hides the drafts when the decision is refused for lack of permission", async () => {
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
    api: stubApi({
      getProblemDescriptions: async () => [DRAFT],
      decideProblemDescription: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    }),
    canReviewDescriptions: true,
  });
  await expect.poll(() => q(el, "[data-problem-description]")).not.toBeNull();
  await userEvent.click(q(el, '[data-description-decision="send"]')!);
  await expect.poll(() => q(el, "[data-description-heading]")).toBeNull();
  expect(q(el, "[data-problem-description]")).toBeNull();
});

it("clears a failed poll's message once a later poll succeeds", async () => {
  vi.useFakeTimers();
  try {
    const getRecentLogs = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue({ lines: SEED, timeZone: "UTC", oldestScannedAt: null });
    const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", {
      api: stubApi({ getRecentLogs }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
    await vi.advanceTimersByTimeAsync(1500);
    await el.updateComplete;
    expect(q(el, "[role=alert]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("shows only the clock for today's lines and spells out non-text details", async () => {
  const at = new Date().toISOString();
  const api = stubApi({
    getRecentLogs: vi.fn().mockResolvedValue({
      lines: [{ at, level: "warn", event: "printer.retry", attempts: 3 }],
      timeZone: "UTC",
      oldestScannedAt: null,
    }),
  });
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
  await flush(el);
  const row = q(el, "li.lvl-warn")!;
  expect(row.querySelector("time")!.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  expect(row.textContent).toContain("attempts=3");
});

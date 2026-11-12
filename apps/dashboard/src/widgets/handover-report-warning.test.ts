import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DashboardApi, HandoverInterval } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { HandoverReportWarning } from "./handover-report-warning.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const interval: HandoverInterval = {
  operationId: "takeover",
  sourceName: "Old box",
  destinationName: "New box",
  lastChangeAtMs: null,
  declaredAtMs: 1794304800000,
  activatedAt: "2026-11-10T10:01:00Z",
  reason: "Power failure",
};

it.each([
  ["en-GB", en],
  ["es-ES", es],
] as const)(
  "warns about the venue's unconfirmed return without dating the displayed report (%s)",
  async (language, words) => {
    setLocale(language);
    const { el } = await mountWidget<HandoverReportWarning>("dashboard-handover-report-warning", {
      canViewReports: true,
      api: {
        listHandoverIntervals: async () => ({ intervals: [interval], timeZone: "Europe/Madrid" }),
      } as unknown as DashboardApi,
    });
    expect(el.shadowRoot).not.toBeNull();
    await vi.waitFor(() =>
      expect(el.shadowRoot?.textContent).toContain(words["handover_warning.unconfirmed"]),
    );
    expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/handover-intervals",
    );
    expect(el.shadowRoot!.querySelector("a")!.textContent).toContain(
      words["handover_warning.check"],
    );
    expect(el.shadowRoot!.textContent).not.toContain(interval.reason);
  },
);

it("keeps a pending check, failure, retry and empty result distinct", async () => {
  setLocale("en-GB");
  let answer!: (value: unknown) => void;
  const list = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    )
    .mockRejectedValueOnce({ code: "report.failed" })
    .mockResolvedValue({ intervals: [], timeZone: "Europe/Madrid" });
  const { el } = await mountWidget<HandoverReportWarning>("dashboard-handover-report-warning", {
    canViewReports: true,
    api: { listHandoverIntervals: list } as unknown as DashboardApi,
  });
  expect(el.shadowRoot).not.toBeNull();
  expect(el.shadowRoot?.textContent).toContain(en["handover_warning.loading"]);
  answer({ intervals: [interval], timeZone: "Europe/Madrid" });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("a")).toBeTruthy());
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.textContent).toContain(en["handover_warning.unavailable"]),
  );
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("[role=status]")).toBeNull());
  expect(el.shadowRoot!.textContent!.trim()).toBe("");
});

it("explains the missing report-view permission without requesting or linking private intervals", async () => {
  setLocale("en-GB");
  const list = vi.fn().mockResolvedValue({ intervals: [interval], timeZone: "Europe/Madrid" });
  const { el } = await mountWidget<HandoverReportWarning>("dashboard-handover-report-warning", {
    canViewReports: false,
    api: { listHandoverIntervals: list } as unknown as DashboardApi,
  });
  expect(el.shadowRoot).not.toBeNull();
  expect(el.shadowRoot?.textContent).toContain(en["handover_warning.permission"]);
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-button")).toBeNull();
  expect(list).not.toHaveBeenCalled();
});

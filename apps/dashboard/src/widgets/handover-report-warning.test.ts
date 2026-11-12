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

it("hides the first check and retains warning or failure while Refresh runs", async () => {
  setLocale("en-GB");
  let answer!: (value: unknown) => void;
  let refuse!: (reason: unknown) => void;
  const list = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        answer = resolve;
        refuse = reject;
      }),
  );
  const { el } = await mountWidget<HandoverReportWarning>("dashboard-handover-report-warning", {
    api: { listHandoverIntervals: list } as unknown as DashboardApi,
  });
  expect(el.shadowRoot).not.toBeNull();
  const region = el.shadowRoot!.querySelector("[role=status]");
  expect(region).not.toBeNull();
  expect(region!.textContent!.trim()).toBe("");
  expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  answer({ intervals: [interval], timeZone: "Europe/Madrid" });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("a")).toBeTruthy());
  expect(el.shadowRoot!.querySelector("[role=status]")).toBe(region);
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  expect(el.shadowRoot!.textContent).toContain(en["handover_warning.unconfirmed"]);
  expect(el.shadowRoot!.querySelector("a")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(true);
  refuse({ code: "report.failed" });
  await vi.waitFor(() =>
    expect(el.shadowRoot?.textContent).toContain(en["handover_warning.unavailable"]),
  );
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  expect(el.shadowRoot!.textContent).toContain(en["handover_warning.unavailable"]);
  expect(el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(true);
  answer({ intervals: [], timeZone: "Europe/Madrid" });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector(".notice")).toBeNull());
  expect(el.shadowRoot!.querySelector("[role=status]")).toBe(region);
  expect(el.shadowRoot!.textContent!.trim()).toBe("");
});

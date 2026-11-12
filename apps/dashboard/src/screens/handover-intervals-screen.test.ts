import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { HandoverIntervalsScreen } from "./handover-intervals-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const row = {
  operationId: "op",
  sourceName: "Kitchen box",
  destinationName: "Counter box",
  lastChangeAtMs: Date.parse("2026-11-10T09:50:00Z"),
  declaredAtMs: Date.parse("2026-11-10T10:00:00Z"),
  activatedAt: "2026-11-10T09:59:00Z",
  reason: "Power failure",
};

it("keeps loading, empty, failure and retry distinct", async () => {
  setLocale("en-GB");
  let resolve!: (value: unknown) => void;
  const listHandoverIntervals = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockRejectedValueOnce({ code: "report.failed" })
    .mockResolvedValue({ intervals: [row], timeZone: "Europe/Madrid" });
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: { listHandoverIntervals } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("wt-data-table")?.loading).toBe(true));
  resolve({ intervals: [], timeZone: "Europe/Madrid" });
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.emptyMessage).toBe(
      en["handover_intervals.empty"],
    ),
  );
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBeTruthy(),
  );
  expect(el.shadowRoot!.querySelector("wt-data-table")!.emptyMessage).toBe("");
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toEqual([row]),
  );
  expect(el.shadowRoot!.querySelector("wt-data-table")!.errorMessage).toBe("");
});

it.each([
  ["en-GB", en],
  ["es-ES", es],
] as const)(
  "labels each clock in the venue zone, with backwards dates and unknown activity (%s)",
  async (language, words) => {
    setLocale(language);
    const { el } = await mountWidget<HandoverIntervalsScreen>(
      "dashboard-handover-intervals-screen",
      {
        api: {
          listHandoverIntervals: async () => ({
            intervals: [row, { ...row, operationId: "unknown", lastChangeAtMs: null }],
            timeZone: "Europe/Madrid",
          }),
        } as unknown as DashboardApi,
      },
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toHaveLength(2),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const text = table.shadowRoot!.textContent!;
    for (const key of ["copy", "declared", "activated"] as const)
      expect(text).toContain(words[`handover_intervals.${key}`]);
    for (const value of [
      "Kitchen box",
      "Counter box",
      "Power failure",
      "10:50",
      "11:00",
      "10:59",
      words["handover_intervals.unknown"],
    ])
      expect(text).toContain(value);
    expect(el.shadowRoot!.textContent).toContain("Europe/Madrid");
    expect(el.shadowRoot!.textContent).toContain(words["handover_intervals.unconfirmed"]);
    expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
      `/help/${language.startsWith("es") ? "es" : "en"}/servers#reconciliation`,
    );
  },
);

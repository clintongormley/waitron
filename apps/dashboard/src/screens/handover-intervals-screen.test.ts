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
  inventoryReceived: true,
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
    api: {
      listHandoverIntervals,
      listReturnedInvoices: async () => ({
        records: [],
        nextOffset: null,
        timeZone: "Europe/Madrid",
      }),
    } as unknown as DashboardApi,
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
          listReturnedInvoices: async () => ({
            records: [],
            nextOffset: null,
            timeZone: "Europe/Madrid",
          }),
          listHandoverIntervals: async () => ({
            intervals: [
              row,
              { ...row, operationId: "unknown", inventoryReceived: false, lastChangeAtMs: null },
            ],
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
      words["handover_intervals.received"],
      words["handover_intervals.not_received"],
    ])
      expect(text).toContain(value);
    expect(el.shadowRoot!.textContent).toContain("Europe/Madrid");
    expect(el.shadowRoot!.textContent).toContain(words["handover_intervals.unconfirmed"]);
    expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(
      `/help/${language.startsWith("es") ? "es" : "en"}/servers#reconciliation`,
    );
  },
);

it("loads returned invoices independently and pages, retries and refreshes to zero", async () => {
  setLocale("en-GB");
  let resolve!: (value: unknown) => void;
  const invoice = {
    recordId: "original",
    saleId: "sale",
    sourceName: "Old box",
    sourceNodeId: "old",
    generationId: "chain",
    installation: "ABCDE",
    sequence: 12,
    invoiceNumber: "A/42",
    issueDate: "2026-07-20",
    kind: "F2",
    category: "simplified",
    correctsRecordId: null,
    taxable: "0.30",
    gross: "0.33",
    tax: "0.03",
    receivedAt: "2026-07-21T23:30:00Z",
  };
  const listReturnedInvoices = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockRejectedValueOnce({ code: "report.failed" })
    .mockResolvedValueOnce({ records: [invoice], nextOffset: 100, timeZone: "Europe/Madrid" })
    .mockResolvedValueOnce({
      records: [{ ...invoice, recordId: "next" }],
      nextOffset: null,
      timeZone: "Europe/Madrid",
    })
    .mockResolvedValue({ records: [invoice], nextOffset: 100, timeZone: "Europe/Madrid" });
  const { el } = await mountWidget<HandoverIntervalsScreen>("dashboard-handover-intervals-screen", {
    api: {
      listHandoverIntervals: async () => ({ intervals: [], timeZone: "Europe/Madrid" }),
      listReturnedInvoices,
    } as unknown as DashboardApi,
  });
  const table = () => el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
  await vi.waitFor(() => expect(table()?.loading).toBe(true));
  resolve({ records: [], nextOffset: null, timeZone: "Europe/Madrid" });
  await vi.waitFor(() => expect(table().emptyMessage).toBe(en["returned_invoices.empty"]));
  const click = async (action: string) =>
    userEvent.click(el.shadowRoot!.querySelector(`[data-invoices="${action}"]`)!);
  await click("refresh");
  await vi.waitFor(() => expect(table().errorMessage).toBeTruthy());
  expect(table().emptyMessage).toBe("");
  await click("refresh");
  await vi.waitFor(() => expect(table().rows).toEqual([invoice]));
  expect(table().shadowRoot!.textContent).toContain("Simplified invoice");
  expect(table().shadowRoot!.textContent).toContain("F2");
  expect(table().shadowRoot!.textContent).toContain("2026-07-20");
  expect(table().shadowRoot!.textContent).toContain("01:30");
  await click("next");
  await vi.waitFor(() => expect(table().rows[0]).toMatchObject({ recordId: "next" }));
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-invoices="next"]')!.disabled).toBe(
    true,
  );
  await click("previous");
  await vi.waitFor(() => expect(table().rows).toEqual([invoice]));
  await click("next");
  await vi.waitFor(() => expect(listReturnedInvoices).toHaveBeenCalledTimes(6));
  await click("refresh");
  await vi.waitFor(() => expect(listReturnedInvoices).toHaveBeenCalledTimes(7));
  expect(listReturnedInvoices.mock.calls.map(([offset]) => offset)).toEqual([
    0, 0, 0, 100, 0, 100, 0,
  ]);
});

import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, MonthDownloadDto, TaxOfficeInvoiceDto } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TaxOfficeScreen } from "./tax-office-screen.js";
import "./tax-office-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  history.replaceState(null, "", "/");
});

const rows: TaxOfficeInvoiceDto[] = [
  {
    id: "sale-2",
    number: "B/7",
    kind: "F1",
    issuedAt: "2026-11-05T10:30:00.000Z",
    issueDate: "2026-11-05",
    operationDate: "2026-11-01",
    customerName: "Comidas Ruiz SL",
    customerTaxId: "B12345678",
    vat: [
      { rate: "10.00", base: "20.00", tax: "2.00" },
      { rate: "21.00", base: "10.00", tax: "2.10" },
    ],
    total: "34.10",
    corrects: [],
    cancelledAt: null,
  },
  {
    id: "sale-1",
    number: "A/12",
    kind: "R5",
    issuedAt: "2026-11-04T19:00:00.000Z",
    issueDate: "2026-11-04",
    operationDate: null,
    customerName: null,
    customerTaxId: null,
    vat: [{ rate: "10.00", base: "-10.00", tax: "-1.00" }],
    total: "-11.00",
    corrects: ["A/3"],
    cancelledAt: "2026-11-06T09:00:00.000Z",
  },
];

const api = (answer: () => Promise<unknown>): DashboardApi =>
  ({
    liveData: new LiveData(),
    listTaxOfficeInvoices: vi
      .fn()
      .mockImplementation(answer) as DashboardApi["listTaxOfficeInvoices"],
  }) as Partial<DashboardApi> as DashboardApi;
const tableOf = (el: TaxOfficeScreen) =>
  el.shadowRoot!.querySelector("wt-data-table") as HTMLElement & {
    loading: boolean;
    updateComplete: Promise<boolean>;
  };

describe.each(["light", "dark"] as const)("invoices for the tax office (%s)", (theme) => {
  it.each([
    ["the list", () => Promise.resolve({ rows, next: rows[1], timeZone: "Europe/Madrid" })],
    ["no invoices", () => Promise.resolve({ rows: [], next: null, timeZone: "Europe/Madrid" })],
    ["a failed read", () => Promise.reject({ code: "report.failed" })],
    [
      "a refused field",
      () => Promise.reject({ code: "management.request_invalid", params: { field: "rate" } }),
    ],
  ] as const)("keeps %s accessible", async (_state, answer) => {
    setLocale("en-GB");
    history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
    const { el, host } = await mountWidget<TaxOfficeScreen>(
      "dashboard-tax-office-screen",
      { api: api(answer) },
      theme,
    );
    const table = tableOf(el);
    await vi.waitFor(() => expect(table.loading).toBe(false));
    await table.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each([
    [
      "a ready month file",
      {
        status: "ready",
        id: "b1",
        month: "2026-11",
        bytes: 154_000_000,
        expiresAt: "2026-11-30T15:45:00.000Z",
      },
    ],
    ["a failed month file", { status: "failed", id: "b1", month: "2026-11", refusal: null }],
    [
      "a month file stopped when the server ran short of space",
      {
        status: "failed",
        id: "b1",
        month: "2026-11",
        refusal: {
          code: "tax_office.space_ran_out",
          params: { writtenBytes: 412_000_000 },
        },
      },
    ],
  ] as const)("keeps %s accessible", async (_state, view: MonthDownloadDto) => {
    setLocale("en-GB");
    history.replaceState(null, "", "/manage/invoices/from/2026-11-01/to/2026-11-30");
    const { el, host } = await mountWidget<TaxOfficeScreen>(
      "dashboard-tax-office-screen",
      {
        api: api(() => Promise.resolve({ rows, next: null, timeZone: "Europe/Madrid" })),
        monthFile: view,
      },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=month-file]")).not.toBeNull(),
    );
    const table = tableOf(el);
    await vi.waitFor(() => expect(table.loading).toBe(false));
    await table.updateComplete;
    await expectNoA11yViolations(host);
  });
});

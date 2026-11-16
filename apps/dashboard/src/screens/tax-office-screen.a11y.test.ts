import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, TaxOfficeInvoiceDto } from "../api/client.js";
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
      {
        api: {
          listTaxOfficeInvoices: vi
            .fn()
            .mockImplementation(answer) as DashboardApi["listTaxOfficeInvoices"],
        } as DashboardApi,
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table") as HTMLElement & {
      loading: boolean;
      updateComplete: Promise<boolean>;
    };
    await vi.waitFor(() => expect(table.loading).toBe(false));
    await table.updateComplete;
    await expectNoA11yViolations(host);
  });
});

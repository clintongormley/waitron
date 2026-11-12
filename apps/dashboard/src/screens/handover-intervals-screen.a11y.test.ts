import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { HandoverIntervalsScreen } from "./handover-intervals-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("handover intervals (%s)", (theme) => {
  it("keeps empty, populated and failed states accessible, with keyboard retry", async () => {
    setLocale("en-GB");
    const list = vi
      .fn()
      .mockResolvedValueOnce({ intervals: [], timeZone: "Europe/Madrid" })
      .mockResolvedValueOnce({
        intervals: [
          {
            operationId: "op",
            inventoryReceived: true,
            sourceName: "Old box",
            destinationName: "New box",
            lastChangeAtMs: null,
            declaredAtMs: 1794304800000,
            activatedAt: "2026-11-10T10:01:00Z",
            reason: "Power failure",
          },
        ],
        timeZone: "Europe/Madrid",
      })
      .mockRejectedValueOnce({ code: "report.failed" })
      .mockResolvedValue({ intervals: [], timeZone: "Europe/Madrid" });
    const { el, host } = await mountWidget<HandoverIntervalsScreen>(
      "dashboard-handover-intervals-screen",
      {
        api: {
          listHandoverIntervals: list,
          listReturnedInvoices: async () => ({
            records: [],
            nextOffset: null,
            timeZone: "Europe/Madrid",
          }),
        } as unknown as DashboardApi,
      },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.loading).toBe(false),
    );
    await expectNoA11yViolations(host);
    const button = el.shadowRoot!.querySelector("wt-button")!;
    await userEvent.click(button);
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toHaveLength(1),
    );
    await expectNoA11yViolations(host);
    await userEvent.click(button);
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBeTruthy(),
    );
    await expectNoA11yViolations(host);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBe(""),
    );
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows).toEqual([]);
  });
});

describe.each(["light", "dark"] as const)("returned invoices (%s)", (theme) => {
  it.each([
    ["en-GB", en],
    ["es-ES", es],
  ] as const)(
    "keeps loading, empty, populated and failed states accessible (%s)",
    async (language, words) => {
      setLocale(language);
      let resolve!: (value: unknown) => void;
      const row = {
        recordId: "cancellation",
        saleId: "sale",
        sourceNodeId: "old",
        sourceName: "Old box",
        generationId: "chain",
        installation: "ABCDE",
        sequence: 2,
        invoiceNumber: "A/42",
        issueDate: "2026-07-20",
        kind: "cancellation",
        correctsRecordId: "prior-record",
        taxable: null,
        gross: null,
        tax: null,
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
        .mockResolvedValueOnce({ records: [row], nextOffset: null, timeZone: "Europe/Madrid" })
        .mockRejectedValueOnce({ code: "report.failed" })
        .mockResolvedValue({ records: [], nextOffset: null, timeZone: "Europe/Madrid" });
      const { el, host } = await mountWidget<HandoverIntervalsScreen>(
        "dashboard-handover-intervals-screen",
        {
          api: {
            listHandoverIntervals: async () => ({ intervals: [], timeZone: "Europe/Madrid" }),
            listReturnedInvoices,
          } as unknown as DashboardApi,
        },
        theme,
      );
      const table = () => el.shadowRoot!.querySelectorAll("wt-data-table")[1]!;
      expect(table().loading).toBe(true);
      await expectNoA11yViolations(host);
      resolve({ records: [], nextOffset: null, timeZone: "Europe/Madrid" });
      await vi.waitFor(() => expect(table().loading).toBe(false));
      expect(table().emptyMessage).toBe(words["returned_invoices.empty"]);
      await expectNoA11yViolations(host);
      const button = el.shadowRoot!.querySelector<HTMLElement>('[data-invoices="refresh"]')!;
      await userEvent.click(button);
      await vi.waitFor(() => expect(table().rows).toEqual([row]));
      await table().updateComplete;
      expect(table().shadowRoot!.textContent).toContain(words["returned_invoices.not_recorded"]);
      expect(table().shadowRoot!.textContent).toContain(words["returned_invoices.cancellation"]);
      expect(table().shadowRoot!.textContent).toContain("prior-record");
      expect(table().shadowRoot!.textContent).toContain("2026-07-20");
      expect(table().shadowRoot!.textContent).toContain("1:30");
      await expectNoA11yViolations(host);
      await userEvent.click(button);
      await vi.waitFor(() => expect(table().errorMessage).toBeTruthy());
      await expectNoA11yViolations(host);
      button.focus();
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => expect(table().errorMessage).toBe(""));
      expect(table().rows).toEqual([]);
    },
  );
});

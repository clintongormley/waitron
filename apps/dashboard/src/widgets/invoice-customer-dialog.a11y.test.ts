import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import type { InvoiceCustomerDialog } from "./invoice-customer-dialog.js";

const modules = import.meta.glob<typeof import("./invoice-customer-dialog.js")>(
  "./invoice-customer-dialog.ts",
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const THREE: InvoiceCustomerSearchDto = {
  taxId: "12345678Z",
  invoices: [
    {
      invoice: "F1-2026-0003",
      issuedAt: "2026-03-02T10:15:00.000Z",
      name: "Jordi Puig",
      total: "12.50",
    },
    {
      invoice: "F1-2026-0011",
      issuedAt: "2026-05-19T18:40:00.000Z",
      name: "Puig Electrical Ltd",
      total: "240.00",
    },
    {
      invoice: "F1-2026-0020",
      issuedAt: "2026-09-30T09:05:00.000Z",
      name: "Jordi Puig",
      total: "7.05",
    },
  ],
};

async function type(el: InvoiceCustomerDialog, value: string): Promise<void> {
  const field = el.shadowRoot!.querySelector("wt-input[name=taxId]")!;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("invoice customer dialog accessibility %s", (theme) => {
  it("checks the empty, invalid, zero and three-row states", async () => {
    setLocale("en-GB");
    const load = modules["./invoice-customer-dialog.ts"];
    expect(load).toBeTypeOf("function");
    await load!();
    let answer: InvoiceCustomerSearchDto = { taxId: "12345678Z", invoices: [] };
    const api = { findInvoiceCustomer: async () => answer } as unknown as DashboardApi;
    const { el, host } = await mountWidget<InvoiceCustomerDialog>(
      "dashboard-invoice-customer-dialog",
      { api, open: true },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    await expectNoA11yViolations(host);

    await type(el, "12/34");
    await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
    await expectNoA11yViolations(host);

    await type(el, "12345678Z");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=none]")).not.toBeNull();
    await expectNoA11yViolations(host);

    answer = THREE;
    await type(el, "es 12345678z");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=count]")).not.toBeNull();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    await expectNoA11yViolations(host);
  });
});

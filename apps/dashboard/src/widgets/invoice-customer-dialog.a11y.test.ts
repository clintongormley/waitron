import { afterEach, describe, expect, it } from "vitest";
import type { WtInput } from "@waitron/ui";
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
  const field = el.shadowRoot!.querySelector<WtInput>("wt-input[name=taxId]")!;
  await field.updateComplete;
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
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

  it("checks the downloading status and the permission refusal", async () => {
    setLocale("en-GB");
    const load = modules["./invoice-customer-dialog.ts"];
    expect(load).toBeTypeOf("function");
    await load!();
    let refuse!: (error: unknown) => void;
    const api = {
      findInvoiceCustomer: async () => THREE,
      downloadInvoiceCustomerData: () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<InvoiceCustomerDialog>(
      "dashboard-invoice-customer-dialog",
      { api, open: true },
      theme,
    );
    await type(el, "12345678Z");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=download]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=download]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=preparing]")).not.toBeNull();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    await expectNoA11yViolations(host);

    refuse({ code: "authorization.not_permitted" });
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=admin-sign-in]"))
      .not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("checks Find's permission refusal in the bottom message beside the sign-in offer", async () => {
    setLocale("en-GB");
    const load = modules["./invoice-customer-dialog.ts"];
    expect(load).toBeTypeOf("function");
    await load!();
    const api = {
      findInvoiceCustomer: () => Promise.reject({ code: "authorization.not_permitted" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<InvoiceCustomerDialog>(
      "dashboard-invoice-customer-dialog",
      { api, open: true },
      theme,
    );
    await type(el, "12345678Z");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=admin-sign-in]"))
      .not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

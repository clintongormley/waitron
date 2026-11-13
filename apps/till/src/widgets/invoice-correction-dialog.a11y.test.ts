import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { AdjustmentReason } from "../api/client.js";
import "./invoice-correction-dialog.js";
import type {
  InvoiceCorrectionApi,
  TillInvoiceCorrectionDialog,
} from "./invoice-correction-dialog.js";

const reasons = [
  { id: "overcharged", name: "Cobrado de más", noteRequired: false },
  { id: "other", name: "Otro", noteRequired: true },
].map(
  (reason) =>
    ({
      ...reason,
      kind: "void",
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
    }) as AdjustmentReason,
);
const api = (over: Partial<InvoiceCorrectionApi> = {}): InvoiceCorrectionApi => ({
  readInvoiceCorrectionLines: async () => ({
    lines: [
      {
        id: "rice",
        lineNo: 1,
        descriptions: { es: "Arroz" },
        rate: "10.00",
        gross: "11.00",
        left: "0.00",
      },
      {
        id: "steak",
        lineNo: 2,
        descriptions: { es: "Entrecot" },
        rate: "21.00",
        gross: "12.10",
        left: "6.05",
      },
    ],
    moneyRefundable: "6.05",
  }),
  getRefundableTenders: async () => [
    {
      tenderId: "card-1",
      method: "card",
      last4: "0042",
      appliedRemaining: "6.05",
      tipRemaining: "0.00",
      pendingRefundId: null,
      manual: false,
    },
  ],
  listAdjustmentReasons: async () => reasons,
  previewInvoiceCorrection: async (_saleId, request) => ({
    gross: request.gross,
    vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
    moneyRefundable: "6.05",
  }),
  ...over,
});
beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("invoice correction accessibility (%s)", (theme) => {
  async function mount(over: Partial<InvoiceCorrectionApi> = {}) {
    const mounted = await mountWidget<TillInvoiceCorrectionDialog>(
      "till-invoice-correction-dialog",
      { api: api(over), saleId: "s1", invoiceNumber: "T/0012", namesLocale: "es" },
      theme,
    );
    await vi.waitFor(() =>
      expect(mounted.el.shadowRoot!.querySelector("[data-loading]")).toBeNull(),
    );
    await mounted.el.updateComplete;
    return mounted;
  }
  it("has no violations while the invoice is read", async () => {
    const { host } = await mountWidget<TillInvoiceCorrectionDialog>(
      "till-invoice-correction-dialog",
      {
        api: api({ readInvoiceCorrectionLines: () => new Promise(() => {}) }),
        saleId: "s1",
        invoiceNumber: "T/0012",
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
  it("has no violations with dishes, a dish with nothing left, and the payments", async () => {
    const { host } = await mount();
    await expectNoA11yViolations(host);
  });
  it("has no violations with the money and reason marked missing", async () => {
    const { el, host } = await mount();
    el.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("has no violations with a dish picked and the server's split shown", async () => {
    const { el, host } = await mount();
    const root = el.shadowRoot!;
    root.querySelector("wt-switch[data-line=steak]")!.shadowRoot!.querySelector("input")!.click();
    const field = root.querySelector("wt-price-input")!.shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(field), "6,05");
    await vi.waitFor(() => expect(root.querySelector("[data-split]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });
  it("has no violations refused on opening", async () => {
    const { host } = await mount({
      readInvoiceCorrectionLines: () =>
        Promise.reject({ code: "sale.correction_not_admitted", reason: "filing_refused" }),
    });
    await expectNoA11yViolations(host);
  });
  it("has no violations when the invoice could not be read", async () => {
    const { host } = await mount({
      readInvoiceCorrectionLines: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await expectNoA11yViolations(host);
  });
  it("has no violations when the reasons could not be read", async () => {
    const { host } = await mount({ listAdjustmentReasons: () => Promise.reject(new Error("x")) });
    await expectNoA11yViolations(host);
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AdjustmentReason } from "../api/client.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type {
  InvoiceCorrectionLines,
  InvoiceCorrectionPreview,
} from "../api/invoice-correction-types.js";
import "./invoice-correction-dialog.js";
import type {
  InvoiceCorrectionAsk,
  TillInvoiceCorrectionDialog,
} from "./invoice-correction-dialog.js";

const reason = (id: string, name: string, noteRequired = false) =>
  ({
    id,
    name,
    kind: "void",
    actions: ["cancel"],
    noteRequired,
    maxPercentBp: null,
    maxAmount: null,
  }) as AdjustmentReason;
const REASONS = [reason("overcharged", "Overcharged"), reason("other", "Other", true)];
const LINES: InvoiceCorrectionLines = {
  lines: [
    {
      id: "rice",
      lineNo: 1,
      descriptions: { en: "Rice" },
      rate: "10.00",
      gross: "11.00",
      left: "11.00",
    },
    {
      id: "steak",
      lineNo: 2,
      descriptions: { en: "Steak" },
      rate: "21.00",
      gross: "12.10",
      left: "6.05",
    },
  ],
  moneyRefundable: "23.10",
};
const TENDERS: RefundableTender[] = [
  {
    tenderId: "cash-1",
    method: "cash",
    last4: null,
    appliedRemaining: "13.10",
    tipRemaining: "0.00",
    pendingRefundId: null,
    manual: false,
  },
  {
    tenderId: "card-1",
    method: "card",
    last4: "0042",
    appliedRemaining: "10.00",
    tipRemaining: "0.00",
    pendingRefundId: null,
    manual: false,
  },
];
const SPLIT = [{ rate: "21.00", base: "5.00", tax: "1.05" }];
const answer = (gross: string): InvoiceCorrectionPreview => ({
  gross,
  vatBreakdown: SPLIT,
  moneyRefundable: "23.10",
});

/** An API answering every read at once, and each preview with the split for its amount. */
function fakeApi() {
  return {
    readInvoiceCorrectionLines: vi.fn(async (): Promise<InvoiceCorrectionLines> => LINES),
    getRefundableTenders: vi.fn(async () => TENDERS),
    listAdjustmentReasons: vi.fn(async () => REASONS),
    previewInvoiceCorrection: vi.fn(async (_saleId: string, request: { gross: string }) =>
      answer(request.gross),
    ),
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

async function mount(api = fakeApi()) {
  const { el } = await mountWidget<TillInvoiceCorrectionDialog>("till-invoice-correction-dialog", {
    api,
    saleId: "sale-1",
    invoiceNumber: "T/0012",
    namesLocale: "en",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-loading]")).toBeNull());
  await el.updateComplete;
  return { el, api };
}
const root = (el: TillInvoiceCorrectionDialog) => el.shadowRoot!;
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const dish = (el: TillInvoiceCorrectionDialog, id: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(`wt-switch[data-line="${id}"]`)!;
const grossField = (el: TillInvoiceCorrectionDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-price-input"]>("wt-price-input[name=gross]")!;
const confirm = (el: TillInvoiceCorrectionDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!;
async function type(el: TillInvoiceCorrectionDialog, value: string) {
  const field = grossField(el);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function pick(el: TillInvoiceCorrectionDialog, id: string) {
  dish(el, id).shadowRoot!.querySelector("input")!.click();
  await el.updateComplete;
}
async function choose(el: TillInvoiceCorrectionDialog, id: string) {
  root(el)
    .querySelector("wt-combobox[name=reason]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: id }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
}

it("shows each dish with what is left of it, the money still refundable and the payments", async () => {
  const { el, api } = await mount();

  expect(api.readInvoiceCorrectionLines).toHaveBeenCalledWith("sale-1", expect.anything());
  expect([dish(el, "rice").label, dish(el, "steak").label]).toEqual([
    "Rice · €11.00 · €11.00 left to correct",
    "Steak · €12.10 · €6.05 left to correct",
  ]);
  expect(text(root(el).querySelector("[data-refundable]"))).toBe(
    t("invoice_correction.refundable").replace("{amount}", "€23.10"),
  );
  expect([...root(el).querySelectorAll("[data-payment]")].map(text)).toEqual([
    "Cash · €13.10",
    "Card · 0042 · €10.00",
  ]);
  expect(grossField(el).label).toBe("Money back, VAT included");
  expect(grossField(el).required).toBe(true);
});

it("previews the typed amount and shows the server's split, keeping only the latest answer", async () => {
  let resolveLate!: (answer: InvoiceCorrectionPreview) => void;
  const api = fakeApi();
  api.previewInvoiceCorrection.mockImplementationOnce(
    () => new Promise((resolve) => (resolveLate = resolve)),
  );
  const { el } = await mount(api);

  await type(el, "5");
  await type(el, "6.05");
  resolveLate({ ...answer("5.00"), vatBreakdown: [{ rate: "21.00", base: "4.13", tax: "0.87" }] });
  await vi.waitFor(() =>
    expect(text(root(el).querySelector("[data-split]"))).toBe(
      t("invoice_correction.split")
        .replace("{rate}", "21")
        .replace("{base}", "€5.00")
        .replace("{tax}", "€1.05"),
    ),
  );
  expect(api.previewInvoiceCorrection.mock.calls.map((call) => call[1])).toEqual([
    { gross: "5.00" },
    { gross: "6.05" },
  ]);
  expect(text(confirm(el))).toBe(t("invoice_correction.confirm").replace("{amount}", "€6.05"));
});

it("previews the picked dishes and stops offering dishes at another VAT rate", async () => {
  const { el, api } = await mount();

  await pick(el, "steak");
  expect(dish(el, "rice").disabled).toBe(true);
  expect(dish(el, "steak").disabled).toBe(false);
  await type(el, "6.05");
  await vi.waitFor(() =>
    expect(api.previewInvoiceCorrection).toHaveBeenLastCalledWith("sale-1", {
      gross: "6.05",
      lineIds: ["steak"],
    }),
  );
  await pick(el, "steak");
  expect(dish(el, "rice").disabled).toBe(false);
});

it("explains on opening an invoice the preview would refuse, offering only Cancel", async () => {
  const refused = { code: "sale.correction_not_admitted", reason: "voided" };
  const api = fakeApi();
  api.readInvoiceCorrectionLines.mockRejectedValue(refused);
  const { el } = await mount(api);

  expect(root(el).querySelector("wt-form-actions")!.error).toBe(
    codeMessage("sale.correction_not_admitted", "en", { reason: "voided" }),
  );
  expect(grossField(el)).toBeNull();
  expect(confirm(el)).toBeNull();
});

it("puts an amount the preview refuses under the money field, leaving the action enabled", async () => {
  const api = fakeApi();
  api.previewInvoiceCorrection.mockRejectedValue({ code: "sale.correction_amount_invalid" });
  const { el } = await mount(api);

  await type(el, "30");
  await vi.waitFor(() =>
    expect(grossField(el).error).toBe(codeMessage("sale.correction_amount_invalid")),
  );
  expect(confirm(el).disabled).toBe(false);
});

it("marks the missing money and reason, then confirms the previewed split once they are fixed", async () => {
  const { el } = await mount();
  const asks: InvoiceCorrectionAsk[] = [];
  el.addEventListener("invoice-correction-confirm", (event) =>
    asks.push((event as CustomEvent<InvoiceCorrectionAsk>).detail),
  );

  confirm(el).click();
  await el.updateComplete;
  expect(grossField(el).error).toBe(t("invoice_correction.gross_invalid"));
  expect(root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!.error).toBe(
    t("adjust.reason_required"),
  );
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(confirm(el).disabled).toBe(true);
  expect(asks).toEqual([]);

  await type(el, "6.05");
  await choose(el, "other");
  await vi.waitFor(() => expect(root(el).querySelector("[data-split]")).not.toBeNull());
  expect(confirm(el).disabled).toBe(true);
  const note = root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!;
  await userEvent.fill(
    page.elementLocator(note.shadowRoot!.querySelector("input")!),
    " Wrong price ",
  );
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(false);
  confirm(el).click();
  expect(asks).toEqual([
    { gross: "6.05", reasonId: "other", note: "Wrong price", expectedSplit: SPLIT },
  ]);
});

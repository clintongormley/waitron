import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./printers-dialog.js";
import type { PrintersChangeDetail, TillPrintersDialog } from "./printers-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const P1 = { id: "P1", name: "Counter printer" };
const P2 = { id: "P2", name: "Bar printer" };
const S1 = { id: "S1", name: "Portable slip printer" };

async function mountDialog(props: Partial<TillPrintersDialog> = {}): Promise<TillPrintersDialog> {
  const { el } = await mountWidget<TillPrintersDialog>("till-printers-dialog", {
    open: true,
    receipt: { current: "P1", choices: [P1, P2] },
    paymentSlip: { current: "S1", choices: [S1] },
    ...props,
  });
  return el;
}

const combobox = (el: TillPrintersDialog, name: string) =>
  el.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name="${name}"]`);
const shown = (el: TillPrintersDialog, row: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-printer-row="${row}"] [data-printer-shown]`);

function changes(el: TillPrintersDialog): PrintersChangeDetail[] {
  const seen: PrintersChangeDetail[] = [];
  el.addEventListener("printers-change", (event) =>
    seen.push((event as CustomEvent<PrintersChangeDetail>).detail),
  );
  return seen;
}

describe("till-printers-dialog", () => {
  it("offers a receipt printer list with the current one picked, and reports only the receipt printer chosen", async () => {
    const el = await mountDialog();
    const seen = changes(el);

    const picker = combobox(el, "receiptPrinterId")!;
    expect(picker.label).toBe(t("printers.receipt"));
    expect(picker.options.map((option) => [option.value, option.label])).toEqual([
      ["P1", "Counter printer"],
      ["P2", "Bar printer"],
    ]);
    expect(picker.value).toBe("P1");

    await chooseOption(picker, "P2");

    expect(seen).toEqual([{ receiptPrinterId: "P2" }]);
    expect(Object.keys(seen[0]!)).toEqual(["receiptPrinterId"]);
  });

  it("reports only the payment slip printer when that is the one chosen", async () => {
    const el = await mountDialog({ paymentSlip: { current: null, choices: [S1, P2] } });
    const seen = changes(el);

    await chooseOption(combobox(el, "paymentSlipPrinterId")!, "S1");

    expect(seen).toEqual([{ paymentSlipPrinterId: "S1" }]);
    expect(Object.keys(seen[0]!)).toEqual(["paymentSlipPrinterId"]);
  });

  it("shows a payment slip printer with no other choice as text, with no list to pick from", async () => {
    const el = await mountDialog();

    expect(combobox(el, "paymentSlipPrinterId")).toBeNull();
    expect(shown(el, "paymentSlip")!.textContent!.trim()).toBe("Portable slip printer");
    expect(el.shadowRoot!.querySelector('[data-printer-row="paymentSlip"]')!.textContent).toContain(
      t("printers.payment_slip"),
    );
  });

  it("says No printer for a kind of printing the profile lists none for", async () => {
    const el = await mountDialog({
      receipt: { current: null, choices: [] },
      paymentSlip: { current: null, choices: [] },
    });

    expect(combobox(el, "receiptPrinterId")).toBeNull();
    expect(shown(el, "receipt")!.textContent!.trim()).toBe(t("printers.none"));
    expect(shown(el, "paymentSlip")!.textContent!.trim()).toBe(t("printers.none"));
  });

  it("does not present a current printer that is no longer among the choices as chosen", async () => {
    const el = await mountDialog({
      receipt: { current: "P-off", choices: [P1, P2] },
      paymentSlip: { current: "S-off", choices: [S1] },
    });

    expect(combobox(el, "receiptPrinterId")!.value).toBe("");
    expect(shown(el, "paymentSlip")!.textContent!.trim()).toBe(t("printers.none"));
  });

  it("shows a refusal naming the receipt printer under that field, and the generic sentence at the bottom", async () => {
    const el = await mountDialog();

    el.error = { code: "device.binding_invalid", field: "receiptPrinterId" };
    await el.updateComplete;

    expect(combobox(el, "receiptPrinterId")!.error).toBe(codeMessage("device.binding_invalid"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
    ).toBe(t("form.fix_fields"));
  });

  it("shows a refusal naming no field it shows at the bottom in its own words", async () => {
    const el = await mountDialog();

    el.error = { code: "device.binding_invalid", field: "paymentSlipPrinterId" };
    await el.updateComplete;

    expect(combobox(el, "receiptPrinterId")!.error).toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
    ).toBe(codeMessage("device.binding_invalid"));
  });

  it("shows a refusal naming the payment slip printer under that list when it has one", async () => {
    const el = await mountDialog({ paymentSlip: { current: "S1", choices: [S1, P2] } });

    el.error = { code: "device.binding_invalid", field: "paymentSlipPrinterId" };
    await el.updateComplete;

    expect(combobox(el, "paymentSlipPrinterId")!.error).toBe(codeMessage("device.binding_invalid"));
    expect(combobox(el, "receiptPrinterId")!.error).toBe("");
  });

  it("draws nothing while closed", async () => {
    const el = await mountDialog({ open: false });

    expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });

  it("closes when the dialog is dismissed", async () => {
    const el = await mountDialog();
    let closed = 0;
    el.addEventListener("close", () => (closed += 1));

    el.shadowRoot!.querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));

    expect(closed).toBe(1);
  });

  it("closes from its Close button", async () => {
    const el = await mountDialog();
    let closed = 0;
    el.addEventListener("close", () => (closed += 1));

    el.shadowRoot!.querySelector<HTMLElement>("[data-printers-close]")!.click();

    expect(closed).toBe(1);
  });
});

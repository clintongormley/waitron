import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-email-dialog.js";
import type { InvoiceEmailSendDetail, TillInvoiceEmailDialog } from "./invoice-email-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillInvoiceEmailDialog> = {}) {
  const { el } = await mountWidget<TillInvoiceEmailDialog>("till-invoice-email-dialog", props);
  await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return el;
}
const field = (el: TillInvoiceEmailDialog) => el.shadowRoot!.querySelector("wt-input")!;
const send = (el: TillInvoiceEmailDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-email-send]")!;
const bottom = (el: TillInvoiceEmailDialog) =>
  el.shadowRoot!.querySelector("wt-form-actions")!.error;
async function type(el: TillInvoiceEmailDialog, value: string) {
  await field(el).updateComplete;
  await userEvent.fill(page.elementLocator(field(el).shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function sendState(el: TillInvoiceEmailDialog) {
  await el.updateComplete;
  await send(el).updateComplete;
  return {
    variant: send(el).variant,
    disabled: send(el).disabled,
    innerDisabled: send(el).shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const held = { variant: "primary", disabled: true, innerDisabled: true };
function sends(el: TillInvoiceEmailDialog) {
  const sent: InvoiceEmailSendDetail[] = [];
  el.addEventListener("invoice-email-send", (event) =>
    sent.push((event as CustomEvent<InvoiceEmailSendDetail>).detail),
  );
  return sent;
}

describe("till-invoice-email-dialog", () => {
  it("asks for the customer's address in a required email field, with no address filled in", async () => {
    const el = await mount();
    const input = field(el);
    expect(input.name).toBe("email");
    expect(input.type).toBe("email");
    expect(input.required).toBe(true);
    expect(input.label).toBe(t("invoice.email"));
    expect(input.value).toBe("");
    // A shared till must not offer earlier customers' addresses.
    expect(input.autocomplete).toBe("off");
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(t("invoice.email_send"));
  });

  it("is headed as a copy when the invoice was already delivered", async () => {
    const el = await mount({ copy: true });
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(t("invoice.email_copy"));
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      "Enviar una copia por correo electrónico",
    );
  });

  it("opens with Send quiet and disabled, and an address makes it primary and enabled", async () => {
    const el = await mount();
    expect(await sendState(el)).toEqual(quiet);
    await type(el, "ana@example.com");
    expect(await sendState(el)).toEqual(ready);
    await type(el, "");
    expect(await sendState(el)).toEqual(quiet);
    await type(el, "   ");
    expect(await sendState(el)).toEqual(quiet);
  });

  it("sends the typed address", async () => {
    const el = await mount();
    const sent = sends(el);
    await type(el, "ana@example.com");
    send(el).click();
    expect(sent).toEqual([{ recipient: "ana@example.com" }]);
  });

  // A host `.click()` reaches Send's listener even while its inner button is disabled.
  it("a press that reaches Send's handler with nothing typed sends nothing and marks nothing", async () => {
    const el = await mount();
    const sent = sends(el);
    send(el).click();
    await el.updateComplete;
    expect(sent).toEqual([]);
    expect(field(el).error).toBe("");
    expect(bottom(el)).toBe("");
  });

  it.each(["ana@", "ana@example", "ana.example.com"])(
    "marks the malformed address %j beside the field and once at the bottom, and sends nothing",
    async (address) => {
      const el = await mount();
      const sent = sends(el);
      await type(el, address);
      send(el).click();
      await el.updateComplete;
      expect(sent).toEqual([]);
      expect(field(el).error).toBe(t("invoice.email_invalid"));
      expect(bottom(el)).toBe(t("form.fix_fields"));
      expect(await sendState(el)).toEqual(held);
      await type(el, "ana@example.com");
      expect(field(el).error).toBe("");
      expect(bottom(el)).toBe("");
      expect(await sendState(el)).toEqual(ready);
    },
  );

  it("says nothing about the address before the first press", async () => {
    const el = await mount();
    await type(el, "ana@");
    expect(field(el).error).toBe("");
    expect(bottom(el)).toBe("");
  });

  it("holds Send while the request is out, still drawn primary", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    el.busy = true;
    expect(await sendState(el)).toEqual(held);
    const sent = sends(el);
    send(el).click();
    expect(sent).toEqual([]);
  });

  it("shows Send working while the request is out", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    el.busy = true;
    await el.updateComplete;
    expect(send(el).loading).toBe(true);
    el.busy = false;
    await el.updateComplete;
    expect(send(el).loading).toBe(false);
  });

  it.each([1280, 390])(
    "at %ipx shows a long address whole, and keeps its width when a message appears",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const el = await mount();
        const native = () =>
          el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!;
        await type(el, "ana.garcia@restaurantesgarcia.es");
        const input = field(el).shadowRoot!.querySelector("input")!;
        expect(input.scrollWidth).toBeLessThanOrEqual(input.clientWidth);
        const body = native().querySelector<HTMLElement>(".body")!;
        // A body wider than its box scrolls sideways and takes the dialog's first focus.
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        const before = native().getBoundingClientRect();
        expect(before.right).toBeLessThanOrEqual(width);
        await type(el, "ana@ejemplo");
        send(el).click();
        await el.updateComplete;
        expect(field(el).error).not.toBe("");
        expect(native().getBoundingClientRect().width).toBe(before.width);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  it("holds the field and Cancel while the request is out, and frees them once it answers", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    let cancelled = 0;
    el.addEventListener("invoice-email-cancel", () => cancelled++);
    const cancel =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-email-cancel]")!;
    el.busy = true;
    await el.updateComplete;
    await cancel.updateComplete;
    expect(field(el).disabled).toBe(true);
    expect(cancel.variant).toBe("secondary");
    expect(cancel.disabled).toBe(true);
    expect(cancel.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.dismissible).toBe(false);
    cancel.click();
    expect(cancelled).toBe(0);
    el.busy = false;
    await el.updateComplete;
    await cancel.updateComplete;
    expect(field(el).disabled).toBe(false);
    expect(cancel.disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-dialog")!.dismissible).toBe(true);
  });

  it("puts a refused address under the field, until the address changes", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    el.refusal = { code: "management.request_invalid", field: "recipient" };
    await el.updateComplete;
    expect(field(el).error).toBe(t("invoice.email_invalid"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(await sendState(el)).toEqual(ready);
    await type(el, "ana@example.org");
    expect(field(el).error).toBe("");
    expect(bottom(el)).toBe("");
  });

  it("leaves the owner's refusal as given once typed over, and shows the next one", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    const refusal = { code: "management.request_invalid", field: "recipient" };
    el.refusal = refusal;
    await el.updateComplete;
    await type(el, "ana@example.org");
    expect(el.refusal).toBe(refusal);
    // The owner's binding setting the same refusal again does not bring it back.
    el.refusal = refusal;
    el.requestUpdate("refusal");
    await el.updateComplete;
    expect(field(el).error).toBe("");
    expect(bottom(el)).toBe("");
    el.refusal = { ...refusal };
    await el.updateComplete;
    expect(field(el).error).toBe(t("invoice.email_invalid"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
  });

  it("puts a refusal that names no field at the bottom, with Send still enabled", async () => {
    const el = await mount();
    await type(el, "ana@example.com");
    el.refusal = { code: "invoice_delivery.email_unavailable" };
    await el.updateComplete;
    expect(field(el).error).toBe("");
    expect(bottom(el)).toBe(codeMessage("invoice_delivery.email_unavailable"));
    expect(await sendState(el)).toEqual(ready);
    await type(el, "ana@example.org");
    expect(bottom(el)).toBe(codeMessage("invoice_delivery.email_unavailable"));
    el.refusal = {};
    await el.updateComplete;
    expect(bottom(el)).toBe(t("invoice.delivery_error"));
  });

  it("Cancel on an untouched form reports the close", async () => {
    const el = await mount();
    let cancelled = 0;
    el.addEventListener("invoice-email-cancel", () => cancelled++);
    el.shadowRoot!.querySelector<HTMLElement>("[data-email-cancel]")!.click();
    expect(cancelled).toBe(1);
  });

  it("Enter in the field sends the typed address", async () => {
    const el = await mount();
    const sent = sends(el);
    await type(el, "ana@example.com");
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([{ recipient: "ana@example.com" }]);
  });
});

import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { PurchaseInvoice } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./purchase-form.js";

const invoice: PurchaseInvoice = {
  id: "pi-1",
  supplierTaxId: "B12345678",
  supplierName: "Supplier",
  supplierInvoiceNumber: "F-1",
  issuedOn: "2026-08-10",
  receivedOn: "2026-08-12",
  total: "121.00",
  regime: "general",
  deductibleProportion: "100.00",
  note: null,
  lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
};
class PurchaseLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  invoice: PurchaseInvoice | null = invoice;
  busy = false;
  closes = 0;
  override render() {
    return html`<dashboard-purchase-form
        .open=${true}
        .invoice=${this.invoice}
        .busy=${this.busy}
        @wt-close=${() => this.closes++}
      ></dashboard-purchase-form
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("purchase-leave-test-app", PurchaseLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("a busy purchase ignores delivered field and VAT-choice events without dirtying its saved values", async () => {
  const { app, form } = await mount();
  app.busy = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  for (const [name, value] of [
    ["supplier-name", "Different supplier"],
    ["regime", "simplified"],
    ["line-base-0", "999"],
    ["line-kind-0", "capital"],
  ]) {
    form
      .shadowRoot!.querySelector(`[data-test=${name}]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  }
  for (const action of ["add-line", "remove-line-0"]) {
    form.shadowRoot!.querySelector(`[data-test=${action}]`)!.dispatchEvent(new MouseEvent("click"));
  }
  await form.updateComplete;
  expect(unload()).toBe(false);
  expect(
    (form.shadowRoot!.querySelector("[data-test=supplier-name]") as HTMLInputElement).value,
  ).toBe("Supplier");
  expect(
    (form.shadowRoot!.querySelector("[data-test=line-base-0]") as HTMLInputElement).value,
  ).toBe("100.00");
  app.busy = false;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  const confirm =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
  expect(confirm.disabled).toBe(true);
  const sent: unknown[] = [];
  form.addEventListener("update-purchase", (event) => sent.push((event as CustomEvent).detail));
  await change(form, "note", "Nota");
  confirm.click();
  expect(sent).toEqual([
    {
      id: "pi-1",
      patch: {
        header: {
          supplierTaxId: "B12345678",
          supplierName: "Supplier",
          supplierInvoiceNumber: "F-1",
          issuedOn: "2026-08-10",
          receivedOn: "2026-08-12",
          total: "121.00",
          regime: "general",
          deductibleProportion: "100.00",
          note: "Nota",
        },
        lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
      },
    },
  ]);
});
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount(add = false) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PurchaseLeaveApp>("purchase-leave-test-app", {
    invoice: add ? null : invoice,
  });
  const form = app.shadowRoot!.querySelector("dashboard-purchase-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function edit(
  form: HTMLElementTagNameMap["dashboard-purchase-form"],
  name: string,
  value: string,
) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test=${name}]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
  return field.shadowRoot!.querySelector("input")!;
}
async function change(
  form: HTMLElementTagNameMap["dashboard-purchase-form"],
  name: string,
  value: string,
) {
  form
    .shadowRoot!.querySelector(`[data-test=${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
}
async function question(app: PurchaseLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
for (const add of [false, true]) {
  it(`${add ? "Add" : "Edit"} purchase native Escape keeps input and focus, then discards once`, async () => {
    const { app, form } = await mount(add);
    const input = await edit(form, "supplier-name", "Changed supplier");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(
      form.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("Changed supplier");
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    await userEvent.keyboard("{Escape}");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.closes).toBe(1);
    await closeReportsDelivered();
    expect(app.closes).toBe(1);
    expect(form.open).toBe(false);
    expect(unload()).toBe(false);
  });
}
for (const [name, value, original] of [
  ["supplier-tax-id", "B99999999", invoice.supplierTaxId],
  ["supplier-invoice-number", "F-2", invoice.supplierInvoiceNumber],
  ["issued-on", "2026-08-09", invoice.issuedOn],
  ["received-on", "2026-08-11", invoice.receivedOn],
  ["total", "122.00", "121.000"],
  ["deductible-proportion", "50.00", "100"],
  ["note", "Note", "   "],
  ["regime", "equivalence_surcharge", "general"],
  ["line-rate-0", "10", "21"],
  ["line-base-0", "101", "100.000"],
  ["line-tax-0", "22", "21.0"],
  ["line-kind-0", "capital", "ordinary"],
] as const) {
  it(`purchase ${name} change warns, and equivalent submitted value clears it`, async () => {
    const { app, form } = await mount();
    await change(form, name, value);
    expect(unload()).toBe(true);
    await change(form, name, original);
    expect(unload()).toBe(false);
    await edit(form, "supplier-name", invoice.supplierName);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => app.closes).toBe(1);
    expect((await question(app)).open).toBe(false);
  });
}
it("invalid raw numeric input and an additional VAT row remain dirty", async () => {
  const { form } = await mount();
  await change(form, "total", "not-an-amount");
  expect(unload()).toBe(true);
  await change(form, "total", invoice.total);
  expect(unload()).toBe(false);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-line]")!.click();
  await form.updateComplete;
  expect(unload()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-line-1]")!.click();
  await form.updateComplete;
  expect(unload()).toBe(false);
});
it("a same-invoice refresh preserves edits; a different invoice invalidates a pending answer", async () => {
  const { app, form } = await mount();
  await edit(form, "supplier-name", "Changed supplier");
  app.invoice = { ...invoice, supplierName: "Background read" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=supplier-name]")!
      .value,
  ).toBe("Changed supplier");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  app.invoice = { ...invoice, id: "pi-2", supplierName: "Other supplier" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
});
it("busy purchase fields and Escape cannot change or discard the submitted input", async () => {
  const { app, form } = await mount();
  const input = await edit(form, "supplier-name", "Changed supplier");
  app.busy = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=supplier-name]",
  )!;
  await field.updateComplete;
  expect(input.disabled).toBe(true);
  await change(form, "supplier-name", "Busy edit");
  expect(field.value).toBe("Changed supplier");
  await userEvent.keyboard("{Escape}");
  await closeReportsDelivered();
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
  expect((await question(app)).open).toBe(false);
});

it("a submitted purchase snapshot commits independently of newer unsubmitted input", async () => {
  const { form } = await mount();
  await edit(form, "supplier-name", "Submitted supplier");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  const completeWrite = form.writeCompletion();
  await edit(form, "supplier-name", "Newer supplier");
  expect(completeWrite()).toBe(false);
  expect(form.open).toBe(true);
  expect(unload()).toBe(true);
  await edit(form, "supplier-name", "Submitted supplier");
  expect(unload()).toBe(false);
});
it("purchase comparisons preserve precision beyond JavaScript number rounding", async () => {
  const { form } = await mount();
  await change(form, "total", "121.00000000000000000001");
  expect(unload()).toBe(true);
  await change(form, "total", "121.00000000000000000000");
  expect(unload()).toBe(false);
});
it("disconnection aborts an outstanding purchase discard and releases unload protection", async () => {
  const { app, form } = await mount();
  await edit(form, "supplier-name", "Changed supplier");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
});

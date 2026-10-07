import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, PurchaseInvoice } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./purchases-screen.js";

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

class PurchasesLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-purchases-screen .api=${this.api}></dashboard-purchases-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("purchases-leave-test-app", PurchasesLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount(write: (body: unknown) => Promise<unknown>, refresh: () => void = () => {}) {
  let reads = 0;
  const api = {
    listPurchaseInvoices: async () => {
      if (reads++ > 0) refresh();
      return [invoice, { ...invoice, id: "pi-2", supplierName: "Other" }];
    },
    createPurchaseInvoice: write,
    updatePurchaseInvoice: async (_id: string, body: unknown) => write(body),
  } as unknown as DashboardApi;
  setLocale("en-GB");
  const { el: app } = await mountWidget<PurchasesLeaveApp>("purchases-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-purchases-screen")!;
  await expect.poll(() => reads).toBe(1);
  await screen.updateComplete;
  return { app, screen };
}
async function editor(screen: HTMLElementTagNameMap["dashboard-purchases-screen"], add: boolean) {
  if (add) screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-purchase]")!.click();
  else
    screen.shadowRoot!.querySelector("dashboard-purchase-list")!.dispatchEvent(
      new CustomEvent("edit-purchase", {
        detail: { id: invoice.id },
        bubbles: true,
        composed: true,
      }),
    );
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-purchase-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  if (add)
    for (const [name, value] of [
      ["supplier-tax-id", invoice.supplierTaxId],
      ["supplier-invoice-number", invoice.supplierInvoiceNumber],
      ["issued-on", invoice.issuedOn],
      ["received-on", invoice.receivedOn],
      ["total", invoice.total],
      ["line-rate-0", "21.00"],
      ["line-base-0", "100.00"],
      ["line-tax-0", "21.00"],
    ]) {
      form
        .shadowRoot!.querySelector(`[data-test=${name}]`)!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    }
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=supplier-name]",
  )!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Changed supplier",
  );
  await form.updateComplete;
  return form;
}
for (const add of [false, true]) {
  it(`successful ${add ? "create" : "update"} purchase clears its warning before failed refresh`, async () => {
    let body: unknown;
    let warned: boolean | undefined;
    const { screen } = await mount(
      async (input) => {
        body = input;
      },
      () => {
        warned = unload();
        throw { code: "connection.failed" };
      },
    );
    const form = await editor(screen, add);
    expect(unload()).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await expect.poll(() => warned).toBe(false);
    await expect.poll(() => form.open).toBe(false);
    expect(body).toEqual({
      header: {
        supplierTaxId: invoice.supplierTaxId,
        supplierName: "Changed supplier",
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        issuedOn: invoice.issuedOn,
        receivedOn: invoice.receivedOn,
        total: invoice.total,
        regime: invoice.regime,
        deductibleProportion: invoice.deductibleProportion,
        note: null,
      },
      lines: invoice.lines,
    });
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[role=alert]")?.textContent)
      .toContain(codeMessage("connection.failed"));
    expect(unload()).toBe(false);
  });
  it(`refused ${add ? "create" : "update"} purchase retains edited values and Escape warning`, async () => {
    const { app, screen } = await mount(async () => {
      throw { code: "purchase.duplicate" };
    });
    const form = await editor(screen, add);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await expect.poll(() => form.busy).toBe(false);
    expect(form.open).toBe(true);
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    await app.updateComplete;
    const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => q.open).toBe(true);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "[data-test=supplier-name]",
      )!.value,
    ).toBe("Changed supplier");
  });
}
it("a late successful purchase write preserves a replacement invoice editor", async () => {
  let finish!: () => void;
  const { screen } = await mount(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const form = await editor(screen, false);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => form.busy).toBe(true);
  screen
    .shadowRoot!.querySelector("dashboard-purchase-list")!
    .dispatchEvent(
      new CustomEvent("edit-purchase", { detail: { id: "pi-2" }, bubbles: true, composed: true }),
    );
  await screen.updateComplete;
  await form.updateComplete;
  finish();
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(form.invoice?.id).toBe("pi-2");
});

it("a departed invoice's refused write cannot mark the replacement form", async () => {
  let refuse!: (error: unknown) => void;
  const { screen } = await mount(
    () =>
      new Promise<void>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  const form = await editor(screen, false);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => form.busy).toBe(true);
  screen
    .shadowRoot!.querySelector("dashboard-purchase-list")!
    .dispatchEvent(
      new CustomEvent("edit-purchase", { detail: { id: "pi-2" }, bubbles: true, composed: true }),
    );
  await screen.updateComplete;
  await form.updateComplete;
  refuse({ code: "purchase.duplicate" });
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(form.invoice?.id).toBe("pi-2");
  expect(form.fieldErrors).toEqual({});
});

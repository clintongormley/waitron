import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog, type WtInput, type WtUnsavedChanges } from "@waitron/ui";
import {
  cleanupWidgets,
  dialogClosed,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import type { InvoiceCustomerDialog } from "./invoice-customer-dialog.js";

const modules = import.meta.glob<typeof import("./invoice-customer-dialog.js")>(
  "./invoice-customer-dialog.ts",
);

const THREE: InvoiceCustomerSearchDto = {
  taxId: "12345678Z",
  invoices: [
    {
      invoice: "F1-2026-0011",
      issuedAt: "2026-09-30T09:05:00.000Z",
      name: "Jordi Puig",
      total: "7.05",
    },
  ],
};

class InvoiceCustomerLeaveTest extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    findInvoiceCustomer: vi.fn(async () => THREE),
    downloadInvoiceCustomerData: vi.fn(async () => ({
      blob: new Blob(["zip"]),
      fileName: "invoice-customer-12345678Z.zip",
    })),
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-invoice-customer-dialog
        .api=${this.api}
        .open=${true}
      ></dashboard-invoice-customer-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("invoice-customer-leave-test-app", InvoiceCustomerLeaveTest);

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const load = modules["./invoice-customer-dialog.ts"];
  expect(load).toBeTypeOf("function");
  await load!();
  const { el: app } = await mountWidget<InvoiceCustomerLeaveTest>(
    "invoice-customer-leave-test-app",
    {},
  );
  const form = app.shadowRoot!.querySelector<InvoiceCustomerDialog>(
    "dashboard-invoice-customer-dialog",
  )!;
  await form.updateComplete;
  const dialog = form.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await dialog.updateComplete;
  return { app, form, dialog };
}

async function edit(form: InvoiceCustomerDialog, value: string) {
  form
    .shadowRoot!.querySelector<WtInput>("[name=taxId]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await form.updateComplete;
}

async function warning(app: InvoiceCustomerLeaveTest) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

const pressClose = (form: InvoiceCustomerDialog) =>
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();

it("starts clean, and a typed number makes it dirty until it is typed away again", async () => {
  const { app, form } = await fixture();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "12345678Z");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("asks before closing over a typed, unsearched number, and closes only once it is discarded", async () => {
  const { app, form, dialog } = await fixture();
  await edit(form, "12345678Z");
  pressClose(form);
  const q = await warning(app);
  await expect.poll(() => q.open).toBe(true);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  expect(form.open).toBe(true);
  expect(form.shadowRoot!.querySelector<WtInput>("[name=taxId]")!.value).toBe("12345678Z");
  pressClose(form);
  await expect.poll(() => q.open).toBe(true);
  const closed = dialogClosed(dialog);
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await closed;
  expect(form.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("closes without asking after the number was searched", async () => {
  const { app, form } = await fixture();
  await edit(form, "es 12345678z");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
  await expect.poll(() => form.shadowRoot!.querySelector("[data-test=download]")).not.toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  pressClose(form);
  await expect.poll(() => form.open).toBe(false);
  expect((await warning(app)).open).toBe(false);
});

it("closes without asking after the customer's data was downloaded", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { app, form } = await fixture();
  await edit(form, "12345678Z");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
  await expect.poll(() => form.shadowRoot!.querySelector("[data-test=download]")).not.toBeNull();
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=download]")!.click();
  await expect.poll(() => click.mock.calls.length).toBe(1);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  pressClose(form);
  await expect.poll(() => form.open).toBe(false);
  expect((await warning(app)).open).toBe(false);
});

it("disconnect closes the dialog and clears the typed number, and a reopened dialog protects new text", async () => {
  const { app, form } = await fixture();
  await edit(form, "12345678Z");
  await reattachAfterDetachedUpdate(form);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(form.open).toBe(false);
  form.open = true;
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>("[name=taxId]")!.value).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "12345678Z");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});

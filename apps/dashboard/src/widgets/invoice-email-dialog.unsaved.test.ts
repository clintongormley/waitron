import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog, type WtInput } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-email-dialog.js";

class InvoiceEmailLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-invoice-email-dialog .api=${this.api}></dashboard-invoice-email-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("invoice-email-leave-test-app", InvoiceEmailLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const requestOrderEmailDelivery = vi.fn().mockResolvedValue({ id: "delivery-1" });
  const api = { requestOrderEmailDelivery } as unknown as DashboardApi;
  const { el: app } = await mountWidget<InvoiceEmailLeaveApp>("invoice-email-leave-test-app", {
    api,
  });
  const host = app.shadowRoot!.querySelector("dashboard-invoice-email-dialog")!;
  host.show("bill-1");
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const input = dialog.querySelector<WtInput>("wt-input[name=email]")!;
  await input.updateComplete;
  return { app, host, dialog, input, requestOrderEmailDelivery };
}

async function question(app: InvoiceEmailLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function choose(app: InvoiceEmailLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

async function typeAddress(input: WtInput) {
  input.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("ana@example.com");
}

it("an untouched dialog closes on Escape without asking", async () => {
  const { app, dialog, input } = await fixture();
  input.shadowRoot!.querySelector("input")!.focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a typed address asks before Escape, and Keep keeps it", async () => {
  const { app, dialog, input, requestOrderEmailDelivery } = await fixture();
  await typeAddress(input);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(input.value).toBe("ana@example.com");
  expect(requestOrderEmailDelivery).not.toHaveBeenCalled();
});

it("a typed address asks before Cancel, and Discard closes without sending", async () => {
  const { app, dialog, input, requestOrderEmailDelivery } = await fixture();
  await typeAddress(input);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  dialog.querySelector<HTMLElement>("wt-button[data-test=cancel-email]")!.click();
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(requestOrderEmailDelivery).not.toHaveBeenCalled();
});

it("a sent address closes without asking and leaves nothing unsaved", async () => {
  const { app, dialog, input, requestOrderEmailDelivery } = await fixture();
  await typeAddress(input);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  const closed = dialogClosed(dialog);
  dialog.querySelector<HTMLElement>("wt-button[data-test=send-email]")!.click();
  await closed;
  expect(requestOrderEmailDelivery).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("dismissing it, as the order detail does when it closes, releases the draft", async () => {
  const { app, host, dialog, input, requestOrderEmailDelivery } = await fixture();
  await typeAddress(input);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  const closed = dialogClosed(dialog);
  host.dismiss();
  await closed;
  expect(dialog.open).toBe(false);
  expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(requestOrderEmailDelivery).not.toHaveBeenCalled();
});

it("taken out of the page, it releases the draft", async () => {
  const { app, host, input } = await fixture();
  await typeAddress(input);
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  host.remove();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

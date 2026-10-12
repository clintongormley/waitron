import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { PagePrinterEntry } from "../api/client.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./page-printer-add.js";

const entry: PagePrinterEntry = {
  agentId: "a1",
  host: "10.0.0.56",
  port: 631,
  path: "/ipp/print",
};

class PagePrinterLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  entry: PagePrinterEntry | null = entry;
  closed = 0;
  added: string[] = [];
  readonly api = {
    registerPagePrinter: vi.fn().mockResolvedValue({ id: "pp1", outcome: "created" }),
  };
  override render() {
    return html`<dashboard-page-printer-add
        .api=${this.api}
        .entry=${this.entry}
        description="HP LaserJet · 10.0.0.56:631"
        @page-printer-added=${(event: CustomEvent<{ name: string }>) =>
          this.added.push(event.detail.name)}
        @page-printer-add-closed=${() => {
          this.closed++;
          this.entry = null;
          this.requestUpdate();
        }}
      ></dashboard-page-printer-add
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("page-printer-leave-test-app", PagePrinterLeaveApp);
afterEach(cleanupWidgets);

type Dialog = HTMLElementTagNameMap["dashboard-page-printer-add"];

async function mount() {
  const { el: app } = await mountWidget<PagePrinterLeaveApp>("page-printer-leave-test-app", {});
  const dialog = app.shadowRoot!.querySelector("dashboard-page-printer-add")!;
  await dialog.updateComplete;
  await dialog.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, dialog };
}
async function type(dialog: Dialog, value: string) {
  const field =
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await dialog.updateComplete;
}
const nameOf = (dialog: Dialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!.value;
async function question(app: PagePrinterLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(dialog: Dialog) {
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-add-page-printer]")!.click();
}
async function add(dialog: Dialog) {
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-add-page-printer]")!.click();
  await dialog.updateComplete;
}

it("closing with a typed name asks to discard, keeps the name through Keep, and closes once after Discard", async () => {
  const { app, dialog } = await mount();
  await type(dialog, "Back office");
  cancel(dialog);
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.closed).toBe(0);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(nameOf(dialog)).toBe("Back office");
  cancel(dialog);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closed).toBe(1);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("closing untouched does not ask, and a name typed back to empty is no change", async () => {
  const { app, dialog } = await mount();
  await type(dialog, "Back office");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await type(dialog, "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(dialog);
  await expect.poll(() => app.closed).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("after the printer is added it closes without asking", async () => {
  const { app, dialog } = await mount();
  await type(dialog, " Back office ");
  await add(dialog);
  await expect.poll(() => app.closed).toBe(1);
  expect(app.added).toEqual(["Back office"]);
  expect(app.api.registerPagePrinter).toHaveBeenCalledWith({ ...entry, name: "Back office" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a refused add keeps the name as a change, so closing still asks", async () => {
  const { app, dialog } = await mount();
  app.api.registerPagePrinter.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await type(dialog, "Back office");
  await add(dialog);
  await expect.poll(() => app.api.registerPagePrinter.mock.calls.length).toBe(1);
  await dialog.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(dialog);
  expect((await question(app)).open).toBe(true);
  expect(app.closed).toBe(0);
});

it("a name typed before the dialog is taken out of the page still counts once it is put back", async () => {
  const { app, dialog } = await mount();
  await type(dialog, "Back office");
  await reattachAfterDetachedUpdate(dialog);
  expect(nameOf(dialog)).toBe("Back office");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(dialog);
  expect((await question(app)).open).toBe(true);
  expect(app.closed).toBe(0);
});

it("a dialog put back and then edited asks before discarding the edit", async () => {
  const { app, dialog } = await mount();
  await reattachAfterDetachedUpdate(dialog);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await type(dialog, "Back office");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  cancel(dialog);
  expect((await question(app)).open).toBe(true);
});

it("a press that reaches an untouched Add's handler sends nothing and marks nothing", async () => {
  const { app, dialog } = await mount();
  await add(dialog);
  expect(app.api.registerPagePrinter).not.toHaveBeenCalled();
  const field =
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
  expect(field.invalid).toBe(false);
  const button = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=confirm-add-page-printer]",
  )!;
  expect(button.variant).toBe("secondary");
  expect(button.disabled).toBe(true);
});

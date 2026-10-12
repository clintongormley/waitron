import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import {
  cleanupWidgets,
  dialogClosed,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  clickReceiptSave,
  deferred,
  editReceipt,
  mountReceiptDialog,
  receiptApi,
  receiptField,
  receiptSave,
} from "../testing/department-receipt-dialog-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it("untouched Escape closes without a leave question", async () => {
  const { app, dialog, el } = await mountReceiptDialog();
  receiptField(el, "email").focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("dirty Escape and Cancel protect the draft with Keep and Discard", async () => {
  const { app, dialog, el, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  await userEvent.keyboard("{Escape}");
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => q.open).toBe(true);
  await q.updateComplete;
  const keepClosed = dialogClosed(q.shadowRoot!.querySelector("wt-modal")!);
  await userEvent.click(page.elementLocator(q.shadowRoot!.querySelector("[data-choice=keep]")!));
  await keepClosed;
  expect(dialog.open).toBe(true);
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await expect.poll(() => q.open).toBe(true);
  await q.updateComplete;
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(q.shadowRoot!.querySelector("[data-choice=discard]")!));
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  el.show({ id: "bar", name: "Bar" });
  await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(el, "email").value).toBe("");
  expect(receiptSave(el).disabled).toBe(true);
});
it("preview language does not dirty the authored receipt", async () => {
  const { app, el, api } = await mountReceiptDialog();
  await chooseOption(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewLanguage]")!,
    "ca-ES",
  );
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
    .toMatchObject({ departmentId: "bar", language: "ca-ES" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(receiptSave(el).disabled).toBe(true);
});
it("pending Save blocks Escape, Cancel and a duplicate request", async () => {
  const api = receiptApi();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const { el, dialog, app } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "sent@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  await userEvent.keyboard("{Escape}");
  expect(await dialog.requestClose("cancel")).toBe(false);
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const closed = dialogClosed(dialog);
  held.resolve();
  await closed;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("removing the dialog closes the modal and disposes its draft", async () => {
  const { app, el, dialog } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await reattachAfterDetachedUpdate(el);
  expect(dialog.open).toBe(false);
  expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  el.show({ id: "cafe", name: "Cafe" });
  await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
  expect(receiptSave(el).disabled).toBe(true);
});

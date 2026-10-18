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
  receiptModel,
  receiptField,
  receiptSave,
  receiptRoot,
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
    page.elementLocator(receiptRoot(el).querySelector("[data-test=cancel-receipt]")!),
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
  await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(el, "email").value).toBe("");
  expect(receiptSave(el).disabled).toBe(true);
});
it("preview language does not dirty the authored receipt", async () => {
  const { app, el, api } = await mountReceiptDialog();
  await chooseOption(
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewLanguage]")!,
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
it("reconnecting the same receipt preserves its native draft and original Save baseline", async () => {
  const { app, el, dialog, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await reattachAfterDetachedUpdate(el);
  await expect.poll(() => dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  expect(receiptField(el, "email").shadowRoot!.querySelector("input")!.value).toBe(
    "draft@example.com",
  );
  expect(receiptSave(el).disabled).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await editReceipt(el, "email", "");
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a removed receipt closes the native modal and releases its mounted draft", async () => {
  const { app, el, dialog } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  el.remove();
  await el.updateComplete;
  expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("an unchanged live read leaves the receipt leave question open and its choice current", async () => {
  const { app, el, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  const pending = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  const keep = question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!;
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(question.open).toBe(true);
  await userEvent.click(page.elementLocator(keep));
  expect(await pending).toBe("kept");
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it.each(["keep", "discard"] as const)(
  "deletion retires a pending %s choice before a replacement receipt opens",
  async (decision) => {
    const { app, el, api, dialog } = await mountReceiptDialog();
    await editReceipt(el, "email", "old@example.com");
    let proceeded = false;
    const pending = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        proceeded = true;
      },
    });
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    const stale = question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!;
    const closed = dialogClosed(dialog);
    api.getDepartmentReceipt.mockRejectedValueOnce({ code: "department.not_found" });
    api.liveData.invalidate([{ type: "departments" }]);
    await closed;
    expect(await pending).toBe("stale");
    el.show({ id: "replacement", name: "Replacement" });
    await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
    await editReceipt(el, "email", "replacement@example.com");
    stale.click();
    await el.updateComplete;
    expect(proceeded).toBe(false);
    expect(receiptField(el, "email").value).toBe("replacement@example.com");
    expect(app.leave.coordinator.isDirty()).toBe(true);
  },
);
it.each(["success", "refusal"] as const)(
  "an old Save %s cannot close or clean a reconnected receipt draft",
  async (answer) => {
    const api = receiptApi(receiptModel);
    const held = deferred<void>();
    api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
    const { app, el, dialog } = await mountReceiptDialog(api);
    await editReceipt(el, "email", "sent@example.com");
    await clickReceiptSave(el);
    await reattachAfterDetachedUpdate(el);
    await expect
      .poll(() => dialog.shadowRoot!.querySelector("dialog")!.matches(":modal"))
      .toBe(true);
    await editReceipt(el, "email", "new@example.com");
    if (answer === "success") held.resolve();
    else held.reject({ code: "management.failed" });
    await held.promise.catch(() => {});
    await el.updateComplete;
    expect(dialog.open).toBe(true);
    expect(receiptField(el, "email").value).toBe("new@example.com");
    expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe("");
    expect(receiptSave(el).disabled).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await editReceipt(el, "email", "");
    expect(receiptSave(el).disabled).toBe(true);
  },
);

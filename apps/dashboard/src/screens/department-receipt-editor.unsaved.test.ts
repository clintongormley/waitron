import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, reattachAfterDetachedUpdate } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  clickReceiptSave,
  deferred,
  editReceipt,
  mountReceiptEditor,
  receiptApi,
  receiptModel,
  receiptField,
  receiptSave,
  receiptRoot,
} from "../testing/department-receipt-editor-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it("preview language does not dirty the authored receipt", async () => {
  const { app, el, api } = await mountReceiptEditor();
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
it("pending Save blocks a duplicate request", async () => {
  const api = receiptApi();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const { el, app, events } = await mountReceiptEditor(api);
  await editReceipt(el, "email", "sent@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  held.resolve();
  await expect.poll(() => events).toEqual(["department-receipt-saved:bar"]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("reconnecting the same receipt keeps its draft and original Save baseline", async () => {
  const { app, el, api } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await reattachAfterDetachedUpdate(el);
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
it("a removed editor releases its mounted receipt draft", async () => {
  const { app, el } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  el.remove();
  await el.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("an unchanged live read leaves the receipt leave question open and its choice current", async () => {
  const { app, el, api } = await mountReceiptEditor();
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
    const { app, el, api, events } = await mountReceiptEditor();
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
    api.getDepartmentReceipt.mockRejectedValueOnce({ code: "department.not_found" });
    api.liveData.invalidate([{ type: "departments" }]);
    await expect.poll(() => events).toEqual(["department-receipt-closed:bar"]);
    expect(await pending).toBe("stale");
    el.subject = { id: "replacement", name: "Replacement" };
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
    const { app, el, events } = await mountReceiptEditor(api);
    await editReceipt(el, "email", "sent@example.com");
    await clickReceiptSave(el);
    await reattachAfterDetachedUpdate(el);
    await editReceipt(el, "email", "new@example.com");
    if (answer === "success") held.resolve();
    else held.reject({ code: "management.failed" });
    await held.promise.catch(() => {});
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(receiptField(el, "email").value).toBe("new@example.com");
    expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe("");
    expect(receiptSave(el).disabled).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await editReceipt(el, "email", "");
    expect(receiptSave(el).disabled).toBe(true);
  },
);

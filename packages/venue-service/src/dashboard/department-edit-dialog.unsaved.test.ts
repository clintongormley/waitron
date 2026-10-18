import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  editDepartmentField,
  departmentSave,
  selectDepartmentTab,
  supplyReceiptEditor,
  editReceipt,
  receiptInput,
} from "../testing/department-edit-fixture.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});
it("Escape asks about this dialog's draft; Keep retains and Discard closes without writing", async () => {
  const { el, app, form, modal, writes } = await mountDepartmentEditor();
  await editDepartmentField(form, "tradingName", "Trading draft");
  const closing = modal.requestClose("escape");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await closing).toBe(false);
  expect(modal.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tradingName]")!.value,
  ).toBe("Trading draft");
  const discard = modal.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discard).toBe(true);
  expect(modal.open).toBe(false);
  expect(writes).toEqual([]);
  expect(el.departmentId).toBe("d1");
});
it("a pending Save prevents Escape and preserves a newer native draft after the submitted values commit", async () => {
  let finish!: () => void;
  const { form, modal, app } = await mountDepartmentEditor((async (path, method = "GET") => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? []
        : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  await editDepartmentField(form, "name", "Submitted");
  departmentSave(form).click();
  await expect.poll(() => !!finish).toBe(true);
  expect(await modal.requestClose("escape")).toBe(false);
  expect(modal.open).toBe(true);
  await editDepartmentField(form, "name", "Later draft");
  finish();
  await expect.poll(() => departmentSave(form).disabled).toBe(false);
  expect(modal.open).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Later draft");
});
it("Escape with both drafts dirty asks one question; Discard closes without writing either", async () => {
  const { el, app, form, modal, writes } = await mountDepartmentEditor();
  const editor = await supplyReceiptEditor(el, form);
  await editDepartmentField(form, "name", "Restaurant draft");
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  const closing = modal.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await closing).toBe(true);
  expect(modal.open).toBe(false);
  expect(question.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(editor.hasUnsavedChanges).toBe(false);
  expect(form.hasUnsavedChanges).toBe(false);
  expect(writes).toEqual([]);
});
it("a pending receipt Save blocks Escape and Cancel", async () => {
  const { el, form, modal } = await mountDepartmentEditor();
  const editor = await supplyReceiptEditor(el, form);
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  editor.hold = true;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-receipt]")!.click();
  await expect.poll(() => !!editor.finish).toBe(true);
  expect(await modal.requestClose("escape")).toBe(false);
  expect(await modal.requestClose("cancel")).toBe(false);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-receipt]")!.click();
  await selectDepartmentTab(form, "details");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await form.updateComplete;
  expect(modal.open).toBe(true);
  editor.finish!();
  await expect.poll(() => modal.open).toBe(false);
});
it("untouched Escape on the Receipts tab closes without a leave question", async () => {
  const { el, app, form, modal } = await mountDepartmentEditor();
  const editor = await supplyReceiptEditor(el, form);
  await selectDepartmentTab(form, "receipt");
  receiptInput(editor).focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => modal.open).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

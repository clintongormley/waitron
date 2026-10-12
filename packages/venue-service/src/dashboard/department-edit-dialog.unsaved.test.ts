import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  editDepartmentField,
  departmentSave,
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

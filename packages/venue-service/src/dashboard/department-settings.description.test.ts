import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor as mount,
  editDepartmentField,
  departmentSave,
  selectDepartmentTab,
  supplyReceiptEditor,
} from "../testing/department-edit-fixture.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});

function descriptionField(form: HTMLElementTagNameMap["department-settings"]) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[slot=details] [name=operationDescription]",
  );
}
async function mountWithDescription(saved = "Dining service", request?: DashboardRequest) {
  const mounted = await mount(request);
  const editor = await supplyReceiptEditor(mounted.el, mounted.form, saved);
  await expect.poll(() => descriptionField(mounted.form)?.value).toBe(saved);
  return { ...mounted, editor };
}

it("draws no description on Details without a receipt editor, or when the editor offers none", async () => {
  const { el, form } = await mount();
  expect(descriptionField(form)).toBeNull();
  const editor = await supplyReceiptEditor(el, form);
  await form.updateComplete;
  expect(descriptionField(form)).toBeNull();
  editor.offerDescription("Dining service");
  await expect.poll(() => descriptionField(form)?.value).toBe("Dining service");
  expect(form.hasUnsavedChanges).toBe(false);
  editor.offerDescription(undefined);
  await expect.poll(() => descriptionField(form)).toBeNull();
});
it.each([
  [
    "en",
    "Invoice operation description",
    "Sent to the tax agency with each invoice record; not printed",
  ],
  [
    "es",
    "Descripción de la operación",
    "Se envía a la Agencia Tributaria con cada registro de factura; no se imprime",
  ],
] as const)(
  "Details draws the required description with its %s label and hint",
  async (locale, label, hint) => {
    setLocale(locale);
    const { form, editor } = await mountWithDescription();
    const field = descriptionField(form)!;
    expect(field.required).toBe(true);
    expect(field.label).toBe(label);
    expect(field.hint).toBe(hint);
    expect(editor.shadowRoot!.querySelector("[name=operationDescription]")).toBeNull();
    expect(
      [...form.shadowRoot!.querySelectorAll("[slot=details] wt-input")].map(
        (input) => (input as HTMLElementTagNameMap["wt-input"]).name,
      ),
    ).toEqual(["name", "tradingName", "operationDescription"]);
  },
);
it("a Details Save with only the description changed sends the description alone and closes", async () => {
  const { el, form, modal, editor, writes } = await mountWithDescription();
  const saved = vi.fn();
  el.addEventListener("saved", saved);
  await editDepartmentField(form, "operationDescription", "Counter service");
  expect(form.hasUnsavedChanges).toBe(true);
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect.poll(() => modal.open).toBe(false);
  expect(editor.descriptionSaves).toEqual(["Counter service"]);
  expect(writes).toEqual([]);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(form.hasUnsavedChanges).toBe(false);
});
it("Enter in the description saves it exactly once", async () => {
  const { form, editor, writes } = await mountWithDescription();
  await editDepartmentField(form, "operationDescription", "Counter service");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => editor.descriptionSaves).toEqual(["Counter service"]);
  expect(writes).toEqual([]);
});
it("a Details Save with settings and description changed sends the settings first, then the description", async () => {
  const { form, modal, editor, writes } = await mountWithDescription();
  const seen: number[] = [];
  const original = editor.saveOperationDescription.bind(editor);
  vi.spyOn(editor, "saveOperationDescription").mockImplementation(async (value) => {
    seen.push(writes.length);
    return original(value);
  });
  await editDepartmentField(form, "name", "Restaurant renamed");
  await editDepartmentField(form, "operationDescription", "Counter service");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect.poll(() => modal.open).toBe(false);
  expect(writes).toHaveLength(1);
  expect(writes[0]![0]).toMatch(/\/settings$/);
  expect(writes[0]![2]).not.toHaveProperty("operationDescription");
  expect(seen).toEqual([1]);
  expect(editor.descriptionSaves).toEqual(["Counter service"]);
});
it("a settings change alone sends no description", async () => {
  const { form, modal, editor, writes } = await mountWithDescription();
  await editDepartmentField(form, "name", "Restaurant renamed");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect.poll(() => modal.open).toBe(false);
  expect(writes).toHaveLength(1);
  expect(writes[0]![2]).not.toHaveProperty("operationDescription");
  expect(editor.descriptionSaves).toEqual([]);
});
it("a refused description shows its refusal under the field and stays unsaved while the settings change stands", async () => {
  const { el, form, modal, editor, writes } = await mountWithDescription();
  editor.descriptionRefusal = "That description was refused";
  const saved = vi.fn();
  const written = vi.fn();
  el.addEventListener("saved", saved);
  el.addEventListener("written", written);
  await editDepartmentField(form, "name", "Restaurant renamed");
  await editDepartmentField(form, "operationDescription", "Rejected service");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect.poll(() => written.mock.calls.length).toBe(1);
  const field = descriptionField(form)!;
  await expect.poll(() => field.error).toBe("That description was refused");
  await expect
    .poll(() => field.shadowRoot!.activeElement)
    .toBe(field.shadowRoot!.querySelector("input"));
  expect(field.value).toBe("Rejected service");
  expect(form.tab).toBe("details");
  expect(modal.open).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
  expect(editor.descriptionSaves).toEqual(["Rejected service"]);
  expect(form.hasUnsavedChanges).toBe(true);
  const actions = form.shadowRoot!.querySelector("wt-form-actions")!;
  expect(actions.error).toBe("Correct the highlighted fields to continue.");
  // The settings part is committed: putting the description back leaves nothing unsaved.
  await editDepartmentField(form, "operationDescription", "Dining service");
  expect(field.error).toBe("");
  expect(form.hasUnsavedChanges).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLInputElement & { value: string }>("[name=name]")!.value,
  ).toBe("Restaurant renamed");
});
it("a refused description keeps its refusal while another field changes", async () => {
  const { form, editor } = await mountWithDescription();
  editor.descriptionRefusal = "That description was refused";
  await editDepartmentField(form, "operationDescription", "Rejected service");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  const field = descriptionField(form)!;
  await expect.poll(() => field.error).toBe("That description was refused");
  await editDepartmentField(form, "tradingName", "Other");
  expect(field.error).toBe("That description was refused");
});
it("a refused settings save sends no description", async () => {
  const { form, editor, writes } = await mountWithDescription("Dining service", (async (
    path: string,
    method = "GET",
  ) => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? []
        : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
    throw { code: "department.name_taken" };
  }) as DashboardRequest);
  await editDepartmentField(form, "name", "Bar");
  await editDepartmentField(form, "operationDescription", "Counter service");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect
    .poll(
      () => form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
    )
    .not.toBe("");
  expect(editor.descriptionSaves).toEqual([]);
  expect(writes).toEqual([]);
  expect(form.hasUnsavedChanges).toBe(true);
});
it("an invalid description is explained inline and blocks the save", async () => {
  const { form, editor, writes } = await mountWithDescription();
  await editDepartmentField(form, "operationDescription", " ");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  const field = descriptionField(form)!;
  await expect.poll(() => field.error).toBe("Description required");
  expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(departmentSave(form).disabled).toBe(true);
  await expect
    .poll(() => field.shadowRoot!.activeElement)
    .toBe(field.shadowRoot!.querySelector("input"));
  expect(editor.descriptionSaves).toEqual([]);
  expect(writes).toEqual([]);
  await editDepartmentField(form, "operationDescription", "Counter service");
  expect(field.error).toBe("");
  expect(departmentSave(form).disabled).toBe(false);
});
it("an invalid description on another tab returns to Details", async () => {
  const { form } = await mountWithDescription();
  await editDepartmentField(form, "operationDescription", "");
  await selectDepartmentTab(form, "service");
  await userEvent.click(page.elementLocator(departmentSave(form)));
  await expect.poll(() => form.tab).toBe("details");
  await expect.poll(() => descriptionField(form)!.error).toBe("Description required");
});
it("a new saved description is adopted while untouched, and an edited draft stays", async () => {
  const { form, editor } = await mountWithDescription();
  editor.offerDescription("New elsewhere");
  await expect.poll(() => descriptionField(form)!.value).toBe("New elsewhere");
  expect(form.hasUnsavedChanges).toBe(false);
  await editDepartmentField(form, "operationDescription", "Mine");
  editor.offerDescription("Again elsewhere");
  await form.updateComplete;
  expect(descriptionField(form)!.value).toBe("Mine");
  expect(form.hasUnsavedChanges).toBe(true);
  await editDepartmentField(form, "operationDescription", "Again elsewhere");
  expect(form.hasUnsavedChanges).toBe(false);
});
it("Cancel restores the saved description", async () => {
  const { form, editor } = await mountWithDescription();
  const cancelled = vi.fn();
  form.addEventListener("cancelled", cancelled);
  await editDepartmentField(form, "operationDescription", "Draft");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => cancelled.mock.calls.length).toBe(1);
  expect(form.hasUnsavedChanges).toBe(false);
  await form.updateComplete;
  expect(descriptionField(form)!.value).toBe("Dining service");
  expect(editor.descriptionSaves).toEqual([]);
});
it("contains the description field's change event", async () => {
  const { form } = await mountWithDescription();
  const leaked = vi.fn();
  form.addEventListener("wt-change", leaked);
  await editDepartmentField(form, "operationDescription", "Updated");
  expect(descriptionField(form)!.value).toBe("Updated");
  expect(leaked).not.toHaveBeenCalled();
});

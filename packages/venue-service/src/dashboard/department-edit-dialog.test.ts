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
  editReceipt,
  receiptInput,
} from "../testing/department-edit-fixture.js";
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});
it("opens a protected department dialog with the narrowed fields in order", async () => {
  const { el, writes } = await mount();
  const modal = el.shadowRoot?.querySelector("wt-modal");
  expect(modal, "the department opens as a dialog").toBeTruthy();
  await modal!.updateComplete;
  expect(modal!.heading).toBe("Edit department: Restaurant");
  expect(modal!.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
  const form = el.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  expect([...form.shadowRoot!.querySelectorAll("wt-input")].map((f) => f.name)).toEqual([
    "name",
    "tradingName",
  ]);
  expect(form.shadowRoot!.querySelector("[data-test=save-editor]")!.getAttribute("variant")).toBe(
    "secondary",
  );
  expect(writes).toEqual([]);
});

it("successful Save closes before its host is asked to refresh", async () => {
  const { el, form, modal, writes } = await mount();
  const saved = vi.fn(() => modal.open);
  el.addEventListener("saved", saved);
  await editDepartmentField(form, "name", "Restaurant revised");
  departmentSave(form).click();
  await expect.poll(() => modal.open).toBe(false);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/settings",
      "PUT",
      {
        name: "Restaurant revised",
        tradingName: "Casa",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        transfers: { receivingProfileId: null, destinationDepartmentIds: [] },
      },
    ],
  ]);
  await expect.poll(() => saved.mock.calls.length).toBe(1);
  expect(saved.mock.results[0]!.value).toBe(false);
});
it("a blank name keeps its dialog open, explains the field and disables Save until corrected", async () => {
  const { el, form, modal, writes } = await mount();
  await editDepartmentField(form, "name", " ");
  departmentSave(form).click();
  await form.updateComplete;
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  expect(field.error).toBe("This field is required.");
  expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(departmentSave(form).disabled).toBe(true);
  expect(modal.open).toBe(true);
  expect(writes).toEqual([]);
  await editDepartmentField(form, "name", "Fixed");
  expect(departmentSave(form).disabled).toBe(false);
  expect(el.departmentId).toBe("d1");
});
it("a departed Save cannot close or mark the replacement department", async () => {
  let finish!: () => void;
  const { el, form } = await mount((async (path, method = "GET") => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? []
        : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  const saved = vi.fn();
  el.addEventListener("saved", saved);
  await editDepartmentField(form, "name", "Submitted");
  departmentSave(form).click();
  await expect.poll(() => !!finish).toBe(true);
  el.departmentId = "d2";
  await el.updateComplete;
  const next = el.shadowRoot!.querySelector("department-settings")!;
  await next.updateComplete;
  await editDepartmentField(next, "name", "Deli draft");
  finish();
  await form.updateComplete;
  await next.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(
    next.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Deli draft");
  expect(saved).not.toHaveBeenCalled();
});

it("a live deletion closes the editor and releases its draft", async () => {
  const { el, form, modal, app } = await mount();
  const gone = vi.fn();
  el.addEventListener("gone", gone);
  await editDepartmentField(form, "name", "Draft");
  const view = structuredClone(el.model);
  view.departments[0]!.active = false;
  el.model = view;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(modal.isConnected).toBe(false);
  expect(gone).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: { departmentId: "d1" } }),
  );
});

it("an empty or unknown subject neither opens a dialog nor asks its host to reload", async () => {
  const el = document.createElement("department-edit-dialog");
  const gone = vi.fn();
  el.addEventListener("gone", gone);
  document.body.append(el);
  try {
    await el.updateComplete;
    expect(gone).not.toHaveBeenCalled();
    el.departmentId = "unknown";
    await el.updateComplete;
    expect(gone).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  } finally {
    el.remove();
  }
});

it("an old native close event cannot dismiss the replacement department", async () => {
  const { el, modal } = await mount();
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  el.departmentId = "d2";
  await el.updateComplete;
  const next = el.shadowRoot!.querySelector("wt-modal")!;
  await next.updateComplete;
  expect(next.open).toBe(true);
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(next.open).toBe(true);
  expect(closed).not.toHaveBeenCalled();
});

it.each(["en", "es"])(
  "a late department name clash does not mark newer native input in %s",
  async (locale) => {
    setLocale(locale);
    let reject!: (error: unknown) => void;
    const writes: unknown[][] = [];
    const { form, modal } = await mount((async (path, method = "GET", body) => {
      if (method === "GET")
        return path.endsWith("/profiles")
          ? []
          : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
      writes.push([path, method, body]);
      await new Promise<void>((_resolve, refuse) => {
        reject = refuse;
      });
    }) as import("@waitron/dashboard-kit").DashboardRequest);
    const change = async (value: string) => {
      await editDepartmentField(form, "name", value);
    };
    await change("Reserved");
    departmentSave(form).click();
    await expect.poll(() => writes.length).toBe(1);
    await change("Available now");
    reject({ code: "department.name_taken", params: { name: "Reserved" } });
    await expect.poll(() => departmentSave(form).disabled).toBe(false);
    const name = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await name.updateComplete;
    expect(name.error).toBe("");
    expect(name.shadowRoot!.querySelector("input")!.value).toBe("Available now");
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(form.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
    expect(modal.open).toBe(true);
    expect(departmentSave(form).variant).toBe("primary");
    expect(writes).toHaveLength(1);
    expect((writes[0]![2] as { name: string }).name).toBe("Reserved");
  },
);
it("passes its tab to the form, and a later tab moves the form there", async () => {
  const { el, form } = await mount();
  expect(el.tab).toBe("details");
  el.tab = "service";
  await el.updateComplete;
  await form.updateComplete;
  expect(form.tab).toBe("service");
  el.tab = "details";
  await el.updateComplete;
  await form.updateComplete;
  expect(form.tab).toBe("details");
});

it("offers Receipts between Service and Transfers when an editor is supplied, and is wide", async () => {
  const { el, form, modal } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  await modal.updateComplete;
  expect(modal.size).toBe("wide");
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  expect(
    [...strip.shadowRoot!.querySelectorAll("[role=tab]")].map((tab) => [
      tab.getAttribute("data-key"),
      tab.textContent!.trim(),
    ]),
  ).toEqual([
    ["details", "Details"],
    ["service", "Service"],
    ["receipt", "Receipts"],
    ["transfers", "Transfers"],
  ]);
  expect(form.shadowRoot!.querySelector("[slot=receipt]")!.contains(editor)).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-form-actions")).not.toBeNull();
  await selectDepartmentTab(form, "receipt");
  expect(form.tab).toBe("receipt");
  expect(form.shadowRoot!.querySelector("wt-form-actions")).toBeNull();
  expect(modal.size).toBe("wide");
});
it("no editor, no Receipts tab, standard width", async () => {
  const { form, modal } = await mount();
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  expect(
    [...strip.shadowRoot!.querySelectorAll("[role=tab]")].map((tab) =>
      tab.getAttribute("data-key"),
    ),
  ).toEqual(["details", "service", "transfers"]);
  expect(form.shadowRoot!.querySelector("[slot=receipt]")).toBeNull();
  expect(modal.size).toBe("standard");
});
it("a receipt Save closes the dialog when the department form is clean", async () => {
  const { el, form, modal, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const saved = vi.fn();
  const written = vi.fn();
  el.addEventListener("saved", saved);
  el.addEventListener("written", written);
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-receipt]")!.click();
  await expect.poll(() => modal.open).toBe(false);
  await expect.poll(() => saved.mock.calls.length).toBe(1);
  expect(saved.mock.calls[0]![0].detail).toEqual({ departmentId: "d1" });
  expect(written).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});
it("a receipt Save keeps the dialog open on Receipts when Details is dirty, and the Details edit survives", async () => {
  const { el, form, modal, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const saved = vi.fn();
  const written = vi.fn();
  el.addEventListener("saved", saved);
  el.addEventListener("written", written);
  await editDepartmentField(form, "name", "Restaurant draft");
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-receipt]")!.click();
  await expect.poll(() => written.mock.calls.length).toBe(1);
  expect(written.mock.calls[0]![0].detail).toEqual({ departmentId: "d1" });
  await form.updateComplete;
  expect(saved).not.toHaveBeenCalled();
  expect(modal.open).toBe(true);
  expect(form.tab).toBe("receipt");
  expect(editor.hasUnsavedChanges).toBe(false);
  expect(form.hasUnsavedChanges).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Restaurant draft");
  expect(writes).toEqual([]);
});
it("Enter in a receipt field, receipt unchanged and Details dirty, writes nothing", async () => {
  const { el, form, modal, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  await editDepartmentField(form, "name", "Restaurant draft");
  await selectDepartmentTab(form, "receipt");
  await userEvent.click(page.elementLocator(editor.shadowRoot!.querySelector("wt-input")!));
  expect(editor.shadowRoot!.activeElement?.shadowRoot?.activeElement).toBe(receiptInput(editor));
  await userEvent.keyboard("{Enter}");
  await form.updateComplete;
  expect(writes).toEqual([]);
  expect(modal.open).toBe(true);
  expect(form.hasUnsavedChanges).toBe(true);
});
it("Enter reaching a receipt field after the dialog has moved to Details, before the browser moves focus off it, writes nothing", async () => {
  const { el, form, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  await editDepartmentField(form, "name", "Restaurant draft");
  await selectDepartmentTab(form, "receipt");
  await userEvent.click(page.elementLocator(editor.shadowRoot!.querySelector("wt-input")!));
  form.tab = "details";
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-tabs")!.updateComplete;
  expect(departmentSave(form)).not.toBeNull();
  expect(editor.shadowRoot!.activeElement?.shadowRoot?.activeElement).toBe(receiptInput(editor));
  receiptInput(editor).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(writes).toEqual([]);
  expect(form.hasUnsavedChanges).toBe(true);
});
it("a department Save keeps the dialog open while the receipt draft is dirty", async () => {
  const { el, form, modal, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const saved = vi.fn();
  const written = vi.fn();
  el.addEventListener("saved", saved);
  el.addEventListener("written", written);
  await selectDepartmentTab(form, "receipt");
  await editReceipt(editor, "Thanks");
  await selectDepartmentTab(form, "details");
  await editDepartmentField(form, "name", "Restaurant revised");
  departmentSave(form).click();
  await expect.poll(() => written.mock.calls.length).toBe(1);
  expect(writes).toHaveLength(1);
  expect(saved).not.toHaveBeenCalled();
  expect(modal.open).toBe(true);
  expect(editor.hasUnsavedChanges).toBe(true);
});
it("the receipt editor's Cancel asks the dialog to close", async () => {
  const { el, form, modal, writes } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  await selectDepartmentTab(form, "receipt");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-receipt]")!.click();
  await expect.poll(() => modal.open).toBe(false);
  await expect.poll(() => closed.mock.calls.length).toBe(1);
  expect(closed.mock.calls[0]![0].detail).toEqual({ departmentId: "d1" });
  expect(writes).toEqual([]);
});
it("the receipt editor losing its department dismisses the dialog as gone", async () => {
  const { el, form, modal } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const gone = vi.fn();
  el.addEventListener("gone", gone);
  editor.notify("department-receipt-closed");
  await el.updateComplete;
  expect(gone).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: { departmentId: "d1" } }),
  );
  await expect.poll(() => modal.open).toBe(false);
});
it("receipt events naming another department leave the dialog alone", async () => {
  const { el, form, modal } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const heard = vi.fn();
  for (const type of ["saved", "written", "closed", "gone"]) el.addEventListener(type, heard);
  editor.departmentId = "d2";
  for (const type of [
    "department-receipt-saved",
    "department-receipt-cancel",
    "department-receipt-closed",
  ])
    editor.notify(type);
  await el.updateComplete;
  await form.updateComplete;
  await modal.updateComplete;
  expect(heard).not.toHaveBeenCalled();
  expect(modal.open).toBe(true);
});
function tabChanges(el: HTMLElement) {
  const changes: unknown[] = [];
  el.addEventListener("department-tab-change", (event) =>
    changes.push((event as CustomEvent).detail),
  );
  return changes;
}
function tabMarks(form: HTMLElementTagNameMap["department-settings"]) {
  return form.shadowRoot!.querySelector("wt-tabs")!.items.map(({ key, marked }) => [key, marked]);
}
it("a receipt refusal naming a field while Details shows selects Receipts, replacing the address, marks it and focuses the field", async () => {
  const { el, form } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  await selectDepartmentTab(form, "receipt");
  await selectDepartmentTab(form, "details");
  const changes = tabChanges(el);
  await editor.refuse();
  await expect.poll(() => form.tab).toBe("receipt");
  expect(changes).toEqual([{ tab: "receipt", replace: true }]);
  await form.shadowRoot!.querySelector("wt-tabs")!.updateComplete;
  expect(tabMarks(form)).toEqual([
    ["details", undefined],
    ["service", undefined],
    ["receipt", "needs fixing"],
    ["transfers", undefined],
  ]);
  const field = editor.shadowRoot!.querySelector("wt-input")!;
  await expect.poll(() => editor.shadowRoot!.activeElement).toBe(field);
  expect(field.shadowRoot!.activeElement).toBe(receiptInput(editor));
  await editReceipt(editor, "Fixed");
  await expect.poll(() => tabMarks(form)[2]).toEqual(["receipt", undefined]);
  expect(changes).toHaveLength(1);
});
it("a receipt refusal while Receipts shows marks the tab and changes no tab", async () => {
  const { el, form } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  await selectDepartmentTab(form, "receipt");
  const changes = tabChanges(el);
  await editor.refuse();
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-tabs")!.updateComplete;
  expect(tabMarks(form)[2]).toEqual(["receipt", "needs fixing"]);
  expect(form.tab).toBe("receipt");
  expect(changes).toEqual([]);
});
it("a receipt refusal event from another department's editor does not move the tab or take focus", async () => {
  const { el, form } = await mount();
  const editor = await supplyReceiptEditor(el, form);
  const changes = tabChanges(el);
  const heard = vi.fn();
  el.addEventListener("department-receipt-invalid", heard);
  editor.departmentId = "d2";
  await editor.refuse();
  await form.updateComplete;
  expect(form.tab).toBe("details");
  expect(changes).toEqual([]);
  expect(heard).not.toHaveBeenCalled();
  expect(editor.shadowRoot!.activeElement).toBeNull();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor as mount,
  editDepartmentField,
  departmentSave,
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

import { navigationGuardFor } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, dialogClosed } from "./widgets/test-helpers.js";
import {
  deferred,
  receiptModel,
  editReceipt,
  receiptField,
  receiptSave,
  receiptRoot,
} from "./testing/department-receipt-editor-fixture.js";
import {
  deep,
  departmentDialog,
  departmentForm,
  mountReceiptApp as mount,
  mountReceiptTab,
  receiptTabEditor,
} from "./testing/department-receipt-app-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", "/manage");
});
it.each([true, false])(
  "mounts the selected protected receipt editor on the Receipts tab with installed description visibility (%s)",
  async (required) => {
    const { app } = await mount({ required });
    await expect.poll(() => receiptTabEditor(app)).toBeTruthy();
    const editor = receiptTabEditor(app)!;
    await expect.poll(() => receiptRoot(editor).querySelector("[name=email]")).toBeTruthy();
    expect(departmentForm(app)!.tab).toBe("receipt");
    expect(receiptTabEditor(app)!.subject).toEqual({ id: "bar", name: "Bar" });
    expect(!!receiptRoot(editor).querySelector("[name=operationDescription]")).toBe(required);
    expect(deep(app.shadowRoot!, "dashboard-receipts-screen")).toBeNull();
    expect(departmentDialog(app)!.shadowRoot!.querySelector("wt-modal")!.heading).toBe(
      "Edit department: Bar",
    );
  },
);
it("successful receipt save closes the department dialog when the department form is clean", async () => {
  const { app, fetchImpl } = await mount();
  await expect.poll(() => receiptTabEditor(app)).toBeTruthy();
  const editor = receiptTabEditor(app)!;
  await expect.poll(() => receiptRoot(editor).querySelector("[name=email]")).toBeTruthy();
  await editReceipt(editor, "email", "bar@example.com");
  expect(departmentForm(app)!.hasUnsavedChanges).toBe(false);
  const dialog = departmentDialog(app)!.shadowRoot!.querySelector("wt-modal")!;
  const toggle = receiptRoot(editor).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=printTradingName]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(receiptSave(editor)));
  await closed;
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations");
  expect(
    JSON.parse(
      fetchImpl.mock.calls.find(
        ([path, init]) => path.endsWith("/bar/receipt") && init.method === "PUT",
      )![1].body as string,
    ),
  ).toEqual({
    receipt: { ...receiptModel.receipt, email: "bar@example.com" },
    policy: { ...receiptModel.policy, printTradingName: false },
  });
  expect(receiptTabEditor(app)).toBeNull();
  expect(departmentDialog(app)).toBeNull();
  const list = deep(
    app.shadowRoot!,
    "departments-list",
  ) as HTMLElementTagNameMap["departments-list"];
  await expect
    .poll(
      () =>
        list?.model?.salePolicies.departments.find((policy) => policy.departmentId === "bar")
          ?.printTradingName,
    )
    .toBe(false);
});
it("a live receipt read after Cancel begins cannot keep the dialog open", async () => {
  const held = deferred<Response>();
  let hold = false;
  const { app, api, fetchImpl, modal } = await mountReceiptTab({
    respond: (path, init) =>
      hold && path.endsWith("/bar/receipt") && init.method !== "PUT" ? held.promise : undefined,
  });
  const reads = () =>
    fetchImpl.mock.calls.filter(
      ([path, init]) => path.endsWith("/bar/receipt") && init.method !== "PUT",
    ).length;
  expect(reads()).toBe(1);
  hold = true;
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(reads).toBe(2);
  expect(await modal.requestClose("cancel")).toBe(true);
  expect(modal.open).toBe(false);
  held.resolve(
    new Response(
      JSON.stringify({ ...receiptModel, venueDefaults: {}, operationDescriptionRequired: true }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations");
  expect(modal.open).toBe(false);
  expect(receiptTabEditor(app)).toBeNull();
  expect(departmentDialog(app)).toBeNull();
});
it("a dirty receipt draft asks before another department's Receipts address; Keep stays, Discard opens it", async () => {
  const { app } = await mountReceiptTab({
    departments: [
      { id: "bar", name: "Bar" },
      { id: "cafe", name: "Cafe" },
    ],
  });
  const editor = receiptTabEditor(app)!;
  await editReceipt(editor, "email", "draft@example.com");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  const cafe = "/manage/venue-operations/department/cafe/view/receipt";
  for (const decision of ["keep", "discard"] as const) {
    void navigationGuardFor(window)!.write(cafe);
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    await userEvent.click(
      page.elementLocator(question.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
    );
    await expect.poll(() => question.open).toBe(false);
    if (decision === "keep") {
      expect(location.pathname).toBe("/manage/venue-operations/department/bar/view/receipt");
      expect(receiptTabEditor(app)).toBe(editor);
      expect(editor.subject).toEqual({ id: "bar", name: "Bar" });
      expect(receiptField(editor, "email").value).toBe("draft@example.com");
    }
  }
  await expect.poll(() => location.pathname).toBe(cafe);
  await expect.poll(() => receiptTabEditor(app)?.subject?.id).toBe("cafe");
  expect(departmentForm(app)!.tab).toBe("receipt");
  const next = receiptTabEditor(app)!;
  await expect.poll(() => next.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(next, "email").value).toBe("");
});
it("Venue settings no longer hosts a global receipt tab or global receipt reads", async () => {
  const { app, fetchImpl } = await mount({ path: "/manage/venue-settings/view/receipts" });
  await expect.poll(() => location.pathname).toBe("/manage/venue-settings/view/venue-details");
  const settings = deep(app.shadowRoot!, "dashboard-venue-settings-screen")!;
  expect(settings.shadowRoot!.querySelector("wt-tabs")!.items.map(({ key }) => key)).not.toContain(
    "receipts",
  );
  expect(deep(app.shadowRoot!, "dashboard-receipts-screen")).toBeNull();
  expect(fetchImpl.mock.calls.map(([path]) => path)).not.toEqual(
    expect.arrayContaining([
      "/management-api/receipt",
      "/management-api/receipt-settings",
      "/management-api/location-settings",
    ]),
  );
});
it("a deep link without layout permission opens Details, replacing the address, with no Receipts tab", async () => {
  const push = vi.spyOn(history, "pushState");
  const { app, fetchImpl } = await mount({ permissions: ["venue_service.manage"] });
  await expect.poll(() => departmentForm(app)).toBeTruthy();
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/bar");
  const form = departmentForm(app)!;
  await form.updateComplete;
  expect(form.tab).toBe("details");
  expect(form.shadowRoot!.querySelector("wt-tabs")!.items.map(({ key }) => key)).not.toContain(
    "receipt",
  );
  expect(push.mock.calls.some(([, , url]) => String(url).includes("/department/bar"))).toBe(false);
  expect(receiptTabEditor(app)).toBeNull();
  expect(fetchImpl.mock.calls.some(([path]) => path.endsWith("/bar/receipt"))).toBe(false);
  push.mockRestore();
});

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
    const { app, editor } = await mountReceiptTab({ required });
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
  const { app, fetchImpl, editor } = await mountReceiptTab();
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
async function showDepartmentTab(app: Parameters<typeof departmentForm>[0], key: string) {
  const form = departmentForm(app)!;
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  await userEvent.click(
    page.elementLocator(strip.shadowRoot!.querySelector(`[role=tab][data-key=${key}]`)!),
  );
  await expect.poll(() => form.tab).toBe(key);
}
const emailRefusal = () =>
  new Response(
    JSON.stringify({
      error: { code: "receipt.invalid", params: { field: "email", reason: "invalid_email" } },
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );
it("a receipt refusal naming a field that lands while Details shows returns to Receipts, replacing the address, marks the tab and focuses the field", async () => {
  const held = deferred<Response>();
  const { app, editor, modal } = await mountReceiptTab({
    respond: (path, init) =>
      path.endsWith("/bar/receipt") && init.method === "PUT" ? held.promise : undefined,
  });
  await editReceipt(editor, "email", "new@example.com");
  await userEvent.click(page.elementLocator(receiptSave(editor)));
  await expect.poll(() => editor.saving).toBe(true);
  await showDepartmentTab(app, "details");
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/bar");
  const form = departmentForm(app)!;
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  try {
    held.resolve(emailRefusal());
    await expect.poll(() => form.tab).toBe("receipt");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/venue-operations/department/bar/view/receipt");
    expect(push).not.toHaveBeenCalled();
    expect(
      replace.mock.calls.some(([, , url]) => String(url).includes("/department/bar/view/receipt")),
    ).toBe(true);
    await strip.updateComplete;
    expect(strip.items.map(({ key, marked }) => [key, marked])).toEqual([
      ["details", undefined],
      ["service", undefined],
      ["receipt", "needs fixing"],
    ]);
    const email = receiptField(editor, "email");
    expect(email.error).toBe("Enter an email address such as name@example.com.");
    await expect.poll(() => receiptRoot(editor).activeElement).toBe(email);
    expect(email.shadowRoot!.activeElement).toBe(email.shadowRoot!.querySelector("input"));
    expect(modal.open).toBe(true);
    expect(editor.hasUnsavedChanges).toBe(true);
    await editReceipt(editor, "email", "fixed@example.com");
    await strip.updateComplete;
    await expect
      .poll(() => strip.items.find(({ key }) => key === "receipt")!.marked)
      .toBeUndefined();
  } finally {
    push.mockRestore();
    replace.mockRestore();
  }
});
it("a receipt refusal naming a field that lands while Receipts shows changes no tab or address", async () => {
  const held = deferred<Response>();
  const { app, editor } = await mountReceiptTab({
    respond: (path, init) =>
      path.endsWith("/bar/receipt") && init.method === "PUT" ? held.promise : undefined,
  });
  const form = departmentForm(app)!;
  const changes = vi.fn();
  form.addEventListener("department-tab-change", changes);
  await editReceipt(editor, "email", "new@example.com");
  await userEvent.click(page.elementLocator(receiptSave(editor)));
  await expect.poll(() => editor.saving).toBe(true);
  held.resolve(emailRefusal());
  await expect.poll(() => receiptField(editor, "email").error).not.toBe("");
  await expect.poll(() => receiptRoot(editor).activeElement).toBe(receiptField(editor, "email"));
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  expect(strip.items.find(({ key }) => key === "receipt")!.marked).toBe("needs fixing");
  expect(form.tab).toBe("receipt");
  expect(changes).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/manage/venue-operations/department/bar/view/receipt");
});
it("a last-language footer refusal at phone width leaves its focused textarea in view in the department dialog's scrolled body", async () => {
  const viewport = { width: innerWidth, height: innerHeight };
  await page.viewport(390, 844);
  try {
    const { editor, modal } = await mountReceiptTab({
      respond: (path, init) =>
        path.endsWith("/bar/receipt") && init.method === "PUT"
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    code: "receipt.invalid",
                    params: { field: "footerMessage", language: "ca-ES", maxLength: 300 },
                  },
                }),
                { status: 422, headers: { "content-type": "application/json" } },
              ),
            )
          : undefined,
    });
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const refused = receiptField(editor, "footerMessage-ca-ES");
    const textarea = refused.shadowRoot!.querySelector("textarea")!;
    const inView = () => {
      const shown = body.getBoundingClientRect();
      const field = textarea.getBoundingClientRect();
      return field.top >= shown.top && field.bottom <= shown.bottom;
    };
    await editReceipt(editor, "footerMessage-ca-ES", "Draft");
    textarea.blur();
    body.scrollTop = 0;
    expect(inView()).toBe(false);
    receiptSave(editor).click();
    await expect.poll(() => refused.error).not.toBe("");
    await expect.poll(inView).toBe(true);
    expect(refused.shadowRoot!.activeElement).toBe(textarea);
  } finally {
    await page.viewport(viewport.width, viewport.height);
  }
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

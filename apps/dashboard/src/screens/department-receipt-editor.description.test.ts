import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  clickReceiptSave,
  deferred,
  editReceipt,
  mountReceiptEditor,
  receiptApi,
  receiptField,
  receiptModel,
  receiptRoot,
} from "../testing/department-receipt-editor-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it("draws no description field and offers the saved description to the Details tab", async () => {
  const { el } = await mountReceiptEditor();
  expect(receiptRoot(el).querySelector("[name=operationDescription]")).toBeNull();
  expect(el.savedOperationDescription).toBe("Dining service");
});
it("offers no description when the installation does not require one", async () => {
  const { el } = await mountReceiptEditor(
    receiptApi({ ...receiptModel, receipt: {}, operationDescriptionRequired: false }),
  );
  expect(el.savedOperationDescription).toBeUndefined();
});
it.each([
  ["", "venue_settings.required"],
  [" ", "venue_settings.required"],
  ["a".repeat(501), "venue_settings.invalid"],
  ["Sale\u0001service", "venue_settings.invalid"],
  ["Sale\u007fservice", "venue_settings.invalid"],
] as const)("judges description case %# as %s", async (value, key) => {
  const { el } = await mountReceiptEditor();
  expect(el.descriptionProblem(value)).toBe(t(key));
});
it("accepts a 500-character description", async () => {
  const { el } = await mountReceiptEditor();
  expect(el.descriptionProblem("a".repeat(500))).toBe("");
  expect(el.descriptionProblem("Counter service")).toBe("");
});
it("announces the description when it loads and when a live read brings a new saved value", async () => {
  const api = receiptApi();
  const seen: unknown[] = [];
  const listener = (event: Event) =>
    seen.push((event as CustomEvent<{ departmentId: string }>).detail.departmentId);
  document.addEventListener("department-receipt-description", listener);
  try {
    const { el } = await mountReceiptEditor(api);
    await expect.poll(() => seen).toEqual(["bar"]);
    await editReceipt(el, "email", "draft@example.com");
    api.getDepartmentReceipt.mockResolvedValue({
      ...receiptModel,
      receipt: { ...receiptModel.receipt, operationDescription: "New elsewhere" },
    });
    api.liveData.invalidate([{ type: "department_receipts" }]);
    await expect.poll(() => el.savedOperationDescription).toBe("New elsewhere");
    await expect.poll(() => seen).toEqual(["bar", "bar"]);
  } finally {
    document.removeEventListener("department-receipt-description", listener);
  }
});
it("saves the description with the saved record only, never the Receipts tab's unsaved edits", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "phone", "+34 912 345 678");
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const saving = el.saveOperationDescription("Counter service");
  expect(el.saving).toBe(true);
  held.resolve();
  expect(await saving).toBeUndefined();
  expect(el.saving).toBe(false);
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
    receipt: { ...receiptModel.receipt, operationDescription: "Counter service" },
    policy: receiptModel.policy,
  });
  expect(el.savedOperationDescription).toBe("Counter service");
  expect(el.hasUnsavedChanges).toBe(true);
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(2);
  expect(api.putDepartmentReceipt.mock.lastCall).toEqual([
    "bar",
    {
      receipt: {
        ...receiptModel.receipt,
        operationDescription: "Counter service",
        phone: "+34 912 345 678",
      },
      policy: receiptModel.policy,
    },
  ]);
});
it("a description save keeps what another session saved under a field edited here", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "email", "mine@example.com");
  api.getDepartmentReceipt.mockResolvedValue({
    ...receiptModel,
    receipt: {
      ...receiptModel.receipt,
      email: "other@example.com",
      operationDescription: "New elsewhere",
    },
  });
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => el.savedOperationDescription).toBe("New elsewhere");
  expect(await el.saveOperationDescription("Counter service")).toBeUndefined();
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
    receipt: {
      ...receiptModel.receipt,
      email: "other@example.com",
      operationDescription: "Counter service",
    },
    policy: receiptModel.policy,
  });
  expect(el.hasUnsavedChanges).toBe(true);
  expect(receiptField(el, "email").value).toBe("mine@example.com");
});
it("a description save after a Receipts save sends what that save wrote", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "phone", "+34 912 345 678");
  await clickReceiptSave(el);
  await expect.poll(() => el.hasUnsavedChanges).toBe(false);
  expect(await el.saveOperationDescription("Counter service")).toBeUndefined();
  expect(api.putDepartmentReceipt.mock.lastCall).toEqual([
    "bar",
    {
      receipt: {
        ...receiptModel.receipt,
        phone: "+34 912 345 678",
        operationDescription: "Counter service",
      },
      policy: receiptModel.policy,
    },
  ]);
});
it("a description save on a clean editor leaves it clean", async () => {
  const { el } = await mountReceiptEditor();
  expect(await el.saveOperationDescription("Counter service")).toBeUndefined();
  expect(el.hasUnsavedChanges).toBe(false);
});
it.each([
  [
    { code: "management.request_invalid", params: { field: "operationDescription" } },
    () => t("venue_settings.invalid"),
  ],
  [{ code: "management.failed" }, () => codeMessage("management.failed")],
] as const)(
  "a refused description save answers its sentence and changes nothing",
  async (error, sentence) => {
    const { el, api } = await mountReceiptEditor();
    api.putDepartmentReceipt.mockRejectedValueOnce(error);
    expect(await el.saveOperationDescription("Rejected service")).toBe(sentence());
    expect(el.saving).toBe(false);
    expect(el.savedOperationDescription).toBe("Dining service");
    expect(el.hasUnsavedChanges).toBe(false);
    await editReceipt(el, "email", "bar@example.com");
    await clickReceiptSave(el);
    await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(2);
    expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt.operationDescription).toBe(
      "Dining service",
    );
  },
);
it("a description save while a Receipts save runs sends nothing and says so", async () => {
  const { el, api } = await mountReceiptEditor();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => el.saving).toBe(true);
  expect(await el.saveOperationDescription("Counter service")).toBe(
    codeMessage("server.internal_error"),
  );
  held.resolve();
  await expect.poll(() => el.saving).toBe(false);
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(el.savedOperationDescription).toBe("Dining service");
});
it("a description save that lands after the editor closed changes nothing on it", async () => {
  const { el, api } = await mountReceiptEditor();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const saving = el.saveOperationDescription("Counter service");
  el.subject = undefined;
  await el.updateComplete;
  held.resolve();
  expect(await saving).toBeUndefined();
  expect(el.savedOperationDescription).toBeUndefined();
  expect(el.hasUnsavedChanges).toBe(false);
});

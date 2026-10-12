import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  deferred,
  editReceipt,
  mountReceiptDialog,
  preview,
  receiptApi,
  receiptField,
  receiptModel,
  receiptSave,
} from "../testing/department-receipt-dialog-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it.each([
  ["phone", "not yet"],
  ["email", "a@"],
  ["phone", "1".repeat(31)],
  ["email", "a".repeat(249) + "@b.com"],
] as const)("previews other authored fields while %s is incomplete", async (field, value) => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, field, value);
  await editReceipt(el, "footerMessage-es-ES", "Thanks");
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0].receipt.footerMessage)
    .toEqual({ "es-ES": "Thanks" });
  expect(api.previewReceiptDraft.mock.lastCall![0].receipt).not.toHaveProperty(field);
  expect(receiptField(el, field).value).toBe(value);
  expect(receiptField(el, field).error).toBe("");
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("coalesces edits behind one in-flight preview and sends only the latest draft after it answers", async () => {
  const api = receiptApi();
  const old = deferred<ReturnType<typeof preview>>();
  const latest = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => latest.promise);
  const { el } = await mountReceiptDialog(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  await editReceipt(el, "email", "first@example.com");
  await editReceipt(el, "email", "last@example.com");
  // A new live snapshot drives the same desired preview; it must not dispatch a second request.
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
  old.resolve(preview("OUTDATED"));
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(2);
  expect(api.previewReceiptDraft.mock.lastCall?.[0].receipt.email).toBe("last@example.com");
  expect(el.shadowRoot!.querySelector(".paper")?.textContent ?? "").not.toContain("OUTDATED");
  latest.resolve(preview("LATEST"));
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("LATEST");
});
it("an unchanged live snapshot leaves an in-flight preview current and does not ask again", async () => {
  const api = receiptApi();
  const held = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  const { el } = await mountReceiptDialog(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  held.resolve(preview("CURRENT"));
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("CURRENT");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
});
it("keeps the last paper when the newest preview refuses, then recovers without clearing a save refusal", async () => {
  const { el, api } = await mountReceiptDialog();
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Sample");
  api.previewReceiptDraft.mockRejectedValueOnce({ code: "server.internal" });
  await editReceipt(el, "email", "draft@example.com");
  await expect.poll(() => el.shadowRoot!.querySelector(".preview [role=alert]")).toBeTruthy();
  expect(el.shadowRoot!.querySelector(".paper")!.textContent).toContain("Sample");
  api.putDepartmentReceipt.mockRejectedValueOnce({ code: "server.internal" });
  await userEvent.click(page.elementLocator(receiptSave(el)));
  await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  await editReceipt(el, "footerMessage-es-ES", "Again");
  await expect.poll(() => el.shadowRoot!.querySelector(".preview [role=alert]")).toBeNull();
});
it("keeps the chosen preview language and width through typed text and passive live snapshots", async () => {
  const { el, api, app } = await mountReceiptDialog();
  await expect.poll(() => el.shadowRoot!.querySelector("[name=previewWidth]")).toBeTruthy();
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=previewLanguage]")!, "ca-ES");
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=previewWidth]")!, "58mm");
  await editReceipt(el, "headerSubtitle-ca-ES", "Cafè");
  api.getDepartmentReceipt.mockResolvedValue({ ...receiptModel, venueAddress: ["New Street"] });
  api.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
    .toMatchObject({
      departmentId: "bar",
      language: "ca-ES",
      paperWidth: "58mm",
      receipt: { headerSubtitle: { "ca-ES": "Cafè" } },
    });
  expect(api.previewReceiptDraft.mock.lastCall?.[1]).toEqual({ passive: true });
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it.each([{ widths: [] }, { widths: ["80mm"] }])(
  "shows no width chooser with $widths available widths",
  async ({ widths }) => {
    const api = receiptApi();
    api.previewReceiptDraft.mockResolvedValue({
      ...preview(),
      paperWidths: widths as ("58mm" | "80mm")[],
    });
    const { el } = await mountReceiptDialog(api);
    await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[name=previewWidth]")).toBeNull();
  },
);
it("a dismissed preview cannot replace the paper after reopening the same department", async () => {
  const api = receiptApi();
  const held = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  const { el, dialog } = await mountReceiptDialog(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  el.dismiss();
  await expect.poll(() => dialog.open).toBe(false);
  el.show({ id: "bar", name: "Bar" });
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Sample");
  held.resolve(preview("OLD OPENING"));
  await held.promise;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".paper")!.textContent).not.toContain("OLD OPENING");
});

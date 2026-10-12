import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  clickReceiptSave,
  editReceipt,
  mountReceiptDialog,
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
const LOGO = `${"a".repeat(64)}.png`;
it("clears one authored map entry without losing other visible or hidden translations", async () => {
  const api = receiptApi({
    ...receiptModel,
    receipt: {
      ...receiptModel.receipt,
      footerMessage: { "es-ES": "Thanks", "ca-ES": "Gràcies", "eu-ES": "Agur" },
    },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({
    ...receiptModel.receipt,
    footerMessage: { "es-ES": "Thanks", "ca-ES": "", "eu-ES": "Agur" },
  });
});
it("typing then clearing an absent translation returns to a clean draft", async () => {
  const { el, app, api } = await mountReceiptDialog();
  await editReceipt(el, "footerMessage-ca-ES", "New");
  expect(receiptSave(el).disabled).toBe(false);
  await editReceipt(el, "footerMessage-ca-ES", "");
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("trims contacts on save and omits blank contact keys", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({
      ...receiptModel,
      receipt: { ...receiptModel.receipt, phone: "910000000", email: "old@example.com" },
    }),
  );
  await editReceipt(el, "phone", "  +34 912 345 678  ");
  await editReceipt(el, "email", "   ");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({
    ...receiptModel.receipt,
    phone: "+34 912 345 678",
  });
});
it("marks both invalid contacts and enables Save only after both are repaired", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "phone", "not yet");
  await editReceipt(el, "email", "a@");
  await clickReceiptSave(el);
  expect(receiptField(el, "phone").error).toBe(t("receipts.invalid_phone"));
  expect(receiptField(el, "email").error).toBe(t("receipts.invalid_email"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "phone", "910000000");
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "email", "bar@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it.each([
  { field: "phone", at: `123${" ".repeat(24)}456`, over: `123${" ".repeat(25)}456`, max: 30 },
  { field: "email", at: "a".repeat(248) + "@b.com", over: "a".repeat(249) + "@b.com", max: 254 },
] as const)("holds $field to its exact trimmed save bound", async ({ field, at, over, max }) => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, field, " " + over + " ");
  await clickReceiptSave(el);
  expect(receiptField(el, field).error).toBe(
    t("receipts.trim_too_long").replace("{max}", String(max)),
  );
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, field, " " + at + " ");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt[field]).toBe(at);
});
it("choosing and clearing a previously absent logo restores a clean draft without inheritance", async () => {
  const { el, api, app } = await mountReceiptDialog();
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  upload.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: LOGO }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(upload.image).toBe(LOGO);
  expect(receiptSave(el).disabled).toBe(false);
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=remove-image]")!),
  );
  await el.updateComplete;
  expect(upload.image).toBeNull();
  expect(upload.inheritedImage).toBeNull();
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("clearing a saved logo previews and saves no logo", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({ ...receiptModel, receipt: { ...receiptModel.receipt, logo: LOGO } }),
  );
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=remove-image]")!),
  );
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0].receipt)
    .toEqual(receiptModel.receipt);
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual(receiptModel.receipt);
});
it("a last-language footer refusal focuses its textarea and survives edits to another field", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "footerMessage", language: "ca-ES", maxLength: 300 },
  });
  const { el, dialog } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "Draft");
  await clickReceiptSave(el);
  const refused = receiptField(el, "footerMessage-ca-ES");
  await expect.poll(() => refused.error).toBe(t("receipts.trim_too_long").replace("{max}", "300"));
  expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("textarea"));
  expect(dialog.shadowRoot!.querySelector(".body")!.scrollTop).toBeGreaterThan(0);
  await editReceipt(el, "email", "bar@example.com");
  expect(refused.error).not.toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  await editReceipt(el, "footerMessage-ca-ES", "Fixed");
  expect(refused.error).toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  expect(receiptSave(el).disabled).toBe(false);
});
it("an unknown refused language is summarized without marking fields or creating hostile markup", async () => {
  const api = receiptApi();
  const hostile = '<img src=x onerror="alert(1)">';
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "footerMessage", language: hostile, reason: "invalid_language" },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "Draft");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("receipt.invalid"));
  for (const name of [
    "footerMessage-ca-ES",
    "footerMessage-es-ES",
    "headerSubtitle-ca-ES",
    "email",
  ])
    expect(receiptField(el, name).error).toBe("");
  expect(el.shadowRoot!.querySelector("img")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(hostile);
  expect(receiptSave(el).disabled).toBe(false);
});
it("a refused address switch is explained beside it and clears when the switch is fixed", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "printAddress", reason: "not_boolean" },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-field-error=printAddress]")?.textContent)
    .toBe(codeMessage("receipt.invalid"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=printAddress]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  expect(el.shadowRoot!.querySelector("[data-field-error=printAddress]")).toBeNull();
  expect(receiptSave(el).disabled).toBe(false);
});
it("a failed initial read offers native Retry and uses the localized fallback for an uncoded rejection", async () => {
  const api = receiptApi();
  api.getDepartmentReceipt.mockRejectedValueOnce(new Error("internal details"));
  const { el, host: app } = await mountWidget<
    HTMLElementTagNameMap["dashboard-department-receipt-dialog"]
  >("dashboard-department-receipt-dialog", { api, subject: { id: "bar", name: "Bar" } });
  await expect
    .poll(() => el.shadowRoot!.querySelector(".error[role=alert]")?.textContent)
    .toBe(codeMessage("server.internal_error"));
  expect(app.textContent).not.toContain("internal details");
  await userEvent.click(page.elementLocator(el.shadowRoot!.querySelector("wt-button")!));
  await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(el, "operationDescription").value).toBe("Dining service");
});
it("Enter on an unchanged receipt sends nothing and Enter on an edited description saves exactly once", async () => {
  const { el, api, dialog } = await mountReceiptDialog();
  const description = receiptField(el, "operationDescription");
  await description.updateComplete;
  const input = description.shadowRoot!.querySelector("input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  await userEvent.click(page.elementLocator(input!));
  await userEvent.keyboard("{Enter}");
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, "operationDescription", "Counter service");
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(input!));
  await userEvent.keyboard("{Enter}");
  await closed;
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt.operationDescription).toBe(
    "Counter service",
  );
});
it("an unassigned save refusal stays visible when another authored field changes", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({ code: "management.failed" });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("management.failed"));
  await editReceipt(el, "phone", "910000000");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    codeMessage("management.failed"),
  );
  expect(receiptSave(el).disabled).toBe(false);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  deferred,
  editReceipt,
  mountReceiptEditor,
  preview,
  receiptApi,
  receiptField,
  receiptModel,
  receiptSave,
  receiptRoot,
} from "../testing/department-receipt-editor-fixture.js";

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
  const { el, api } = await mountReceiptEditor();
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
  const { el } = await mountReceiptEditor(api);
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
  expect(receiptRoot(el).querySelector(".paper")?.textContent ?? "").not.toContain("OUTDATED");
  latest.resolve(preview("LATEST"));
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("LATEST");
});
it("an unchanged live snapshot leaves an in-flight preview current and does not ask again", async () => {
  const api = receiptApi();
  const held = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  held.resolve(preview("CURRENT"));
  await expect
    .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
    .toContain("CURRENT");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
});
it("keeps the last paper when the newest preview refuses, then recovers without clearing a save refusal", async () => {
  const { el, api } = await mountReceiptEditor();
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("Sample");
  api.previewReceiptDraft.mockRejectedValueOnce({ code: "server.internal" });
  await editReceipt(el, "email", "draft@example.com");
  await expect.poll(() => receiptRoot(el).querySelector(".preview [role=alert]")).toBeTruthy();
  expect(receiptRoot(el).querySelector(".paper")!.textContent).toContain("Sample");
  api.putDepartmentReceipt.mockRejectedValueOnce({ code: "server.internal" });
  await userEvent.click(page.elementLocator(receiptSave(el)));
  await expect.poll(() => receiptRoot(el).querySelector("wt-form-actions")!.error).not.toBe("");
  await editReceipt(el, "footerMessage-es-ES", "Again");
  await expect.poll(() => receiptRoot(el).querySelector(".preview [role=alert]")).toBeNull();
});
it("keeps the chosen preview language and width through typed text and passive live snapshots", async () => {
  const { el, api, app } = await mountReceiptEditor();
  await expect.poll(() => receiptRoot(el).querySelector("[name=previewWidth]")).toBeTruthy();
  await chooseOption(receiptRoot(el).querySelector("wt-combobox[name=previewLanguage]")!, "ca-ES");
  await chooseOption(receiptRoot(el).querySelector("wt-combobox[name=previewWidth]")!, "58mm");
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
    const { el } = await mountReceiptEditor(api);
    await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
    expect(receiptRoot(el).querySelector("[name=previewWidth]")).toBeNull();
  },
);
it("a dismissed preview cannot replace the paper after reopening the same department", async () => {
  const api = receiptApi();
  const held = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "bar", name: "Bar" };
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("Sample");
  held.resolve(preview("OLD OPENING"));
  await held.promise;
  await el.updateComplete;
  expect(receiptRoot(el).querySelector(".paper")!.textContent).not.toContain("OLD OPENING");
});

it.each(["en-GB", "es-ES"] as const)("labels paper widths in %s", async (locale) => {
  setLocale(locale);
  const { el } = await mountReceiptEditor();
  await expect.poll(() => receiptRoot(el).querySelector("[name=previewWidth]")).toBeTruthy();
  const widths =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")!;
  expect(widths.options).toEqual([
    { value: "58mm", label: t("printers.paper_width_58") },
    { value: "80mm", label: t("printers.paper_width_80") },
  ]);
});
it("an implicit preview language follows the saved venue language while retaining a dirty receipt", async () => {
  const { el, api } = await mountReceiptEditor();
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  await editReceipt(el, "email", "bar@example.com");
  api.getDepartmentReceipt.mockResolvedValue({ ...receiptModel, receiptLanguage: "ca-ES" });
  api.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await expect.poll(() => api.previewReceiptDraft.mock.lastCall?.[0].language).toBe("ca-ES");
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it.each([
  { field: "logo", mark: "logo" },
  { field: "phone", mark: "phone" },
  { field: "email", mark: "email" },
  { field: "printAddress", mark: "address" },
  { field: "headerSubtitle-es-ES", mark: "headerSubtitle" },
  { field: "footerMessage-ca-ES", mark: "footerMessage" },
])(
  "focusing $field marks its printed block and leaving it clears the mark",
  async ({ field, mark }) => {
    const api = receiptApi();
    api.previewReceiptDraft.mockResolvedValue({
      ...preview("Printed content"),
      marks: { ...preview().marks, [mark]: { start: 0, end: 1 } },
    });
    const { el } = await mountReceiptEditor(api);
    await expect.poll(() => receiptRoot(el).querySelector(`[data-mark=${mark}]`)).toBeTruthy();
    const control = receiptRoot(el).querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >(`[name="${field}"]`)!;
    await control.updateComplete;
    const button = control.shadowRoot!.querySelector<HTMLElement>("wt-button");
    const native =
      button?.shadowRoot?.querySelector<HTMLElement>("button") ??
      control.shadowRoot!.querySelector<HTMLElement>("input,textarea,button")!;
    native.focus();
    await expect
      .poll(() => receiptRoot(el).querySelector(`[data-mark=${mark}]`)?.hasAttribute("data-active"))
      .toBe(true);
    receiptField(el, "operationDescription").focus();
    await el.updateComplete;
    expect(receiptRoot(el).querySelector(`[data-mark=${mark}]`)!.hasAttribute("data-active")).toBe(
      false,
    );
    expect(receiptRoot(el).querySelector("[data-mark=operationDescription]")).toBeNull();
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  },
);
it("renders chosen paper dimensions and preserves the old paper after a width refusal", async () => {
  const api = receiptApi();
  api.previewReceiptDraft.mockImplementation(async (input) => {
    const answer = preview(input.paperWidth === "58mm" ? "Narrow paper" : "Wide paper");
    return input.paperWidth === "58mm"
      ? {
          ...answer,
          paperWidth: "58mm",
          preview: { ...answer.preview, columns: 30, widthDots: 384 },
        }
      : answer;
  });
  const { el, app } = await mountReceiptEditor(api);
  await expect
    .poll(() => receiptRoot(el).querySelector<HTMLElement>(".paper")?.style.width)
    .toBe("42ch");
  const width =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")!;
  await chooseOption(width, "58mm");
  await expect
    .poll(() => receiptRoot(el).querySelector<HTMLElement>(".paper")?.style.width)
    .toBe("30ch");
  expect(receiptRoot(el).querySelector(".paper")!.textContent).toContain("Narrow paper");
  api.previewReceiptDraft.mockRejectedValue({ code: "management.failed" });
  await chooseOption(width, "80mm");
  await expect
    .poll(() => receiptRoot(el).querySelector(".preview [role=alert]")?.textContent)
    .toBe(t("receipts.preview_error"));
  expect(width.value).toBe("80mm");
  expect(receiptRoot(el).querySelector<HTMLElement>(".paper")!.style.width).toBe("30ch");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("choosing a width sends the latest staged text immediately and cancels its older quiet timer", async () => {
  const { el, api } = await mountReceiptEditor();
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await editReceipt(el, "headerSubtitle-es-ES", "Latest");
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
    const width =
      receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")!;
    width.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "58mm" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toMatchObject({
      paperWidth: "58mm",
      receipt: { headerSubtitle: { "es-ES": "Latest" } },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
    expect(api.previewReceiptDraft.mock.lastCall?.[1]).toEqual({ passive: true });
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("labels the preview before the width chooser and paper without adding another page title", async () => {
  const { el } = await mountReceiptEditor();
  await expect.poll(() => receiptRoot(el).querySelector("[name=previewWidth]")).toBeTruthy();
  const heading = receiptRoot(el).querySelector(".preview h3")!;
  expect(heading?.textContent).toBe(t("receipts.preview"));
  const width = receiptRoot(el).querySelector("[name=previewWidth]")!;
  const paper = receiptRoot(el).querySelector(".paper")!;
  expect(heading.compareDocumentPosition(width) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(width.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(receiptRoot(el).querySelector("h1")).toBeNull();
});

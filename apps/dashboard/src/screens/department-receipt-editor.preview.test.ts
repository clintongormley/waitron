import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, reattachAfterDetachedUpdate } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { QUERY_DEPENDENCIES } from "../api/live-queries.js";
import { codeMessage } from "../i18n/codes.js";
import { PREVIEW_DELAY_MS } from "./department-receipt-editor.js";
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
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
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
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  held.resolve(preview("CURRENT"));
  await expect
    .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
    .toContain("CURRENT");
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
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
  api.liveData.invalidate([{ type: "settings.business_day" }]);
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
  api.liveData.invalidate([{ type: "settings.business_day" }]);
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
    // A keyboard user: a button shows focus, and so its mark, only after a key.
    await userEvent.keyboard("{Shift}");
    native.focus();
    await expect
      .poll(() => receiptRoot(el).querySelector(`[data-mark=${mark}]`)?.hasAttribute("data-active"))
      .toBe(true);
    receiptField(el, "previewLanguage").focus();
    await el.updateComplete;
    expect(receiptRoot(el).querySelector(`[data-mark=${mark}]`)!.hasAttribute("data-active")).toBe(
      false,
    );
    expect(receiptRoot(el).querySelector("[data-mark=operationDescription]")).toBeNull();
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  },
);
it("adding a logo with the pointer leaves focus on the logo control and draws no ring on the preview", async () => {
  const api = receiptApi();
  api.previewReceiptDraft.mockResolvedValue({
    ...preview("Printed content"),
    marks: { ...preview().marks, logo: { start: 0, end: 1 } },
  });
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector("[data-mark=logo]")).toBeTruthy();
  const upload =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["dashboard-image-upload"]>(
      "dashboard-image-upload",
    )!;
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=choose-image]")!),
  );
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeTruthy();
  upload.shadowRoot!.querySelector("media-image-picker")!.dispatchEvent(
    new CustomEvent("select-image", {
      detail: { filename: "logo.png", names: {} },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  const control = upload.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!;
  await expect.poll(() => upload.shadowRoot!.activeElement).toBe(control);
  await el.updateComplete;
  const preview_ = receiptRoot(el).querySelector<HTMLElement>("section.preview")!;
  expect(composedContains(preview_, deepActiveElement())).toBe(false);
  expect(receiptRoot(el).querySelector("[data-mark=logo]")!.hasAttribute("data-active")).toBe(
    false,
  );
  expect(preview_.tabIndex).toBe(-1);
  expect(preview_.querySelector("[tabindex]:not([tabindex='-1']), a[href], button")).toBeNull();
});
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
function composedContains(container: Node, node: Node | null): boolean {
  for (let at = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null)
    if (at === container) return true;
  return false;
}
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
it("says in words when the preview draws the venue's logo, and only then", async () => {
  const api = receiptApi();
  api.previewReceiptDraft.mockResolvedValueOnce({ ...preview(), venueLogo: true });
  const { el } = await mountReceiptEditor(api);
  const note = () => receiptRoot(el).querySelector("[data-test=venue-logo]");
  await expect.poll(() => note()?.textContent?.trim()).toBe(t("receipts.venue_logo"));
  expect(note()!.classList.contains("note")).toBe(true);
  await editReceipt(el, "email", "draft@example.com");
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(2);
  await expect.poll(() => note()).toBeNull();
  api.previewReceiptDraft.mockResolvedValueOnce({ ...preview(), venueLogo: true });
  await editReceipt(el, "email", "again@example.com");
  await expect.poll(() => note()).toBeTruthy();
  api.previewReceiptDraft.mockRejectedValueOnce({ code: "server.internal" });
  const logo = `${"a".repeat(64)}.png`;
  receiptRoot(el)
    .querySelector("dashboard-image-upload")!
    .dispatchEvent(
      new CustomEvent("image-changed", {
        detail: { image: logo },
        bubbles: true,
        composed: true,
      }),
    );
  await expect.poll(() => receiptRoot(el).querySelector(".preview [role=alert]")).toBeTruthy();
  expect(api.previewReceiptDraft.mock.lastCall![0].receipt.logo).toBe(logo);
  expect(note()).toBeNull();
  const english = t("receipts.venue_logo");
  setLocale("es-ES");
  expect(t("receipts.venue_logo")).not.toBe(english);
});
it("redraws the preview when the theme in use changes, with the draft unchanged", async () => {
  const api = receiptApi();
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("Sample");
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
  api.previewReceiptDraft.mockResolvedValueOnce({ ...preview("THEMED"), venueLogo: true });
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(2);
  expect(api.previewReceiptDraft.mock.calls[1]![0]).toEqual(
    api.previewReceiptDraft.mock.calls[0]![0],
  );
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("THEMED");
  await expect.poll(() => receiptRoot(el).querySelector("[data-test=venue-logo]")).toBeTruthy();
  expect(el.hasUnsavedChanges).toBe(false);
});
const WIDTH_TABLES = ["printers", "devices", "device_profiles"] as const;
it.each(WIDTH_TABLES)(
  "offers the widths a fresh preview names after a %s change moves them",
  async (type) => {
    const api = receiptApi();
    api.previewReceiptDraft.mockResolvedValueOnce({ ...preview(), paperWidths: ["80mm"] });
    api.getReceiptPaperWidths.mockResolvedValue({ paperWidths: ["80mm"] });
    const { el } = await mountReceiptEditor(api);
    await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
    expect(receiptRoot(el).querySelector("[name=previewWidth]")).toBeNull();
    api.getReceiptPaperWidths.mockResolvedValue({ paperWidths: ["58mm", "80mm"] });
    api.previewReceiptDraft.mockResolvedValueOnce({
      ...preview(),
      paperWidths: ["58mm", "80mm"],
    });
    api.liveData.invalidate([{ type }]);
    await expect
      .poll(() =>
        receiptRoot(el)
          .querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")
          ?.options.map((option) => option.value),
      )
      .toEqual(["58mm", "80mm"]);
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
    expect(api.previewReceiptDraft.mock.calls[1]![0]).toEqual(
      api.previewReceiptDraft.mock.calls[0]![0],
    );
    expect(el.hasUnsavedChanges).toBe(false);
  },
);
it.each(WIDTH_TABLES)(
  "asks for no new preview when a %s change leaves the offered widths as they were",
  async (type) => {
    const api = receiptApi();
    const { el } = await mountReceiptEditor(api);
    await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
    await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(1);
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
    api.liveData.invalidate([{ type }]);
    await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(2);
    await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
  },
);
it("a closed editor keeps no theme or paper-width watch, even when it closes before the receipt read answers", async () => {
  const api = receiptApi();
  const { el } = await mountReceiptEditor(api);
  const types: readonly string[] = ["custom_themes", ...QUERY_DEPENDENCIES.getReceiptPaperWidths];
  const watched = () =>
    api.liveData.interests
      .map((interest) => interest.type)
      .filter((type) => types.includes(type))
      .sort();
  await expect.poll(watched).toEqual([...types].sort());
  const held = deferred<typeof receiptModel>();
  api.getDepartmentReceipt.mockImplementationOnce(() => held.promise);
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "bar", name: "Bar" };
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  el.subject = undefined;
  await el.updateComplete;
  held.resolve(structuredClone(receiptModel));
  await held.promise;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(watched()).toEqual([]);
});
it("offers the new widths after a printer change when the opening widths read failed", async () => {
  const api = receiptApi();
  api.getReceiptPaperWidths.mockRejectedValueOnce({ code: "server.internal_error" });
  api.previewReceiptDraft.mockResolvedValueOnce({ ...preview(), paperWidths: ["80mm"] });
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
  expect(receiptRoot(el).querySelector("[name=previewWidth]")).toBeNull();
  api.getReceiptPaperWidths.mockResolvedValue({ paperWidths: ["58mm", "80mm"] });
  api.liveData.invalidate([{ type: "printers" }]);
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(2);
  await expect
    .poll(() =>
      receiptRoot(el)
        .querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")
        ?.options.map((option) => option.value),
    )
    .toEqual(["58mm", "80mm"]);
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
});
it("an unchanged widths answer leaves the opening preview in flight to be drawn", async () => {
  const api = receiptApi();
  const held = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.previewReceiptDraft.mockResolvedValue(preview("SUPERSEDING"));
  api.liveData.invalidate([{ type: "devices" }]);
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
  held.resolve(preview("CURRENT"));
  await expect
    .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
    .toContain("CURRENT");
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1);
  expect(receiptRoot(el).querySelector(".paper")?.textContent).toContain("CURRENT");
});
it("a discarded preview's widths are not taken as the ones on offer", async () => {
  const api = receiptApi();
  const opening = deferred<ReturnType<typeof preview>>();
  const fresh = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft
    .mockImplementationOnce(() => opening.promise)
    .mockImplementationOnce(() => fresh.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.getReceiptPaperWidths.mockResolvedValue({ paperWidths: ["80mm"] });
  api.liveData.invalidate([{ type: "printers" }]);
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(2);
  opening.resolve(preview("OUTDATED"));
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(2);
  api.liveData.invalidate([{ type: "devices" }]);
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(3);
  fresh.resolve({ ...preview("LATEST"), paperWidths: ["80mm"] });
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("LATEST");
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
  expect(receiptRoot(el).querySelector("[name=previewWidth]")).toBeNull();
});
it("a failed opening widths read stays shown, with Retry, after the receipt loads, and Retry clears it", async () => {
  const api = receiptApi();
  api.getReceiptPaperWidths.mockRejectedValueOnce({ code: "server.internal_error" });
  const receipt = deferred<typeof receiptModel>();
  api.getDepartmentReceipt.mockImplementationOnce(() => receipt.promise);
  const mounting = mountReceiptEditor(api);
  await expect
    .poll(() =>
      document
        .querySelector("receipt-editor-test-host")
        ?.shadowRoot?.querySelector("dashboard-department-receipt-editor")
        ?.shadowRoot?.querySelector(".error[role=alert]"),
    )
    .toBeTruthy();
  receipt.resolve(structuredClone(receiptModel));
  const { el } = await mounting;
  await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
  expect(receiptRoot(el).querySelector(".error[role=alert]")?.textContent).toBe(
    codeMessage("server.internal_error"),
  );
  const retry = Array.from(receiptRoot(el).querySelectorAll("wt-button")).find(
    (button) => button.textContent?.trim() === t("venue_settings.retry"),
  );
  expect(retry).toBeTruthy();
  await userEvent.click(page.elementLocator(retry!));
  await expect.poll(() => receiptRoot(el).querySelector(".error[role=alert]")).toBeNull();
  expect(api.getReceiptPaperWidths).toHaveBeenCalledTimes(2);
});
it("a widths read that fails after opening is shown until a later widths read answers", async () => {
  const api = receiptApi();
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
  api.getReceiptPaperWidths.mockRejectedValueOnce({ code: "server.internal_error" });
  api.liveData.invalidate([{ type: "devices" }]);
  await expect.poll(() => receiptRoot(el).querySelector(".error[role=alert]")).toBeTruthy();
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  expect(receiptRoot(el).querySelector(".error[role=alert]")).toBeTruthy();
  api.liveData.invalidate([{ type: "devices" }]);
  await expect.poll(() => receiptRoot(el).querySelector(".error[role=alert]")).toBeNull();
});
it("an error line from before the editor was taken off the page clears once its reads answer after it is put back", async () => {
  const api = receiptApi();
  api.getReceiptPaperWidths.mockRejectedValueOnce({ code: "server.internal_error" });
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector(".error[role=alert]")).toBeTruthy();
  await reattachAfterDetachedUpdate(el);
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(2);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await expect.poll(() => receiptRoot(el).querySelector(".error[role=alert]")).toBeNull();
});
it("another department's first widths answer asks for no second preview, whatever the last department offered", async () => {
  const api = receiptApi();
  api.getReceiptPaperWidths.mockResolvedValue({ paperWidths: ["80mm"] });
  api.previewReceiptDraft.mockResolvedValueOnce({ ...preview(), paperWidths: ["80mm"] });
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
  await expect.poll(() => api.getReceiptPaperWidths.mock.calls.length).toBe(1);
  const opening = deferred<ReturnType<typeof preview>>();
  const widths = deferred<{ paperWidths: ("58mm" | "80mm")[] }>();
  api.previewReceiptDraft.mockImplementationOnce(() => opening.promise);
  api.getReceiptPaperWidths.mockImplementationOnce(() => widths.promise);
  el.subject = { id: "kitchen", name: "Kitchen" };
  await expect.poll(() => api.previewReceiptDraft.mock.lastCall?.[0].departmentId).toBe("kitchen");
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
  widths.resolve({ paperWidths: ["58mm", "80mm"] });
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
  opening.resolve({ ...preview("KITCHEN"), paperWidths: ["58mm", "80mm"] });
  await expect
    .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
    .toContain("KITCHEN");
  await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS + 50));
  expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
});

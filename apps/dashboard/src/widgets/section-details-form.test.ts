import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, customSquarePixels, mountWidget } from "./test-helpers.js";
import "./section-details-form.js";
import "./option-label-form.js";
afterEach(cleanupWidgets);
it("marks the required internal name and refuses a blank submission", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    { open: true },
  );
  const save = vi.fn();
  el.addEventListener("wt-submit", save);
  const field = el.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="internalName"]',
  );
  expect(field?.required).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(field!.error).not.toBe("");
  expect(save).not.toHaveBeenCalled();
});
it("puts a Spanish translation refusal under the Spanish field and other refusals below the fields", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    {
      open: true,
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      refusal: {
        code: "menu_section.translation_required",
        params: { field: "names", language: "es" },
      },
    },
  );
  const spanish =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="names-es"]')!;
  expect(spanish.error).not.toBe("");
  el.refusal = { code: "management.request_invalid" };
  await el.updateComplete;
  const bottom = el.shadowRoot!.querySelector('[data-test="form-error"]')!;
  expect(bottom.textContent?.trim()).not.toBe("");
  expect(bottom.closest('[slot="footer"]')).toBeNull();
});
it("preserves the draft across refusals and submits all details on Enter", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    {
      open: true,
      heading: "Edit Starters",
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      value: {
        id: "s",
        internalName: "Starters",
        names: { en: "To begin", es: "Para empezar" },
        image: "photo",
        color: "#aa3300",
        members: [],
      },
    },
  );
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  const internal =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="internalName"]')!;
  internal.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: " First courses " },
      bubbles: true,
      composed: true,
    }),
  );
  el.fieldErrors = { image: "Choose another image." };
  await el.updateComplete;
  expect(internal.value).toBe(" First courses ");
  await internal.updateComplete;
  internal
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce());
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    internalName: "First courses",
    names: { en: "To begin", es: "Para empezar" },
    image: "photo",
    color: "#aa3300",
  });
});

const sectionValue = {
  id: "drinks",
  internalName: "Drinks",
  names: { en: "Something to drink", es: "Bebidas" },
  image: null as string | null,
  color: "#aabbcc" as string | null,
  members: [],
};
async function detailsForm(
  props: Partial<HTMLElementTagNameMap["dashboard-section-details-form"]> = {},
) {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    "dashboard-section-details-form",
    {
      open: true,
      heading: "Edit Drinks",
      value: sectionValue,
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      ...props,
    },
  );
  el.addEventListener("wt-cancel", () => {
    el.open = false;
  });
  return el;
}
const field = (el: HTMLElementTagNameMap["dashboard-section-details-form"], name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
const saveButton = (el: HTMLElementTagNameMap["dashboard-section-details-form"]) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
const modalOf = (el: HTMLElementTagNameMap["dashboard-section-details-form"]) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const uploadOf = (el: HTMLElementTagNameMap["dashboard-section-details-form"]) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-image-upload"]>(
    "dashboard-image-upload",
  )!;
const bottomOf = (el: HTMLElementTagNameMap["dashboard-section-details-form"]) =>
  el.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim();
function changeField(
  el: HTMLElementTagNameMap["dashboard-section-details-form"],
  name: string,
  value: string,
) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
const emit = (target: Element, name: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));

it("focuses Choose image when a refusal names the image", async () => {
  const el = await detailsForm();
  el.fieldErrors = { image: codeMessage("menu_section.invalid") };
  await el.updateComplete;
  const upload = uploadOf(el);
  await upload.updateComplete;
  await vi.waitFor(() =>
    expect(upload.shadowRoot!.activeElement).toBe(
      upload.shadowRoot!.querySelector('[data-test="choose-image"]'),
    ),
  );
  expect(
    upload.shadowRoot!.querySelector('[data-test="choose-image"]')!.getAttribute("aria-invalid"),
  ).toBe("true");
});
it("rechecks invalid name submissions, focuses the field, keeps values and resets on reopening", async () => {
  const el = await detailsForm();
  changeField(el, "internalName", " ");
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe("");
  expect(bottomOf(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  saveButton(el).click();
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(field(el, "internalName").shadowRoot!.activeElement).toBe(
      field(el, "internalName").shadowRoot!.querySelector("input"),
    ),
  );
  expect(saveButton(el).disabled).toBe(true);
  expect(field(el, "names-en").value).toBe("Something to drink");
  changeField(el, "internalName", "Drinks");
  await el.updateComplete;
  expect(bottomOf(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  changeField(el, "internalName", " ");
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe(t("sections.internal_name_required"));
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(true);
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe("");
  expect(bottomOf(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  expect(field(el, "internalName").value).toBe("Drinks");
});
it("focuses a refused field, keeps Save retryable and clears only that field on change", async () => {
  const el = await detailsForm();
  el.fieldErrors = { internalName: codeMessage("menu_section.invalid") };
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(field(el, "internalName").shadowRoot!.activeElement).toBe(
      field(el, "internalName").shadowRoot!.querySelector("input"),
    ),
  );
  expect(saveButton(el).disabled).toBe(false);
  changeField(el, "names-en", "Drinks");
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe(codeMessage("menu_section.invalid"));
  changeField(el, "internalName", "Drinks bar");
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe("");
  expect(bottomOf(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
});
it("keeps a non-field refusal retryable until the next submission", async () => {
  const el = await detailsForm();
  el.refusal = { code: "server.internal" };
  await el.updateComplete;
  expect(bottomOf(el)).toBe(codeMessage("server.internal"));
  expect(saveButton(el).disabled).toBe(false);
  changeField(el, "internalName", "Drinks bar");
  await el.updateComplete;
  expect(bottomOf(el)).toBe(codeMessage("server.internal"));
  changeField(el, "internalName", "");
  await el.updateComplete;
  saveButton(el).click();
  await el.updateComplete;
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
});
it("clears translation refusals on retry without discarding other language values", async () => {
  const el = await detailsForm();
  el.refusal = {
    code: "menu_section.translation_required",
    params: { field: "names", language: "es" },
  };
  await el.updateComplete;
  expect(field(el, "names-es").invalid).toBe(true);
  expect(field(el, "names-en").invalid).toBe(false);
  expect(field(el, "names-en").value).toBe("Something to drink");
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  saveButton(el).click();
  await el.updateComplete;
  expect(field(el, "names-es").error).toBe("");
  expect(bottomOf(el)).toBe("");
});
it("prevents duplicate save and dismissal while a save is in flight", async () => {
  const el = await detailsForm();
  const submitted = vi.fn(() => {
    el.busy = true;
  });
  el.addEventListener("wt-submit", submitted);
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modalOf(el).dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  saveButton(el).click();
  await el.updateComplete;
  expect(field(el, "internalName").disabled).toBe(true);
  expect(field(el, "names-es").disabled).toBe(true);
  emit(modalOf(el), "wt-close", {});
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modalOf(el).dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await el.updateComplete;
  expect(el.open).toBe(true);
  saveButton(el).click();
  expect(submitted).toHaveBeenCalledOnce();
  el.busy = false;
  await el.updateComplete;
  emit(modalOf(el), "wt-close", {});
  await el.updateComplete;
  expect(el.open).toBe(false);
});
it("keeps the editor open while its image picker is open and accepts its selected image", async () => {
  const el = await detailsForm();
  const upload = uploadOf(el);
  emit(upload, "image-picker-state", { open: true });
  await el.updateComplete;
  emit(modalOf(el), "wt-close", {});
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(saveButton(el).disabled).toBe(true);
  emit(upload, "image-changed", { image: "img-1" });
  emit(upload, "image-picker-state", { open: false });
  await el.updateComplete;
  expect(upload.image).toBe("img-1");
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  saveButton(el).click();
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail.image).toBe("img-1");
});
it("saves a removed image as none", async () => {
  const el = await detailsForm({ value: { ...sectionValue, image: "img-beer" } });
  const upload = uploadOf(el);
  expect(upload.image).toBe("img-beer");
  await upload.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-image"]')!.click();
  await el.updateComplete;
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  saveButton(el).click();
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail.image).toBeNull();
});
it("sets a custom colour from the native colour input", async () => {
  const el = await detailsForm();
  const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"]')!;
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await el.updateComplete;
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  saveButton(el).click();
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail.color).toBe("#123456");
});
it("draws the Custom square empty for no colour and saves none", async () => {
  const el = await detailsForm({ value: { ...sectionValue, color: null } });
  const { inside, border, borderColor, beside } = await customSquarePixels(el.shadowRoot!);
  expect(inside).not.toEqual([0, 0, 0, 255]);
  expect(inside).toEqual(beside);
  expect(border).toEqual(borderColor);
  expect(border).not.toEqual(beside);
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  saveButton(el).click();
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail.color).toBeNull();
});
it("paints the custom colour and rings it only when a colour is set", async () => {
  const el = await detailsForm();
  const custom = await customSquarePixels(el.shadowRoot!);
  expect(custom.inside).toEqual([0xaa, 0xbb, 0xcc, 255]);
  expect([custom.row[0], custom.row[1]]).toEqual([custom.ringColor, custom.ringColor]);
  cleanupWidgets();
  const other = await detailsForm({ value: { ...sectionValue, color: null } });
  const none = await customSquarePixels(other.shadowRoot!);
  expect(none.row[0]).toEqual(none.borderColor);
  expect(none.borderColor).not.toEqual(none.ringColor);
});

it.each([
  ["en-GB", "Customer-facing names", "Customer-facing name"],
  ["es-ES", "Nombres para el cliente", "Nombre para el cliente"],
])(
  "heads the names with the option window's group label, worded alike (%s)",
  async (locale, headingText, fieldLabel) => {
    setLocale(locale);
    try {
      const el = await detailsForm();
      const heading = el.shadowRoot!.querySelector<HTMLElement>(
        '[data-test="customer-names-heading"]',
      )!;
      expect(heading.textContent!.trim()).toBe(headingText);
      expect(field(el, "names-en").label).toBe(`${fieldLabel} (en)`);
      expect(field(el, "names-es").label).toBe(`${fieldLabel} (es)`);

      const { el: optionWindow } = await mountWidget<
        HTMLElementTagNameMap["dashboard-option-label-form"]
      >("dashboard-option-label-form", {
        open: true,
        value: null,
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
      });
      const optionHeading = optionWindow.shadowRoot!.querySelector<HTMLElement>(
        '[data-test="customer-names-heading"]',
      )!;
      expect(optionHeading.textContent!.trim()).toBe(headingText);
      const style = getComputedStyle(heading);
      const optionStyle = getComputedStyle(optionHeading);
      expect(style.textTransform).toBe("uppercase");
      for (const property of ["textTransform", "fontWeight", "fontSize", "color"] as const)
        expect(style[property], property).toBe(optionStyle[property]);
    } finally {
      setLocale("es-ES");
    }
  },
);
it("leaves the colour caption out of the group-label look the names heading takes", async () => {
  const el = await detailsForm();
  const heading = el.shadowRoot!.querySelector<HTMLElement>(
    '[data-test="customer-names-heading"]',
  )!;
  const caption = el.shadowRoot!.querySelector<HTMLElement>("fieldset.color legend")!;
  const headingStyle = getComputedStyle(heading);
  const captionStyle = getComputedStyle(caption);
  expect(headingStyle.textTransform).toBe("uppercase");
  expect(captionStyle.textTransform).toBe("none");
  expect(captionStyle.color).not.toBe(headingStyle.color);
  expect(captionStyle.marginBottom).not.toBe("0px");
  expect(captionStyle.marginBottom).toBe(headingStyle.marginBottom);
});

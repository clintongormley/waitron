import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { CategorySummary } from "../api/client.js";
import type { CategoryDetailsForm } from "./category-details-form.js";
import "./category-details-form.js";

afterEach(cleanupWidgets);

const drinks: CategorySummary = { id: "d", name: "Drinks", parentId: null, color: "#b12525" };

async function detailsForm(props: Partial<CategoryDetailsForm> = {}) {
  const { el } = await mountWidget<CategoryDetailsForm>("dashboard-category-details-form", {
    open: true,
    value: drinks,
    ...props,
  });
  return el;
}
const nameField = (el: CategoryDetailsForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="category-name"]',
  )!;
const saveButton = (el: CategoryDetailsForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
const bottomOf = (el: CategoryDetailsForm) =>
  el.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim();
const swatch = (el: CategoryDetailsForm, color: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-color="${color}"]`)!;
function typeName(el: CategoryDetailsForm, value: string) {
  nameField(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
function submitted(el: CategoryDetailsForm) {
  const sent: unknown[] = [];
  el.addEventListener("wt-submit", (event) => sent.push((event as CustomEvent).detail));
  return sent;
}

it("opens holding the category's name and colour, under the Edit category heading", async () => {
  const el = await detailsForm();
  expect(nameField(el).value).toBe("Drinks");
  expect(nameField(el).label).toBe(t("folders.name"));
  expect(swatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
  expect(el.shadowRoot!.querySelector("wt-modal")!.getAttribute("size")).toBe("standard");
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe(t("folders.edit_heading"));
});

it("names its inputs category-name and category-color", async () => {
  const el = await detailsForm();
  expect(nameField(el)).not.toBeNull();
  expect(el.shadowRoot!.querySelector('input[type="color"]')!.getAttribute("name")).toBe(
    "category-color",
  );
});

it("marks Name required, and a blank name is refused beside it and at the bottom, with Save disabled", async () => {
  const el = await detailsForm();
  const sent = submitted(el);
  expect(nameField(el).required).toBe(true);
  typeName(el, "   ");
  await el.updateComplete;
  saveButton(el).click();
  await el.updateComplete;
  expect(nameField(el).error).toBe(t("folders.name_required"));
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(true);
  expect(sent).toEqual([]);
  typeName(el, "Bebidas");
  await el.updateComplete;
  expect(nameField(el).error).toBe("");
  expect(bottomOf(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
});

it("sends the trimmed name and the chosen swatch on Save", async () => {
  const el = await detailsForm();
  const sent = submitted(el);
  typeName(el, "  Beverages ");
  swatch(el, "#256bb1").click();
  await el.updateComplete;
  saveButton(el).click();
  expect(sent).toEqual([{ name: "Beverages", color: "#256bb1" }]);
});

it("sends no colour when No colour is chosen", async () => {
  const el = await detailsForm();
  const sent = submitted(el);
  swatch(el, "").click();
  await el.updateComplete;
  saveButton(el).click();
  expect(sent).toEqual([{ name: "Drinks", color: null }]);
});

it("shows a refused colour under the chooser, a refused name under Name, and anything else at the end of the body", async () => {
  const el = await detailsForm({
    errors: {
      name: codeMessage("category.name_taken"),
      color: t("editor.field_rejected"),
    },
  });
  expect(nameField(el).error).toBe(codeMessage("category.name_taken"));
  expect(el.shadowRoot!.querySelector("#category-color-error")!.textContent!.trim()).toBe(
    t("editor.field_rejected"),
  );
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  el.errors = { _form: codeMessage("server.internal") };
  await el.updateComplete;
  expect(nameField(el).error).toBe("");
  expect(el.shadowRoot!.querySelector("#category-color-error")!.textContent!.trim()).toBe("");
  const bottom = el.shadowRoot!.querySelector('[data-test="form-error"]')!;
  expect(bottom.textContent!.trim()).toBe(codeMessage("server.internal"));
  expect(bottom.closest('[slot="footer"]')).toBeNull();
  const fields = el.shadowRoot!.querySelector(".fields")!;
  expect(fields.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("sends a cancel on Cancel and on Esc", async () => {
  const el = await detailsForm();
  const cancels = vi.fn();
  el.addEventListener("wt-cancel", cancels);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  expect(cancels).toHaveBeenCalledOnce();
  nameField(el).focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(cancels).toHaveBeenCalledTimes(2));
});

it("sends nothing, and cannot be dismissed, while a save is in flight", async () => {
  const el = await detailsForm({ busy: true });
  const sent = submitted(el);
  const cancels = vi.fn();
  el.addEventListener("wt-cancel", cancels);
  saveButton(el).click();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  expect(sent).toEqual([]);
  expect(cancels).not.toHaveBeenCalled();
  expect(nameField(el).disabled).toBe(true);
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  modal.shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
  await userEvent.keyboard("{Escape}");
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  expect(cancels).not.toHaveBeenCalled();
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

it("opens again holding the category it is given, with no leftover refusal", async () => {
  const el = await detailsForm();
  typeName(el, "");
  saveButton(el).click();
  await el.updateComplete;
  el.open = false;
  await el.updateComplete;
  el.value = { id: "f", name: "Food", parentId: null, color: null };
  el.open = true;
  await el.updateComplete;
  expect(nameField(el).value).toBe("Food");
  expect(nameField(el).error).toBe("");
  expect(swatch(el, "").getAttribute("aria-checked")).toBe("true");
});

it.each(["en-GB", "es-ES"])(
  "keeps the Name field and its refusal inside the dialog at 390 px (%s)",
  async (locale) => {
    const restore = {
      width: window.innerWidth,
      height: window.innerHeight,
      locale: currentLocale(),
    };
    try {
      setLocale(locale);
      await page.viewport(390, 844);
      const el = await detailsForm({ errors: { name: codeMessage("category.name_taken") } });
      const field = nameField(el);
      await field.updateComplete;
      for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
      const dialog = el
        .shadowRoot!.querySelector("wt-modal")!
        .shadowRoot!.querySelector("dialog")!
        .getBoundingClientRect();
      const error = field.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
      expect(error.textContent).toBe(codeMessage("category.name_taken"));
      for (const part of [field.shadowRoot!.querySelector("input")!, error]) {
        const { left, right } = part.getBoundingClientRect();
        expect(left).toBeGreaterThanOrEqual(dialog.left);
        expect(right).toBeLessThanOrEqual(dialog.right);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(390);
      }
      expect(error.scrollWidth).toBeLessThanOrEqual(error.clientWidth);
    } finally {
      setLocale(restore.locale);
      await page.viewport(restore.width, restore.height);
    }
  },
);

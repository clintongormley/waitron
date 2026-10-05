import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { ProductColorForm } from "./product-color-form.js";
import "./product-color-form.js";

afterEach(cleanupWidgets);

async function colorForm(props: Partial<ProductColorForm> = {}) {
  const { el } = await mountWidget<ProductColorForm>("dashboard-product-color-form", {
    open: true,
    name: "Lemonade",
    color: "#b12525",
    categoryColor: "#256bb1",
    ...props,
  });
  return el;
}
const modal = (el: ProductColorForm) => el.shadowRoot!.querySelector("wt-modal")!;
const saveButton = (el: ProductColorForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
const bottomOf = (el: ProductColorForm) =>
  el.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim();
const swatch = (el: ProductColorForm, color: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-color="${color}"]`)!;
const colorError = (el: ProductColorForm) =>
  el.shadowRoot!.querySelector("#product-color-error")!.textContent!.trim();
function submitted(el: ProductColorForm) {
  const sent: unknown[] = [];
  el.addEventListener("wt-submit", (event) => sent.push((event as CustomEvent).detail));
  return sent;
}

it.each([
  ["en-GB", "Colour of Lemonade", "Changes this product's colour on every menu that uses it."],
  [
    "es-ES",
    "Color de Lemonade",
    "Cambia el color de este producto en todas las cartas que lo usan.",
  ],
])(
  "is headed with the product's name and says the colour is the product's everywhere (%s)",
  async (locale, heading, scope) => {
    const before = currentLocale();
    try {
      setLocale(locale);
      const el = await colorForm();
      expect(modal(el).getAttribute("size")).toBe("standard");
      expect(modal(el).heading).toBe(heading);
      expect(el.shadowRoot!.querySelector('[data-test="scope"]')!.textContent!.trim()).toBe(scope);
      expect(swatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
    } finally {
      setLocale(before);
    }
  },
);

it("names its chooser product-color and offers its category's colour, with the inherited chip", async () => {
  const el = await colorForm();
  expect(el.shadowRoot!.querySelector('input[type="color"]')!.getAttribute("name")).toBe(
    "product-color",
  );
  const none = swatch(el, "");
  expect(none.querySelector("#product-color-none-label")!.textContent!.trim()).toBe(
    t("editor.color_use_category"),
  );
  expect(none.querySelector<HTMLElement>(".chip")!.style.background).toBe("rgb(37, 107, 177)");
});

it("says the category has no colour when there is none to take", async () => {
  const el = await colorForm({ categoryColor: null });
  expect(swatch(el, "").querySelector(".chip")).toBeNull();
  expect(swatch(el, "").textContent).toContain(t("editor.color_category_none"));
});

it("sends the chosen colour on Save, and null for the category's", async () => {
  const el = await colorForm();
  const sent = submitted(el);
  swatch(el, "#256bb1").click();
  await el.updateComplete;
  saveButton(el).click();
  swatch(el, "").click();
  await el.updateComplete;
  saveButton(el).click();
  expect(sent).toEqual([{ color: "#256bb1" }, { color: null }]);
});

it("shows a refused colour under the chooser, focused, and anything else at the end of the body", async () => {
  const el = await colorForm({ errors: { color: t("editor.field_rejected") } });
  expect(colorError(el)).toBe(t("editor.field_rejected"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.activeElement?.getAttribute("name")).toBe("product-color"),
  );
  expect(bottomOf(el)).toBe(t("form.fix_fields"));
  el.errors = { _form: codeMessage("server.internal") };
  await el.updateComplete;
  expect(colorError(el)).toBe("");
  const bottom = el.shadowRoot!.querySelector('[data-test="form-error"]')!;
  expect(bottom.textContent!.trim()).toBe(codeMessage("server.internal"));
  expect(bottom.closest('[slot="footer"]')).toBeNull();
  const fields = el.shadowRoot!.querySelector(".fields")!;
  expect(fields.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("clears a refused colour once another is chosen", async () => {
  const el = await colorForm({ errors: { color: t("editor.field_rejected") } });
  swatch(el, "#256bb1").click();
  await el.updateComplete;
  expect(colorError(el)).toBe("");
  expect(bottomOf(el)).toBe("");
});

it("sends a cancel on Cancel and on Esc", async () => {
  const el = await colorForm();
  const cancels = vi.fn();
  el.addEventListener("wt-cancel", cancels);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  expect(cancels).toHaveBeenCalledOnce();
  swatch(el, "#256bb1").focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(cancels).toHaveBeenCalledTimes(2));
});

it("sends nothing, and cannot be dismissed, while a save is in flight", async () => {
  const el = await colorForm({ busy: true });
  const sent = submitted(el);
  const cancels = vi.fn();
  el.addEventListener("wt-cancel", cancels);
  saveButton(el).click();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  expect(sent).toEqual([]);
  expect(cancels).not.toHaveBeenCalled();
  modal(el).shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
  await userEvent.keyboard("{Escape}");
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  expect(cancels).not.toHaveBeenCalled();
  expect(modal(el).shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

it("opens again holding the colour it is given, with no leftover choice or refusal", async () => {
  const el = await colorForm({ errors: { color: t("editor.field_rejected") } });
  swatch(el, "#256bb1").click();
  el.open = false;
  await el.updateComplete;
  el.name = "Lager";
  el.color = null;
  el.errors = {};
  el.open = true;
  await el.updateComplete;
  expect(modal(el).heading).toBe(t("product_color.heading").replace("{name}", "Lager"));
  expect(swatch(el, "").getAttribute("aria-checked")).toBe("true");
  expect(colorError(el)).toBe("");
});

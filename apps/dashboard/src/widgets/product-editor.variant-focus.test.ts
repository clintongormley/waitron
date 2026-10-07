import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const product: ProductEditorDraft = {
  id: "coffee",
  name: "Coffee",
  customerName: { en: "House coffee", es: "Café de la casa" },
  description: { en: "Freshly roasted" },
  kitchenName: "BAR",
  image: null,
  unitId: null,
  unitPrice: "9.00",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [],
  primaryCategoryId: null,
  color: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
  courseId: null,
};

function active(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

const cases = [1280, 390]
  .flatMap((width) =>
    ["add", "row", "menu"].flatMap((via) =>
      ["save", "cancel"].map((action) => ({ width, via, action })),
    ),
  )
  .flatMap((test) =>
    (["en-GB", "es-ES"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => ({ ...test, locale, theme })),
    ),
  );

it.each(cases)(
  "keeps the variant opener and scroll after $via/$action at $width px in $locale/$theme",
  async ({ width, via, action, locale, theme }) => {
    const localeBefore = currentLocale();
    setLocale(locale);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 600);
    try {
      expect(window.innerWidth).toBe(width);
      const variants =
        via === "add"
          ? []
          : [
              {
                id: "small",
                name: "Small",
                customerName: { en: "Small cup", es: "Taza pequeña" },
                kitchenName: "SM",
                image: null,
                unitPrice: "2.00",
                available: true,
                active: true,
              },
            ];
      const { el } = await mountWidget<ProductEditor>(
        "dashboard-product-editor",
        {
          open: true,
          value: { ...product, variants },
          locales: ["en", "es"],
        },
        theme,
      );
      const modal = el.shadowRoot!.querySelector("wt-modal")!;
      await modal.updateComplete;
      const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
      const table = el.shadowRoot!.querySelector("dashboard-variant-table");
      await table?.updateComplete;
      const target = () =>
        via === "add"
          ? el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!
          : table!.shadowRoot!.querySelector<HTMLElement>(
              `[data-test=${via === "row" ? "edit-row" : "actions"}-0]`,
            )!;
      target().scrollIntoView({ block: "center" });
      const before = body.scrollTop;
      expect(before).toBeGreaterThan(0);
      await userEvent.click(target());
      if (via === "menu")
        await userEvent.click(table!.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-0]")!);
      expect(body.scrollTop).toBe(before);
      const form = el.shadowRoot!.querySelector("dashboard-variant-form")!;
      await form.updateComplete;
      const child = form.shadowRoot!.querySelector("wt-modal")!;
      await child.updateComplete;
      const native = child.shadowRoot!.querySelector("dialog")!;
      const closed = new Promise((resolve) =>
        native.addEventListener("close", resolve, { once: true }),
      );
      if (action === "save") {
        const field = form.shadowRoot!.querySelector("[name=name]")!;
        await userEvent.fill(field.shadowRoot!.querySelector("input")!, "Single");
      }
      await userEvent.click(
        form.shadowRoot!.querySelector<HTMLElement>(`[data-test=variant-${action}]`)!,
      );
      await closed;
      await expect.poll(() => native.open).toBe(false);
      expect(el.currentValue.variants.map((v) => v.name)).toEqual(
        action === "save" ? ["Single"] : variants.map((v) => v.name),
      );
      expect(Math.abs(body.scrollTop - before)).toBeLessThanOrEqual(1);
      expect(active()).toBe(
        via === "row" ? target() : target().shadowRoot!.querySelector("button"),
      );
      if (via === "add" && action === "save") {
        await userEvent.keyboard("{Enter}");
        await expect.poll(() => native.open).toBe(true);
        expect(el.currentValue.variants).toHaveLength(1);
      }
    } finally {
      setLocale(localeBefore);
      await page.viewport(viewport.width, viewport.height);
    }
  },
);

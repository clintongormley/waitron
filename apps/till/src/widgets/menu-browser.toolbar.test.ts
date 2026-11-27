import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DEFAULT_HOME_ORDER } from "@waitron/shared";
import type { WtCombobox } from "@waitron/ui";
import type { TillProduct, TillZoneMenu } from "../api/menu-api.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import "./menu-browser.js";
import "./menu-switcher.js";
import "./diet-filter.js";

const locale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(locale);
  await resetPage();
});

const dish: TillProduct = {
  id: "dish",
  productId: "dish",
  menuItemId: "offer",
  menuVersionId: "version",
  name: "Soup",
  customerName: { en: "Soup" },
  kitchenName: "Soup",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
};

function menuNamed(name: string): TillZoneMenu {
  return {
    id: "menu",
    name,
    versionId: "version",
    isDefault: true,
    orderable: true,
    endedPeriodName: null,
    audience: "customer",
    structure: { members: [{ kind: "product", productId: "dish", menuItemId: "offer" }] },
    home: { shortcuts: [], order: DEFAULT_HOME_ORDER },
  };
}

/** Mounts the browser in a page `width` wide, with the screens' picker and diet filter in its toolbar. */
async function mount(width: number, name: string, lang: string) {
  setLocale(lang);
  await page.viewport(width, 800);
  const menu = menuNamed(name);
  const { el, host } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
    menu,
    products: [dish],
    store: new WorkingOrderStore(),
    hasMenuPicker: true,
  });
  host.style.width = `${width}px`;
  const switcher = Object.assign(document.createElement("till-menu-switcher"), {
    slot: "menu-picker",
    menus: [
      { id: menu.id, name, isDefault: true, orderable: true, audience: "customer" as const },
      {
        id: "other",
        name: `${name} 2`,
        isDefault: false,
        orderable: true,
        audience: "staff" as const,
      },
    ],
    selectedId: menu.id,
  });
  const filter = Object.assign(document.createElement("till-diet-filter"), { slot: "filters" });
  el.append(switcher, filter);
  await switcher.updateComplete;
  const picker = switcher.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!;
  await Promise.all([picker.updateComplete, filter.updateComplete]);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const search = el.shadowRoot!.querySelector<HTMLElement>('[data-region="search"]')!;
  return { picker, search };
}

describe("the menu toolbar", () => {
  it.each([
    ["Evening Special", "en-GB"],
    ["Especial de noche", "es-ES"],
  ])("shows the chosen menu %s in full at 320 px (%s)", async (name, lang) => {
    const { picker } = await mount(320, name, lang);
    const value = picker.shadowRoot!.querySelector<HTMLElement>(".value")!;
    expect(value.textContent!.trim()).toBe(name);
    expect(value.clientWidth).toBeGreaterThan(0);
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
  });

  it.each([390, 768])(
    "keeps the menu picker and the search on one line at %i px",
    async (width) => {
      const { picker, search } = await mount(width, "Evening Special", "en-GB");
      const pickerBox = picker.getBoundingClientRect();
      const searchBox = search.getBoundingClientRect();
      expect(Math.abs(pickerBox.bottom - searchBox.bottom)).toBeLessThanOrEqual(1);
      expect(pickerBox.right).toBeLessThanOrEqual(searchBox.left);
    },
  );
});

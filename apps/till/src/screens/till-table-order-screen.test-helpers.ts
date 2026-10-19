/** Fixtures and steps shared by the table screen's drafting and Review suites. */
import { userEvent } from "vitest/browser";
import type { TillBasket } from "../widgets/basket.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import { mountWidget, servedMenus } from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OfferedModifier, TillProduct } from "../api/client.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";

// Beer and Flan ring straight in; the Burger asks for its doneness and its extras first (Bacon
// comes preselected); Jamón is sold by weight.

export const beer: TillProduct = {
  id: "beer",
  menuItemId: "offer-beer",
  catalogueId: "menu-table",
  name: "Beer",
  customerName: { es: "Cerveza de barril" },
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
  courseId: null,
};

export const flan: TillProduct = { ...beer, id: "flan", menuItemId: "offer-flan", name: "Flan" };

const cookedList: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Doneness",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Rare",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Medium",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

const extrasList: OfferedModifier = {
  kind: "extras",
  id: "list-extras",
  name: "Extras",
  customerName: { es: "Extras carta" },
  kitchenName: "Extras KDS",
  minPicks: 0,
  maxPicks: null,
  items: [
    {
      portion: "1",
      unit: {
        name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
        hardwareUnit: null,
        id: "00000000-0000-0000-0000-000000000001",
        abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
        precision: 0,
      },
      productId: "p-bacon",
      name: "Bacon",
      customerName: { es: "Bacon carta" },
      kitchenName: "Bacon KDS",
      price: "1.00",
      vatClass: "general",
      maxQuantity: 3,
      preselected: true,
      addAllergens: null,
      suitableFor: [],
    },
  ],
};

export const burger: TillProduct = {
  ...beer,
  id: "burger",
  menuItemId: "offer-burger",
  name: "Burger",
  unitPrice: "9.50",
  offeredModifiers: [cookedList, extrasList],
};

export const jamon: TillProduct = {
  ...beer,
  id: "jamon",
  menuItemId: "offer-jamon",
  name: "Jamón",
  pricingUnit: "weight",
  unitPrice: "20.00",
};

export const products = [beer, flan, burger, jamon];

export function menuOf(
  offered: TillProduct[],
  section?: (product: TillProduct) => string | undefined,
) {
  return servedMenus(
    [{ id: "menu-table", name: "Carta", isDefault: true, versionId: "menu-table-v1" }],
    offered.map((product) => {
      const placed = section?.(product);
      return {
        id: product.menuItemId!,
        menuId: "menu-table",
        productId: product.id,
        ...(placed === undefined ? {} : { section: placed }),
      };
    }),
  );
}

export async function mount(over: Partial<TillTableOrderScreen> = {}) {
  const offered = over.products ?? products;
  return mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: offered,
    menus: menuOf(offered),
    lines: [],
    orderId: "wo-4",
    draftStore: new DraftStore(),
    ...over,
  });
}

export const browser = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
export const store = (el: TillTableOrderScreen) => el.draftStore!;
export const rows = (el: TillTableOrderScreen) =>
  store(el).lines.map(
    (line) => `${line.product.name} ×${line.quantity}${line.noMerge === true ? " apart" : ""}`,
  );

/** Taps the menu browser's tile named `name`. */
export async function tap(el: TillTableOrderScreen, name: string): Promise<void> {
  [...browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")]
    .find((tile) => tile.querySelector(".name")?.textContent === name)!
    .click();
  await el.updateComplete;
}

/** Lets a ResizeObserver see a new width and the screen render what it decided. */
export async function resized(el: TillTableOrderScreen): Promise<void> {
  for (let frame = 0; frame < 2; frame++)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await el.updateComplete;
}

export const shown = (element: Element | null) => element !== null && element.checkVisibility();

export async function openDraftLine(
  el: TillTableOrderScreen,
  index: number,
): Promise<TillModifierPicker> {
  const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review?.checkVisibility()) {
    await userEvent.click(review);
    await el.updateComplete;
  }
  const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((each) =>
    each.lineIndexes?.includes(index),
  );
  if (basket === undefined) throw new Error(`No draft basket for line ${index}`);
  await basket.updateComplete;
  const info = basket.shadowRoot!.querySelector<HTMLElement>(`[data-line-detail="${index}"]`);
  if (info === null) throw new Error(`No detail control for line ${index}`);
  await userEvent.click(info);
  await basket.updateComplete;
  const picker = basket.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");
  if (picker === null) throw new Error(`No line window for ${index}`);
  await picker.updateComplete;
  return picker;
}

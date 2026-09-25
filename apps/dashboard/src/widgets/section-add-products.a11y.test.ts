import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { SectionAddProducts } from "./section-add-products.js";
import type { CategorySummary } from "../api/client.js";

afterEach(cleanupWidgets);

const categories: CategorySummary[] = [
  {
    id: "c-drinks",
    name: { en: "Drinks", es: "Bebidas" },
    image: null,
    color: null,
    parentId: null,
  },
  {
    id: "c-beer",
    name: { en: "Beer", es: "Cerveza" },
    image: null,
    color: null,
    parentId: "c-drinks",
  },
];
const products = [
  { id: "p-lemonade", name: "Lemonade", categoryId: "c-drinks" },
  { id: "p-lager", name: "Lager", categoryId: "c-beer" },
  { id: "p-burger", name: "Burger", categoryId: null },
];

const states = ["empty", "populated", "filtered", "no-matches", "busy", "invalid"] as const;

describe.each(["light", "dark"] as const)("section add products (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<SectionAddProducts>(
      "dashboard-section-add-products",
      {
        products: state === "empty" ? [] : products,
        categories,
        inSection: ["p-lemonade"],
        onMenu: ["p-burger", "p-lemonade"],
        busy: state === "busy",
      },
      theme,
    );
    const root = el.shadowRoot!;
    if (state === "filtered" || state === "no-matches") {
      const select = root.querySelector<HTMLSelectElement>('select[name="category"]')!;
      select.value = "c-drinks";
      select.dispatchEvent(new Event("change"));
      await el.updateComplete;
    }
    if (state === "no-matches") {
      root
        .querySelector('wt-input[name="search"]')!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Burger" } }));
      await el.updateComplete;
    }
    if (state === "populated") {
      root.querySelector<HTMLInputElement>('input[value="p-lager"]')!.click();
      await el.updateComplete;
    }
    if (state === "invalid") {
      root.querySelector<HTMLElement>('[data-test="add"]')!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

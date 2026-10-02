import { afterEach, describe, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { SectionAddProducts } from "./section-add-products.js";
import type { CategorySummary } from "../api/client.js";

afterEach(cleanupWidgets);

const categories: CategorySummary[] = [
  {
    id: "c-drinks",
    name: "Drinks",
    parentId: null,
  },
  {
    id: "c-beer",
    name: "Beer",
    parentId: "c-drinks",
  },
];
const products = [
  { id: "p-lemonade", name: "Lemonade", categoryId: "c-drinks" },
  { id: "p-lager", name: "Lager", categoryId: "c-beer" },
  { id: "p-burger", name: "Burger", categoryId: null },
];

const states = [
  "empty",
  "populated",
  "filtered",
  "no-matches",
  "busy",
  "invalid",
  "all-in-section",
] as const;

describe.each(["light", "dark"] as const)("section add products (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<SectionAddProducts>(
      "dashboard-section-add-products",
      {
        products: state === "empty" ? [] : products,
        categories,
        inSection: state === "all-in-section" ? products.map(({ id }) => id) : ["p-lemonade"],
        onMenu: ["p-burger", "p-lemonade"],
        busy: state === "busy",
      },
      theme,
    );
    const root = el.shadowRoot!;
    if (state === "filtered" || state === "no-matches") {
      await chooseOption(root.querySelector('wt-combobox[name="category"]')!, "c-drinks");
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

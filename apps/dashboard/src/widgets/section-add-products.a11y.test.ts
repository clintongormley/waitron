import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
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
    color: null,
  },
  {
    id: "c-beer",
    name: "Beer",
    parentId: "c-drinks",
    color: null,
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
  "mixed",
  "all-listed",
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
    const header = root.querySelector<HTMLInputElement>('[data-test="select-listed"]');
    if (state === "mixed") {
      root.querySelector<HTMLInputElement>('input[value="p-lager"]')!.click();
      await el.updateComplete;
      expect(header!.indeterminate).toBe(true);
    }
    if (state === "all-listed") {
      header!.click();
      await el.updateComplete;
      expect(header!.checked).toBe(true);
    }
    if (state === "no-matches" || state === "busy") expect(header!.disabled).toBe(true);
    if (state === "invalid") {
      root.querySelector<HTMLInputElement>('input[value="p-lager"]')!.click();
      el.inSection = ["p-lemonade", "p-lager"];
      await el.updateComplete;
      root.querySelector<HTMLElement>('[data-test="add"]')!.click();
      await el.updateComplete;
      expect(root.querySelector('[data-test="error"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});

/** What Add looks like and whether a person can press it: the host's state and its inner button's. */
async function addState(el: SectionAddProducts) {
  await el.updateComplete;
  const add =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
  await add.updateComplete;
  return {
    variant: add.variant,
    disabled: add.disabled,
    innerDisabled: add.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

describe.each(["light", "dark"] as const)("section add products Add states (%s)", (theme) => {
  const mount = () =>
    mountWidget<SectionAddProducts>(
      "dashboard-section-add-products",
      { products, categories, inSection: [], onMenu: ["p-burger"] },
      theme,
    );

  it("is accessible with Add quiet", async () => {
    const { el, host } = await mount();
    expect(await addState(el)).toEqual(quiet);
    await expectNoA11yViolations(host);
  });

  it("is accessible with Add primary after a tick", async () => {
    const { el, host } = await mount();
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector('input[value="p-lager"]')!),
    );
    expect(await addState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});

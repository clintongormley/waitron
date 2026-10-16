import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ProductNutritionPicker } from "./product-nutrition-picker.js";
import {
  applyNutritionChange,
  type NutritionChange,
  type NutritionValue,
} from "./product-nutrition.js";
import type { InheritedValues } from "@waitron/catalogue/src/product-types.js";

registerIcons(DASHBOARD_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const inherited: InheritedValues = {
  name: "Bread $& <large>",
  unitPrice: "3.00",
  vatClass: "reduced",
  unitId: null,
  primaryCategoryId: null,
  courseId: null,
  description: null,
  image: null,
  allergens: { gluten: { kinds: ["barley"] }, nuts: { kinds: ["almonds"] } },
  dietaryDeclarations: ["vegan"],
};
async function mount(
  value: NutritionValue = { allergens: null, dietaryDeclarations: [] },
  props: Partial<ProductNutritionPicker> = {},
) {
  const { el } = await mountWidget<ProductNutritionPicker>("dashboard-product-nutrition-picker", {
    value,
    ...props,
  });
  const changes: NutritionChange[] = [];
  el.addEventListener("wt-nutrition-change", (event) => {
    const change = (event as CustomEvent<NutritionChange>).detail;
    changes.push(change);
    el.value = applyNutritionChange(el.value, change);
  });
  return { el, changes };
}
function chip(el: ProductNutritionPicker, choice: string) {
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`);
  expect(button, choice).not.toBeNull();
  return button!;
}
async function click(el: ProductNutritionPicker, choice: string) {
  await userEvent.click(chip(el, choice));
  await el.updateComplete;
}

it("distinguishes untouched allergens from explicit None and emits only the edited field", async () => {
  const { el, changes } = await mount();
  expect(chip(el, "none").getAttribute("aria-pressed")).toBe("false");
  expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')).toBeNull();
  await click(el, "none");
  expect(changes).toEqual([{ field: "allergens", value: {} }]);
  expect(chip(el, "none").getAttribute("aria-pressed")).toBe("true");
  await click(el, "allergen-milk");
  expect(changes.at(-1)).toEqual({ field: "allergens", value: { milk: {} } });
  expect(chip(el, "none").getAttribute("aria-pressed")).toBe("false");
  await click(el, "none");
  expect(el.value.allergens).toEqual({});
  await click(el, "none");
  expect(el.value.allergens).toBeNull();
});

it("offers all fourteen named icons and returns to unreviewed after removing the last allergen", async () => {
  const { el } = await mount();
  const codes = [
    "gluten",
    "crustaceans",
    "eggs",
    "fish",
    "peanuts",
    "soybeans",
    "milk",
    "nuts",
    "celery",
    "mustard",
    "sesame",
    "sulphites",
    "lupin",
    "molluscs",
  ];
  for (const code of codes) {
    const button = chip(el, `allergen-${code}`);
    expect(button.textContent!.trim()).not.toBe("");
    expect(button.querySelector("wt-icon")!.name).toBe(`allergen-${code}`);
  }
  await click(el, "allergen-eggs");
  await click(el, "allergen-eggs");
  expect(el.value.allergens).toBeNull();
});

it("requires explicit cereal and nut kinds, keeps them separate and clears removed codes", async () => {
  const { el, changes } = await mount();
  await click(el, "allergen-gluten");
  expect(changes.at(-1)).toEqual({ field: "allergens", value: { gluten: {} } });
  const cerealChoices = ["wheat", "rye", "barley", "oats", "spelt", "kamut"];
  for (const kind of cerealChoices)
    expect(chip(el, `kind-gluten-${kind}`).getAttribute("aria-pressed")).toBe("false");
  await click(el, "kind-gluten-wheat");
  await click(el, "kind-gluten-barley");
  await click(el, "allergen-nuts");
  const nutChoices = [
    "almonds",
    "hazelnuts",
    "walnuts",
    "cashews",
    "pecans",
    "brazil_nuts",
    "pistachios",
    "macadamia",
  ];
  for (const kind of nutChoices)
    expect(chip(el, `kind-nuts-${kind}`).getAttribute("aria-pressed")).toBe("false");
  await click(el, "kind-nuts-walnuts");
  expect(el.value.allergens).toEqual({
    gluten: { kinds: ["wheat", "barley"] },
    nuts: { kinds: ["walnuts"] },
  });
  await click(el, "allergen-gluten");
  await click(el, "allergen-gluten");
  expect(el.value.allergens).toEqual({ nuts: { kinds: ["walnuts"] }, gluten: {} });
  await click(el, "none");
  expect(el.value.allergens).toEqual({});
  expect(el.shadowRoot!.querySelector('[data-field="allergens-gluten"]')).toBeNull();
});

it("previews inherited kinds read-only and replaces the parent's entire set on an own choice", async () => {
  const { el, changes } = await mount(
    { allergens: null, dietaryDeclarations: null },
    { inherited },
  );
  expect(chip(el, "same-as").textContent).toContain("Bread $& <large>");
  expect(chip(el, "same-as").getAttribute("aria-pressed")).toBe("true");
  expect(chip(el, "allergen-gluten").disabled).toBe(true);
  expect(getComputedStyle(chip(el, "allergen-gluten")).fontStyle).toBe("italic");
  expect(chip(el, "kind-gluten-barley").getAttribute("aria-pressed")).toBe("true");
  expect(chip(el, "kind-gluten-barley").disabled).toBe(true);
  chip(el, "allergen-gluten").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(changes).toEqual([]);
  await click(el, "allergen-eggs");
  expect(el.value).toEqual({ allergens: { eggs: {} }, dietaryDeclarations: null });
  await click(el, "same-as");
  expect(el.value.allergens).toBeNull();
  await click(el, "none");
  expect(el.value.allergens).toEqual({});
  await click(el, "allergen-gluten");
  await click(el, "kind-gluten-wheat");
  expect(el.value.allergens).toEqual({ gluten: { kinds: ["wheat"] } });
});

it("shows inherited None and unreviewed status distinctly", async () => {
  setLocale("en");
  const { el } = await mount(
    { allergens: null, dietaryDeclarations: null },
    { inherited: { ...inherited, allergens: null } },
  );
  expect(el.shadowRoot!.querySelector('[data-test="inherited-status"]')!.textContent).toBe(
    "Not yet reviewed",
  );
  el.inherited = { ...inherited, allergens: {} };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="inherited-status"]')!.textContent).toBe("None");
  expect(chip(el, "same-as").getAttribute("aria-pressed")).toBe("true");
  expect(chip(el, "none").getAttribute("aria-pressed")).toBe("false");
});

it("shows vegan implications as quiet noneditable ticks without saving them", async () => {
  setLocale("en");
  const { el, changes } = await mount();
  await click(el, "diet-vegan");
  expect(changes).toEqual([{ field: "dietaryDeclarations", value: ["vegan"] }]);
  for (const label of ["vegetarian", "no_meat", "no_fish"]) {
    const button = chip(el, `diet-${label}`);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("· from Vegan");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  expect(changes).toHaveLength(1);
  await click(el, "diet-vegan");
  expect(el.value).toEqual({ allergens: null, dietaryDeclarations: [] });
});

it("retains an explicit vegetarian declaration when Vegan is removed", async () => {
  const { el } = await mount({ allergens: {}, dietaryDeclarations: ["vegan", "vegetarian"] });
  expect(chip(el, "diet-vegetarian").disabled).toBe(true);
  await click(el, "diet-vegan");
  expect(el.value.dietaryDeclarations).toEqual(["vegetarian"]);
  expect(chip(el, "diet-vegetarian").disabled).toBe(false);
  expect(chip(el, "diet-no_meat").getAttribute("aria-pressed")).toBe("true");
});

it("authors an own diet independently and restores dietary inheritance when its last choice is removed", async () => {
  const { el } = await mount({ allergens: null, dietaryDeclarations: null }, { inherited });
  expect(getComputedStyle(chip(el, "diet-vegan")).fontStyle).toBe("italic");
  await click(el, "diet-halal");
  expect(el.value).toEqual({ allergens: null, dietaryDeclarations: ["halal"] });
  await click(el, "diet-halal");
  expect(el.value).toEqual({ allergens: null, dietaryDeclarations: null });
});

it("disables rendered controls and handler activation while busy", async () => {
  const { el, changes } = await mount(
    { allergens: { gluten: {} }, dietaryDeclarations: ["vegan"] },
    { busy: true },
  );
  const buttons = [...el.shadowRoot!.querySelectorAll("button")];
  expect(buttons.length).toBeGreaterThan(20);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  for (const button of buttons) button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(changes).toEqual([]);
});

it("toggles chips with native Enter and Space without emitting inner control events", async () => {
  const { el, changes } = await mount();
  const inner: Event[] = [];
  el.addEventListener("wt-change", (event) => inner.push(event));
  chip(el, "allergen-milk").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.value.allergens).toEqual({ milk: {} });
  await userEvent.keyboard(" ");
  await el.updateComplete;
  expect(el.value.allergens).toBeNull();
  expect(changes).toHaveLength(2);
  expect(inner).toEqual([]);
});

it("places each kind row directly beneath its allergen before the next allergen", async () => {
  const { el } = await mount({
    allergens: { gluten: { kinds: ["wheat"] }, nuts: { kinds: ["walnuts"] } },
    dietaryDeclarations: [],
  });
  for (const [code, next] of [
    ["gluten", "crustaceans"],
    ["nuts", "celery"],
  ]) {
    const row = el.shadowRoot!.querySelector<HTMLElement>(`[data-field="allergens-${code}"]`)!;
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      chip(el, `allergen-${code}`).getBoundingClientRect().bottom,
    );
    expect(chip(el, `allergen-${next}`).getBoundingClientRect().top).toBeGreaterThanOrEqual(
      row.getBoundingClientRect().bottom,
    );
  }
});

it("ignores a stale kind control after its own declaration is cleared", async () => {
  const { el, changes } = await mount({
    allergens: { gluten: { kinds: ["wheat"] } },
    dietaryDeclarations: [],
  });
  const old = chip(el, "kind-gluten-wheat");
  el.value = { allergens: null, dietaryDeclarations: [] };
  old.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await el.updateComplete;
  expect(changes).toEqual([]);
  expect(el.value.allergens).toBeNull();
});

it("keeps an allergen incomplete after its last kind is unticked", async () => {
  const { el } = await mount({
    allergens: { gluten: { kinds: ["wheat"] } },
    dietaryDeclarations: [],
  });
  await click(el, "kind-gluten-wheat");
  expect(el.value.allergens).toEqual({ gluten: { kinds: [] } });
  expect(chip(el, "allergen-gluten").getAttribute("aria-pressed")).toBe("true");
  expect(chip(el, "none").getAttribute("aria-pressed")).toBe("false");
});

it("locks stored explicit diet labels while another chosen label implies them", async () => {
  const { el, changes } = await mount({
    allergens: null,
    dietaryDeclarations: ["vegan", "vegetarian", "no_meat"],
  });
  for (const label of ["vegetarian", "no_meat", "no_fish"]) {
    const button = chip(el, `diet-${label}`);
    expect(button.disabled, label).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  expect(changes).toEqual([]);
  expect(el.value.dietaryDeclarations).toEqual(["vegan", "vegetarian", "no_meat"]);
  await click(el, "diet-vegan");
  expect(el.value.dietaryDeclarations).toEqual(["vegetarian", "no_meat"]);
  expect(chip(el, "diet-vegetarian").disabled).toBe(false);
  expect(chip(el, "diet-no_meat").disabled).toBe(true);
});

it("locks an earlier explicit diet when a later choice starts implying it", async () => {
  const { el, changes } = await mount();
  await click(el, "diet-no_meat");
  await click(el, "diet-vegetarian");
  expect(chip(el, "diet-no_meat").disabled).toBe(true);
  expect(chip(el, "diet-no_fish").disabled).toBe(true);
  chip(el, "diet-no_meat").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(changes).toHaveLength(2);
  expect(el.value.dietaryDeclarations).toEqual(["vegetarian", "no_meat"]);
  await click(el, "diet-vegetarian");
  expect(el.value.dietaryDeclarations).toEqual(["no_meat"]);
  expect(chip(el, "diet-no_meat").disabled).toBe(false);
});

it("lets a variant choose its own Vegetarian diet while its parent is Vegan", async () => {
  const { el, changes } = await mount(
    { allergens: null, dietaryDeclarations: null },
    { inherited },
  );
  expect(chip(el, "diet-vegetarian").disabled).toBe(false);
  await click(el, "diet-vegetarian");
  expect(changes).toEqual([{ field: "dietaryDeclarations", value: ["vegetarian"] }]);
  expect(el.value).toEqual({ allergens: null, dietaryDeclarations: ["vegetarian"] });
  expect(inherited.dietaryDeclarations).toEqual(["vegan"]);
  expect(chip(el, "diet-vegan").getAttribute("aria-pressed")).toBe("false");
  expect(chip(el, "diet-no_meat").disabled).toBe(true);
});

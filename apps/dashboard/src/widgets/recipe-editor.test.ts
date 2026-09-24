import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-recipe-editor` so `mountWidget` can create it.
import { RecipeEditor, type SaveRecipeDetail } from "./recipe-editor.js";
import type { Ingredient, Product } from "../api/client.js";

afterEach(cleanupWidgets);

const INGREDIENTS: Ingredient[] = [
  {
    id: "i1",
    name: "Harina de trigo",
    allergens: { gluten: { presence: "contains" } },
    dietaryOrigin: null,
    active: true,
  },
  { id: "i2", name: "Sal", allergens: {}, dietaryOrigin: null, active: true },
  {
    id: "i3",
    name: "Leche entera",
    allergens: { milk: { presence: "contains" } },
    dietaryOrigin: "dairy",
    active: true,
  },
];

const PRODUCT: Product = {
  id: "prod-1",
  modifiers: [],
  catalogueId: "cat-1",
  categoryId: null,
  categoryIds: [],
  primaryCategoryId: null,
  name: "Bizcocho",
  customerName: { es: "Bizcocho de la abuela" },
  unitId: "u1",
  unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "3.50",
  vatClass: "reduced",
  active: true,
  available: true,
  soldAlone: true,
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
  variants: [],
};

function baseProps(overrides: Partial<RecipeEditor> = {}): Partial<RecipeEditor> {
  return { product: PRODUCT, ingredients: INGREDIENTS, ...overrides };
}

function switchFor(el: RecipeEditor, id: string): HTMLElement & { checked: boolean } {
  return el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(`[data-test=ing-${id}]`)!;
}

async function setSwitch(el: RecipeEditor, id: string, checked: boolean): Promise<void> {
  switchFor(el, id).dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

function confirm(el: RecipeEditor): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}

function cancel(el: RecipeEditor): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}

function nextEvent<T>(el: RecipeEditor, type: string): Promise<CustomEvent<T>> {
  return new Promise((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }),
  );
}

describe("recipe-editor", () => {
  it("pre-checks the switch for an ingredient already in the recipe", async () => {
    const { el } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      baseProps({ recipe: [INGREDIENTS[0]] }),
    );
    expect(switchFor(el, "i1").checked).toBe(true);
    expect(switchFor(el, "i2").checked).toBe(false);
    expect(switchFor(el, "i3").checked).toBe(false);
  });

  it("emits save-recipe with the pre-checked and the newly toggled ingredient ids", async () => {
    const { el } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      baseProps({ recipe: [INGREDIENTS[0]] }),
    );
    await setSwitch(el, "i2", true);
    const saved = nextEvent<SaveRecipeDetail>(el, "save-recipe");
    confirm(el);
    expect((await saved).detail).toEqual({ productId: "prod-1", ingredientIds: ["i1", "i2"] });
  });

  it("emits an empty ingredientIds when every switch is unchecked", async () => {
    const { el } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      baseProps({ recipe: [INGREDIENTS[0]] }),
    );
    await setSwitch(el, "i1", false);
    const saved = nextEvent<SaveRecipeDetail>(el, "save-recipe");
    confirm(el);
    expect((await saved).detail).toEqual({ productId: "prod-1", ingredientIds: [] });
  });

  it("reseeds the checked switches when the recipe property changes", async () => {
    const { el } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      baseProps({ recipe: [INGREDIENTS[0]] }),
    );
    expect(switchFor(el, "i1").checked).toBe(true);
    el.recipe = [INGREDIENTS[1]];
    await el.updateComplete;
    expect(switchFor(el, "i1").checked).toBe(false);
    expect(switchFor(el, "i2").checked).toBe(true);
  });

  it("emits save-recipe as a bubbling, composed event", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", baseProps());
    const seen = nextEvent(el, "save-recipe");
    confirm(el);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("emits a bubbling, composed wt-close on cancel", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", baseProps());
    const closed = nextEvent(el, "wt-close");
    cancel(el);
    const event = await closed;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("ignores a confirm while busy (single-flight)", async () => {
    const { el } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      baseProps({ recipe: [INGREDIENTS[0]], busy: true }),
    );
    let fired = false;
    el.addEventListener("save-recipe", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  it("renders nothing when no product is selected", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", {
      product: null,
      ingredients: INGREDIENTS,
    });
    expect(el.shadowRoot!.querySelector("[data-test=ing-i1]")).toBe(null);
    expect(el.shadowRoot!.querySelector("[data-test=confirm]")).toBe(null);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-recipe-editor` so `mountWidget` can create it.
import { RecipeEditor, type SaveRecipeDetail } from "./recipe-editor.js";
import type { Ingredient, Product } from "../api/client.js";

afterEach(cleanupWidgets);

/** Three available ingredients — one switch each; ids drive the `ing-${id}` data-test. */
const INGREDIENTS: Ingredient[] = [
  {
    id: "i1",
    name: "Harina de trigo",
    allergens: { gluten: { presence: "contains" } },
    active: true,
  },
  { id: "i2", name: "Sal", allergens: {}, active: true },
  { id: "i3", name: "Leche entera", allergens: { milk: { presence: "contains" } }, active: true },
];

/** A minimal but complete product; the editor only reads its `id`. */
const PRODUCT: Product = {
  id: "prod-1",
  catalogueId: "cat-1",
  categoryId: null,
  descriptions: { es: "Bizcocho" },
  pricingUnit: "each",
  unitPrice: "3.50",
  vatClass: "reduced",
  active: true,
  allergens: null,
  manualAllergens: null,
  image: null,
};

/** The base props every mount needs: a chosen product and the full ingredient list. */
function baseProps(overrides: Partial<RecipeEditor> = {}): Partial<RecipeEditor> {
  return { product: PRODUCT, ingredients: INGREDIENTS, ...overrides };
}

/** The wt-switch for an ingredient id, by its `ing-${id}` data-test. */
function switchFor(el: RecipeEditor, id: string): HTMLElement & { checked: boolean } {
  return el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(`[data-test=ing-${id}]`)!;
}

/** Flip a wt-switch by its ingredient id, via the composed `wt-change` it dispatches. */
async function setSwitch(el: RecipeEditor, id: string, checked: boolean): Promise<void> {
  switchFor(el, id).dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

/** Click the primary confirm (save) control. */
function confirm(el: RecipeEditor): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}

/** Click the cancel control. */
function cancel(el: RecipeEditor): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}

/** Resolve with the next event of `type` dispatched from the editor host. */
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

  // The whole compose round-trip: ingredient #1 is already in the recipe; toggle #2 on; confirm. The
  // emitted set is the FULL recipe (seeded ids first, insertion order), not just the delta.
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

  // Unchecking every seeded ingredient emits an EMPTY set — `setProductRecipe` replaces the recipe with
  // exactly these lines, so an empty array clears it (a removal, not a no-op).
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

  // A recipe change reseeds `checked` — the screen swaps `recipe` when the operator picks another
  // product, and the switches must follow. (A mere toggle does NOT reseed; that is the willUpdate guard.)
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

  // save-recipe must cross this widget's shadow boundary to reach the recipe screen, so it is dispatched
  // bubbles+composed.
  it("emits save-recipe as a bubbling, composed event", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", baseProps());
    const seen = nextEvent(el, "save-recipe");
    confirm(el);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // Cancel asks the screen to close the editor with a bubbling, composed `wt-close` — the same event a
  // wt-dialog close emits, so the screen hears one close event whichever primitive an editor uses.
  it("emits a bubbling, composed wt-close on cancel", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", baseProps());
    const closed = nextEvent(el, "wt-close");
    cancel(el);
    const event = await closed;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // Single-flight: while a save round-trips the screen sets `busy`, and a second confirm is ignored (the
  // write is not server-idempotent) — the sibling widgets' guard shape.
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

  // With no product chosen the editor renders nothing — the screen shows it only once a product is
  // selected.
  it("renders nothing when no product is selected", async () => {
    const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", {
      product: null,
      ingredients: INGREDIENTS,
    });
    expect(el.shadowRoot!.querySelector("[data-test=ing-i1]")).toBe(null);
    expect(el.shadowRoot!.querySelector("[data-test=confirm]")).toBe(null);
  });
});

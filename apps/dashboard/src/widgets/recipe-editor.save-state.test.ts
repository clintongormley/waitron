import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { RecipeEditor } from "./recipe-editor.js";
import "./recipe-editor.js";
import type { RecipeScreen } from "../screens/recipe-screen.js";
import "../screens/recipe-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  Ingredient,
  Product,
  RecipeLine,
} from "../api/client.js";

afterEach(cleanupWidgets);

const INGREDIENTS: Ingredient[] = [
  { id: "i1", name: "Harina de trigo", allergens: {}, dietaryOrigin: null, active: true },
  { id: "i2", name: "Sal", allergens: {}, dietaryOrigin: null, active: true },
  { id: "i3", name: "Leche entera", allergens: {}, dietaryOrigin: "dairy", active: true },
];

const PRODUCT: Product = {
  id: "prod-1",
  modifiers: [],
  catalogueId: "cat-1",
  categoryId: null,
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
  ordering: "public",
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
  color: null,
  variants: [],
};

// Two of the three ingredients already in the recipe, so both switch states are on screen.
const STORED: RecipeLine[] = [INGREDIENTS[0]!, INGREDIENTS[2]!];

async function mount(): Promise<RecipeEditor> {
  const { el } = await mountWidget<RecipeEditor>("dashboard-recipe-editor", {
    product: PRODUCT,
    ingredients: INGREDIENTS,
    recipe: STORED,
  });
  return el;
}
function saveButton(el: RecipeEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: RecipeEditor) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: RecipeEditor) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
/** A real pointer press on an ingredient switch's label. */
async function flip(el: RecipeEditor, id: string) {
  const toggle = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=ing-${id}]`,
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  await el.updateComplete;
}
function saves(el: RecipeEditor) {
  const save = vi.fn();
  el.addEventListener("save-recipe", save);
  return save;
}
function checkedIds(el: RecipeEditor): string[] {
  return INGREDIENTS.map(({ id }) => id).filter(
    (id) =>
      el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(`[data-test=ing-${id}]`)!
        .checked,
  );
}

it("a stored recipe opens with Save quiet and disabled, and an untouched press saves nothing", async () => {
  const el = await mount();
  const save = saves(el);
  expect(checkedIds(el)).toEqual(["i1", "i3"]);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(save).not.toHaveBeenCalled();
});

it("one switch flipped makes Save primary and enabled, and flipping it back makes it quiet", async () => {
  const el = await mount();
  await flip(el, "i2");
  expect(await saveState(el)).toEqual(ready);
  await flip(el, "i2");
  expect(await saveState(el)).toEqual(quiet);
});

it("a changed recipe's press sends what is ticked", async () => {
  const el = await mount();
  const save = saves(el);
  await flip(el, "i1");
  await press(el);
  expect(save).toHaveBeenCalledOnce();
  expect((save.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    productId: "prod-1",
    ingredientIds: ["i3"],
  });
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched recipe saves nothing", async () => {
  const el = await mount();
  const save = saves(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(save).not.toHaveBeenCalled();
});

it("a fetched recipe does not overwrite a changed draft", async () => {
  const el = await mount();
  await flip(el, "i2");
  el.recipe = [INGREDIENTS[1]!];
  await el.updateComplete;
  expect(checkedIds(el)).toEqual(["i1", "i2", "i3"]);
  expect(await saveState(el)).toEqual(ready);
});

it("after a save on the recipe screen the editor stays open with Save quiet again", async () => {
  const catalogues: CatalogueSummary[] = [
    { id: "cat-1", name: "Comida", active: true, version: 1 },
  ];
  let stored: RecipeLine[] = STORED;
  const api = {
    listIngredients: vi.fn().mockResolvedValue(INGREDIENTS),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listProducts: vi.fn().mockResolvedValue([PRODUCT]),
    getProductRecipe: vi.fn(async () => stored),
    setProductRecipe: vi.fn(async (_productId: string, ids: string[]) => {
      stored = INGREDIENTS.filter(({ id }) => ids.includes(id));
    }),
  } as unknown as DashboardApi;
  const { el: screen } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=recipe-catalogue-select]"))
    .toBeTruthy();
  await chooseOption(
    screen.shadowRoot!.querySelector("[data-test=recipe-catalogue-select]")!,
    "cat-1",
  );
  await expect.poll(() => api.listProducts).toHaveBeenCalled();
  await screen.updateComplete;
  await chooseOption(
    screen.shadowRoot!.querySelector("[data-test=recipe-product-select]")!,
    "prod-1",
  );
  await expect.poll(() => screen.shadowRoot!.querySelector("dashboard-recipe-editor")).toBeTruthy();
  const el = screen.shadowRoot!.querySelector("dashboard-recipe-editor")!;
  await expect.poll(() => checkedIds(el)).toEqual(["i1", "i3"]);
  expect(await saveState(el)).toEqual(quiet);
  await flip(el, "i2");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  await expect.poll(() => api.setProductRecipe).toHaveBeenCalledWith("prod-1", ["i1", "i3", "i2"]);
  await expect.poll(() => vi.mocked(api.getProductRecipe).mock.calls.length).toBe(2);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("dashboard-recipe-editor")).toBe(el);
  expect(checkedIds(el)).toEqual(["i1", "i2", "i3"]);
  expect(await saveState(el)).toEqual(quiet);
});

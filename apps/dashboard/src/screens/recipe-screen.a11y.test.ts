import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./recipe-screen.js";
import type { RecipeScreen } from "./recipe-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  Ingredient,
  Product,
  RecipeLine,
} from "../api/client.js";

/**
 * The recipe screen scanned by axe in both themes, driven to its FULLEST surface: mounted by ASSIGNING
 * the `api` stub as a property (the screen loads ingredients + catalogues on connect, so the stub must
 * resolve them or a stray rejection pollutes the run), then a catalogue and a product are chosen so the
 * catalogue picker, the product picker AND the recipe editor (with its ingredient switches, one
 * pre-checked) all render. The ingredient form is left CLOSED (its default), so its dialog renders
 * nothing to the a11y tree (it is scanned in `ingredient-form.a11y.test.ts`). axe is run against the
 * themed host so a color-contrast check means what it means in the app.
 */
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

const CATALOGUES: CatalogueSummary[] = [{ id: "cat-a", name: "Comida", active: true, version: 1 }];

const PRODUCTS: Product[] = [
  {
    id: "p1",
    catalogueId: "cat-a",
    categoryId: null,
    descriptions: { es: "Bizcocho" },
    pricingUnit: "each",
    unitPrice: "3.50",
    vatClass: "reduced",
    active: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
  },
];

const RECIPE: RecipeLine[] = [INGREDIENTS[0]!];

function stubApi(): DashboardApi {
  return {
    listIngredients: vi.fn().mockResolvedValue(INGREDIENTS),
    listCatalogues: vi.fn().mockResolvedValue(CATALOGUES),
    listProducts: vi.fn().mockResolvedValue(PRODUCTS),
    getProductRecipe: vi.fn().mockResolvedValue(RECIPE),
    setProductRecipe: vi.fn().mockResolvedValue(undefined),
    createIngredient: vi.fn().mockResolvedValue(INGREDIENTS[0]),
    updateIngredient: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: RecipeScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function selectValue(el: RecipeScreen, testId: string, value: string): void {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${testId}]`)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("recipe-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a catalogue, a product and its recipe open", async () => {
    const { el, host } = await mountWidget<RecipeScreen>(
      "dashboard-recipe-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);
    selectValue(el, "recipe-product-select", "p1");
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  CatalogueSummary,
  DashboardApi,
  Ingredient,
  Product,
  RecipeLine,
} from "../api/client.js";
import type { IngredientList } from "../widgets/ingredient-list.js";
import type { IngredientForm } from "../widgets/ingredient-form.js";
import type { RecipeEditor } from "../widgets/recipe-editor.js";
import { RecipeScreen } from "./recipe-screen.js";

const ingredients: Ingredient[] = [
  {
    id: "i1",
    name: "Harina de trigo",
    allergens: { gluten: { presence: "contains" } },
    active: true,
  },
  { id: "i2", name: "Sal", allergens: {}, active: true },
];

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];

const products: Product[] = [
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
    manualAllergens: null,
    image: null,
  },
];

const recipe: RecipeLine[] = [ingredients[0]!];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listIngredients: vi.fn().mockResolvedValue(ingredients),
    createIngredient: vi.fn().mockResolvedValue({ ...ingredients[0], id: "i-new" }),
    updateIngredient: vi.fn().mockResolvedValue(undefined),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listProducts: vi.fn().mockResolvedValue(products),
    getProductRecipe: vi.fn().mockResolvedValue(recipe),
    setProductRecipe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight fetches and the follow-up render. */
async function flush(el: RecipeScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const list = (el: RecipeScreen): IngredientList =>
  el.shadowRoot!.querySelector("dashboard-ingredient-list")!;
const form = (el: RecipeScreen): IngredientForm =>
  el.shadowRoot!.querySelector("dashboard-ingredient-form")!;
const editor = (el: RecipeScreen): RecipeEditor =>
  el.shadowRoot!.querySelector("dashboard-recipe-editor")!;
const errorKey = (el: RecipeScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

/** Fire a child widget's composed event, exactly as the real widget dispatches it. */
function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** Set a native <select>'s value and fire its change event, as the browser would. */
function selectValue(el: RecipeScreen, testId: string, value: string): void {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${testId}]`)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Select a catalogue, then a product, settling the recipe load — the editor's precondition. */
async function chooseProduct(el: RecipeScreen): Promise<void> {
  selectValue(el, "recipe-catalogue-select", "cat-a");
  await flush(el);
  selectValue(el, "recipe-product-select", "p1");
  await flush(el);
}

afterEach(cleanupWidgets);

describe("recipe-screen", () => {
  it("loads the ingredients and catalogues on connect (products wait for a catalogue choice)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    expect(api.listIngredients).toHaveBeenCalledTimes(1);
    expect(api.listCatalogues).toHaveBeenCalledTimes(1);
    expect(api.listProducts).not.toHaveBeenCalled();
    expect(list(el).ingredients).toEqual(ingredients);
  });

  it("shows a localised error banner when the initial load fails (and never rejects)", async () => {
    const api = stubApi({
      listIngredients: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("falls back to server.internal when a rejected load carries no code", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  // ── Ingredient authoring (list + form) ─────────────────────────────────────────────────────────

  it("opens the ingredient form for a create when New ingredient is clicked", async () => {
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api: stubApi() });
    await flush(el);

    expect(form(el).open).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;

    expect(form(el).open).toBe(true);
    expect(form(el).ingredient).toBeNull();
  });

  it("creates an ingredient from the form's detail, then closes and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;
    emit(form(el), "create-ingredient", { name: "Azúcar" });
    await flush(el);

    expect(api.createIngredient).toHaveBeenCalledWith({ name: "Azúcar" });
    expect(form(el).open).toBe(false);
    expect(api.listIngredients).toHaveBeenCalledTimes(2); // once on connect + once after the create
  });

  it("opens the form pre-filled when the list asks to edit an ingredient", async () => {
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api: stubApi() });
    await flush(el);

    emit(list(el), "edit-ingredient", { id: "i1" });
    await el.updateComplete;

    expect(form(el).open).toBe(true);
    expect(form(el).ingredient).toEqual(ingredients[0]);
  });

  it("drops an edit event for an unknown ingredient id (stale event)", async () => {
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api: stubApi() });
    await flush(el);

    emit(list(el), "edit-ingredient", { id: "nope" });
    await el.updateComplete;
    expect(form(el).open).toBe(false);
  });

  it("updates an ingredient from the form's edit detail, then closes and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    emit(list(el), "edit-ingredient", { id: "i1" });
    await el.updateComplete;
    const patch = { name: "Harina integral", active: true, allergens: null };
    emit(form(el), "update-ingredient", { id: "i1", patch });
    await flush(el);

    expect(api.updateIngredient).toHaveBeenCalledWith("i1", patch);
    expect(form(el).open).toBe(false);
    expect(api.listIngredients).toHaveBeenCalledTimes(2);
  });

  it("closes the form on wt-close without a write", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
    emit(form(el), "wt-close");
    await el.updateComplete;

    expect(form(el).open).toBe(false);
    expect(api.createIngredient).not.toHaveBeenCalled();
  });

  it("keeps the form open and shows the error when a create fails", async () => {
    const api = stubApi({
      createIngredient: vi.fn().mockRejectedValue({ code: "allergen.invalid_code" }),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;
    emit(form(el), "create-ingredient", { name: "Azúcar" });
    await flush(el);

    expect(errorKey(el)).toBe("allergen.invalid_code");
    expect(form(el).open).toBe(true); // left open for a retry
    expect(api.listIngredients).toHaveBeenCalledTimes(1); // NOT reloaded
  });

  it("keeps the form open and shows the fallback error when an update fails without a code", async () => {
    const api = stubApi({ updateIngredient: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    emit(list(el), "edit-ingredient", { id: "i1" });
    await el.updateComplete;
    emit(form(el), "update-ingredient", {
      id: "i1",
      patch: { name: "x", active: true, allergens: null },
    });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    expect(form(el).open).toBe(true);
  });

  it("files at most one ingredient when create-ingredient fires twice (single-flight)", async () => {
    let resolve!: () => void;
    const createIngredient = vi
      .fn()
      .mockImplementation(
        () => new Promise<Ingredient>((r) => (resolve = () => r(ingredients[0]!))),
      );
    const api = stubApi({ createIngredient });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;

    emit(form(el), "create-ingredient", { name: "Azúcar" });
    emit(form(el), "create-ingredient", { name: "Azúcar" });
    await el.updateComplete;

    expect(createIngredient).toHaveBeenCalledTimes(1);
    resolve();
    await flush(el);
  });

  it("files at most one update when update-ingredient fires twice (single-flight)", async () => {
    let resolve!: () => void;
    const updateIngredient = vi
      .fn()
      .mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const api = stubApi({ updateIngredient });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    emit(list(el), "edit-ingredient", { id: "i1" });
    await el.updateComplete;

    const patch = { name: "x", active: true, allergens: null };
    emit(form(el), "update-ingredient", { id: "i1", patch });
    emit(form(el), "update-ingredient", { id: "i1", patch });
    await el.updateComplete;

    expect(updateIngredient).toHaveBeenCalledTimes(1);
    resolve();
    await flush(el);
  });

  it("passes the busy flag down to the form while a create is in flight", async () => {
    let resolve!: () => void;
    const createIngredient = vi
      .fn()
      .mockImplementation(
        () => new Promise<Ingredient>((r) => (resolve = () => r(ingredients[0]!))),
      );
    const api = stubApi({ createIngredient });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;

    emit(form(el), "create-ingredient", { name: "Azúcar" });
    await el.updateComplete;
    expect(form(el).busy).toBe(true);
    resolve();
    await flush(el);
    expect(form(el).busy).toBe(false);
  });

  it("contains create-ingredient so it does not leak past the screen (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await el.updateComplete;

    const escaped = vi.fn();
    host.addEventListener("create-ingredient", escaped);
    emit(form(el), "create-ingredient", { name: "Azúcar" });
    await flush(el);

    expect(escaped).not.toHaveBeenCalled();
  });

  // ── Product recipe authoring (catalogue → product → editor) ────────────────────────────────────

  it("loads a catalogue's products when a catalogue is chosen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);

    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    // No product chosen yet, so the editor is hidden (product null → renders nothing).
    expect(editor(el).product).toBeNull();
  });

  it("switching catalogue reloads its products and clears the previous product selection", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);
    expect(editor(el).product).toEqual(products[0]);

    selectValue(el, "recipe-catalogue-select", "cat-b");
    await flush(el);

    expect(api.listProducts).toHaveBeenLastCalledWith("cat-b");
    expect(editor(el).product).toBeNull(); // the previous product is deselected
  });

  it("clears the products when the catalogue placeholder is re-selected", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=recipe-product-select]")).not.toBeNull();

    selectValue(el, "recipe-catalogue-select", "");
    await flush(el);
    // With no catalogue chosen there is no product picker.
    expect(el.shadowRoot!.querySelector("[data-test=recipe-product-select]")).toBeNull();
  });

  it("loads a product's recipe when a product is chosen and shows the editor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);

    expect(api.getProductRecipe).toHaveBeenCalledWith("p1");
    expect(editor(el).product).toEqual(products[0]);
    expect(editor(el).recipe).toEqual(recipe);
    expect(editor(el).ingredients).toEqual(ingredients);
  });

  it("hides the editor again when the product placeholder is re-selected", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);
    expect(editor(el).product).toEqual(products[0]);

    selectValue(el, "recipe-product-select", "");
    await flush(el);
    expect(editor(el).product).toBeNull();
  });

  it("saves the recipe when the editor asks, then reloads the recipe", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);

    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: ["i1", "i2"] });
    await flush(el);

    expect(api.setProductRecipe).toHaveBeenCalledWith("p1", ["i1", "i2"]);
    // getProductRecipe: once on choosing the product + once on the post-save reload.
    expect(api.getProductRecipe).toHaveBeenCalledTimes(2);
  });

  it("closes the editor (deselects the product) on the editor's wt-close", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);
    expect(editor(el).product).toEqual(products[0]);

    emit(editor(el), "wt-close");
    await el.updateComplete;
    expect(editor(el).product).toBeNull();
  });

  it("shows the error when loading a catalogue's products fails", async () => {
    const api = stubApi({ listProducts: vi.fn().mockRejectedValue({ code: "shared.invalid_id" }) });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);
    expect(errorKey(el)).toBe("shared.invalid_id");
  });

  it("shows the error when loading a product's recipe fails", async () => {
    const api = stubApi({
      getProductRecipe: vi.fn().mockRejectedValue({ code: "shared.invalid_id" }),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);

    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);
    selectValue(el, "recipe-product-select", "p1");
    await flush(el);
    expect(errorKey(el)).toBe("shared.invalid_id");
  });

  it("shows the error and keeps the editor when saving the recipe fails", async () => {
    const api = stubApi({
      setProductRecipe: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);

    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: ["i1"] });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    expect(editor(el).product).toEqual(products[0]); // still shown for a retry
    // getProductRecipe: once on choosing the product; the post-save reload never runs.
    expect(api.getProductRecipe).toHaveBeenCalledTimes(1);
  });

  it("files at most one recipe save when save-recipe fires twice (single-flight)", async () => {
    let resolve!: () => void;
    const setProductRecipe = vi
      .fn()
      .mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const api = stubApi({ setProductRecipe });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);

    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: ["i1"] });
    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: ["i1"] });
    await el.updateComplete;

    expect(setProductRecipe).toHaveBeenCalledTimes(1);
    resolve();
    await flush(el);
  });

  it("passes the busy flag down to the editor while a save is in flight", async () => {
    let resolve!: () => void;
    const setProductRecipe = vi
      .fn()
      .mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const api = stubApi({ setProductRecipe });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    await chooseProduct(el);

    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: ["i1"] });
    await el.updateComplete;
    expect(editor(el).busy).toBe(true);
    resolve();
    await flush(el);
    expect(editor(el).busy).toBe(false);
  });

  it("disables the editor and drops a save while the chosen product's recipe is still loading", async () => {
    // The data-loss window: choosing a product clears `recipe` to [] and shows the editor immediately,
    // so until getProductRecipe resolves every switch reads unchecked. A Save in that window would call
    // setProductRecipe(productId, []) and wipe the product's existing recipe. The editor must be busy
    // (Save disabled) and the screen must drop a save until the load settles.
    let resolveRecipe!: (r: RecipeLine[]) => void;
    const getProductRecipe = vi
      .fn()
      .mockImplementation(() => new Promise<RecipeLine[]>((r) => (resolveRecipe = r)));
    const api = stubApi({ getProductRecipe });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);
    selectValue(el, "recipe-product-select", "p1");
    await el.updateComplete; // the recipe load is IN FLIGHT (not settled)

    expect(editor(el).busy).toBe(true);
    emit(editor(el), "save-recipe", { productId: "p1", ingredientIds: [] });
    await el.updateComplete;
    expect(api.setProductRecipe).not.toHaveBeenCalled();

    resolveRecipe(recipe);
    await flush(el);
    expect(editor(el).busy).toBe(false);
    expect(editor(el).recipe).toEqual(recipe);
  });

  it("ignores a slow recipe load for a product the operator already switched away from", async () => {
    // A stale-response race: load(A) is slow, the operator picks B (load(B) resolves first), then A's
    // load resolves LAST and must not overwrite the recipe now shown for B.
    const recipeA: RecipeLine[] = [ingredients[0]!];
    const recipeB: RecipeLine[] = [ingredients[1]!];
    const deferreds: Record<string, (r: RecipeLine[]) => void> = {};
    const twoProducts: Product[] = [
      { ...products[0]!, id: "pA" },
      { ...products[0]!, id: "pB" },
    ];
    const api = stubApi({
      listProducts: vi.fn().mockResolvedValue(twoProducts),
      getProductRecipe: vi
        .fn()
        .mockImplementation((id: string) => new Promise<RecipeLine[]>((r) => (deferreds[id] = r))),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);

    selectValue(el, "recipe-product-select", "pA"); // load(A) starts, pending
    await el.updateComplete;
    selectValue(el, "recipe-product-select", "pB"); // switch to B; load(B) starts, pending
    await el.updateComplete;

    deferreds["pB"]!(recipeB); // B resolves first
    await flush(el);
    expect(editor(el).recipe).toEqual(recipeB);

    deferreds["pA"]!(recipeA); // A's slow load resolves LAST — must NOT overwrite B
    await flush(el);
    expect(editor(el).recipe).toEqual(recipeB);
  });

  it("suppresses the error from a superseded product's recipe load", async () => {
    // The catch-side of the same stale-response race: a superseded load that REJECTS must not raise its
    // error over the newer selection the operator is now looking at.
    const recipeB: RecipeLine[] = [ingredients[1]!];
    const resolvers: Record<string, (r: RecipeLine[]) => void> = {};
    const rejecters: Record<string, (e: unknown) => void> = {};
    const twoProducts: Product[] = [
      { ...products[0]!, id: "pA" },
      { ...products[0]!, id: "pB" },
    ];
    const api = stubApi({
      listProducts: vi.fn().mockResolvedValue(twoProducts),
      getProductRecipe: vi.fn().mockImplementation(
        (id: string) =>
          new Promise<RecipeLine[]>((res, rej) => {
            resolvers[id] = res;
            rejecters[id] = rej;
          }),
      ),
    });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);

    selectValue(el, "recipe-product-select", "pA"); // load(A) pending
    await el.updateComplete;
    selectValue(el, "recipe-product-select", "pB"); // switch to B; load(B) pending
    await el.updateComplete;

    resolvers["pB"]!(recipeB);
    await flush(el);
    rejecters["pA"]!({ code: "server.internal" }); // A fails LAST but is superseded
    await flush(el);

    expect(errorKey(el)).toBeNull(); // A's error is not ours to show — B is current
    expect(editor(el).recipe).toEqual(recipeB);
  });

  it("labels each product option by its description, falling back to a bare id", async () => {
    const richProducts: Product[] = [
      { ...products[0]!, id: "p-es", descriptions: { es: "Bizcocho" } },
      { ...products[0]!, id: "p-en", descriptions: { en: "Sponge" } }, // no es → first description
      { ...products[0]!, id: "p-none", descriptions: {} }, // no descriptions → the id
    ];
    const api = stubApi({ listProducts: vi.fn().mockResolvedValue(richProducts) });
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api });
    await flush(el);
    selectValue(el, "recipe-catalogue-select", "cat-a");
    await flush(el);

    const labels = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>(
        "[data-test=recipe-product-select] option",
      ),
    ]
      .filter((o) => o.value !== "") // drop the placeholder option
      .map((o) => o.textContent!.trim());
    expect(labels).toEqual(["Bizcocho", "Sponge", "p-none"]);
  });

  it("renders exactly one h1 (its own title)", async () => {
    const { el } = await mountWidget<RecipeScreen>("dashboard-recipe-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });
});

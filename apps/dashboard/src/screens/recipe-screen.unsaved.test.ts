import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  DashboardApi,
  Ingredient,
  CatalogueSummary,
  Product,
  RecipeLine,
} from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./recipe-screen.js";

class RecipeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-recipe-screen .api=${this.api}></dashboard-recipe-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("recipe-leave-test-app", RecipeLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-recipe-screen"];
type Editor = HTMLElementTagNameMap["dashboard-recipe-editor"];
const ingredients: Ingredient[] = [
  {
    id: "i1",
    name: "Harina de trigo",
    allergens: { gluten: { presence: "contains" } },
    dietaryOrigin: null,
    active: true,
  },
  { id: "i2", name: "Sal", allergens: {}, dietaryOrigin: null, active: true },
];

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];

const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "cat-a",
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
    dietDerivation: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
  },
];

const recipe: RecipeLine[] = [ingredients[0]!];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  const liveData = new LiveData();
  const api = {
    liveData,
    listIngredients: async () => ingredients.map((row) => ({ ...row })),
    listCatalogues: async () => catalogues,
    listProducts: async () => [products[0]!, { ...products[0]!, id: "p2", name: "Other product" }],
    getProductRecipe: async (id: string) => (id === "p1" ? recipe : [ingredients[1]!]),
    setProductRecipe: async () => {},
    createIngredient: async () => ({ ...ingredients[0]!, id: "new" }),
    updateIngredient: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<RecipeLeaveApp>("recipe-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-recipe-screen")!;
  await expect.poll(() => box(screen, "catalogueId")?.options.length).toBe(3);
  await select(screen, "catalogueId", "cat-a");
  await expect.poll(() => box(screen, "productId")?.options.length).toBe(3);
  await select(screen, "productId", "p1");
  await expect.poll(() => editor(screen).busy).toBe(false);
  await expect.poll(() => checked(screen, "i1")).toBe(true);
  return { app, screen, liveData };
}
function box(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `wt-combobox[name=${name}]`,
  )!;
}
async function select(screen: Screen, name: string, value: string) {
  await chooseOption(box(screen, name), value);
  await screen.updateComplete;
}
function editor(screen: Screen): Editor {
  return screen.shadowRoot!.querySelector("dashboard-recipe-editor")!;
}
function switchFor(screen: Screen, id: string) {
  return editor(screen).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    `[data-test=ing-${id}]`,
  )!;
}
function checked(screen: Screen, id: string) {
  return switchFor(screen, id)?.checked;
}
async function toggle(screen: Screen, id: string, checked: boolean) {
  switchFor(screen, id).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await editor(screen).updateComplete;
}
function click(screen: Screen, action: string) {
  editor(screen).shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: RecipeLeaveApp, proceed = () => {}) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
}
async function choose(app: RecipeLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
}
async function settle(screen: Screen) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  await editor(screen).updateComplete;
}
function alert(screen: Screen) {
  return screen.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim() ?? "";
}

it("a clean recipe leaves without asking", async () => {
  const { app } = await mount();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("protects additions and removals and treats the membership revert as clean regardless of toggle order", async () => {
  const { screen } = await mount();
  await toggle(screen, "i2", true);
  expect(unload()).toBe(true);
  await toggle(screen, "i1", false);
  expect(unload()).toBe(true);
  await toggle(screen, "i1", true);
  await toggle(screen, "i2", false);
  expect(unload()).toBe(false);
});
it("Keep retains native choices and Discard restores the fetched membership before leaving once", async () => {
  const { app, screen } = await mount();
  await toggle(screen, "i1", false);
  await toggle(screen, "i2", true);
  let left = 0;
  const kept = leave(app, () => {
    left++;
  });
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(left).toBe(0);
  expect(switchFor(screen, "i1").shadowRoot!.querySelector("input")!.checked).toBe(false);
  expect(switchFor(screen, "i2").shadowRoot!.querySelector("input")!.checked).toBe(true);
  const discarded = leave(app, () => {
    left++;
  });
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await editor(screen).updateComplete;
  expect(left).toBe(1);
  expect(checked(screen, "i1")).toBe(true);
  expect(checked(screen, "i2")).toBe(false);
  expect(unload()).toBe(false);
});
for (const route of ["cancel", "product", "catalogue"] as const) {
  it(`asks before ${route} replaces the recipe and restores the picker on Keep`, async () => {
    const { app, screen } = await mount();
    await toggle(screen, "i2", true);
    const act = async () => {
      if (route === "cancel") click(screen, "cancel");
      else
        await select(
          screen,
          route === "product" ? "productId" : "catalogueId",
          route === "product" ? "p2" : "cat-b",
        );
    };
    await act();
    await choose(app, "keep");
    await settle(screen);
    expect(editor(screen).product?.id).toBe("p1");
    expect(checked(screen, "i2")).toBe(true);
    expect(box(screen, "catalogueId").value).toBe("cat-a");
    expect(box(screen, "productId").value).toBe("p1");
    expect(unload()).toBe(true);
    await act();
    await choose(app, "discard");
    await settle(screen);
    if (route === "product") {
      expect(editor(screen).product?.id).toBe("p2");
      expect(checked(screen, "i1")).toBe(false);
      expect(checked(screen, "i2")).toBe(true);
    } else expect(editor(screen).product).toBeNull();
    expect(unload()).toBe(false);
  });
}
it("reselecting the same product or catalogue retains the dirty recipe without a warning or reload", async () => {
  let reads = 0;
  const { app, screen } = await mount({
    getProductRecipe: async () => {
      reads++;
      return recipe;
    },
  });
  await toggle(screen, "i2", true);
  await select(screen, "productId", "p1");
  await select(screen, "catalogueId", "cat-a");
  await settle(screen);
  expect(checked(screen, "i2")).toBe(true);
  expect(reads).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(true);
});
it("commits the exact membership after an accepted write before a failed refresh", async () => {
  let body: unknown;
  let written = false;
  const { app, screen } = await mount({
    setProductRecipe: async (id, ids) => {
      body = { id, ids };
      written = true;
    },
    getProductRecipe: async () => {
      if (written) throw { code: "connection.failed" };
      return recipe;
    },
  });
  await toggle(screen, "i1", false);
  await toggle(screen, "i2", true);
  click(screen, "confirm");
  await expect.poll(() => alert(screen)).toBe(codeMessage("connection.failed"));
  expect(body).toEqual({ id: "p1", ids: ["i2"] });
  expect(checked(screen, "i1")).toBe(false);
  expect(checked(screen, "i2")).toBe(true);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("a refused recipe write retains the changed membership and warning", async () => {
  const { screen } = await mount({
    setProductRecipe: async () => {
      throw { code: "connection.failed" };
    },
  });
  await toggle(screen, "i2", true);
  click(screen, "confirm");
  await expect.poll(() => alert(screen)).toBe(codeMessage("connection.failed"));
  expect(checked(screen, "i2")).toBe(true);
  expect(unload()).toBe(true);
});
for (const refresh of ["success", "refusal"] as const) {
  it(`a later toggle survives save and ${refresh} refresh and compares with the submitted membership`, async () => {
    const write = deferred<void>();
    let written = false;
    let body: unknown;
    const { screen } = await mount({
      setProductRecipe: async (id, ids) => {
        body = { id, ids: [...ids] };
        await write.promise;
        written = true;
      },
      getProductRecipe: async () => {
        if (!written) return recipe;
        if (refresh === "refusal") throw { code: "connection.failed" };
        return ingredients;
      },
    });
    await toggle(screen, "i2", true);
    click(screen, "confirm");
    await expect.poll(() => editor(screen).busy).toBe(true);
    await toggle(screen, "i1", false);
    write.resolve();
    await expect.poll(() => editor(screen).busy).toBe(false);
    expect(body).toEqual({ id: "p1", ids: ["i1", "i2"] });
    expect(checked(screen, "i1")).toBe(false);
    expect(checked(screen, "i2")).toBe(true);
    expect(unload()).toBe(true);
    await toggle(screen, "i1", true);
    expect(unload()).toBe(false);
  });
}
it("an ingredient save commits only its modal and keeps the recipe selection dirty", async () => {
  const { screen } = await mount();
  await toggle(screen, "i2", true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-ingredient-form")!;
  await form.updateComplete;
  const name = form.shadowRoot!.querySelector("wt-input")!;
  name.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Sugar" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => form.open).toBe(false);
  expect(checked(screen, "i2")).toBe(true);
  expect(unload()).toBe(true);
});
it("live product object replacements preserve dirty membership and an outstanding warning", async () => {
  let reads = 0;
  const { app, screen, liveData } = await mount({
    listProducts: async () => {
      reads++;
      return [
        { ...products[0]!, name: reads === 1 ? "Bizcocho" : "Updated name" },
        { ...products[0]!, id: "p2" },
      ];
    },
  });
  await toggle(screen, "i2", true);
  const pending = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  liveData.invalidate([{ type: "products", id: "p1" }]);
  await settle(screen);
  await expect.poll(() => editor(screen).product?.name).toBe("Updated name");
  expect(checked(screen, "i2")).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(unload()).toBe(true);
});
it("live removal of a product retains its dirty recipe until the operator leaves", async () => {
  let removed = false;
  const { app, screen, liveData } = await mount({
    listProducts: async () => (removed ? [] : [products[0]!, { ...products[0]!, id: "p2" }]),
  });
  await toggle(screen, "i2", true);
  removed = true;
  liveData.invalidate([{ type: "products", id: "p1" }]);
  await expect.poll(() => box(screen, "productId").options.length).toBe(1);
  expect(editor(screen).product?.id).toBe("p1");
  expect(checked(screen, "i2")).toBe(true);
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  expect(unload()).toBe(false);
});
it("disconnect releases recipe protection and reconnect starts with no selected recipe", async () => {
  const { screen } = await mount();
  await toggle(screen, "i2", true);
  const parent = screen.parentNode!;
  screen.remove();
  expect(unload()).toBe(false);
  parent.append(screen);
  await settle(screen);
  expect(editor(screen).product).toBeNull();
  expect(box(screen, "catalogueId").value).toBe("");
  expect(unload()).toBe(false);
});
it("a recipe editor put back after a detached update still asks before Cancel discards a change", async () => {
  const { app, screen } = await mount();
  await reattachAfterDetachedUpdate(editor(screen));
  await toggle(screen, "i2", true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  let closed = 0;
  editor(screen).addEventListener("wt-close", () => closed++);
  click(screen, "cancel");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  expect(closed).toBe(0);
});
for (const result of ["success", "refusal"] as const) {
  it(`a departed recipe save's ${result} cannot read or alter a reconnected editor`, async () => {
    const write = deferred<void>();
    let reads = 0;
    const { screen } = await mount({
      setProductRecipe: () => write.promise,
      getProductRecipe: async () => {
        reads++;
        return recipe;
      },
    });
    await toggle(screen, "i2", true);
    click(screen, "confirm");
    await expect.poll(() => editor(screen).busy).toBe(true);
    const parent = screen.parentNode!;
    screen.remove();
    parent.append(screen);
    await settle(screen);
    await select(screen, "catalogueId", "cat-a");
    await expect.poll(() => box(screen, "productId").options.length).toBe(3);
    await select(screen, "productId", "p1");
    await expect.poll(() => editor(screen).busy).toBe(false);
    await toggle(screen, "i1", false);
    const before = reads;
    if (result === "success") write.resolve();
    else write.reject({ code: "connection.failed" });
    await settle(screen);
    expect(reads).toBe(before);
    expect(checked(screen, "i1")).toBe(false);
    expect(checked(screen, "i2")).toBe(false);
    expect(alert(screen)).toBe("");
    expect(unload()).toBe(true);
    await toggle(screen, "i1", true);
    expect(unload()).toBe(false);
  });
}
it("forced reset discards the membership and cancels an outstanding question", async () => {
  const { app, screen } = await mount();
  await toggle(screen, "i2", true);
  const pending = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  app.leave.forceReset();
  screen.remove();
  expect(await pending).toBe("stale");
  expect(unload()).toBe(false);
});

for (const result of ["success", "refusal"] as const) {
  it(`a superseded same-product recipe load's ${result} cannot replace a later baseline`, async () => {
    const old = deferred<RecipeLine[]>();
    let p1reads = 0;
    const { screen } = await mount({
      getProductRecipe: async (id) => {
        if (id === "p2") return [ingredients[1]!];
        p1reads++;
        if (p1reads === 2) return old.promise;
        return p1reads === 1 ? recipe : [ingredients[1]!];
      },
    });
    await select(screen, "productId", "p2");
    await expect.poll(() => editor(screen).busy).toBe(false);
    await select(screen, "productId", "p1");
    await expect.poll(() => p1reads).toBe(2);
    await select(screen, "productId", "p2");
    await expect.poll(() => editor(screen).busy).toBe(false);
    await select(screen, "productId", "p1");
    await expect.poll(() => checked(screen, "i2")).toBe(true);
    await toggle(screen, "i1", true);
    if (result === "success") old.resolve(recipe);
    else old.reject({ code: "connection.failed" });
    await settle(screen);
    expect(checked(screen, "i1")).toBe(true);
    expect(checked(screen, "i2")).toBe(true);
    expect(alert(screen)).toBe("");
    expect(editor(screen).recipe.map((line) => line.id)).toEqual(["i2"]);
    await toggle(screen, "i1", false);
    expect(unload()).toBe(false);
  });
  for (const kind of ["create", "update"] as const)
    it(`a departed ingredient ${kind}'s ${result} cannot close or refuse a replacement form`, async () => {
      const write = deferred<Ingredient>();
      let reads = 0;
      const { screen } = await mount({
        createIngredient: () => write.promise,
        updateIngredient: async () => {
          await write.promise;
        },
        listIngredients: async () => {
          reads++;
          return ingredients;
        },
      });
      const open = async () => {
        screen.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
        await screen.updateComplete;
        const form = screen.shadowRoot!.querySelector("dashboard-ingredient-form")!;
        await form.updateComplete;
        return form;
      };
      const changeName = async (
        form: HTMLElementTagNameMap["dashboard-ingredient-form"],
        value: string,
      ) => {
        form
          .shadowRoot!.querySelector("wt-input")!
          .dispatchEvent(
            new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
          );
        await form.updateComplete;
      };
      let form = await open();
      if (kind === "update") {
        form.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
        await screen.updateComplete;
        screen.shadowRoot!.querySelector("dashboard-ingredient-list")!.dispatchEvent(
          new CustomEvent("edit-ingredient", {
            detail: { id: "i1" },
            bubbles: true,
            composed: true,
          }),
        );
        await screen.updateComplete;
        await form.updateComplete;
      }
      await changeName(form, "Old sugar");
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
      await expect.poll(() => form.busy).toBe(true);
      const parent = screen.parentNode!;
      screen.remove();
      parent.append(screen);
      await settle(screen);
      form = await open();
      await changeName(form, "Replacement sugar");
      const before = reads;
      if (result === "success") write.resolve({ ...ingredients[0]!, id: "new" });
      else write.reject({ code: "connection.failed" });
      await settle(screen);
      await form.updateComplete;
      expect(form.open).toBe(true);
      expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Replacement sugar");
      expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
      expect(reads).toBe(before);
      expect(unload()).toBe(true);
    });
}

for (const result of ["success", "refusal"] as const) {
  it(`a departed ingredient refresh's ${result} cannot replace reconnected ingredients or errors`, async () => {
    const refresh = deferred<Ingredient[]>();
    let reads = 0;
    const { screen } = await mount({
      listIngredients: async () => {
        reads++;
        return reads === 2 ? refresh.promise : ingredients;
      },
    });
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
    await screen.updateComplete;
    const form = screen.shadowRoot!.querySelector("dashboard-ingredient-form")!;
    await form.updateComplete;
    form.dispatchEvent(
      new CustomEvent("create-ingredient", {
        detail: { name: "Sugar" },
        bubbles: true,
        composed: true,
      }),
    );
    await expect.poll(() => reads).toBe(2);
    const parent = screen.parentNode!;
    screen.remove();
    parent.append(screen);
    await expect.poll(() => reads).toBe(3);
    await settle(screen);
    if (result === "success") refresh.resolve([{ ...ingredients[0]!, name: "Old reply" }]);
    else refresh.reject({ code: "connection.failed" });
    await settle(screen);
    expect(screen.shadowRoot!.querySelector("dashboard-ingredient-list")!.ingredients).toEqual(
      ingredients,
    );
    expect(alert(screen)).toBe("");
    expect(unload()).toBe(false);
  });
}

it("a fetched multi-ingredient membership revert is clean even when switches were toggled in another order", async () => {
  const { screen } = await mount({ getProductRecipe: async () => ingredients });
  await expect.poll(() => checked(screen, "i2")).toBe(true);
  await toggle(screen, "i1", false);
  expect(unload()).toBe(true);
  await toggle(screen, "i1", true);
  expect(unload()).toBe(false);
});

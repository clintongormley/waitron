import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { CategorySummary, DashboardApi } from "../api/client.js";
afterEach(cleanupWidgets);
// The tree/flat toggle persists to localStorage; clear it so every test starts in tree mode.
beforeEach(() => {
  localStorage.clear();
});
describe.each(["light", "dark"] as const)("categories (%s)", (theme) => {
  it.each(["empty", "populated", "failed", "loading"] as const)(
    "renders the %s state accessibly",
    async (state) => {
      const categories = state === "empty" ? [] : [{ id: "food", name: "Food", parentId: null }];
      const api = {
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        listLibraryProducts: async () => [],
        listCategories: () =>
          state === "failed"
            ? Promise.reject(new Error("load"))
            : state === "loading"
              ? new Promise(() => {})
              : Promise.resolve(categories),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<CategoriesScreen>(
        "dashboard-categories-screen",
        { api },
        theme,
      );
      if (state === "failed")
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
        );
      else if (state !== "loading")
        await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
      await expectNoA11yViolations(host);
    },
  );

  it("renders nested tree rows with a colour swatch, then the flat toggle, accessibly", async () => {
    const categories: CategorySummary[] = [
      { id: "food", name: "Food", parentId: null },
      { id: "breakfast", name: "Breakfast", parentId: "food" },
    ];
    const api = {
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      listLibraryProducts: async () => [],
      listCategories: async () => categories,
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api },
      theme,
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  function membersApi(): DashboardApi {
    const categories: CategorySummary[] = [
      { id: "food", name: "Food", parentId: null },
      { id: "drink", name: "Drinks", parentId: null },
      { id: "breakfast", name: "Breakfast", parentId: "food" },
    ];
    return {
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      listCategories: async () => categories,
      listLibraryProducts: async () => [
        {
          catalogueId: "menu",
          categoryId: "food",
          pricingUnit: "each",
          unitPrice: "2",
          vatClass: "general",
          allergens: null,
          manualAllergens: null,
          dietOverride: null,
          image: null,
          id: "p",
          name: "Toast",
          customerName: { en: "Buttered toast" },
          primaryCategoryId: "food",
          active: true,
        },
        {
          catalogueId: "menu",
          categoryId: "breakfast",
          pricingUnit: "each",
          unitPrice: "3",
          vatClass: "general",
          allergens: null,
          manualAllergens: null,
          dietOverride: null,
          image: null,
          id: "q",
          name: "Porridge",
          customerName: { en: "Warm porridge" },
          primaryCategoryId: "breakfast",
          active: true,
        },
      ],
    } as unknown as DashboardApi;
  }

  it("opens the products modal with member lozenges accessibly", async () => {
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api: membersApi() },
      theme,
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("shows the add-products checkbox table accessibly", async () => {
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api: membersApi() },
      theme,
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  async function openFood(el: CategoriesScreen): Promise<void> {
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
    await el.updateComplete;
  }

  it("lists the products below a category too, with the toggle on, accessibly", async () => {
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api: membersApi() },
      theme,
    );
    await openFood(el);
    const toggle = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
      'wt-switch[name="include-descendants"]',
    )!;
    toggle.checked = true;
    toggle.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      '[data-test="category-products"]',
    )!;
    await members.updateComplete;
    expect(members.shadowRoot!.querySelectorAll("tr[data-row-key]")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("confirms a move of the picked products accessibly", async () => {
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api: membersApi() },
      theme,
    );
    await openFood(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
    await el.updateComplete;
    const add = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      '[data-test="category-add-products"]',
    )!;
    await add.updateComplete;
    add.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-all"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
    await el.updateComplete;
    const confirm = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      'wt-modal[data-test="move-confirm"]',
    )!;
    expect(confirm.open).toBe(true);
    await confirm.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("opens the main-category dialog accessibly", async () => {
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api: membersApi() },
      theme,
    );
    await openFood(el);
    const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      '[data-test="category-products"]',
    )!;
    await members.updateComplete;
    members.shadowRoot!.querySelector<HTMLElement>('[data-test="change-main"]')!.click();
    await el.updateComplete;
    const combobox = el.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('wt-modal[data-test="main-category-dialog"] wt-combobox[name="main-category"]')!;
    await combobox.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("shows a refused main-category save above Save accessibly", async () => {
    const api = {
      ...membersApi(),
      setMainCategory: () =>
        Promise.reject({
          code: "management.request_invalid",
          params: { field: "primaryCategoryId" },
        }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api },
      theme,
    );
    await openFood(el);
    const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      '[data-test="category-products"]',
    )!;
    await members.updateComplete;
    members.shadowRoot!.querySelector<HTMLElement>('[data-test="change-main"]')!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector('wt-modal[data-test="main-category-dialog"]')!;
    dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
    const actions = dialog.querySelector("wt-form-actions")!;
    await vi.waitFor(async () => expect(await formMessageOf(actions)).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it("shows the resolved delete preview accessibly", async () => {
    const api = {
      ...membersApi(),
      getCategoryDependants: async () => ({
        products: [{ id: "p", name: "Toast" }],
        children: [{ id: "breakfast", name: "Breakfast" }],
        parentId: null,
        routes: [{ id: "r1", station: "Grill", zone: null }],
      }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<CategoriesScreen>(
      "dashboard-categories-screen",
      { api },
      theme,
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
    actions.querySelectorAll("wt-button")[1]!.click();
    await el.updateComplete;
    const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
    await vi.waitFor(() =>
      expect(
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>('wt-button[variant="danger"]')!
          .disabled,
      ).toBe(false),
    );
    // Both reassignment pickers are drawn: the category has products and a subcategory.
    expect(modal.querySelectorAll("wt-combobox")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });
});

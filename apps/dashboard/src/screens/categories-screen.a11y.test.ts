import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
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
      const categories =
        state === "empty"
          ? []
          : [{ id: "food", name: { en: "Food" }, image: null, color: null, parentId: null }];
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
      { id: "food", name: { en: "Food" }, image: null, color: "#b12525", parentId: null },
      { id: "breakfast", name: { en: "Breakfast" }, image: null, color: null, parentId: "food" },
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
      { id: "food", name: { en: "Food" }, image: null, color: null, parentId: null },
      { id: "drink", name: { en: "Drinks" }, image: null, color: "#2244aa", parentId: null },
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
          descriptions: { en: "Toast" },
          categoryIds: ["food", "drink"],
          primaryCategoryId: "food",
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

  it("opens the membership editor with comboboxes and lozenges accessibly", async () => {
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
    // The member list carries the Edit-membership / Remove row actions; the first opens the picker.
    const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      '[data-test="category-products"]',
    )!;
    await members.updateComplete;
    members
      .shadowRoot!.querySelector("wt-row-actions")!
      .querySelector<HTMLElement>("wt-button")!
      .click();
    await el.updateComplete;
    // The product belongs to two categories, so the picker shows a multi-select combobox with two
    // lozenge chips and the single-select reporting combobox — the states this case exists to scan.
    const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
    await picker.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("shows the resolved delete preview accessibly", async () => {
    const api = {
      ...membersApi(),
      getCategoryDependants: async () => ({
        products: [{ id: "p", name: { en: "Toast" }, reporting: true }],
        children: [{ id: "breakfast", name: { en: "Breakfast" } }],
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
    await expectNoA11yViolations(host);
  });
});

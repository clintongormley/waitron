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
});

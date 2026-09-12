import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { DashboardApi } from "../api/client.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("categories (%s)", (theme) => {
  it.each(["empty", "populated", "failed", "loading"] as const)(
    "renders the %s state accessibly",
    async (state) => {
      const categories =
        state === "empty"
          ? []
          : [{ id: "food", name: { en: "Food" }, image: null, parentId: null }];
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
});
